import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { getDb } from "../storage/db";
import { saveFileLog } from "../storage/request-correlation";
import { extractTokenUsage } from "../core/assemble";
import { rawDir, rawStatus } from "./raw-settings";
import { identifyRawAgent } from "./raw-agent";
import { createLog, updateLog, writeLogTransaction } from "../storage/logs";
import { getServerPort } from "../server/state";

type Item = {
  request_file: string;
  response_file: string;
  session_id: string;
  request_id?: string;
  message_id?: string;
  timestamp: string;
  query_source?: string;
  model?: string;
  message_uuid?: string;
};
let lastOrphanScan = 0;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const timing = new Map<string, { ms: number; first?: number; at: number }>();
export let captureError = "";
let timer: NodeJS.Timeout | undefined;

function nameOf(value: string, suffix: string) {
  if (typeof value !== "string") throw new Error("文件引用无效");
  const name = path.basename(value);
  if (
    !/^[a-zA-Z0-9_-]+\.(request|response)\.json$/.test(name) ||
    !name.endsWith(suffix) ||
    (value !== name && value !== path.join(rawDir(), name))
  )
    throw new Error("文件引用越界");
  return name;
}
function openFile(name: string) {
  if (fs.lstatSync(rawDir()).isSymbolicLink())
    throw new Error("采集目录已变更");
  const fd = fs.openSync(
    path.join(rawDir(), name),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  if (fs.fstatSync(fd).isFile()) return fd;
  fs.closeSync(fd);
  throw new Error("仅接受普通文件");
}
function readBody(name: string): Record<string, any> {
  const fd = openFile(name);
  try {
    if (fs.fstatSync(fd).size > 64 * 1024 * 1024)
      throw new Error("文件超过 64 MiB");
    const body = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("不支持的请求文件格式");
    return body;
  } finally {
    fs.closeSync(fd);
  }
}
function readIndex() {
  let fd: number;
  try {
    fd = openFile("index.jsonl");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  try {
    const db = getDb();
    const stat = fs.fstatSync(fd);
    const identity = [stat.dev, stat.ino, stat.birthtimeMs].join(":");
    const cursor = db
      .prepare("SELECT * FROM raw_cursors WHERE file=?")
      .get(rawDir()) as
      | { identity: string; offset: number; skipping: number }
      | undefined;
    const offset =
      cursor?.identity === identity && cursor.offset <= stat.size
        ? cursor.offset
        : 0;
    if (offset === stat.size) return;
    const buf = Buffer.alloc(Math.min(1024 * 1024, stat.size - offset));
    const n = fs.readSync(fd, buf, 0, buf.length, offset);
    const bytes = buf.subarray(0, n);
    let end = bytes.lastIndexOf(10) + 1;
    const skipping = offset > 0 && !!cursor?.skipping;
    let skipNext = 0;
    if (!end) {
      if (!skipping && n < 1024 * 1024) return;
      captureError = "已跳过超过 1 MiB 的索引行";
      skipNext = 1;
      end = n;
    }
    const start = skipNext ? end : skipping ? bytes.indexOf(10) + 1 : 0;
    db.transaction(() => {
      for (const line of buf
        .toString("utf8", start, end)
        .split("\n")
        .filter(Boolean)) {
        try {
          const item = JSON.parse(line) as Item;
          const req = nameOf(item.request_file, ".request.json");
          const resp = nameOf(item.response_file, ".response.json");
          if (
            !item.session_id ||
            typeof item.session_id !== "string" ||
            !Number.isFinite(Date.parse(item.timestamp))
          )
            throw new Error("索引字段无效");
          if (
            !/^[\w-]{1,160}$/.test(item.session_id) ||
            typeof item.timestamp !== "string" ||
            [
              item.request_id,
              item.message_id,
              item.message_uuid,
              item.query_source,
              item.model,
            ].some(
              (v) => v != null && (typeof v !== "string" || v.length > 512),
            )
          )
            throw new Error("索引字段无效");
          const id = digest(
            JSON.stringify([rawDir(), item.session_id, req, resp]),
          );
          db.prepare(
            "INSERT OR IGNORE INTO raw_pending(id,item,directory,firstSeen) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM raw_seen WHERE id=?)",
          ).run(
            id,
            JSON.stringify({ ...item, request_file: req, response_file: resp }),
            rawDir(),
            Date.now(),
            id,
          );
        } catch {
          captureError = "已跳过无效索引行";
        }
      }
      db.prepare(
        "INSERT OR REPLACE INTO raw_cursors(file,identity,offset,skipping) VALUES (?,?,?,?)",
      ).run(rawDir(), identity, offset + end, skipNext);
    })();
  } finally {
    fs.closeSync(fd);
  }
}
function fileLogId(name: string) {
  return "file-" + digest(JSON.stringify([rawDir(), name]));
}
function scanOrphans() {
  if (Date.now() - lastOrphanScan < 60000) return;
  lastOrphanScan = Date.now();
  const db = getDb();
  const pending = new Set(
    (
      db
        .prepare(
          "SELECT json_extract(item,'$.request_file') AS name FROM raw_pending WHERE directory=?",
        )
        .all(rawDir()) as { name: string }[]
    ).map((x) => x.name),
  );
  for (const entry of fs.readdirSync(rawDir(), { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !/^[a-zA-Z0-9_-]+\.request\.json$/.test(entry.name) ||
      pending.has(entry.name)
    )
      continue;
    const stat = fs.statSync(path.join(rawDir(), entry.name));
    if (Date.now() - stat.mtimeMs >= 900000)
      noteIncomplete(entry.name, stat.mtime.toISOString(), "尚未收到响应索引");
  }
}
function noteIncomplete(
  name: string,
  timestamp: string,
  error: string,
  sessionId?: string,
) {
  const id = fileLogId(name);
  const db = getDb();
  if (
    db
      .prepare(
        "SELECT 1 FROM raw_seen WHERE id=? UNION ALL SELECT 1 FROM logs WHERE id=? LIMIT 1",
      )
      .get(id, id)
  )
    return;
  writeLogTransaction(() => {
    createLog({
      id,
      source: "file",
      targetId: "file-capture",
      targetName: "文件读取",
      method: "POST",
      path: "/v1/messages",
      timestamp,
      sessionId,
      status: "error",
      error,
      durationMs: -1,
      responseStatus: 0,
      originalRequestHeaders: {},
      modifiedRequestHeaders: {},
      originalRequestBody: null,
      modifiedRequestBody: null,
      responseBody: null,
    });
    db.prepare("INSERT OR IGNORE INTO raw_seen VALUES (?,?)").run(id, id);
  });
}
function cleanCommittedFiles() {
  const db = getDb();
  const rows = db
    .prepare("SELECT filename FROM raw_cleanup WHERE directory=? LIMIT 100")
    .all(rawDir()) as { filename: string }[];
  for (const { filename } of rows) {
    const full = path.join(rawDir(), filename);
    if (fs.existsSync(full) && fs.lstatSync(full).isFile()) fs.unlinkSync(full);
    db.prepare("DELETE FROM raw_cleanup WHERE directory=? AND filename=?").run(
      rawDir(),
      filename,
    );
  }
}
export function ingestRaw(port = getServerPort()) {
  if (!rawStatus(port).enabled) return;
  if (fs.lstatSync(rawDir()).isSymbolicLink())
    throw new Error("采集目录已改变");
  cleanCommittedFiles();
  readIndex();
  scanOrphans();
  const db = getDb();
  const deadline = Date.now() + 500;
  const rows = db
    .prepare(
      "SELECT * FROM raw_pending WHERE directory=? AND retryAt<=? ORDER BY retryAt,firstSeen LIMIT 50",
    )
    .all(rawDir(), Date.now()) as {
    id: string;
    item: string;
    firstSeen: number;
  }[];
  for (const row of rows) {
    if (Date.now() > deadline) break;
    const item = JSON.parse(row.item) as Item;
    try {
      const req = readBody(item.request_file);
      const resp = readBody(item.response_file);
      const cachedTime =
        item.request_id &&
        (timing.get(JSON.stringify([item.session_id, item.request_id])) ??
          timing.get(JSON.stringify([null, item.request_id])));
      const time =
        cachedTime && Date.now() - cachedTime.at < 900000
          ? cachedTime
          : undefined;
      const logId = fileLogId(item.request_file);
      const agent = identifyRawAgent(
        item.session_id,
        item.query_source,
        item.message_uuid,
        item.message_id,
      );
      writeLogTransaction(() => {
        const actual = saveFileLog({
          ...agent,
          id: logId,
          source: "file",
          timestamp: new Date(item.timestamp).toISOString(),
          sessionId: item.session_id,
          targetId: "file-capture",
          targetName: "文件读取",
          method: "POST",
          path: "/v1/messages",
          querySource: item.query_source,
          captureModel: item.model ?? resp.model ?? req.model,
          upstreamRequestId: item.request_id,
          responseMessageId: item.message_id ?? resp.id,
          originalRequestHeaders: {},
          modifiedRequestHeaders: {},
          originalRequestBody: req,
          modifiedRequestBody: null,
          status: "completed",
          responseBody: resp,
          responseStatus: 0,
          durationMs: time ? time.ms : -1,
          firstChunkMs: time ? time.first : undefined,
          tokenUsage: extractTokenUsage(resp),
        });
        db.prepare("INSERT OR REPLACE INTO raw_seen VALUES (?,?)").run(
          row.id,
          actual,
        );
        db.prepare("DELETE FROM raw_pending WHERE id=?").run(row.id);
        if (actual !== logId)
          db.prepare(
            "DELETE FROM logs WHERE id=? AND source='file' AND status='error'",
          ).run(logId);
        for (const name of [item.request_file, item.response_file])
          db.prepare("INSERT OR IGNORE INTO raw_cleanup VALUES (?,?)").run(
            rawDir(),
            name,
          );
      });
      cleanCommittedFiles();
    } catch (err) {
      const message =
        (err as Error).message === "ambiguous-capture"
          ? "请求标识不完整，待核对代理记录"
          : (err as NodeJS.ErrnoException).code === "ENOENT"
            ? "等待请求或响应文件"
            : "文件不完整、超限或不可读";
      if (
        (err as NodeJS.ErrnoException).code === "ENOENT" &&
        Date.now() - row.firstSeen > 900000
      )
        noteIncomplete(
          item.request_file,
          item.timestamp,
          message,
          item.session_id,
        );
      db.prepare("UPDATE raw_pending SET error=?,retryAt=? WHERE id=?").run(
        message,
        Date.now() + (Date.now() - row.firstSeen < 30000 ? 1000 : 30000),
        row.id,
      );
    }
  }
}
export function recordTimings(payload: any) {
  for (const group of payload?.resourceLogs ?? [])
    for (const scope of group.scopeLogs ?? [])
      for (const log of scope.logRecords ?? []) {
        const attrs = Object.fromEntries(
          (log.attributes ?? []).map((a: any) => [
            a.key,
            a.value?.stringValue ?? a.value?.intValue ?? a.value?.doubleValue,
          ]),
        );
        if (
          attrs["event.name"] !== "api_request" &&
          log.body?.stringValue !== "claude_code.api_request"
        )
          continue;
        const id = attrs.request_id,
          ms = Number(attrs.duration_ms);
        if (typeof id !== "string" || !Number.isFinite(ms) || ms < 0) continue;
        const first = Number(attrs.ttft_ms);
        const entry = {
          ms,
          first: Number.isFinite(first) && first >= 0 ? first : undefined,
          at: Date.now(),
        };
        const session =
          typeof attrs["session.id"] === "string" ? attrs["session.id"] : null;
        const found = getDb()
          .prepare(
            "SELECT id FROM logs WHERE source='file' AND upstreamRequestId=? AND (? IS NULL OR sessionId=?) LIMIT 2",
          )
          .all(id, session, session) as { id: string }[];
        if (found.length > 1) continue;
        timing.set(JSON.stringify([session, id]), entry);
        if (found.length === 1)
          updateLog(found[0].id, { durationMs: ms, firstChunkMs: entry.first });
      }
  for (const [key, value] of timing)
    if (timing.size > 5000 || Date.now() - value.at > 900000)
      timing.delete(key);
}
export function startRawCapture() {
  if (timer) return;
  timer = setInterval(() => {
    try {
      ingestRaw();
    } catch {
      captureError = "读取采集目录失败";
    }
  }, 2000);
  timer.unref();
}
export function stopRawCapture() {
  clearInterval(timer);
  timer = undefined;
  timing.clear();
}
