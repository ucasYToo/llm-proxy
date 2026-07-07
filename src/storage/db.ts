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
  `CREATE TABLE IF NOT EXISTS session_cwds (
    sessionId TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    remark TEXT,
    createdAt TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_cwds_cwd ON session_cwds(cwd)`,
  `CREATE TABLE IF NOT EXISTS projects (
    cwd TEXT PRIMARY KEY,
    remark TEXT
  )`,
  `ALTER TABLE logs ADD COLUMN conversationId TEXT`,
  `ALTER TABLE logs ADD COLUMN agentRole TEXT;
   CREATE INDEX IF NOT EXISTS idx_logs_agent_role ON logs(agentRole);
   CREATE INDEX IF NOT EXISTS idx_logs_conversation ON logs(conversationId)`,
  `ALTER TABLE logs ADD COLUMN agentId TEXT`,
  `ALTER TABLE logs ADD COLUMN agentType TEXT;
   CREATE INDEX IF NOT EXISTS idx_logs_agent_id ON logs(agentId)`,
  `ALTER TABLE logs ADD COLUMN cwd TEXT;
   UPDATE logs SET agentType = (
     SELECT json_extract(h.payload, '$.agent_type')
     FROM hooks h
     WHERE json_extract(h.payload, '$.agent_id') = logs.agentId
       AND json_extract(h.payload, '$.agent_type') IS NOT NULL
     LIMIT 1
   ) WHERE agentId IS NOT NULL;
   UPDATE logs SET cwd = (
     SELECT sc.cwd FROM session_cwds sc WHERE sc.sessionId = logs.sessionId LIMIT 1
   ) WHERE sessionId IS NOT NULL;
   UPDATE logs SET conversationId = NULL, agentRole = NULL`,
  `CREATE TABLE IF NOT EXISTS remote_threads (
    id TEXT PRIMARY KEY,
    shortId TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    sourceThreadId TEXT,
    sourceUserId TEXT,
    sourceChatId TEXT,
    cwd TEXT,
    claudeSessionId TEXT,
    channelInstanceId TEXT,
    status TEXT NOT NULL,
    title TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    lastMessageAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_remote_threads_updated ON remote_threads(updatedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_remote_threads_source ON remote_threads(source, sourceThreadId);
  CREATE INDEX IF NOT EXISTS idx_remote_threads_cwd ON remote_threads(cwd, updatedAt DESC)`,
  `CREATE TABLE IF NOT EXISTS remote_messages (
    id TEXT PRIMARY KEY,
    threadId TEXT NOT NULL,
    direction TEXT NOT NULL,
    source TEXT NOT NULL,
    sourceMessageId TEXT,
    sourceUserId TEXT,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    raw TEXT,
    createdAt TEXT NOT NULL,
    deliveredAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_remote_messages_thread ON remote_messages(threadId, createdAt ASC);
  CREATE INDEX IF NOT EXISTS idx_remote_messages_status ON remote_messages(status, createdAt ASC)`,
  `CREATE TABLE IF NOT EXISTS remote_channel_instances (
    id TEXT PRIMARY KEY,
    pid INTEGER,
    cwd TEXT,
    claudeSessionId TEXT,
    status TEXT NOT NULL,
    metadata TEXT,
    startedAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_remote_instances_seen ON remote_channel_instances(status, lastSeenAt DESC);
  CREATE INDEX IF NOT EXISTS idx_remote_instances_cwd ON remote_channel_instances(cwd, lastSeenAt DESC)`,
  `CREATE TABLE IF NOT EXISTS remote_permissions (
    id TEXT PRIMARY KEY,
    threadId TEXT,
    channelInstanceId TEXT,
    requestId TEXT NOT NULL,
    toolName TEXT NOT NULL,
    description TEXT,
    inputPreview TEXT,
    status TEXT NOT NULL,
    behavior TEXT,
    createdAt TEXT NOT NULL,
    resolvedAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_remote_permissions_request ON remote_permissions(requestId, status);
  CREATE INDEX IF NOT EXISTS idx_remote_permissions_thread ON remote_permissions(threadId, createdAt DESC)`,
  `CREATE TABLE IF NOT EXISTS remote_message_cards (
    id TEXT PRIMARY KEY,
    threadId TEXT NOT NULL,
    inboundMessageId TEXT NOT NULL,
    provider TEXT NOT NULL,
    providerMessageId TEXT,
    chatId TEXT,
    status TEXT NOT NULL,
    lastSnapshot TEXT,
    lastPatchedAt TEXT,
    error TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_remote_cards_inbound ON remote_message_cards(inboundMessageId);
  CREATE INDEX IF NOT EXISTS idx_remote_cards_thread ON remote_message_cards(threadId, updatedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_remote_cards_provider ON remote_message_cards(provider, providerMessageId)`,
  `ALTER TABLE remote_threads ADD COLUMN sourceBotId TEXT;
   ALTER TABLE remote_messages ADD COLUMN sourceBotId TEXT;
   ALTER TABLE remote_message_cards ADD COLUMN sourceBotId TEXT;
   CREATE INDEX IF NOT EXISTS idx_remote_threads_source_bot ON remote_threads(source, sourceBotId, sourceChatId, updatedAt DESC);
   CREATE INDEX IF NOT EXISTS idx_remote_messages_source_bot ON remote_messages(source, sourceBotId, sourceMessageId)`,
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
  if (process.env.CLAUDE_PROXY_VERBOSE !== "1" && process.env.CLAUDE_PROXY_WARN_LEGACY_LOGS !== "1") return;
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
  db.pragma("mmap_size = 268435456");
  db.pragma("cache_size = -65536");
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
