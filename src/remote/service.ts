import fs from "fs";
import { readConfig } from "../config/store";
import {
  createRemotePermission,
  createRemoteThread,
  findLatestInstanceForCwd,
  findRemoteMessageBySource,
  findLatestRemoteThreadForSource,
  getRemoteChannelInstance,
  getRemoteMessage,
  getRemoteThread,
  heartbeatRemoteChannelInstance,
  insertRemoteMessage,
  markRemoteChannelInstanceOffline,
  queryRemoteChannelInstances,
  queryRemoteMessages,
  queryRemotePermissions,
  queryRemoteThreads,
  resolveRemotePermissionById,
  updateRemoteMessageStatus,
  updateRemoteThread,
  upsertRemoteChannelInstance,
  type RemoteChannelInstance,
  type RemoteMessage,
  type RemotePermissionBehavior,
  type RemoteSource,
  type RemoteThread,
} from "../storage/remote";
import { pushRemoteChannelEvent } from "./channel-hub";
import { launchClaudeSession } from "./session";
import { getServerPort } from "../server/state";
import { installRemoteMcpConfig } from "./mcp-config";
import { runClaudePrint } from "./cli-runner";
import {
  createInitialProgressSnapshot,
  markProgressDone,
  markProgressFailed,
  markProgressRunning,
  reduceClaudeStreamEvent,
  type RemoteProgressSnapshot,
} from "./progress";

export type RemoteEventType =
  | "thread"
  | "message"
  | "instance"
  | "permission"
  | "progress";
export type RemoteOutboundKind = "final" | "partial" | "error";

type RemoteEventListener = (type: RemoteEventType, data: unknown) => void;
type RemoteOutboundSender = (
  thread: RemoteThread,
  message: RemoteMessage,
  kind: RemoteOutboundKind,
) => Promise<void> | void;

const remoteEventListeners = new Set<RemoteEventListener>();
const outboundSenders = new Set<RemoteOutboundSender>();
const cliQueues = new Map<string, Promise<void>>();
const progressSnapshots = new Map<string, RemoteProgressSnapshot>();

export const onRemoteEvent = (fn: RemoteEventListener): (() => void) => {
  remoteEventListeners.add(fn);
  return () => remoteEventListeners.delete(fn);
};

export const registerRemoteOutboundSender = (
  fn: RemoteOutboundSender,
): (() => void) => {
  outboundSenders.add(fn);
  return () => outboundSenders.delete(fn);
};

const emitRemoteEvent = (type: RemoteEventType, data: unknown): void => {
  for (const fn of remoteEventListeners) {
    try {
      fn(type, data);
    } catch {
      // ignore listener failures
    }
  }
};

const dashboardUrlForThread = (thread: RemoteThread): string | undefined => {
  const base = readConfig().remoteBridge?.web?.publicBaseUrl?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/?remoteThread=${encodeURIComponent(thread.shortId)}`;
};

const setProgressSnapshot = (snapshot: RemoteProgressSnapshot): void => {
  progressSnapshots.set(snapshot.inboundMessageId, snapshot);
  emitRemoteEvent("progress", snapshot);
};

export const getRemoteProgressSnapshot = (
  inboundMessageId: string,
): RemoteProgressSnapshot | null =>
  progressSnapshots.get(inboundMessageId) ?? null;

const initProgressSnapshot = (
  thread: RemoteThread,
  message: RemoteMessage,
): RemoteProgressSnapshot => {
  const snapshot = createInitialProgressSnapshot({
    thread,
    message,
    dashboardUrl: dashboardUrlForThread(thread),
  });
  setProgressSnapshot(snapshot);
  return snapshot;
};

const updateProgressSnapshot = (
  inboundMessageId: string,
  fn: (snapshot: RemoteProgressSnapshot) => RemoteProgressSnapshot,
): RemoteProgressSnapshot | null => {
  const current = progressSnapshots.get(inboundMessageId);
  if (!current) return null;
  const next = fn(current);
  setProgressSnapshot(next);
  return next;
};

const isCwdAllowed = (cwd: string): boolean => {
  const remoteBridge = readConfig().remoteBridge;
  const allowed = remoteBridge?.allowedCwds ?? [];
  const candidates =
    allowed.length > 0
      ? allowed
      : remoteBridge?.defaultCwd
        ? [remoteBridge.defaultCwd]
        : [];
  if (!candidates.length) return false;
  const realCwd = fs.realpathSync.native(cwd);
  return candidates.some((item) => {
    try {
      return fs.realpathSync.native(item) === realCwd;
    } catch {
      return false;
    }
  });
};

const normalizeCwd = (cwd: string | null | undefined): string | null => {
  if (!cwd) return null;
  return cwd.replace(/[/\\]+$/, "");
};

const assertAllowedCwd = (cwd: string): void => {
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
  }
  if (!isCwdAllowed(cwd)) {
    throw new Error(`cwd is not allowed by remoteBridge.allowedCwds: ${cwd}`);
  }
};

const selectInstanceForThread = (
  thread: RemoteThread,
): RemoteChannelInstance | null => {
  if (thread.channelInstanceId) {
    const instance = getRemoteChannelInstance(thread.channelInstanceId);
    if (instance) return instance;
  }
  return findLatestInstanceForCwd(thread.cwd);
};

const isThreadVisibleToInput = (
  thread: RemoteThread,
  input: {
    source: RemoteSource;
    sourceUserId?: string | null;
    sourceChatId?: string | null;
  },
): boolean => {
  if (thread.source !== input.source) return false;
  if (thread.sourceChatId && thread.sourceChatId !== input.sourceChatId) return false;
  if (thread.sourceUserId && thread.sourceUserId !== input.sourceUserId) return false;
  return true;
};

const assertThreadVisibleToInput = (
  thread: RemoteThread,
  input: {
    source: RemoteSource;
    sourceUserId?: string | null;
    sourceChatId?: string | null;
  },
): void => {
  if (!isThreadVisibleToInput(thread, input)) {
    throw new Error(`remote thread is not visible to this ${input.source} context`);
  }
};

const isInstanceBusy = (
  instanceId: string,
  exceptThreadId?: string,
): boolean => {
  const { threads } = queryRemoteThreads({ limit: 500 });
  return threads.some(
    (thread) =>
      thread.channelInstanceId === instanceId &&
      thread.id !== exceptThreadId &&
      (thread.status === "running" || thread.status === "waiting_permission"),
  );
};

const makeMessageMeta = (
  thread: RemoteThread,
  message: RemoteMessage,
): Record<string, string> => ({
  remote_thread_id: thread.id,
  remote_short_id: thread.shortId,
  remote_message_id: message.id,
  source: message.source,
  sender_id: message.sourceUserId ?? "",
  cwd: thread.cwd ?? "",
});

const dispatchToInstance = (
  thread: RemoteThread,
  message: RemoteMessage,
  instance: RemoteChannelInstance,
): boolean => {
  if (isInstanceBusy(instance.id, thread.id)) return false;
  const ok = pushRemoteChannelEvent(instance.id, {
    type: "message",
    messageId: message.id,
    threadId: thread.id,
    content: message.text,
    meta: makeMessageMeta(thread, message),
  });
  if (ok) {
    const sent = updateRemoteMessageStatus(message.id, "sent");
    const updatedThread = updateRemoteThread(thread.id, {
      status: "running",
      channelInstanceId: instance.id,
    });
    if (sent) emitRemoteEvent("message", sent);
    if (updatedThread) emitRemoteEvent("thread", updatedThread);
    updateProgressSnapshot(message.id, (snapshot) =>
      markProgressRunning(snapshot, "已投递到 Claude Code channel"),
    );
  }
  return ok;
};

const emitOutboundToSource = async (
  thread: RemoteThread,
  message: RemoteMessage,
  kind: RemoteOutboundKind,
): Promise<void> => {
  for (const sender of outboundSenders) {
    try {
      await sender(thread, message, kind);
    } catch (err) {
      console.warn("[remote] outbound sender failed:", err);
    }
  }
};

const insertAndDeliverOutbound = async (
  thread: RemoteThread,
  text: string,
  kind: RemoteOutboundKind,
): Promise<RemoteMessage> => {
  const message = insertRemoteMessage({
    threadId: thread.id,
    direction: "outbound",
    source: thread.source,
    text,
    status: "delivered",
  });
  emitRemoteEvent("message", message);
  await emitOutboundToSource(thread, message, kind);
  return message;
};

const dispatchToCli = (
  thread: RemoteThread,
  message: RemoteMessage,
): boolean => {
  if (!thread.cwd) return false;
  const run = async (): Promise<void> => {
    const latestThread = getRemoteThread(thread.id) ?? thread;
    const sent = updateRemoteMessageStatus(message.id, "sent");
    if (sent) emitRemoteEvent("message", sent);
    const runningThread = updateRemoteThread(thread.id, { status: "running" });
    if (runningThread) emitRemoteEvent("thread", runningThread);
    updateProgressSnapshot(message.id, (snapshot) =>
      markProgressRunning(snapshot, "Claude 正在处理"),
    );

    const config = readConfig().remoteBridge;
    if (!config) {
      updateProgressSnapshot(message.id, (snapshot) =>
        markProgressFailed(snapshot, "remoteBridge config is missing"),
      );
      const failed = updateRemoteMessageStatus(
        message.id,
        "failed",
        "remoteBridge config is missing",
      );
      if (failed) emitRemoteEvent("message", failed);
      return;
    }

    const result = await runClaudePrint({
      cwd: latestThread.cwd ?? thread.cwd ?? process.cwd(),
      config,
      prompt: message.text,
      resumeSessionId: latestThread.claudeSessionId,
      onEvent: (event) => {
        updateProgressSnapshot(message.id, (snapshot) =>
          reduceClaudeStreamEvent(snapshot, event),
        );
      },
    });

    if (result.ok) {
      updateProgressSnapshot(message.id, (snapshot) =>
        markProgressDone(snapshot, result.text),
      );
      const delivered = updateRemoteMessageStatus(message.id, "delivered");
      if (delivered) emitRemoteEvent("message", delivered);
      const linkedThread = updateRemoteThread(thread.id, {
        claudeSessionId: result.sessionId ?? latestThread.claudeSessionId,
      });
      if (linkedThread) emitRemoteEvent("thread", linkedThread);
      await receiveRemoteReply({
        remoteThreadId: thread.id,
        text: result.text,
        final: true,
      });
      return;
    }

    updateProgressSnapshot(message.id, (snapshot) =>
      markProgressFailed(snapshot, result.error ?? "Claude CLI failed"),
    );
    const failed = updateRemoteMessageStatus(
      message.id,
      "failed",
      result.error ?? "Claude CLI failed",
    );
    if (failed) emitRemoteEvent("message", failed);
    const failedThread = updateRemoteThread(thread.id, { status: "failed" });
    if (failedThread) emitRemoteEvent("thread", failedThread);
    await insertAndDeliverOutbound(
      failedThread ?? latestThread,
      `Claude CLI 执行失败：${result.error ?? "unknown error"}`,
      "error",
    );
  };

  const previous = cliQueues.get(thread.id) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(run)
    .catch(async (err) => {
      const latestThread = getRemoteThread(thread.id) ?? thread;
      updateProgressSnapshot(message.id, (snapshot) =>
        markProgressFailed(
          snapshot,
          err instanceof Error ? err.message : String(err),
        ),
      );
      const failed = updateRemoteMessageStatus(
        message.id,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
      if (failed) emitRemoteEvent("message", failed);
      const failedThread = updateRemoteThread(thread.id, { status: "failed" });
      if (failedThread) emitRemoteEvent("thread", failedThread);
      await insertAndDeliverOutbound(
        failedThread ?? latestThread,
        `Claude CLI 执行失败：${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    })
    .finally(() => {
      if (cliQueues.get(thread.id) === next) cliQueues.delete(thread.id);
    });
  cliQueues.set(thread.id, next);
  return true;
};

const maybeLaunchForThread = (thread: RemoteThread): void => {
  if (!thread.cwd) return;
  const config = readConfig().remoteBridge;
  if (!config?.enabled) return;
  let mcpFile: string | null = null;
  try {
    const install = installRemoteMcpConfig(thread.cwd, getServerPort());
    mcpFile = install.file;
  } catch (err) {
    const system = insertRemoteMessage({
      threadId: thread.id,
      direction: "system",
      source: thread.source,
      text: `写入 MCP channel 配置失败: ${err instanceof Error ? err.message : String(err)}`,
      status: "failed",
    });
    emitRemoteEvent("message", system);
    return;
  }
  const result = launchClaudeSession(thread.cwd, readConfig().remoteBridge ?? config);
  const system = insertRemoteMessage({
    threadId: thread.id,
    direction: "system",
    source: thread.source,
    text: result.ok
      ? `已写入 ${mcpFile}，并尝试拉起 Claude Code: ${result.command}`
      : `拉起 Claude Code 失败: ${result.error ?? result.command}`,
    status: result.ok ? "sent" : "failed",
  });
  emitRemoteEvent("message", system);
};

export const launchRemoteBridgeChannelForCwd = (
  cwd: string,
): {
  mcpFile: string;
  command: string;
  ok: boolean;
  pid?: number;
  error?: string;
} => {
  const normalized = normalizeCwd(cwd);
  if (!normalized) throw new Error("cwd is required");
  assertAllowedCwd(normalized);
  const install = installRemoteMcpConfig(normalized, getServerPort());
  const result = launchClaudeSession(
    normalized,
    readConfig().remoteBridge ?? install.remoteBridge,
  );
  return {
    mcpFile: install.file,
    command: result.command,
    ok: result.ok,
    pid: result.pid,
    error: result.error,
  };
};

export const dispatchQueuedMessagesForInstance = (
  instance: RemoteChannelInstance,
): void => {
  const { messages } = queryRemoteMessages({
    status: "queued",
    limit: 200,
  });
  for (const message of messages) {
    if (message.direction !== "inbound") continue;
    const thread = getRemoteThread(message.threadId);
    if (!thread) continue;
    if (thread.channelInstanceId && thread.channelInstanceId !== instance.id) {
      const pinnedInstance = getRemoteChannelInstance(thread.channelInstanceId);
      if (pinnedInstance) continue;
    }
    if (thread.cwd && instance.cwd && thread.cwd !== instance.cwd) continue;
    dispatchToInstance(thread, message, instance);
  }
};

export const dispatchQueuedMessagesForInstanceId = (
  instanceId: string,
): void => {
  const instance = getRemoteChannelInstance(instanceId);
  if (!instance) return;
  dispatchQueuedMessagesForInstance(instance);
};

export interface SendRemoteMessageInput {
  source: RemoteSource;
  text: string;
  mode?: "new" | "continue";
  threadId?: string;
  cwd?: string | null;
  title?: string | null;
  sourceThreadId?: string | null;
  sourceUserId?: string | null;
  sourceChatId?: string | null;
  sourceMessageId?: string | null;
  raw?: unknown;
}

export const sendRemoteMessage = (
  input: SendRemoteMessageInput,
): { thread: RemoteThread; message: RemoteMessage; dispatched: boolean } => {
  const text = input.text.trim();
  if (!text) throw new Error("text is required");

  const mode = input.mode ?? (input.threadId ? "continue" : "new");
  if (input.sourceMessageId) {
    const existing = findRemoteMessageBySource({
      source: input.source,
      sourceMessageId: input.sourceMessageId,
      direction: "inbound",
    });
    if (existing) {
      const existingThread = getRemoteThread(existing.threadId);
      if (existingThread) {
        return { thread: existingThread, message: existing, dispatched: false };
      }
    }
  }
  let thread: RemoteThread | null = null;
  if (mode === "continue" && input.threadId) {
    thread = getRemoteThread(input.threadId);
    if (!thread) throw new Error(`remote thread not found: ${input.threadId}`);
    assertThreadVisibleToInput(thread, input);
  }
  if (!thread && mode === "continue") {
    thread = findLatestRemoteThreadForSource({
      source: input.source,
      sourceThreadId: input.sourceThreadId,
      sourceUserId: input.sourceUserId,
      sourceChatId: input.sourceChatId,
    });
  }

  if (!thread) {
    const cfg = readConfig().remoteBridge;
    const cwd = normalizeCwd(input.cwd ?? cfg?.defaultCwd ?? process.cwd());
    if (!cwd) throw new Error("cwd is required for a new remote thread");
    assertAllowedCwd(cwd);
    thread = createRemoteThread({
      source: input.source,
      sourceThreadId: input.sourceThreadId,
      sourceUserId: input.sourceUserId,
      sourceChatId: input.sourceChatId,
      cwd,
      title: input.title ?? text.slice(0, 80),
    });
    emitRemoteEvent("thread", thread);
  }

  let message = insertRemoteMessage({
    threadId: thread.id,
    direction: "inbound",
    source: input.source,
    sourceMessageId: input.sourceMessageId,
    sourceUserId: input.sourceUserId,
    text,
    raw: input.raw,
  });
  emitRemoteEvent("message", message);
  initProgressSnapshot(thread, message);

  const deliveryMode = readConfig().remoteBridge?.deliveryMode ?? "cli";
  const instance =
    deliveryMode === "cli" ? null : selectInstanceForThread(thread);
  let dispatched = false;
  if (deliveryMode === "cli") {
    dispatched = dispatchToCli(thread, message);
    if (dispatched) {
      const sent = updateRemoteMessageStatus(message.id, "sent");
      if (sent) {
        message = sent;
        emitRemoteEvent("message", sent);
      }
      const updated = updateRemoteThread(thread.id, { status: "running" });
      if (updated) {
        thread = updated;
        emitRemoteEvent("thread", updated);
      }
    }
  } else if (instance) {
    dispatched = dispatchToInstance(thread, message, instance);
  } else if (deliveryMode === "auto") {
    dispatched = dispatchToCli(thread, message);
    if (dispatched) {
      const sent = updateRemoteMessageStatus(message.id, "sent");
      if (sent) {
        message = sent;
        emitRemoteEvent("message", sent);
      }
      const updated = updateRemoteThread(thread.id, { status: "running" });
      if (updated) {
        thread = updated;
        emitRemoteEvent("thread", updated);
      }
    }
  }
  if (!dispatched) {
    const updated = updateRemoteThread(thread.id, { status: "queued" });
    if (updated) {
      thread = updated;
      emitRemoteEvent("thread", updated);
    }
    if ((mode === "new" || thread.cwd) && (deliveryMode !== "channel" || !instance)) {
      maybeLaunchForThread(thread);
    }
  }

  return { thread, message, dispatched };
};

export const registerRemoteChannelInstance = (input: {
  instanceId?: string;
  pid?: number | null;
  cwd?: string | null;
  claudeSessionId?: string | null;
  metadata?: unknown;
}): RemoteChannelInstance => {
  const instance = upsertRemoteChannelInstance({
    id: input.instanceId,
    pid: input.pid,
    cwd: normalizeCwd(input.cwd),
    claudeSessionId: input.claudeSessionId,
    metadata: input.metadata,
  });
  emitRemoteEvent("instance", instance);
  dispatchQueuedMessagesForInstance(instance);
  return instance;
};

export const heartbeatRemoteChannel = (
  instanceId: string,
  claudeSessionId?: string | null,
): RemoteChannelInstance | null => {
  const instance = heartbeatRemoteChannelInstance(instanceId, claudeSessionId);
  if (instance) emitRemoteEvent("instance", instance);
  return instance;
};

export const offlineRemoteChannel = (instanceId: string): void => {
  markRemoteChannelInstanceOffline(instanceId);
  emitRemoteEvent("instance", { id: instanceId, status: "offline" });
};

export const receiveRemoteReply = async (input: {
  remoteThreadId: string;
  text: string;
  final?: boolean;
  channelInstanceId?: string | null;
}): Promise<RemoteMessage> => {
  const thread = getRemoteThread(input.remoteThreadId);
  if (!thread) throw new Error(`remote thread not found: ${input.remoteThreadId}`);
  if (
    input.channelInstanceId &&
    thread.channelInstanceId &&
    thread.channelInstanceId !== input.channelInstanceId
  ) {
    throw new Error("remote reply instance does not own this thread");
  }
  const message = insertRemoteMessage({
    threadId: thread.id,
    direction: "outbound",
    source: thread.source,
    text: input.text,
    status: "delivered",
  });
  const final = input.final !== false;
  const updatedThread = updateRemoteThread(thread.id, {
    status: final ? "done" : "running",
    channelInstanceId: input.channelInstanceId ?? thread.channelInstanceId,
  });
  emitRemoteEvent("message", message);
  if (updatedThread) emitRemoteEvent("thread", updatedThread);

  await emitOutboundToSource(updatedThread ?? thread, message, final ? "final" : "partial");
  if (final && input.channelInstanceId) {
    dispatchQueuedMessagesForInstanceId(input.channelInstanceId);
  }
  return message;
};

export const recordRemoteChannelDelivery = (input: {
  messageId: string;
  status: "delivered" | "failed";
  error?: string | null;
  instanceId?: string | null;
}): RemoteMessage | null => {
  const existing = getRemoteMessage(input.messageId);
  if (!existing) return null;
  if (input.instanceId) {
    const thread = getRemoteThread(existing.threadId);
    if (
      thread?.channelInstanceId &&
      thread.channelInstanceId !== input.instanceId
    ) {
      throw new Error("delivery instance does not own this message");
    }
  }
  const message = updateRemoteMessageStatus(
    input.messageId,
    input.status,
    input.error,
  );
  if (!message) return null;
  emitRemoteEvent("message", message);
  if (input.status === "failed") {
    const updatedThread = updateRemoteThread(message.threadId, {
      status: "failed",
    });
    if (updatedThread) emitRemoteEvent("thread", updatedThread);
  }
  return message;
};

export const receivePermissionRequest = (input: {
  channelInstanceId: string;
  requestId: string;
  toolName: string;
  description?: string | null;
  inputPreview?: string | null;
  remoteThreadId?: string | null;
}): void => {
  if (input.remoteThreadId) {
    const thread = getRemoteThread(input.remoteThreadId);
    if (!thread) throw new Error(`remote thread not found: ${input.remoteThreadId}`);
    if (
      thread.channelInstanceId &&
      thread.channelInstanceId !== input.channelInstanceId
    ) {
      throw new Error("permission request instance does not own this thread");
    }
  }
  const permission = createRemotePermission({
    threadId: input.remoteThreadId ?? null,
    channelInstanceId: input.channelInstanceId,
    requestId: input.requestId,
    toolName: input.toolName,
    description: input.description,
    inputPreview: input.inputPreview,
  });
  emitRemoteEvent("permission", permission);
  if (permission.threadId) {
    const updatedThread = updateRemoteThread(permission.threadId, {
      status: "waiting_permission",
      channelInstanceId: input.channelInstanceId,
    });
    if (updatedThread) emitRemoteEvent("thread", updatedThread);
    const message = insertRemoteMessage({
      threadId: permission.threadId,
      direction: "permission",
      source: updatedThread?.source ?? "web",
      text:
        `Claude 请求执行 ${input.toolName}: ${input.description ?? ""}\n` +
        `回复 同意 ${input.requestId} 或 拒绝 ${input.requestId}`,
      status: "sent",
    });
    emitRemoteEvent("message", message);
  }
};

export const submitPermissionVerdict = (input: {
  requestId: string;
  behavior: RemotePermissionBehavior;
  source?: {
    source: RemoteSource;
    sourceUserId?: string | null;
    sourceChatId?: string | null;
  };
}): void => {
  const pending = queryRemotePermissions({
    requestId: input.requestId,
    status: "pending",
    limit: 20,
  });
  const candidate = pending.find((permission) => {
    if (!input.source) return true;
    if (!permission.threadId) return false;
    const thread = getRemoteThread(permission.threadId);
    return !!thread && isThreadVisibleToInput(thread, input.source);
  });
  if (!candidate) throw new Error(`permission request not found: ${input.requestId}`);
  if (candidate.channelInstanceId) {
    const delivered = pushRemoteChannelEvent(candidate.channelInstanceId, {
      type: "permission_verdict",
      requestId: input.requestId,
      behavior: input.behavior,
    });
    if (!delivered) {
      throw new Error("permission target channel is offline");
    }
  }
  const permission = resolveRemotePermissionById(candidate.id, input.behavior);
  if (!permission) throw new Error(`permission request not found: ${input.requestId}`);
  emitRemoteEvent("permission", permission);
  if (permission.threadId) {
    const updatedThread = updateRemoteThread(permission.threadId, {
      status: "running",
    });
    if (updatedThread) emitRemoteEvent("thread", updatedThread);
  }
};

export const listRemoteThreads = queryRemoteThreads;
export const listRemoteMessages = queryRemoteMessages;
export const listRemoteInstances = queryRemoteChannelInstances;
export const listRemotePermissions = queryRemotePermissions;
