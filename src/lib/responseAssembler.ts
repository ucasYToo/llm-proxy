/**
 * SSE 响应组装与 token 提取
 * 从 route.ts 中提取的纯数据处理逻辑
 */

import type { TokenUsage } from "./types";

/**
 * Extract token usage from a response body (supports Anthropic and OpenAI formats).
 */
export function extractTokenUsage(body: unknown): TokenUsage | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const usage = b.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;

  // Anthropic format: input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens
  // OpenAI format: prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details.cached_tokens
  const inputTokens: number | undefined = (usage.input_tokens as number | undefined) ?? (usage.prompt_tokens as number | undefined);
  const outputTokens: number | undefined = (usage.output_tokens as number | undefined) ?? (usage.completion_tokens as number | undefined);
  const totalTokens: number | undefined = (usage.total_tokens as number | undefined) ??
    (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);

  // Cache tokens: Anthropic uses cache_read_input_tokens, OpenAI uses prompt_tokens_details.cached_tokens
  let cacheReadTokens: number | undefined = undefined;
  if (typeof usage.cache_read_input_tokens === "number") {
    cacheReadTokens = usage.cache_read_input_tokens;
  } else if (typeof usage.cached_tokens === "number") {
    cacheReadTokens = usage.cached_tokens;
  } else if (usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object") {
    const details = usage.prompt_tokens_details as Record<string, unknown>;
    if (typeof details.cached_tokens === "number") {
      cacheReadTokens = details.cached_tokens;
    }
  }
  const cacheCreationTokens: number | undefined =
    typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : undefined;

  if (inputTokens === undefined && outputTokens === undefined) return undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheCreationTokens,
  };
}

/**
 * Assemble Anthropic Messages API streaming events into a complete response.
 * Events: message_start, content_block_start, content_block_delta, content_block_stop,
 *         message_delta, message_stop
 */
export function assembleAnthropicResponse(events: unknown[]): Record<string, unknown> {
  let message: Record<string, unknown> = {};
  const contentBlocks: Record<string, unknown>[] = [];
  let currentBlockIndex = -1;
  let currentText = "";

  for (const event of events) {
    const e = event as Record<string, unknown>;
    switch (e.type) {
      case "message_start": {
        const msg = e.message as Record<string, unknown> | undefined;
        if (msg) {
          message = { ...msg };
        }
        break;
      }
      case "content_block_start": {
        currentBlockIndex = (e.index as number) ?? contentBlocks.length;
        const block = (e.content_block as Record<string, unknown>) ?? {};
        contentBlocks[currentBlockIndex] = { ...block };
        // Initialize currentText based on block type
        if (block.type === "thinking") {
          currentText = (block.thinking as string) ?? "";
        } else {
          currentText = (block.text as string) ?? "";
        }
        break;
      }
      case "content_block_delta": {
        const delta = e.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          currentText += delta.text;
        } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          currentText += delta.thinking;
        } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          currentText += delta.partial_json;
        } else if (delta?.type === "signature_delta" && typeof delta.signature === "string") {
          // Store signature on the block directly
          if (currentBlockIndex >= 0 && contentBlocks[currentBlockIndex]) {
            contentBlocks[currentBlockIndex].signature = delta.signature;
          }
        }
        break;
      }
      case "content_block_stop": {
        if (currentBlockIndex >= 0 && contentBlocks[currentBlockIndex]) {
          const block = contentBlocks[currentBlockIndex];
          if (block.type === "text") {
            block.text = currentText;
          } else if (block.type === "thinking") {
            block.thinking = currentText;
          } else if (block.type === "tool_use") {
            try {
              block.input = JSON.parse(currentText);
            } catch {
              block.input = currentText;
            }
          }
        }
        currentText = "";
        break;
      }
      case "message_delta": {
        const delta = e.delta as Record<string, unknown> | undefined;
        if (delta) {
          Object.assign(message, delta);
        }
        const usage = e.usage as Record<string, unknown> | undefined;
        if (usage) {
          message.usage = {
            ...((message.usage as Record<string, unknown>) ?? {}),
            ...usage,
          };
        }
        break;
      }
    }
  }

  message.content = contentBlocks;
  return message;
}

/**
 * Assemble OpenAI Chat Completions streaming chunks into a complete response.
 */
export function assembleOpenAIResponse(events: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const choicesMap: Map<number, Record<string, unknown>> = new Map();

  for (const event of events) {
    const e = event as Record<string, unknown>;
    if (!result.id && e.id) result.id = e.id;
    if (!result.model && e.model) result.model = e.model;
    if (!result.created && e.created) result.created = e.created;

    const choices = e.choices as Array<Record<string, unknown>> | undefined;
    if (!choices) continue;

    for (const choice of choices) {
      const idx = (choice.index as number) ?? 0;
      if (!choicesMap.has(idx)) {
        choicesMap.set(idx, { index: idx, message: { role: "assistant", content: "" } });
      }
      const accumulated = choicesMap.get(idx)!;
      const accMsg = accumulated.message as Record<string, unknown>;
      const delta = choice.delta as Record<string, unknown> | undefined;

      if (delta) {
        if (typeof delta.content === "string") {
          accMsg.content = ((accMsg.content as string) ?? "") + delta.content;
        }
        if (delta.role) accMsg.role = delta.role;
        if (delta.tool_calls) {
          // Accumulate tool calls
          if (!accMsg.tool_calls) accMsg.tool_calls = [];
          const existingCalls = accMsg.tool_calls as Array<Record<string, unknown>>;
          const newCalls = delta.tool_calls as Array<Record<string, unknown>>;
          for (const tc of newCalls) {
            const tcIdx = (tc.index as number) ?? 0;
            if (!existingCalls[tcIdx]) {
              existingCalls[tcIdx] = { ...tc };
              const fn = existingCalls[tcIdx].function as Record<string, unknown> | undefined;
              if (fn) existingCalls[tcIdx].function = { ...fn };
            } else {
              const existing = existingCalls[tcIdx];
              const fn = tc.function as Record<string, unknown> | undefined;
              if (fn) {
                const existingFn = (existing.function ?? {}) as Record<string, unknown>;
                if (typeof fn.arguments === "string") {
                  existingFn.arguments = ((existingFn.arguments as string) ?? "") + fn.arguments;
                }
                if (fn.name) existingFn.name = fn.name;
                existing.function = existingFn;
              }
            }
          }
        }
      }

      if (choice.finish_reason) accumulated.finish_reason = choice.finish_reason;
    }

    if (e.usage) result.usage = e.usage;
  }

  result.object = "chat.completion";
  result.choices = Array.from(choicesMap.values()).sort(
    (a, b) => (a.index as number) - (b.index as number)
  );

  return result;
}
