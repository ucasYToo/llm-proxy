/* ── Auth ── */

export type TargetAuthType = "bearer" | "x-api-key" | "custom";

export interface TargetAuth {
  /** 认证类型：bearer → Authorization: Bearer <value>；x-api-key → x-api-key: <value>；custom → <headerName>: <value> */
  type: TargetAuthType;
  /** 仅当 type === "custom" 时生效，指定 header 名称 */
  headerName?: string;
  /** 纯 token 值，不含 "Bearer " 前缀 */
  value: string;
}

/* ── Target ── */

export interface Target {
  id: string;
  name: string;
  /** Base URL，包含路径前缀，例如 https://api.openai.com/v1 */
  url: string;
  /** 额外的请求头，会合并到每个代理请求中 */
  headers: Record<string, string>;
  /** 额外的 Body 字段，会合并到每个代理请求体中 */
  bodyParams: Record<string, unknown>;
  /** 接入 Claude Code 时写入的 ANTHROPIC_MODEL 值 */
  anthropicModel?: string;
  /** 认证配置（推荐方式）。若设置，会按 type 派生 header 并覆盖 headers 中同名键 */
  auth?: TargetAuth;
}

/* ── Channel ── */

export interface Channel {
  id: string;
  name: string;
  /** 该通道当前选择的活动目标 ID */
  activeTarget: string;
}

/* ── Log Collection ── */

export interface LogCollection {
  /** 是否采集原始请求 body（来自客户端，未合并 bodyParams 前）。默认 false */
  captureOriginalBody: boolean;
  /** 是否采集原始流式事件数组（SSE 原始 data 列表）。默认 false */
  captureRawStreamEvents: boolean;
  /** 日志最大保留条数（按 timestamp 倒序保留），默认 300 */
  maxEntries?: number;
}

/* ── Notifications ── */

export interface DingTalkConfig {
  /** 是否启用钉钉通知（与 stop/subagentStop/notification 开关共同决定是否发送） */
  enabled?: boolean;
  /** 钉钉机器人 access_token（来自 webhook URL 的 ?access_token=...） */
  accessToken?: string;
  /** 钉钉机器人加签 secret（机器人安全设置里启用"加签"得到） */
  secret?: string;
}

export interface FeishuConfig {
  /** 是否启用飞书通知（与 stop/subagentStop/notification 开关共同决定是否发送） */
  enabled?: boolean;
  /** 飞书自定义机器人 webhook 完整地址 */
  webhookUrl?: string;
  /** 飞书机器人签名校验 secret（机器人安全设置里启用"签名校验"得到） */
  secret?: string;
}

export interface NotificationSettings {
  /** Stop 事件 -> 触发通知（macOS + 钉钉 + 飞书） */
  stop?: boolean;
  /** SubagentStop 事件 -> 触发通知（macOS + 钉钉 + 飞书） */
  subagentStop?: boolean;
  /** Notification 事件 -> 触发通知（macOS + 钉钉 + 飞书） */
  notification?: boolean;
  /** 钉钉配置，与上面三个事件开关协同工作 */
  dingtalk?: DingTalkConfig;
  /** 飞书配置，与上面三个事件开关协同工作 */
  feishu?: FeishuConfig;
}

/* ── Config ── */

export interface Config {
  activeTarget: string;
  targets: Target[];
  logCollection: LogCollection;
  /** @deprecated 旧版备份字段。还原逻辑已改为写回当前 target 的 baseUrl/model，不再读写此字段 */
  claudeCodeOriginalBaseUrl?: string;
  /** @deprecated 旧版备份字段。还原逻辑已改为写回当前 target 的 baseUrl/model，不再读写此字段 */
  claudeCodeOriginalModel?: string;
  /** 当前接入 Claude Code 的通道 ID */
  claudeCodeChannelId?: string;
  /** 通道配置列表 */
  channels: Channel[];
  /** Claude Code hook 事件的通知开关（默认全部 off） */
  notifications?: NotificationSettings;
  /** 服务端实际监听端口（仅 API 响应附带，不持久化） */
  serverPort?: number;
}
