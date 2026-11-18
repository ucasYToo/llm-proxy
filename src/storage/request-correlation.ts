import { getDb } from "./db";
import { createLog, updateLog, writeLogTransaction } from "./logs";
import { broadcast } from "../server/sse";
import type { LogEntry } from "../interfaces";

function requestKeys(
  session: string | null | undefined,
  request?: string | null,
  message?: string | null,
) {
  if (!session) return [];
  return [
    ["request", request],
    ["message", message],
  ]
    .filter((pair) => pair[1])
    .map((pair) => JSON.stringify([session, ...pair]));
}
function remember(keys: string[], logId: string) {
  const put = getDb().prepare(
    "INSERT INTO raw_seen VALUES (?,?) ON CONFLICT(id) DO UPDATE SET logId=excluded.logId",
  );
  for (const key of keys) {
    if (key.startsWith("[") && JSON.parse(key)[1] === "message") {
      const old = getDb()
        .prepare("SELECT logId FROM raw_seen WHERE id=?")
        .get(key) as { logId: string } | undefined;
      if (old && old.logId !== logId) {
        put.run(key, "ambiguous");
        continue;
      }
    }
    put.run(key, logId);
  }
}
function matched(keys: string[]) {
  const find = getDb().prepare("SELECT logId FROM raw_seen WHERE id=?");
  for (const key of keys) {
    const row = find.get(key) as { logId: string } | undefined;
    if (!row || row.logId === "ambiguous") continue;
    const [session, kind] = JSON.parse(key);
    if (kind === "message" && keys.length === 2) {
      const request = JSON.parse(keys[0])[2];
      const recorded = getDb()
        .prepare("SELECT upstreamRequestId FROM logs WHERE id=?")
        .get(row.logId) as { upstreamRequestId?: string } | undefined;
      if (recorded?.upstreamRequestId && recorded.upstreamRequestId !== request)
        continue;
      if (
        !recorded &&
        getDb()
          .prepare(
            "SELECT 1 FROM raw_seen WHERE logId=? AND CASE WHEN json_valid(id) THEN json_extract(id,'$[1]') END='request' AND id!=? LIMIT 1",
          )
          .get(row.logId, JSON.stringify([session, "request", request]))
      )
        continue;
    }
    return row.logId;
  }
  return undefined;
}
export function saveFileLog(entry: LogEntry) {
  const keys = requestKeys(
    entry.sessionId,
    entry.upstreamRequestId,
    entry.responseMessageId,
  );
  const id = matched(keys);
  if (id) {
    updateLog(id, {
      querySource: entry.querySource,
      ...(entry.agentType
        ? { agentType: entry.agentType, agentId: entry.agentId }
        : {}),
    });
    remember(keys, id);
    return id;
  }
  const overlap = getDb()
    .prepare(`SELECT 1 FROM logs WHERE sessionId=? AND source='proxy' AND
    timestamp BETWEEN ? AND ? AND (upstreamRequestId IS NULL OR ? IS NULL) AND (responseMessageId IS NULL OR ? IS NULL) LIMIT 1`);
  const at = Date.parse(entry.timestamp);
  if (
    overlap.get(
      entry.sessionId,
      new Date(at - 120000).toISOString(),
      new Date(at + 120000).toISOString(),
      entry.upstreamRequestId ?? null,
      entry.responseMessageId ?? null,
    )
  )
    throw new Error("ambiguous-capture");
  createLog(entry);
  remember(keys, entry.id);
  return entry.id;
}
export function finishProxyLog(
  id: string,
  session: string | null,
  headers: Headers,
  body: unknown,
  patch: Partial<LogEntry>,
) {
  const obj = body as { id?: string; model?: string } | null;
  const request = headers.get("request-id") || headers.get("x-request-id");
  const message = typeof obj?.id === "string" ? obj.id : null;
  const keys = requestKeys(session, request, message);
  const db = getDb();
  let removed: string | undefined;
  writeLogTransaction(() => {
    const match = matched(keys);
    if (match && match !== id) {
      const old = db
        .prepare("SELECT source,querySource FROM logs WHERE id=?")
        .get(match) as Pick<LogEntry, "source" | "querySource"> | undefined;
      if (old?.source === "file" || (!old && match.startsWith("file-"))) {
        patch.querySource = old?.querySource;
        db.prepare("DELETE FROM logs WHERE id=?").run(match);
        db.prepare("UPDATE cost_records SET logId=? WHERE logId=?").run(
          id,
          match,
        );
        db.prepare("UPDATE raw_seen SET logId=? WHERE logId=?").run(id, match);
        remember([match], id);
        removed = match;
      }
    }
    updateLog(id, {
      ...patch,
      upstreamRequestId: request,
      responseMessageId: message,
      captureModel: obj?.model,
    });
    remember(keys, id);
  });
  if (removed) broadcast("log-merged", { removed, id });
}
