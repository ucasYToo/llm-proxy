import { v4 as uuidv4 } from "uuid";
import { getDb } from "./db";

export type RemoteSource = "web" | "feishu";
export type RemoteThreadStatus =
  | "pending"
  | "queued"
  | "running"
  | "waiting_permission"
  | "done"
  | "failed";
export type RemoteMessageDirection =
  | "inbound"
  | "outbound"
  | "system"
  | "permission";
export type RemoteMessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed";
export type RemoteInstanceStatus = "online" | "offline";
export type RemotePermissionStatus = "pending" | "resolved" | "expired";
export type RemotePermissionBehavior = "allow" | "deny";
export type RemoteMessageCardStatus =
  | "queued"
  | "running"
  | "waiting_permission"
  | "done"
  | "failed";

export interface RemoteThread {
  id: string;
  shortId: string;
  source: RemoteSource;
  sourceBotId: string | null;
  sourceThreadId: string | null;
  sourceUserId: string | null;
  sourceChatId: string | null;
  cwd: string | null;
  claudeSessionId: string | null;
  channelInstanceId: string | null;
  status: RemoteThreadStatus;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

export interface RemoteMessage {
  id: string;
  threadId: string;
  direction: RemoteMessageDirection;
  source: RemoteSource;
  sourceBotId: string | null;
  sourceMessageId: string | null;
  sourceUserId: string | null;
  text: string;
  status: RemoteMessageStatus;
  error: string | null;
  raw: unknown;
  createdAt: string;
  deliveredAt: string | null;
}

export interface RemoteChannelInstance {
  id: string;
  pid: number | null;
  cwd: string | null;
  claudeSessionId: string | null;
  status: RemoteInstanceStatus;
  metadata: unknown;
  startedAt: string;
  lastSeenAt: string;
}

export interface RemotePermission {
  id: string;
  threadId: string | null;
  channelInstanceId: string | null;
  requestId: string;
  toolName: string;
  description: string | null;
  inputPreview: string | null;
  status: RemotePermissionStatus;
  behavior: RemotePermissionBehavior | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface RemoteMessageCard {
  id: string;
  threadId: string;
  inboundMessageId: string;
  provider: "feishu";
  sourceBotId: string | null;
  providerMessageId: string | null;
  chatId: string | null;
  status: RemoteMessageCardStatus;
  lastSnapshot: unknown;
  lastPatchedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRemoteThreadInput {
  source: RemoteSource;
  sourceBotId?: string | null;
  sourceThreadId?: string | null;
  sourceUserId?: string | null;
  sourceChatId?: string | null;
  cwd?: string | null;
  claudeSessionId?: string | null;
  title?: string | null;
}

export interface InsertRemoteMessageInput {
  threadId: string;
  direction: RemoteMessageDirection;
  source: RemoteSource;
  sourceBotId?: string | null;
  sourceMessageId?: string | null;
  sourceUserId?: string | null;
  text: string;
  status?: RemoteMessageStatus;
  error?: string | null;
  raw?: unknown;
}

const nowIso = (): string => new Date().toISOString();

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const rowToThread = (row: Record<string, unknown>): RemoteThread => ({
  id: row.id as string,
  shortId: row.shortId as string,
  source: row.source as RemoteSource,
  sourceBotId: (row.sourceBotId as string | null) ?? null,
  sourceThreadId: (row.sourceThreadId as string | null) ?? null,
  sourceUserId: (row.sourceUserId as string | null) ?? null,
  sourceChatId: (row.sourceChatId as string | null) ?? null,
  cwd: (row.cwd as string | null) ?? null,
  claudeSessionId: (row.claudeSessionId as string | null) ?? null,
  channelInstanceId: (row.channelInstanceId as string | null) ?? null,
  status: row.status as RemoteThreadStatus,
  title: (row.title as string | null) ?? null,
  createdAt: row.createdAt as string,
  updatedAt: row.updatedAt as string,
  lastMessageAt: (row.lastMessageAt as string | null) ?? null,
});

const rowToMessage = (row: Record<string, unknown>): RemoteMessage => ({
  id: row.id as string,
  threadId: row.threadId as string,
  direction: row.direction as RemoteMessageDirection,
  source: row.source as RemoteSource,
  sourceBotId: (row.sourceBotId as string | null) ?? null,
  sourceMessageId: (row.sourceMessageId as string | null) ?? null,
  sourceUserId: (row.sourceUserId as string | null) ?? null,
  text: row.text as string,
  status: row.status as RemoteMessageStatus,
  error: (row.error as string | null) ?? null,
  raw: parseJson(row.raw),
  createdAt: row.createdAt as string,
  deliveredAt: (row.deliveredAt as string | null) ?? null,
});

const rowToInstance = (
  row: Record<string, unknown>,
): RemoteChannelInstance => ({
  id: row.id as string,
  pid:
    typeof row.pid === "number"
      ? row.pid
      : row.pid === null || row.pid === undefined
        ? null
        : Number(row.pid),
  cwd: (row.cwd as string | null) ?? null,
  claudeSessionId: (row.claudeSessionId as string | null) ?? null,
  status: row.status as RemoteInstanceStatus,
  metadata: parseJson(row.metadata),
  startedAt: row.startedAt as string,
  lastSeenAt: row.lastSeenAt as string,
});

const rowToPermission = (
  row: Record<string, unknown>,
): RemotePermission => ({
  id: row.id as string,
  threadId: (row.threadId as string | null) ?? null,
  channelInstanceId: (row.channelInstanceId as string | null) ?? null,
  requestId: row.requestId as string,
  toolName: row.toolName as string,
  description: (row.description as string | null) ?? null,
  inputPreview: (row.inputPreview as string | null) ?? null,
  status: row.status as RemotePermissionStatus,
  behavior: (row.behavior as RemotePermissionBehavior | null) ?? null,
  createdAt: row.createdAt as string,
  resolvedAt: (row.resolvedAt as string | null) ?? null,
});

const rowToMessageCard = (row: Record<string, unknown>): RemoteMessageCard => ({
  id: row.id as string,
  threadId: row.threadId as string,
  inboundMessageId: row.inboundMessageId as string,
  provider: row.provider as "feishu",
  sourceBotId: (row.sourceBotId as string | null) ?? null,
  providerMessageId: (row.providerMessageId as string | null) ?? null,
  chatId: (row.chatId as string | null) ?? null,
  status: row.status as RemoteMessageCardStatus,
  lastSnapshot: parseJson(row.lastSnapshot),
  lastPatchedAt: (row.lastPatchedAt as string | null) ?? null,
  error: (row.error as string | null) ?? null,
  createdAt: row.createdAt as string,
  updatedAt: row.updatedAt as string,
});

const createShortId = (): string => uuidv4().replace(/-/g, "").slice(0, 8);

export const createRemoteThread = (
  input: CreateRemoteThreadInput,
): RemoteThread => {
  const createdAt = nowIso();
  let shortId = createShortId();
  const db = getDb();
  while (
    db.prepare(`SELECT 1 FROM remote_threads WHERE shortId = ?`).get(shortId)
  ) {
    shortId = createShortId();
  }

  const thread: RemoteThread = {
    id: uuidv4(),
    shortId,
    source: input.source,
    sourceBotId: input.sourceBotId ?? null,
    sourceThreadId: input.sourceThreadId ?? null,
    sourceUserId: input.sourceUserId ?? null,
    sourceChatId: input.sourceChatId ?? null,
    cwd: input.cwd ?? null,
    claudeSessionId: input.claudeSessionId ?? null,
    channelInstanceId: null,
    status: "pending",
    title: input.title ?? null,
    createdAt,
    updatedAt: createdAt,
    lastMessageAt: null,
  };

  db.prepare(
    `INSERT INTO remote_threads (
      id, shortId, source, sourceBotId, sourceThreadId, sourceUserId, sourceChatId, cwd,
      claudeSessionId, channelInstanceId, status, title, createdAt, updatedAt,
      lastMessageAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    thread.id,
    thread.shortId,
    thread.source,
    thread.sourceBotId,
    thread.sourceThreadId,
    thread.sourceUserId,
    thread.sourceChatId,
    thread.cwd,
    thread.claudeSessionId,
    thread.channelInstanceId,
    thread.status,
    thread.title,
    thread.createdAt,
    thread.updatedAt,
    thread.lastMessageAt,
  );

  return thread;
};

export const getRemoteThread = (idOrShortId: string): RemoteThread | null => {
  const row = getDb()
    .prepare(
      `SELECT * FROM remote_threads WHERE id = ? OR shortId = ? LIMIT 1`,
    )
    .get(idOrShortId, idOrShortId) as Record<string, unknown> | undefined;
  return row ? rowToThread(row) : null;
};

export const findLatestRemoteThreadForSource = (opts: {
  source: RemoteSource;
  sourceBotId?: string | null;
  sourceThreadId?: string | null;
  sourceUserId?: string | null;
  sourceChatId?: string | null;
}): RemoteThread | null => {
  const filters = ["source = ?"];
  const args: unknown[] = [opts.source];
  if (opts.sourceThreadId) {
    filters.push("sourceThreadId = ?");
    args.push(opts.sourceThreadId);
  }
  if (opts.sourceBotId) {
    filters.push("(sourceBotId = ? OR sourceBotId IS NULL)");
    args.push(opts.sourceBotId);
  }
  if (opts.sourceUserId) {
    filters.push("sourceUserId = ?");
    args.push(opts.sourceUserId);
  }
  if (opts.sourceChatId) {
    filters.push("sourceChatId = ?");
    args.push(opts.sourceChatId);
  }
  const row = getDb()
    .prepare(
      `SELECT * FROM remote_threads WHERE ${filters.join(" AND ")}
       ORDER BY updatedAt DESC LIMIT 1`,
    )
    .get(...args) as Record<string, unknown> | undefined;
  return row ? rowToThread(row) : null;
};

export const updateRemoteThread = (
  threadId: string,
  updates: Partial<
    Pick<
      RemoteThread,
      | "status"
      | "sourceBotId"
      | "sourceThreadId"
      | "sourceUserId"
      | "sourceChatId"
      | "claudeSessionId"
      | "channelInstanceId"
      | "cwd"
      | "title"
      | "lastMessageAt"
    >
  >,
): RemoteThread | null => {
  const cols: string[] = [];
  const args: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === "undefined") continue;
    cols.push(`${key} = ?`);
    args.push(value ?? null);
  }
  cols.push("updatedAt = ?");
  args.push(nowIso(), threadId);
  getDb()
    .prepare(`UPDATE remote_threads SET ${cols.join(", ")} WHERE id = ?`)
    .run(...args);
  return getRemoteThread(threadId);
};

export const queryRemoteThreads = (opts: {
  limit?: number;
  offset?: number;
  status?: string;
  source?: string;
} = {}): { threads: RemoteThread[]; total: number } => {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = [];
  const args: unknown[] = [];
  if (opts.status) {
    filters.push("status = ?");
    args.push(opts.status);
  }
  if (opts.source) {
    filters.push("source = ?");
    args.push(opts.source);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const total = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM remote_threads ${where}`)
    .get(...args) as { count: number };
  const rows = getDb()
    .prepare(
      `SELECT * FROM remote_threads ${where}
       ORDER BY updatedAt DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as Record<string, unknown>[];
  return { threads: rows.map(rowToThread), total: total.count };
};

export const insertRemoteMessage = (
  input: InsertRemoteMessageInput,
): RemoteMessage => {
  const createdAt = nowIso();
  const message: RemoteMessage = {
    id: uuidv4(),
    threadId: input.threadId,
    direction: input.direction,
    source: input.source,
    sourceBotId: input.sourceBotId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceUserId: input.sourceUserId ?? null,
    text: input.text,
    status: input.status ?? "queued",
    error: input.error ?? null,
    raw: input.raw ?? null,
    createdAt,
    deliveredAt: null,
  };
  const db = getDb();
  db.prepare(
    `INSERT INTO remote_messages (
      id, threadId, direction, source, sourceBotId, sourceMessageId, sourceUserId, text,
      status, error, raw, createdAt, deliveredAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.threadId,
    message.direction,
    message.source,
    message.sourceBotId,
    message.sourceMessageId,
    message.sourceUserId,
    message.text,
    message.status,
    message.error,
    JSON.stringify(message.raw ?? null),
    message.createdAt,
    message.deliveredAt,
  );
  updateRemoteThread(message.threadId, {
    lastMessageAt: createdAt,
    title:
      message.direction === "inbound"
        ? message.text.trim().slice(0, 80)
        : undefined,
  });
  return message;
};

export const updateRemoteMessageStatus = (
  messageId: string,
  status: RemoteMessageStatus,
  error?: string | null,
): RemoteMessage | null => {
  const deliveredAt =
    status === "sent" || status === "delivered" ? nowIso() : null;
  getDb()
    .prepare(
      `UPDATE remote_messages
       SET status = ?, error = ?, deliveredAt = COALESCE(?, deliveredAt)
       WHERE id = ?`,
    )
    .run(status, error ?? null, deliveredAt, messageId);
  const row = getDb()
    .prepare(`SELECT * FROM remote_messages WHERE id = ?`)
    .get(messageId) as Record<string, unknown> | undefined;
  return row ? rowToMessage(row) : null;
};

export const getRemoteMessage = (
  messageId: string,
): RemoteMessage | null => {
  const row = getDb()
    .prepare(`SELECT * FROM remote_messages WHERE id = ? LIMIT 1`)
    .get(messageId) as Record<string, unknown> | undefined;
  return row ? rowToMessage(row) : null;
};

export const findRemoteMessageBySource = (opts: {
  source: RemoteSource;
  sourceBotId?: string | null;
  sourceMessageId: string;
  direction: RemoteMessageDirection;
}): RemoteMessage | null => {
  const row = getDb()
    .prepare(
      `SELECT * FROM remote_messages
       WHERE source = ? AND sourceMessageId = ? AND direction = ?
         AND (? IS NULL OR sourceBotId = ? OR sourceBotId IS NULL)
       ORDER BY createdAt DESC LIMIT 1`,
    )
    .get(opts.source, opts.sourceMessageId, opts.direction, opts.sourceBotId ?? null, opts.sourceBotId ?? null) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToMessage(row) : null;
};

export const queryRemoteMessages = (opts: {
  threadId?: string;
  status?: string;
  limit?: number;
  offset?: number;
} = {}): { messages: RemoteMessage[]; total: number } => {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = [];
  const args: unknown[] = [];
  if (opts.threadId) {
    filters.push("threadId = ?");
    args.push(opts.threadId);
  }
  if (opts.status) {
    filters.push("status = ?");
    args.push(opts.status);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const total = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM remote_messages ${where}`)
    .get(...args) as { count: number };
  const orderBy = opts.threadId ? "createdAt ASC" : "createdAt DESC";
  const rows = getDb()
    .prepare(
      `SELECT * FROM remote_messages ${where}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as Record<string, unknown>[];
  const messages = rows.map(rowToMessage);
  return {
    messages: opts.threadId ? messages : messages.reverse(),
    total: total.count,
  };
};

export const createRemoteMessageCard = (input: {
  threadId: string;
  inboundMessageId: string;
  provider: "feishu";
  sourceBotId?: string | null;
  providerMessageId?: string | null;
  chatId?: string | null;
  status?: RemoteMessageCardStatus;
  lastSnapshot?: unknown;
}): RemoteMessageCard => {
  const ts = nowIso();
  const card: RemoteMessageCard = {
    id: uuidv4(),
    threadId: input.threadId,
    inboundMessageId: input.inboundMessageId,
    provider: input.provider,
    sourceBotId: input.sourceBotId ?? null,
    providerMessageId: input.providerMessageId ?? null,
    chatId: input.chatId ?? null,
    status: input.status ?? "queued",
    lastSnapshot: input.lastSnapshot ?? null,
    lastPatchedAt: null,
    error: null,
    createdAt: ts,
    updatedAt: ts,
  };
  getDb()
    .prepare(
      `INSERT INTO remote_message_cards (
        id, threadId, inboundMessageId, provider, sourceBotId, providerMessageId, chatId,
        status, lastSnapshot, lastPatchedAt, error, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      card.id,
      card.threadId,
      card.inboundMessageId,
      card.provider,
      card.sourceBotId,
      card.providerMessageId,
      card.chatId,
      card.status,
      JSON.stringify(card.lastSnapshot ?? null),
      card.lastPatchedAt,
      card.error,
      card.createdAt,
      card.updatedAt,
    );
  return card;
};

export const getRemoteMessageCardByInbound = (
  inboundMessageId: string,
): RemoteMessageCard | null => {
  const row = getDb()
    .prepare(
      `SELECT * FROM remote_message_cards
       WHERE inboundMessageId = ?
       ORDER BY createdAt DESC LIMIT 1`,
    )
    .get(inboundMessageId) as Record<string, unknown> | undefined;
  return row ? rowToMessageCard(row) : null;
};

export const getLatestRemoteMessageCardForThread = (
  threadId: string,
): RemoteMessageCard | null => {
  const row = getDb()
    .prepare(
      `SELECT * FROM remote_message_cards
       WHERE threadId = ?
       ORDER BY updatedAt DESC LIMIT 1`,
    )
    .get(threadId) as Record<string, unknown> | undefined;
  return row ? rowToMessageCard(row) : null;
};

export const updateRemoteMessageCard = (
  id: string,
  updates: Partial<
    Pick<
      RemoteMessageCard,
      | "providerMessageId"
      | "chatId"
      | "status"
      | "lastSnapshot"
      | "lastPatchedAt"
      | "error"
    >
  >,
): RemoteMessageCard | null => {
  const cols: string[] = [];
  const args: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === "undefined") continue;
    cols.push(`${key} = ?`);
    args.push(key === "lastSnapshot" ? JSON.stringify(value ?? null) : value ?? null);
  }
  if (cols.length === 0) {
    const row = getDb()
      .prepare(`SELECT * FROM remote_message_cards WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToMessageCard(row) : null;
  }
  cols.push("updatedAt = ?");
  args.push(nowIso(), id);
  getDb()
    .prepare(`UPDATE remote_message_cards SET ${cols.join(", ")} WHERE id = ?`)
    .run(...args);
  const row = getDb()
    .prepare(`SELECT * FROM remote_message_cards WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToMessageCard(row) : null;
};

export const upsertRemoteChannelInstance = (input: {
  id?: string;
  pid?: number | null;
  cwd?: string | null;
  claudeSessionId?: string | null;
  metadata?: unknown;
}): RemoteChannelInstance => {
  const db = getDb();
  const id = input.id || uuidv4();
  const existing = db
    .prepare(`SELECT * FROM remote_channel_instances WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  const ts = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE remote_channel_instances
       SET pid = ?, cwd = ?, claudeSessionId = COALESCE(?, claudeSessionId),
           status = 'online', metadata = ?, lastSeenAt = ?
       WHERE id = ?`,
    ).run(
      input.pid ?? null,
      input.cwd ?? null,
      input.claudeSessionId ?? null,
      JSON.stringify(input.metadata ?? null),
      ts,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO remote_channel_instances (
        id, pid, cwd, claudeSessionId, status, metadata, startedAt, lastSeenAt
      ) VALUES (?, ?, ?, ?, 'online', ?, ?, ?)`,
    ).run(
      id,
      input.pid ?? null,
      input.cwd ?? null,
      input.claudeSessionId ?? null,
      JSON.stringify(input.metadata ?? null),
      ts,
      ts,
    );
  }
  const row = db
    .prepare(`SELECT * FROM remote_channel_instances WHERE id = ?`)
    .get(id) as Record<string, unknown>;
  return rowToInstance(row);
};

export const heartbeatRemoteChannelInstance = (
  id: string,
  claudeSessionId?: string | null,
): RemoteChannelInstance | null => {
  getDb()
    .prepare(
      `UPDATE remote_channel_instances
       SET status = 'online', lastSeenAt = ?, claudeSessionId = COALESCE(?, claudeSessionId)
       WHERE id = ?`,
    )
    .run(nowIso(), claudeSessionId ?? null, id);
  const row = getDb()
    .prepare(`SELECT * FROM remote_channel_instances WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToInstance(row) : null;
};

export const markRemoteChannelInstanceOffline = (id: string): void => {
  getDb()
    .prepare(`UPDATE remote_channel_instances SET status = 'offline' WHERE id = ?`)
    .run(id);
};

export const queryRemoteChannelInstances = (opts: {
  limit?: number;
  includeStale?: boolean;
  onlineWithinMs?: number;
} = {}): RemoteChannelInstance[] => {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const onlineWithinMs = opts.onlineWithinMs ?? 60_000;
  const args: unknown[] = [];
  let where = "";
  if (!opts.includeStale) {
    where = "WHERE status = 'online' AND lastSeenAt >= ?";
    args.push(new Date(Date.now() - onlineWithinMs).toISOString());
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM remote_channel_instances ${where}
       ORDER BY lastSeenAt DESC LIMIT ?`,
    )
    .all(...args, limit) as Record<string, unknown>[];
  return rows.map(rowToInstance);
};

export const getRemoteChannelInstance = (
  id: string,
  onlineWithinMs = 60_000,
): RemoteChannelInstance | null => {
  const row = getDb()
    .prepare(
      `SELECT * FROM remote_channel_instances
       WHERE id = ? AND status = 'online' AND lastSeenAt >= ?`,
    )
    .get(id, new Date(Date.now() - onlineWithinMs).toISOString()) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToInstance(row) : null;
};

export const findLatestInstanceForCwd = (
  cwd: string | null | undefined,
  onlineWithinMs = 60_000,
): RemoteChannelInstance | null => {
  const args: unknown[] = [new Date(Date.now() - onlineWithinMs).toISOString()];
  let where = "status = 'online' AND lastSeenAt >= ?";
  if (cwd) {
    where += " AND cwd = ?";
    args.push(cwd);
  }
  const row = getDb()
    .prepare(
      `SELECT * FROM remote_channel_instances WHERE ${where}
       ORDER BY lastSeenAt DESC LIMIT 1`,
    )
    .get(...args) as Record<string, unknown> | undefined;
  return row ? rowToInstance(row) : null;
};

export const createRemotePermission = (input: {
  threadId?: string | null;
  channelInstanceId?: string | null;
  requestId: string;
  toolName: string;
  description?: string | null;
  inputPreview?: string | null;
}): RemotePermission => {
  const createdAt = nowIso();
  const permission: RemotePermission = {
    id: uuidv4(),
    threadId: input.threadId ?? null,
    channelInstanceId: input.channelInstanceId ?? null,
    requestId: input.requestId,
    toolName: input.toolName,
    description: input.description ?? null,
    inputPreview: input.inputPreview ?? null,
    status: "pending",
    behavior: null,
    createdAt,
    resolvedAt: null,
  };
  getDb()
    .prepare(
      `INSERT INTO remote_permissions (
        id, threadId, channelInstanceId, requestId, toolName, description,
        inputPreview, status, behavior, createdAt, resolvedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      permission.id,
      permission.threadId,
      permission.channelInstanceId,
      permission.requestId,
      permission.toolName,
      permission.description,
      permission.inputPreview,
      permission.status,
      permission.behavior,
      permission.createdAt,
      permission.resolvedAt,
    );
  return permission;
};

export const resolveRemotePermission = (
  requestId: string,
  behavior: RemotePermissionBehavior,
): RemotePermission | null => {
  const pending = queryRemotePermissions({ requestId, status: "pending", limit: 1 })[0];
  if (!pending) return null;
  return resolveRemotePermissionById(pending.id, behavior);
};

export const resolveRemotePermissionById = (
  id: string,
  behavior: RemotePermissionBehavior,
): RemotePermission | null => {
  getDb()
    .prepare(
      `UPDATE remote_permissions
       SET status = 'resolved', behavior = ?, resolvedAt = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(behavior, nowIso(), id);
  const row = getDb()
    .prepare(
      `SELECT * FROM remote_permissions WHERE id = ? LIMIT 1`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToPermission(row) : null;
};

export const queryRemotePermissions = (opts: {
  threadId?: string;
  requestId?: string;
  status?: string;
  limit?: number;
} = {}): RemotePermission[] => {
  const filters: string[] = [];
  const args: unknown[] = [];
  if (opts.threadId) {
    filters.push("threadId = ?");
    args.push(opts.threadId);
  }
  if (opts.requestId) {
    filters.push("requestId = ?");
    args.push(opts.requestId);
  }
  if (opts.status) {
    filters.push("status = ?");
    args.push(opts.status);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT * FROM remote_permissions ${where}
       ORDER BY createdAt DESC LIMIT ?`,
    )
    .all(...args, Math.min(opts.limit ?? 100, 500)) as Record<
    string,
    unknown
  >[];
  return rows.map(rowToPermission);
};
