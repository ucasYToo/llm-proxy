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

export function appendLog(entry: LogEntry): void {
  // Apply log collection config to filter out unwanted fields
  const { logCollection } = readConfig();
  const filtered: LogEntry = { ...entry };

  if (!logCollection.captureOriginalBody) {
    // Pre-compute diff before discarding original data
    filtered.precomputedDiff = {
      headers: jsonDiff(entry.originalRequestHeaders, entry.modifiedRequestHeaders),
      body: jsonDiff(entry.originalRequestBody, entry.modifiedRequestBody),
    };
    filtered.originalRequestBody = null;
    filtered.originalRequestHeaders = {};
  }

  if (!logCollection.captureRawStreamEvents) {
    // Only strip if it's the raw SSE events array (not assembled body)
    if (Array.isArray(filtered.responseBody)) {
      filtered.responseBody = null;
    }
  }

  const logs = readAll();
  logs.unshift(filtered);
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
