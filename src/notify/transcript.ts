import { readFileSync } from "node:fs";

/**
 * 从 Claude Code transcript jsonl 中提取最后一条 assistant 消息的纯文本。
 *
 * transcript 每行是一条事件：
 *   { type: "assistant", message: { content: string | Array<{ type, text }> }, ... }
 *
 * 返回 null 表示：文件不存在 / 解析失败 / 没有 assistant 消息 / 内容里没有 text 部分。
 */
export const extractLastAssistantText = (
  transcriptPath: string | null | undefined,
  maxLen = 1000,
): string | null => {
  if (!transcriptPath) return null;
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed.type !== "assistant") continue;
    const message = parsed.message as Record<string, unknown> | undefined;
    const content = message?.content;
    const text = pickText(content);
    if (!text) return null;
    return truncate(text, maxLen);
  }
  return null;
};

const pickText = (content: unknown): string | null => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const c = part as Record<string, unknown>;
    if (c.type === "text" && typeof c.text === "string") {
      parts.push(c.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
};

const truncate = (text: string, maxLen: number): string => {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + "…";
};

/** 把文本逐行加上 `> ` 前缀，渲染为 markdown 引用块。 */
export const quoteMarkdown = (text: string): string => {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
};
