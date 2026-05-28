import type { HookEntry, LogEntry, SessionSummary } from "../../lib/api";

export interface Props {
  config: import("../../lib/api").Config;
  onRefresh: () => void;
}

export type SseStatus = "connecting" | "open" | "closed";

export type SessionGroup = {
  key: string;
  cwd: string | null;
  folder: string;
  sessions: SessionSummary[];
  lastEventAt: string;
};

export type SelectedDetail =
  | { kind: "hook"; entry: HookEntry }
  | { kind: "log"; entry: LogEntry };

/* ── Filter Types ── */

export type EventTypeFilter =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "StopFailure"
  | "PermissionDenied"
  | "Stop"
  | "UserPromptSubmit"
  | "SubagentStart"
  | "SubagentStop"
  | "Notification"
  | "SessionEnd"
  | "apiLog";

export type FilterPreset = "compact" | "all" | "custom";

export const ALL_EVENT_TYPES: EventTypeFilter[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "StopFailure",
  "PermissionDenied",
  "Stop",
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "SessionEnd",
  "apiLog",
];

export const COMPACT_EVENT_TYPES: Set<EventTypeFilter> = new Set([
  "PostToolUse",
  "PostToolUseFailure",
  "StopFailure",
  "Stop",
  "SubagentStop",
  "Notification",
  "apiLog",
]);

export const EVENT_TYPE_LABELS: Record<EventTypeFilter, string> = {
  PreToolUse: "工具执行前",
  PostToolUse: "工具执行后",
  PostToolUseFailure: "工具执行失败",
  StopFailure: "API 错误",
  PermissionDenied: "权限拒绝",
  Stop: "任务完成",
  UserPromptSubmit: "用户输入",
  SubagentStart: "子代理启动",
  SubagentStop: "子代理完成",
  Notification: "通知",
  SessionEnd: "会话结束",
  apiLog: "API 日志",
};
