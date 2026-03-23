/**
 * 日志内容提取函数
 * 从 LogsTab.tsx 中提取的纯数据处理逻辑，用于从请求/响应体中提取可读文本
 */

import { truncateText } from "./format";

/** 从 content 数组中提取多条文本（每条一行） */
export function extractContentLines(content: unknown[]): string[] {
  const lines: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || !item) continue;
    const i = item as Record<string, unknown>;
    switch (i.type) {
      case "text":
        if (typeof i.text === "string" && i.text.trim()) {
          lines.push(`[text] ${truncateText(i.text.trim(), 110)}`);
        }
        break;
      case "thinking":
        if (typeof i.thinking === "string" && i.thinking.trim()) {
          lines.push(`[thinking] ${truncateText(i.thinking.trim(), 110)}`);
        }
        break;
      case "tool_use":
        if (typeof i.name === "string") {
          lines.push(`[tool_use] ${i.name}`);
        }
        break;
      case "tool_result":
        if (typeof i.content === "string" && i.content.trim()) {
          lines.push(`[tool_result] ${truncateText(i.content.trim(), 110)}`);
        } else if (Array.isArray(i.content)) {
          const nested = extractContentLines(i.content);
          nested.forEach(line => lines.push(line.startsWith("[") ? line : `[tool_result] ${line}`));
        }
        break;
      case "image":
        lines.push("[image]");
        break;
      default:
        if (i.type && typeof i.type === "string") {
          const text = typeof i.text === "string" ? i.text : 
                       typeof i.content === "string" ? i.content : "";
          if (text.trim()) {
            lines.push(`[${i.type}] ${truncateText(text.trim(), 110)}`);
          } else {
            lines.push(`[${i.type}]`);
          }
        }
        break;
    }
  }
  return lines;
}

/** 提取最后一条 message 的文本内容（返回多行） */
export function extractLastMessageLines(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages)) return [];
  const lastMsg = b.messages[b.messages.length - 1];
  if (!lastMsg || typeof lastMsg !== "object") return [];
  const msg = lastMsg as Record<string, unknown>;
  const content = msg.content;
  if (typeof content === "string") {
    return content.trim() ? [truncateText(content.trim(), 120)] : [];
  }
  if (Array.isArray(content)) {
    return extractContentLines(content);
  }
  return [];
}

/** 提取响应体的 content（返回多行） */
export function extractResponseLines(responseBody: unknown): string[] {
  if (!responseBody) return [];
  if (typeof responseBody === "string") {
    return responseBody.trim() ? [truncateText(responseBody.trim(), 120)] : [];
  }
  if (typeof responseBody === "object") {
    const rb = responseBody as Record<string, unknown>;
    if (typeof rb.content === "string" && rb.content.trim()) {
      return [truncateText(rb.content.trim(), 120)];
    }
    if (Array.isArray(rb.content)) {
      return extractContentLines(rb.content);
    }
    if (Array.isArray(rb.choices) && rb.choices.length > 0) {
      const choice = rb.choices[0] as Record<string, unknown>;
      if (choice.message && typeof choice.message === "object") {
        const msg = choice.message as Record<string, unknown>;
        if (typeof msg.content === "string" && msg.content.trim()) {
          return [truncateText(msg.content.trim(), 120)];
        }
        if (Array.isArray(msg.content)) {
          return extractContentLines(msg.content);
        }
      }
    }
    if (Array.isArray(rb.choices) && rb.choices.length > 0) {
      const firstChoice = rb.choices[0] as Record<string, unknown>;
      if (firstChoice.delta && typeof firstChoice.delta === "object") {
        const delta = firstChoice.delta as Record<string, unknown>;
        if (typeof delta.content === "string" && delta.content.trim()) {
          return [truncateText(delta.content.trim(), 120)];
        }
      }
    }
  }
  return [];
}
