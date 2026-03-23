import fs from "fs";
import path from "path";
import type { LogEntry } from "./types";
import { readConfig } from "./config";
import { jsonDiff } from "./jsonDiff";

const LOGS_PATH = path.join(process.cwd(), "data", "logs.json");
const MAX_ENTRIES = 300;

function readAll(): LogEntry[] {
  if (!fs.existsSync(LOGS_PATH)) return [];
  const raw = fs.readFileSync(LOGS_PATH, "utf-8");
  return JSON.parse(raw) as LogEntry[];
}

function saveLogs(logs: LogEntry[]): void {
  fs.writeFileSync(LOGS_PATH, JSON.stringify(logs, null, 2), "utf-8");
}

function applyLogCollectionFilter(entry: LogEntry, preserveDiff = false): LogEntry {
  const { logCollection } = readConfig();
  const filtered: LogEntry = { ...entry };

  if (!logCollection.captureOriginalBody) {
    // 仅在 diff 尚未存在时计算（preserveDiff=true 表示 updateLog 调用，diff 已在 createLog 中正确计算）
    if (!preserveDiff || !filtered.precomputedDiff) {
      filtered.precomputedDiff = {
        headers: jsonDiff(entry.originalRequestHeaders, entry.modifiedRequestHeaders),
        body: jsonDiff(entry.originalRequestBody, entry.modifiedRequestBody),
      };
    }
    filtered.originalRequestBody = null;
    filtered.originalRequestHeaders = {};
  }

  if (!logCollection.captureRawStreamEvents) {
    // 仅在是原始 SSE 事件数组时才清除（非组装后的 body）
    if (Array.isArray(filtered.responseBody)) {
      filtered.responseBody = null;
    }
  }

  return filtered;
}

/**
 * 创建新日志条目（请求开始时调用）
 */
export function createLog(entry: LogEntry): void {
  const filtered = applyLogCollectionFilter(entry);
  const logs = readAll();
  logs.unshift(filtered);
  // 仅保留最近的 MAX_ENTRIES 条记录
  const trimmed = logs.slice(0, MAX_ENTRIES);
  saveLogs(trimmed);
}

/**
 * 更新现有日志条目（根据 ID）
 * 如果条目不存在则不做任何操作
 */
export function updateLog(id: string, updates: Partial<LogEntry>): void {
  const logs = readAll();
  const index = logs.findIndex((l) => l.id === id);
  if (index === -1) return;

  // 合并更新
  logs[index] = { ...logs[index], ...updates };
  
  // 应用过滤（保留已有的 diff）
  const filtered = applyLogCollectionFilter(logs[index], true);
  logs[index] = filtered;
  
  saveLogs(logs);
}

/**
 * 创建或更新日志条目
 */
export function upsertLog(entry: LogEntry): void {
  const logs = readAll();
  const index = logs.findIndex((l) => l.id === entry.id);
  
  const filtered = applyLogCollectionFilter(entry);
  
  if (index !== -1) {
    // 更新已有记录
    logs[index] = { ...logs[index], ...filtered };
  } else {
    // 插入新记录
    logs.unshift(filtered);
  }
  
  // 仅保留最近的 MAX_ENTRIES 条记录
  const trimmed = logs.slice(0, MAX_ENTRIES);
  saveLogs(trimmed);
}

/**
 * 追加日志（向后兼容，请求结束时调用）
 */
export function appendLog(entry: LogEntry): void {
  upsertLog(entry);
}

export interface QueryLogsOptions {
  limit?: number;
  offset?: number;
  targetId?: string;
}

export function queryLogs(opts: QueryLogsOptions = {}): {
  entries: LogEntry[];
  total: number;
} {
  const { limit = 50, offset = 0, targetId } = opts;
  let logs = readAll();
  if (targetId) {
    logs = logs.filter((l) => l.targetId === targetId);
  }
  return { entries: logs.slice(offset, offset + limit), total: logs.length };
}

export function clearLogs(): void {
  fs.writeFileSync(LOGS_PATH, "[]", "utf-8");
}
