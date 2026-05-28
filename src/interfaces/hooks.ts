/* ── Claude Code Hook Payload Types ── */

/** 所有 hook 事件共享的基础字段 */
interface HookPayloadBase {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
  effort?: { level: string };
}

/** PreToolUse: 工具执行前触发 */
export interface PreToolUsePayload extends HookPayloadBase {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

/** PostToolUse: 工具执行成功后触发（tool_response 结构因工具而异） */
export interface PostToolUsePayload extends HookPayloadBase {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id: string;
  duration_ms?: number;
}

/** PostToolUseFailure: 工具执行失败时触发 */
export interface PostToolUseFailurePayload extends HookPayloadBase {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  error: string;
  is_interrupt?: boolean;
  duration_ms?: number;
}

/** StopFailure: API 错误导致 turn 结束（rate_limit / auth / billing 等） */
export interface StopFailurePayload extends HookPayloadBase {
  hook_event_name: "StopFailure";
  error:
    | "authentication_failed"
    | "oauth_org_not_allowed"
    | "billing_error"
    | "rate_limit"
    | "invalid_request"
    | "model_not_found"
    | "server_error"
    | "unknown"
    | "max_output_tokens";
  error_details?: string;
  last_assistant_message?: string;
}

/** PermissionDenied: 自动模式下工具调用被拒绝 */
export interface PermissionDeniedPayload extends HookPayloadBase {
  hook_event_name: "PermissionDenied";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  reason: string;
}

/** Stop: 主任务结束 */
export interface StopPayload extends HookPayloadBase {
  hook_event_name: "Stop";
  stop_hook_active: boolean;
  last_assistant_message: string;
  background_tasks: unknown[];
  session_crons: unknown[];
}

/** UserPromptSubmit: 用户提交 prompt */
export interface UserPromptSubmitPayload extends HookPayloadBase {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
}

/** SubagentStart: 子代理启动 */
export interface SubagentStartPayload extends HookPayloadBase {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string;
}

/** SubagentStop: 子代理结束 */
export interface SubagentStopPayload extends HookPayloadBase {
  hook_event_name: "SubagentStop";
  agent_id: string;
  agent_type: string;
  stop_hook_active: boolean;
  agent_transcript_path: string;
  last_assistant_message: string;
  background_tasks: unknown[];
  session_crons: unknown[];
}

/** Notification: Claude Code 通知 */
export interface NotificationPayload extends HookPayloadBase {
  hook_event_name: "Notification";
  message: string;
  notification_type: string;
}

/** SessionEnd: 会话结束 */
export interface SessionEndPayload extends HookPayloadBase {
  hook_event_name: "SessionEnd";
  reason: string;
}

/** 所有 hook 事件的联合类型 */
export type HookPayload =
  | PreToolUsePayload
  | PostToolUsePayload
  | PostToolUseFailurePayload
  | StopFailurePayload
  | PermissionDeniedPayload
  | StopPayload
  | UserPromptSubmitPayload
  | SubagentStartPayload
  | SubagentStopPayload
  | NotificationPayload
  | SessionEndPayload;

/** 从 request body 解析为 HookPayload（带防御性 fallback） */
export const parseHookPayload = (raw: unknown): HookPayload | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const name = obj.hook_event_name;
  if (typeof name !== "string") return null;
  return obj as unknown as HookPayload;
};
