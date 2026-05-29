import type { ModelPricing } from "../cost/pricing";

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
  /** 可选：每个 target 的定价覆盖（USD per 1M tokens） */
  pricing?: Partial<ModelPricing>;
}

/* ── CWD Route ── */

export interface CwdRoute {
  /** 项目工作目录（精确匹配） */
  cwd: string;
  /** 转发目标 ID */
  targetId: string;
}

/* ── Channel ── */

export interface Channel {
  id: string;
  name: string;
  /** 该通道当前选择的活动目标 ID */
  activeTarget: string;
  /** 按项目目录覆盖转发目标 */
  cwdRoutes?: CwdRoute[];
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

/** 每个通知渠道可独立勾选要响应的 hook 事件 */
export interface ChannelEvents {
  stop?: boolean;
  subagentStop?: boolean;
  notification?: boolean;
}

export interface MacosNotifyConfig {
  /** 总开关：false 时整个 macOS 通知关闭，不管 events 怎么勾 */
  enabled?: boolean;
  events?: ChannelEvents;
}

export interface DingTalkConfig {
  /** 总开关 */
  enabled?: boolean;
  /** 钉钉机器人 access_token（来自 webhook URL 的 ?access_token=...） */
  accessToken?: string;
  /** 钉钉机器人加签 secret（机器人安全设置里启用"加签"得到） */
  secret?: string;
  /** 该渠道要响应的事件（与 macOS 完全独立） */
  events?: ChannelEvents;
}

export interface NotificationSettings {
  macos?: MacosNotifyConfig;
  dingtalk?: DingTalkConfig;

  /** @deprecated 老版本扁平字段，仅做兼容读取；startup migration 会迁移到 macos.events 然后被删除 */
  stop?: boolean;
  /** @deprecated 同上 */
  subagentStop?: boolean;
  /** @deprecated 同上 */
  notification?: boolean;
}

/* ── Budget ── */

export interface BudgetConfig {
  /** 每日预算上限（USD） */
  dailyLimitUsd?: number;
  /** 每月预算上限（USD） */
  monthlyLimitUsd?: number;
  /** 告警阈值百分比（默认 80） */
  alertThresholdPct?: number;
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
  /** 预算配置 */
  budget?: BudgetConfig;
  /** 服务端实际监听端口（仅 API 响应附带，不持久化） */
  serverPort?: number;
}
