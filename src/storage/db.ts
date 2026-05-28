import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.env.HOME || "~", ".claude-proxy");
const DB_PATH = path.join(DATA_DIR, "logs.db");
const LEGACY_LOGS_PATH = path.join(DATA_DIR, "logs.json");

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    targetId TEXT NOT NULL,
    targetName TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    responseStatus INTEGER NOT NULL DEFAULT 0,
    status TEXT,
    durationMs INTEGER NOT NULL DEFAULT 0,
    firstChunkMs INTEGER,
    startTime TEXT,
    error TEXT,
    inputTokens INTEGER,
    outputTokens INTEGER,
    totalTokens INTEGER,
    cacheReadTokens INTEGER,
    cacheCreationTokens INTEGER,
    originalRequestHeaders TEXT,
    originalRequestBody TEXT,
    modifiedRequestHeaders TEXT,
    modifiedRequestBody TEXT,
    responseBody TEXT,
    assembledResponseBody TEXT,
    precomputedDiff TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_logs_target_ts ON logs(targetId, timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(timestamp DESC)`,
  `CREATE TABLE IF NOT EXISTS hooks (
    id TEXT PRIMARY KEY,
    sessionId TEXT,
    eventName TEXT NOT NULL,
    toolName TEXT,
    payload TEXT,
    createdAt TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_hooks_session_ts ON hooks(sessionId, createdAt DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_hooks_ts ON hooks(createdAt DESC)`,
  `ALTER TABLE hooks ADD COLUMN cwd TEXT`,
  `ALTER TABLE hooks ADD COLUMN projectRoot TEXT`,
  `ALTER TABLE logs ADD COLUMN sessionId TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_logs_session_ts ON logs(sessionId, timestamp DESC)`,
  `CREATE TABLE IF NOT EXISTS cost_records (
    id TEXT PRIMARY KEY,
    logId TEXT,
    timestamp TEXT NOT NULL,
    sessionId TEXT,
    targetId TEXT NOT NULL,
    targetName TEXT NOT NULL,
    model TEXT,
    inputTokens INTEGER NOT NULL DEFAULT 0,
    outputTokens INTEGER NOT NULL DEFAULT 0,
    totalTokens INTEGER NOT NULL DEFAULT 0,
    cacheReadTokens INTEGER NOT NULL DEFAULT 0,
    cacheCreationTokens INTEGER NOT NULL DEFAULT 0,
    costUsd REAL NOT NULL DEFAULT 0,
    durationMs INTEGER NOT NULL DEFAULT 0,
    firstChunkMs INTEGER,
    status TEXT NOT NULL DEFAULT 'completed'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cost_session ON cost_records(sessionId, timestamp DESC);
   CREATE INDEX IF NOT EXISTS idx_cost_ts ON cost_records(timestamp DESC);
   CREATE INDEX IF NOT EXISTS idx_cost_target_ts ON cost_records(targetId, timestamp DESC)`,
];

let dbInstance: Database.Database | null = null;
let legacyWarned = false;

const ensureDataDir = (): void => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const runMigrations = (db: Database.Database): void => {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec(MIGRATIONS[i]);
  }
  if (current < MIGRATIONS.length) {
    db.pragma(`user_version = ${MIGRATIONS.length}`);
  }
};

const warnLegacyOnce = (): void => {
  if (legacyWarned) return;
  legacyWarned = true;
  if (fs.existsSync(LEGACY_LOGS_PATH)) {
    console.warn(
      `[claude-llm-proxy] 检测到旧版 logs.json（${LEGACY_LOGS_PATH}）。新版日志已迁移到 SQLite（logs.db），旧文件不再使用，可手动删除。`,
    );
  }
};

export const getDb = (): Database.Database => {
  if (dbInstance) return dbInstance;
  ensureDataDir();
  warnLegacyOnce();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  runMigrations(db);
  dbInstance = db;
  return db;
};

export const closeDb = (): void => {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
};
