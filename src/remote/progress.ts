import path from "path";
import type { RemoteMessage, RemoteThread } from "../storage/remote";

export type RemoteProgressStatus =
  | "queued"
  | "running"
  | "waiting_permission"
  | "done"
  | "failed";

export interface RemoteProgressSnapshot {
  threadId: string;
  shortId: string;
  inboundMessageId: string;
  source: string;
  cwd: string | null;
  project: string;
  prompt: string;
  status: RemoteProgressStatus;
  phase: string;
  events: string[];
  tools: string[];
  answerPreview: string;
  finalText: string;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  dashboardUrl?: string;
}

const MAX_EVENTS = 5;
const MAX_TOOLS = 8;
const MAX_PREVIEW_CHARS = 1400;

const nowIso = (): string => new Date().toISOString();

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const stringAt = (obj: Record<string, unknown>, key: string): string | null =>
  typeof obj[key] === "string" ? (obj[key] as string) : null;

const pushUnique = (items: string[], value: string, limit: number): string[] => {
  const text = value.trim();
  if (!text) return items;
  const next = items.includes(text) ? items : [...items, text];
  return next.slice(-limit);
};

const pushEvent = (snapshot: RemoteProgressSnapshot, event: string): void => {
  snapshot.events = pushUnique(snapshot.events, event, MAX_EVENTS);
};

const extractText = (value: unknown): string => {
  const record = asRecord(value);
  const direct = stringAt(record, "text") ?? stringAt(record, "result");
  if (direct) return direct;
  const delta = asRecord(record.delta);
  const deltaText = stringAt(delta, "text");
  if (deltaText) return deltaText;
  const message =
    record.message && typeof record.message === "object"
      ? asRecord(record.message)
      : null;
  if (message) {
    const fromMessage = extractText(message);
    if (fromMessage) return fromMessage;
  }
  const content = Array.isArray(record.content)
    ? record.content
    : message && Array.isArray(message.content)
      ? message.content
      : null;
  if (!content) return "";
  return content
    .map((item) => {
      const part = asRecord(item);
      if (part.type === "thinking") return "";
      return stringAt(part, "text") ?? "";
    })
    .filter(Boolean)
    .join("");
};

const extractToolNames = (value: unknown): string[] => {
  const record = asRecord(value);
  const direct = stringAt(record, "tool_name") ?? stringAt(record, "name");
  const names = direct ? [direct] : [];
  const message =
    record.message && typeof record.message === "object"
      ? asRecord(record.message)
      : null;
  const content = Array.isArray(record.content)
    ? record.content
    : message && Array.isArray(message.content)
      ? message.content
      : [];
  for (const item of content) {
    const part = asRecord(item);
    if (part.type === "tool_use") {
      const name = stringAt(part, "name");
      if (name) names.push(name);
    }
  }
  return names;
};

const extractError = (value: unknown): string | null => {
  const record = asRecord(value);
  const candidates = [
    stringAt(record, "error"),
    stringAt(record, "message"),
    stringAt(record, "result"),
    stringAt(asRecord(record.error), "message"),
  ];
  return candidates.find(Boolean) ?? null;
};

export const createInitialProgressSnapshot = (input: {
  thread: RemoteThread;
  message: RemoteMessage;
  dashboardUrl?: string;
}): RemoteProgressSnapshot => {
  const ts = nowIso();
  return {
    threadId: input.thread.id,
    shortId: input.thread.shortId,
    inboundMessageId: input.message.id,
    source: input.thread.source,
    cwd: input.thread.cwd,
    project: input.thread.cwd ? path.basename(input.thread.cwd) : "unknown",
    prompt: truncate(input.message.text, 500),
    status: "queued",
    phase: "已接收，等待执行",
    events: ["已接收远程消息"],
    tools: [],
    answerPreview: "",
    finalText: "",
    error: null,
    startedAt: ts,
    updatedAt: ts,
    elapsedMs: 0,
    dashboardUrl: input.dashboardUrl,
  };
};

export const markProgressRunning = (
  snapshot: RemoteProgressSnapshot,
  phase = "Claude 正在处理",
): RemoteProgressSnapshot => {
  const next = { ...snapshot };
  next.status = "running";
  next.phase = phase;
  next.updatedAt = nowIso();
  next.elapsedMs = Date.parse(next.updatedAt) - Date.parse(next.startedAt);
  pushEvent(next, phase);
  return next;
};

export const markProgressFailed = (
  snapshot: RemoteProgressSnapshot,
  error: string,
): RemoteProgressSnapshot => {
  const next = { ...snapshot };
  next.status = "failed";
  next.phase = "执行失败";
  next.error = truncate(error, 1000);
  next.updatedAt = nowIso();
  next.elapsedMs = Date.parse(next.updatedAt) - Date.parse(next.startedAt);
  pushEvent(next, "执行失败");
  return next;
};

export const markProgressDone = (
  snapshot: RemoteProgressSnapshot,
  text: string,
): RemoteProgressSnapshot => {
  const next = { ...snapshot, events: [...snapshot.events], tools: [...snapshot.tools] };
  next.status = "done";
  next.phase = "已完成";
  next.finalText = text;
  next.answerPreview = truncate(text || next.answerPreview, MAX_PREVIEW_CHARS);
  next.error = null;
  next.updatedAt = nowIso();
  next.elapsedMs = Date.parse(next.updatedAt) - Date.parse(next.startedAt);
  pushEvent(next, "生成完成");
  return next;
};

export const reduceClaudeStreamEvent = (
  snapshot: RemoteProgressSnapshot,
  rawEvent: unknown,
): RemoteProgressSnapshot => {
  const event = asRecord(rawEvent);
  const next = { ...snapshot, events: [...snapshot.events], tools: [...snapshot.tools] };
  const type = stringAt(event, "type") ?? "";
  next.updatedAt = nowIso();
  next.elapsedMs = Date.parse(next.updatedAt) - Date.parse(next.startedAt);

  if (type === "result") {
    const result = stringAt(event, "result") ?? "";
    const isError = event.is_error === true || stringAt(event, "subtype") === "error";
    if (isError) {
      return markProgressFailed(next, extractError(event) ?? "Claude 执行失败");
    }
    return markProgressDone(next, result);
  }

  if (type === "assistant" || type.includes("message") || type.includes("delta")) {
    const text = extractText(event);
    if (text) {
      next.status = "running";
      next.phase = "正在生成回复";
      const current = next.answerPreview;
      next.answerPreview = truncate(
        text.startsWith(current) || text.length >= current.length
          ? text
          : `${current}${text}`,
        MAX_PREVIEW_CHARS,
      );
      pushEvent(next, "正在生成回复");
    }
  }

  const tools = extractToolNames(event);
  for (const tool of tools) {
    if (tool && !tool.includes("remote_reply")) {
      next.tools = pushUnique(next.tools, tool, MAX_TOOLS);
      pushEvent(next, `调用工具 ${tool}`);
      next.phase = `调用工具 ${tool}`;
      next.status = "running";
    }
  }

  const hookName = stringAt(event, "hookName") ?? stringAt(event, "hook_event_name");
  if (hookName) {
    const toolName = stringAt(event, "toolName") ?? stringAt(event, "tool_name");
    pushEvent(next, toolName ? `${hookName}: ${toolName}` : hookName);
  }

  if (type.includes("error") || event.is_error === true) {
    return markProgressFailed(next, extractError(event) ?? "Claude 执行失败");
  }

  return next;
};
