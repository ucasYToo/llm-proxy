import fs from "fs";
import path from "path";
import type { LogEntry } from "./types";

const LOGS_PATH = path.join(process.cwd(), "data", "logs.json");
const MAX_ENTRIES = 1000;

function readAll(): LogEntry[] {
  if (!fs.existsSync(LOGS_PATH)) return [];
  const raw = fs.readFileSync(LOGS_PATH, "utf-8");
  return JSON.parse(raw) as LogEntry[];
}

export function appendLog(entry: LogEntry): void {
  const logs = readAll();
  logs.unshift(entry);
  // Keep only the most recent MAX_ENTRIES
  const trimmed = logs.slice(0, MAX_ENTRIES);
  fs.writeFileSync(LOGS_PATH, JSON.stringify(trimmed, null, 2), "utf-8");
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
