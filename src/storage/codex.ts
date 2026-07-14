import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { HookEntry } from "./hooks";

const CODEX_HOOK_TRIM_THRESHOLD = 2500;
const CODEX_HOOK_KEEP_AFTER_TRIM = 2000;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS hooks (
    id TEXT PRIMARY KEY,
    sessionId TEXT,
    eventName TEXT NOT NULL,
    toolName TEXT,
    cwd TEXT,
    payload TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_codex_hooks_session_ts ON hooks(sessionId, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_codex_hooks_ts ON hooks(createdAt DESC)`,
  `CREATE TABLE IF NOT EXISTS trace_bundles (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    bundlePath TEXT NOT NULL UNIQUE,
    startedAt TEXT NOT NULL,
    indexedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_codex_trace_bundles_session ON trace_bundles(sessionId, startedAt DESC)`,
];

let dbInstance: Database.Database | null = null;

export const getCodexDbPath = (): string =>
  process.env.CLAUDE_PROXY_CODEX_DB_PATH ||
  path.join(process.env.HOME || "~", ".claude-proxy", "codex-logs.db");

export const getCodexDb = (): Database.Database => {
  if (dbInstance) return dbInstance;
  const dbPath = getCodexDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let index = current; index < MIGRATIONS.length; index++) {
    db.exec(MIGRATIONS[index]);
  }
  if (current < MIGRATIONS.length) {
    db.pragma(`user_version = ${MIGRATIONS.length}`);
  }
  dbInstance = db;
  return db;
};

export const closeCodexDb = (): void => {
  dbInstance?.close();
  dbInstance = null;
};

export interface InsertCodexHookInput {
  eventName: string;
  sessionId?: string | null;
  toolName?: string | null;
  cwd?: string | null;
  payload: unknown;
}

const rowToHook = (row: Record<string, unknown>): HookEntry => {
  let payload: unknown = null;
  try {
    payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  } catch {
    payload = row.payload;
  }
  return {
    id: row.id as string,
    sessionId: (row.sessionId as string | null) ?? null,
    eventName: row.eventName as string,
    toolName: (row.toolName as string | null) ?? null,
    cwd: (row.cwd as string | null) ?? null,
    projectRoot: (row.cwd as string | null) ?? null,
    payload,
    createdAt: row.createdAt as string,
  };
};

export const insertCodexHook = (input: InsertCodexHookInput): HookEntry => {
  const entry: HookEntry = {
    id: uuidv4(),
    sessionId: input.sessionId ?? null,
    eventName: input.eventName,
    toolName: input.toolName ?? null,
    cwd: input.cwd ?? null,
    projectRoot: input.cwd ?? null,
    payload: input.payload,
    createdAt: new Date().toISOString(),
  };
  const db = getCodexDb();
  db.prepare(
    `INSERT INTO hooks (id, sessionId, eventName, toolName, cwd, payload, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.sessionId,
    entry.eventName,
    entry.toolName,
    entry.cwd,
    JSON.stringify(entry.payload ?? null),
    entry.createdAt,
  );

  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM hooks`).get() as {
    count: number;
  };
  if (count > CODEX_HOOK_TRIM_THRESHOLD) {
    db.prepare(
      `DELETE FROM hooks WHERE rowid NOT IN (
        SELECT rowid FROM hooks ORDER BY createdAt DESC LIMIT ?
      )`,
    ).run(CODEX_HOOK_KEEP_AFTER_TRIM);
  }
  return entry;
};

export const queryCodexHooks = (
  options: {
    limit?: number;
    offset?: number;
    sessionId?: string;
    eventName?: string;
  } = {},
): { entries: HookEntry[]; total: number } => {
  const { limit = 100, offset = 0, sessionId, eventName } = options;
  const filters: string[] = [];
  const args: unknown[] = [];
  if (sessionId) {
    filters.push("sessionId = ?");
    args.push(sessionId);
  }
  if (eventName) {
    filters.push("eventName = ?");
    args.push(eventName);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const db = getCodexDb();
  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM hooks ${where}`)
    .get(...args) as { count: number };
  const rows = db
    .prepare(
      `SELECT * FROM hooks ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as Record<string, unknown>[];
  return { entries: rows.map(rowToHook), total: total.count };
};

export interface CodexSessionSummary {
  sessionId: string;
  lastEventAt: string;
  lastEventName: string;
  eventCount: number;
  promptCount: number;
  replyCount: number;
  cwd: string | null;
  model: string | null;
  title: string | null;
  lastAssistantMessage: string | null;
  traceBundleCount: number;
}

const stringField = (value: unknown, key: string): string | null => {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : null;
};

export const queryCodexSessions = (limit = 200): CodexSessionSummary[] => {
  const hooks = queryCodexHooks({ limit: 5000 }).entries.slice().reverse();
  const sessions = new Map<string, CodexSessionSummary>();

  for (const hook of hooks) {
    if (!hook.sessionId) continue;
    let session = sessions.get(hook.sessionId);
    if (!session) {
      session = {
        sessionId: hook.sessionId,
        lastEventAt: hook.createdAt,
        lastEventName: hook.eventName,
        eventCount: 0,
        promptCount: 0,
        replyCount: 0,
        cwd: null,
        model: null,
        title: null,
        lastAssistantMessage: null,
        traceBundleCount: 0,
      };
      sessions.set(hook.sessionId, session);
    }

    session.eventCount += 1;
    if (hook.createdAt >= session.lastEventAt) {
      session.lastEventAt = hook.createdAt;
      session.lastEventName = hook.eventName;
    }
    session.cwd ??= hook.cwd;
    session.model ??= stringField(hook.payload, "model");
    if (hook.eventName === "UserPromptSubmit") {
      session.promptCount += 1;
      session.title ??= stringField(hook.payload, "prompt");
    }
    if (hook.eventName === "Stop") {
      session.replyCount += 1;
      session.lastAssistantMessage =
        stringField(hook.payload, "last_assistant_message") ??
        session.lastAssistantMessage;
    }
  }

  for (const bundle of queryCodexTraceBundles()) {
    let session = sessions.get(bundle.sessionId);
    if (!session) {
      session = {
        sessionId: bundle.sessionId,
        lastEventAt: bundle.startedAt,
        lastEventName: "RolloutTrace",
        eventCount: 0,
        promptCount: 0,
        replyCount: 0,
        cwd: null,
        model: null,
        title: null,
        lastAssistantMessage: null,
        traceBundleCount: 0,
      };
      sessions.set(bundle.sessionId, session);
    }
    session.traceBundleCount += 1;
    if (bundle.startedAt > session.lastEventAt) {
      session.lastEventAt = bundle.startedAt;
      session.lastEventName = "RolloutTrace";
    }
  }

  return [...sessions.values()]
    .sort((left, right) => (left.lastEventAt < right.lastEventAt ? 1 : -1))
    .slice(0, Math.min(Math.max(limit, 1), 500));
};

export const getCodexSessionTimeline = (
  sessionId: string,
  limit = 300,
): Array<{ kind: "hook"; at: string; hook: HookEntry }> =>
  queryCodexHooks({ sessionId, limit }).entries.map((hook) => ({
    kind: "hook" as const,
    at: hook.createdAt,
    hook,
  }));

export const getCodexOverview = (): {
  sessionCount: number;
  hookCount: number;
  promptCount: number;
  replyCount: number;
  traceBundleCount: number;
} => {
  const db = getCodexDb();
  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS hookCount,
         SUM(CASE WHEN eventName = 'UserPromptSubmit' THEN 1 ELSE 0 END) AS promptCount,
         SUM(CASE WHEN eventName = 'Stop' THEN 1 ELSE 0 END) AS replyCount
       FROM hooks`,
    )
    .get() as { hookCount: number; promptCount: number | null; replyCount: number | null };
  return {
    sessionCount: queryCodexSessions(500).length,
    hookCount: counts.hookCount,
    promptCount: counts.promptCount ?? 0,
    replyCount: counts.replyCount ?? 0,
    traceBundleCount: countCodexTraceBundles(),
  };
};

export const clearCodexData = (): void => {
  getCodexDb().exec(`DELETE FROM hooks; DELETE FROM trace_bundles`);
};

export interface CodexTraceBundleIndex {
  id: string;
  sessionId: string;
  bundlePath: string;
  startedAt: string;
  indexedAt: string;
}

const rowToTraceBundle = (row: Record<string, unknown>): CodexTraceBundleIndex => ({
  id: row.id as string,
  sessionId: row.sessionId as string,
  bundlePath: row.bundlePath as string,
  startedAt: row.startedAt as string,
  indexedAt: row.indexedAt as string,
});

export const replaceCodexTraceBundles = (
  bundles: Array<Omit<CodexTraceBundleIndex, "indexedAt">>,
): void => {
  const db = getCodexDb();
  const indexedAt = new Date().toISOString();
  const replace = db.transaction(() => {
    const paths = new Set(bundles.map((bundle) => bundle.bundlePath));
    const existing = db
      .prepare(`SELECT bundlePath FROM trace_bundles`)
      .all() as Array<{ bundlePath: string }>;
    const remove = db.prepare(`DELETE FROM trace_bundles WHERE bundlePath = ?`);
    for (const row of existing) {
      if (!paths.has(row.bundlePath)) remove.run(row.bundlePath);
    }

    const upsert = db.prepare(
      `INSERT INTO trace_bundles (id, sessionId, bundlePath, startedAt, indexedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         sessionId = excluded.sessionId,
         bundlePath = excluded.bundlePath,
         startedAt = excluded.startedAt,
         indexedAt = excluded.indexedAt`,
    );
    for (const bundle of bundles) {
      upsert.run(
        bundle.id,
        bundle.sessionId,
        bundle.bundlePath,
        bundle.startedAt,
        indexedAt,
      );
    }
  });
  replace();
};

export const queryCodexTraceBundles = (
  sessionId?: string,
): CodexTraceBundleIndex[] => {
  const rows = sessionId
    ? getCodexDb()
        .prepare(`SELECT * FROM trace_bundles WHERE sessionId = ? ORDER BY startedAt DESC`)
        .all(sessionId)
    : getCodexDb()
        .prepare(`SELECT * FROM trace_bundles ORDER BY startedAt DESC`)
        .all();
  return (rows as Record<string, unknown>[]).map(rowToTraceBundle);
};

export const getCodexTraceBundle = (
  id: string,
): CodexTraceBundleIndex | null => {
  const row = getCodexDb()
    .prepare(`SELECT * FROM trace_bundles WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToTraceBundle(row) : null;
};

export const countCodexTraceBundles = (): number => {
  const row = getCodexDb()
    .prepare(`SELECT COUNT(*) AS count FROM trace_bundles`)
    .get() as { count: number };
  return row.count;
};
