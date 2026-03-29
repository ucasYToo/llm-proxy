// 核心代理功能
export { proxyRequest } from "./core/proxy";
export type { ProxyRequest, ProxyResponse } from "./core/proxy";

// 配置管理
export {
  readConfig,
  writeConfig,
  getActiveTarget,
} from "./config/store";
export type {
  Config,
  Target,
  LogEntry,
  LogStatus,
  LogCollection,
  TokenUsage,
} from "./config/types";

// 日志存储
export {
  createLog,
  updateLog,
  clearLogs,
  queryLogs,
} from "./storage/logs";
export type { QueryLogsOptions } from "./storage/logs";

// 工具函数
export { formatTime, statusClass } from "./utils/format";
