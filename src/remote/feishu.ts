import path from "path";
import * as lark from "@larksuiteoapi/node-sdk";
import { readConfig } from "../config/store";
import {
  getRemoteProgressSnapshot,
  onRemoteEvent,
  registerRemoteOutboundSender,
  sendRemoteMessage,
  submitPermissionVerdict,
  type RemoteOutboundKind,
} from "./service";
import type { RemoteThread, RemoteMessage } from "../storage/remote";
import {
  createRemoteMessageCard,
  findLatestRemoteThreadForSource,
  getRemoteThread,
  getLatestRemoteMessageCardForThread,
  getRemoteMessageCardByInbound,
  queryRemoteChannelInstances,
  queryRemoteThreads,
  updateRemoteThread,
  updateRemoteMessageCard,
  type RemoteMessageCard,
} from "../storage/remote";
import {
  buildFeishuProgressCard,
  splitFeishuText,
} from "./feishu-card";
import { markProgressDone, markProgressFailed, type RemoteProgressSnapshot } from "./progress";
import {
  parseFeishuRemoteCommand,
  parseFeishuTextContent,
  parsePermissionReply,
  type FeishuRemoteCommand,
} from "./feishu/parser";

let wsClient: any | null = null;
let client: lark.Client | null = null;
let unregisterSender: (() => void) | null = null;
let unregisterProgress: (() => void) | null = null;
const PATCH_MIN_INTERVAL_MS = 1000;
const cardPatchFailureNotified = new Set<string>();
const cardPatchQueues = new Map<string, Promise<RemoteMessageCard | null>>();
const cardPatchTimers = new Map<string, ReturnType<typeof setTimeout>>();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const textWithoutBotMention = (text: string): string =>
  text.replace(/@\S+\s*/g, "").trim();

const pickSenderId = (event: Record<string, any>): string | null => {
  const senderId = event.sender?.sender_id ?? {};
  return (
    senderId.open_id ??
    senderId.user_id ??
    senderId.union_id ??
    event.sender?.sender_type ??
    null
  );
};

const shouldHandleGroupMessage = (message: Record<string, any>): boolean => {
  const chatType = message.chat_type ?? message.chatType;
  if (chatType === "p2p") return true;
  if (Array.isArray(message.mentions) && message.mentions.length > 0) {
    return true;
  }
  return !!message.parent_id || !!message.root_id;
};

const resolveCwdFromAlias = (raw: string | undefined): string | null => {
  const cfg = readConfig().remoteBridge;
  if (!raw) return cfg?.defaultCwd ?? process.cwd();
  if (path.isAbsolute(raw)) return raw;
  const allowed = cfg?.allowedCwds ?? [];
  const found = allowed.find((cwd) => path.basename(cwd) === raw || cwd === raw);
  return found ?? cfg?.defaultCwd ?? null;
};

const resolveCwdFromAliasStrict = (raw: string | undefined): string | null => {
  const value = raw?.trim();
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  const cfg = readConfig().remoteBridge;
  const candidates = [
    ...(cfg?.allowedCwds ?? []),
    ...(cfg?.defaultCwd ? [cfg.defaultCwd] : []),
  ];
  return candidates.find((cwd) => path.basename(cwd) === value || cwd === value) ?? null;
};

const splitFirstToken = (
  input: string,
): { first: string; rest: string } | null => {
  const match = /^(\S+)(?:\s+([\s\S]+))?$/.exec(input.trim());
  if (!match) return null;
  return { first: match[1], rest: (match[2] ?? "").trim() };
};

const resolveNewCommandInput = (
  input: string,
): { cwd: string | null | undefined; text: string } => {
  const parts = splitFirstToken(input);
  if (parts?.rest) {
    const cwd = resolveCwdFromAliasStrict(parts.first);
    if (cwd) return { cwd, text: parts.rest };
  }
  return { cwd: resolveCwdFromAlias(undefined), text: input.trim() };
};

const formatThreadLine = (thread: RemoteThread): string => {
  const project = thread.cwd ? path.basename(thread.cwd) : "unknown";
  return `#${thread.shortId} · ${thread.status} · ${project}`;
};

const buildHelpText = (): string =>
  [
    "Claude Code 远程命令",
    "/help 查看帮助",
    "/new [项目别名或路径] <prompt> 新建远程对话",
    "/continue <threadId> <prompt> 继续指定对话",
    "/status 查看当前远程状态",
    "/projects 查看可用项目别名",
    "/use <threadId> 切换当前聊天默认继续的对话",
    "审批：同意 <id> / 拒绝 <id>",
    "兼容写法：以上命令也可以写成 /cc ...",
    "普通消息会继续当前聊天最近使用的远程对话。",
  ].join("\n");

const buildProjectsText = (): string => {
  const cfg = readConfig().remoteBridge;
  const allowed = cfg?.allowedCwds ?? [];
  const defaultCwd = cfg?.defaultCwd ?? process.cwd();
  const lines = ["可用项目"];
  lines.push(`默认：${path.basename(defaultCwd)} — ${defaultCwd}`);
  if (allowed.length > 0) {
    for (const cwd of allowed) {
      lines.push(`${path.basename(cwd)} — ${cwd}`);
    }
  } else {
    lines.push("allowedCwds 未配置；/new <prompt> 会使用默认项目。");
  }
  lines.push("用法：/new <项目别名> <prompt> 或 /new <prompt>");
  return lines.join("\n");
};

const isThreadVisibleToSource = (
  thread: RemoteThread,
  context: {
    chatId: string;
    senderId: string | null;
  },
): boolean => {
  if (thread.source !== "feishu") return false;
  if (thread.sourceChatId && thread.sourceChatId !== context.chatId) return false;
  if (thread.sourceUserId && thread.sourceUserId !== context.senderId) return false;
  return true;
};

const findActiveThreadForSource = (context: {
  chatId: string;
  senderId: string | null;
  sourceThreadId: string;
}): RemoteThread | null =>
  findLatestRemoteThreadForSource({
    source: "feishu",
    sourceThreadId: context.sourceThreadId,
    sourceChatId: context.chatId,
    sourceUserId: context.senderId,
  });

const buildStatusText = (context: {
  chatId: string;
  senderId: string | null;
  sourceThreadId: string;
}): string => {
  const cfg = readConfig().remoteBridge;
  const active = findActiveThreadForSource(context);
  const instances = queryRemoteChannelInstances({ limit: 5 });
  const recent = queryRemoteThreads({ source: "feishu", limit: 30 }).threads
    .filter((thread) => isThreadVisibleToSource(thread, context))
    .slice(0, 5);
  const lines = [
    "远程状态",
    `Bridge：${cfg?.enabled ? "已启用" : "未启用"} · ${cfg?.deliveryMode ?? "cli"}`,
    `在线 channel：${instances.length}`,
    active ? `当前默认：${formatThreadLine(active)}` : "当前默认：暂无",
  ];
  if (recent.length > 0) {
    lines.push("最近对话：");
    for (const thread of recent) lines.push(formatThreadLine(thread));
  }
  return lines.join("\n");
};

const buildUseThreadText = (
  target: string,
  context: {
    chatId: string;
    senderId: string | null;
  },
): string => {
  const thread = getRemoteThread(target);
  if (!thread || !isThreadVisibleToSource(thread, context)) {
    return `找不到可切换的远程对话：${target}`;
  }
  const updated = updateRemoteThread(thread.id, {});
  return `已切换当前聊天默认对话：${formatThreadLine(updated ?? thread)}`;
};

const commandToDirectReply = (
  command: FeishuRemoteCommand,
  context: {
    chatId: string;
    senderId: string | null;
    sourceThreadId: string;
  },
): string | null => {
  switch (command.kind) {
    case "help":
      return buildHelpText();
    case "projects":
      return buildProjectsText();
    case "status":
      return buildStatusText(context);
    case "use":
      return buildUseThreadText(command.target, context);
    case "new":
    case "continue":
      return null;
  }
};

const sendFeishuText = async (
  chatId: string,
  text: string,
): Promise<void> => {
  if (!client) return;
  const content = JSON.stringify({ text });
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content,
    },
  });
};

const progressCardConfig = () => {
  const cfg = readConfig().remoteBridge?.feishu?.progressCard;
  return {
    enabled: cfg?.enabled ?? true,
    showPartialAnswer: cfg?.showPartialAnswer ?? true,
    showToolEvents: cfg?.showToolEvents ?? true,
  };
};

const assertFeishuOk = (
  result: { code?: number; msg?: string },
  action: string,
): void => {
  if (typeof result.code === "number" && result.code !== 0) {
    throw new Error(`${action} failed: ${result.msg ?? result.code}`);
  }
};

const describeFeishuError = (err: unknown): string => {
  if (!err || typeof err !== "object") {
    return err instanceof Error ? err.message : String(err);
  }
  const record = err as {
    message?: unknown;
    response?: { status?: unknown; data?: unknown };
    code?: unknown;
  };
  const status =
    typeof record.response?.status === "number"
      ? `status ${record.response.status}`
      : null;
  const data = record.response?.data;
  const detail =
    typeof data === "string"
      ? data
      : data
        ? JSON.stringify(data)
        : typeof record.message === "string"
          ? record.message
          : String(err);
  return [status, detail].filter(Boolean).join(": ");
};

const sendFeishuCard = async (input: {
  chatId: string;
  card: Record<string, unknown>;
}): Promise<string | null> => {
  if (!client) return null;
  const content = JSON.stringify(input.card);
  const result = await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: input.chatId,
      msg_type: "interactive",
      content,
    },
  });
  assertFeishuOk(result, "send progress card");
  return result.data?.message_id ?? null;
};

const patchFeishuCard = async (
  providerMessageId: string,
  card: Record<string, unknown>,
): Promise<void> => {
  if (!client) return;
  const result = await client.im.v1.message.patch({
    path: { message_id: providerMessageId },
    data: { content: JSON.stringify(card) },
  });
  assertFeishuOk(result, "patch progress card");
};

const msUntilNextPatch = (
  card: RemoteMessageCard,
): number => {
  if (!card.lastPatchedAt) return 0;
  return Math.max(0, PATCH_MIN_INTERVAL_MS - (Date.now() - Date.parse(card.lastPatchedAt)));
};

const clearScheduledCardPatch = (cardId: string): void => {
  const timer = cardPatchTimers.get(cardId);
  if (!timer) return;
  clearTimeout(timer);
  cardPatchTimers.delete(cardId);
};

const scheduleTrailingCardPatch = (cardId: string, delayMs: number): void => {
  if (cardPatchTimers.has(cardId)) return;
  const timer = setTimeout(() => {
    cardPatchTimers.delete(cardId);
    const latest = updateRemoteMessageCard(cardId, {});
    const snapshot = latest?.lastSnapshot as RemoteProgressSnapshot | null | undefined;
    if (!latest || !snapshot) return;
    void patchStoredProgressCard(latest, snapshot, true);
  }, Math.max(0, delayMs));
  cardPatchTimers.set(cardId, timer);
};

const enqueueCardPatch = (
  cardId: string,
  task: () => Promise<RemoteMessageCard | null>,
): Promise<RemoteMessageCard | null> => {
  const previous = cardPatchQueues.get(cardId) ?? Promise.resolve(null);
  const next = previous
    .catch(() => null)
    .then(task)
    .finally(() => {
      if (cardPatchQueues.get(cardId) === next) {
        cardPatchQueues.delete(cardId);
      }
    });
  cardPatchQueues.set(cardId, next);
  return next;
};

const patchStoredProgressCard = async (
  card: RemoteMessageCard,
  snapshot: RemoteProgressSnapshot,
  force = false,
): Promise<RemoteMessageCard | null> => {
  const stored = updateRemoteMessageCard(card.id, {
    status: snapshot.status,
    lastSnapshot: snapshot,
  });
  const current = stored ?? card;
  if (current.error && !force) {
    return current;
  }
  if (!current.providerMessageId) {
    return current;
  }
  if (force) {
    clearScheduledCardPatch(current.id);
  }
  if (cardPatchQueues.has(current.id) && !force) {
    scheduleTrailingCardPatch(current.id, PATCH_MIN_INTERVAL_MS);
    return current;
  }
  const waitBeforePatch = msUntilNextPatch(current);
  if (!force && waitBeforePatch > 0) {
    scheduleTrailingCardPatch(current.id, waitBeforePatch);
    return current;
  }

  return enqueueCardPatch(current.id, async () => {
    let latest = updateRemoteMessageCard(current.id, {}) ?? current;
    if (latest.error && !force) {
      return latest;
    }
    if (!latest.providerMessageId) {
      return latest;
    }
    const waitMs = msUntilNextPatch(latest);
    if (waitMs > 0) {
      if (!force) {
        scheduleTrailingCardPatch(latest.id, waitMs);
        return latest;
      }
      await sleep(waitMs);
      latest = updateRemoteMessageCard(current.id, {}) ?? latest;
      if (!latest.providerMessageId) return latest;
    }

    try {
      await patchFeishuCard(
        latest.providerMessageId,
        buildFeishuProgressCard(snapshot, progressCardConfig()),
      );
      const updated = updateRemoteMessageCard(latest.id, {
        status: snapshot.status,
        lastSnapshot: snapshot,
        lastPatchedAt: new Date().toISOString(),
        error: null,
      });
      cardPatchFailureNotified.delete(latest.id);
      return updated;
    } catch (err) {
      const error = describeFeishuError(err);
      const failed = updateRemoteMessageCard(latest.id, { error });
      if (!cardPatchFailureNotified.has(latest.id) && !latest.error && latest.chatId) {
        cardPatchFailureNotified.add(latest.id);
        await sendFeishuText(
          latest.chatId,
          `进度卡片更新失败，后续将降级为文本：${error}`,
        );
      }
      return failed;
    }
  });
};

const sendFinalReplyText = async (
  chatId: string,
  thread: RemoteThread,
  text: string,
): Promise<void> => {
  const chunks = splitFeishuText(text);
  if (chunks.length === 0) return;
  for (let i = 0; i < chunks.length; i += 1) {
    const body =
      chunks.length > 1
        ? `#${thread.shortId} 回复 ${i + 1}/${chunks.length}\n${chunks[i]}`
        : chunks[i];
    await sendFeishuText(chatId, body);
  }
};

const createProgressCardForInbound = async (input: {
  thread: RemoteThread;
  message: RemoteMessage;
  chatId: string;
}): Promise<void> => {
  if (!progressCardConfig().enabled) return;
  if (getRemoteMessageCardByInbound(input.message.id)) return;
  const ts = new Date().toISOString();
  const snapshot =
    getRemoteProgressSnapshot(input.message.id) ??
    ({
      threadId: input.thread.id,
      shortId: input.thread.shortId,
      inboundMessageId: input.message.id,
      source: input.thread.source,
      cwd: input.thread.cwd,
      project: input.thread.cwd ? path.basename(input.thread.cwd) : "unknown",
      prompt: input.message.text,
      status: "queued",
      phase: "已接收，等待执行",
      events: ["已接收远程消息"],
      tools: [],
      answerPreview: "",
      finalText: "",
      error: null,
      startedAt: ts,
      updatedAt: ts,
      elapsedMs: 0,
    } satisfies RemoteProgressSnapshot);

  let card = createRemoteMessageCard({
    threadId: input.thread.id,
    inboundMessageId: input.message.id,
    provider: "feishu",
    chatId: input.chatId,
    status: snapshot.status,
    lastSnapshot: snapshot,
  });

  try {
    const providerMessageId = await sendFeishuCard({
      chatId: input.chatId,
      card: buildFeishuProgressCard(snapshot, progressCardConfig()),
    });
    card =
      updateRemoteMessageCard(card.id, {
        providerMessageId,
        status: snapshot.status,
        lastSnapshot: snapshot,
        lastPatchedAt: new Date().toISOString(),
        error: null,
      }) ?? card;
    const latest = getRemoteProgressSnapshot(input.message.id);
    if (latest) await patchStoredProgressCard(card, latest);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    updateRemoteMessageCard(card.id, { error, status: "failed" });
    await sendFeishuText(
      input.chatId,
      `已开始执行，但进度卡片发送失败 · #${input.thread.shortId}\n${error}`,
    );
  }
};

const handleRemoteProgress = async (
  snapshot: RemoteProgressSnapshot,
): Promise<void> => {
  if (snapshot.source !== "feishu" || !progressCardConfig().enabled) return;
  const card = getRemoteMessageCardByInbound(snapshot.inboundMessageId);
  if (!card) return;
  await patchStoredProgressCard(card, snapshot);
};

const handleFeishuText = async (
  event: Record<string, any>,
): Promise<void> => {
  const message = event.message ?? {};
  if (!shouldHandleGroupMessage(message)) return;

  const cfg = readConfig().remoteBridge;
  const feishuCfg = cfg?.feishu;
  const senderId = pickSenderId(event);
  const allowed = feishuCfg?.allowedUserIds ?? [];
  if (allowed.length > 0 && (!senderId || !allowed.includes(senderId))) {
    return;
  }

  const chatId = message.chat_id as string | undefined;
  if (!chatId) return;

  let text = textWithoutBotMention(parseFeishuTextContent(message.content));
  if (!text) return;

  const permission = parsePermissionReply(text);
  if (permission) {
    try {
      submitPermissionVerdict({
        requestId: permission.requestId,
        behavior: permission.behavior,
        source: {
          source: "feishu",
          sourceChatId: chatId,
          sourceUserId: senderId,
        },
      });
      await sendFeishuText(
        chatId,
        `已记录审批：${permission.behavior} ${permission.requestId}`,
      );
    } catch (err) {
      await sendFeishuText(
        chatId,
        `审批处理失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  let mode: "new" | "continue" = "continue";
  let threadId: string | undefined;
  let cwd: string | null | undefined;

  const sourceThreadId =
    (message.root_id as string | undefined) ??
    (message.parent_id as string | undefined) ??
    chatId;

  const command = parseFeishuRemoteCommand(text);
  if (command) {
    const reply = commandToDirectReply(command, {
      chatId,
      senderId,
      sourceThreadId,
    });
    if (reply) {
      await sendFeishuText(chatId, reply);
      return;
    }
    if (command.kind === "new") {
      const resolved = resolveNewCommandInput(command.input);
      mode = "new";
      cwd = resolved.cwd;
      text = resolved.text;
    } else if (command.kind === "continue") {
      mode = "continue";
      threadId = command.threadId;
      text = command.prompt;
    }
  }

  let result: ReturnType<typeof sendRemoteMessage>;
  try {
    result = sendRemoteMessage({
      source: "feishu",
      mode,
      threadId,
      cwd,
      text,
      sourceThreadId,
      sourceChatId: chatId,
      sourceUserId: senderId,
      sourceMessageId: message.message_id,
      raw: event,
    });
  } catch (err) {
    await sendFeishuText(
      chatId,
      `远程消息发送失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (progressCardConfig().enabled) {
    await createProgressCardForInbound({
      thread: result.thread,
      message: result.message,
      chatId,
    });
    return;
  }

  await sendFeishuText(
    chatId,
    result.dispatched
      ? `已开始执行，等待 Claude 回复 · #${result.thread.shortId}`
      : `已排队，等待 Claude Code 可用 · #${result.thread.shortId}`,
  );
};

const sendOutboundToFeishu = async (
  thread: RemoteThread,
  message: RemoteMessage,
  kind: RemoteOutboundKind,
): Promise<void> => {
  if (thread.source !== "feishu" || !thread.sourceChatId) return;
  if (kind === "partial") return;
  let finalTextSent = false;
  const sendFinalTextOnce = async (): Promise<void> => {
    if (finalTextSent) return;
    finalTextSent = true;
    await sendFinalReplyText(
      thread.sourceChatId ?? "",
      thread,
      message.text,
    );
  };

  if (progressCardConfig().enabled) {
    const card = getLatestRemoteMessageCardForThread(thread.id);
    if (card?.providerMessageId) {
      const baseSnapshot =
        (card.lastSnapshot as RemoteProgressSnapshot | null) ??
        getRemoteProgressSnapshot(card.inboundMessageId);
      if (baseSnapshot) {
        if (kind === "error") {
          await sendFinalTextOnce();
          await patchStoredProgressCard(
            card,
            markProgressFailed(baseSnapshot, message.text),
            true,
          );
          return;
        }
        await sendFinalTextOnce();
        await patchStoredProgressCard(
          card,
          markProgressDone(baseSnapshot, message.text),
          true,
        );
        return;
      }
    }
  }
  await sendFinalTextOnce();
};

export const startFeishuRemoteBridge = (): void => {
  const config = readConfig().remoteBridge;
  const feishu = config?.feishu;
  if (!config?.enabled || !feishu?.enabled || !feishu.appId || !feishu.appSecret) {
    return;
  }
  if (wsClient) return;

  client = new lark.Client({
    appId: feishu.appId,
    appSecret: feishu.appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });

  const eventDispatcher = new lark.EventDispatcher({
    encryptKey: feishu.encryptKey,
    verificationToken: feishu.verificationToken,
  }).register({
    "im.message.receive_v1": async (data: unknown) => {
      await handleFeishuText(data as Record<string, any>);
    },
  });

  wsClient = new lark.WSClient({
    appId: feishu.appId,
    appSecret: feishu.appSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.warn,
  });
  wsClient?.start({ eventDispatcher });

  unregisterSender = registerRemoteOutboundSender(sendOutboundToFeishu);
  unregisterProgress = onRemoteEvent((kind, data) => {
    if (kind !== "progress") return;
    void handleRemoteProgress(data as RemoteProgressSnapshot);
  });
  console.log("[remote:feishu] long connection started");
};

export const stopFeishuRemoteBridge = (): void => {
  try {
    wsClient?.stop?.();
  } catch {
    // ignore
  }
  wsClient = null;
  client = null;
  unregisterSender?.();
  unregisterSender = null;
  unregisterProgress?.();
  unregisterProgress = null;
};

export const restartFeishuRemoteBridge = (): void => {
  stopFeishuRemoteBridge();
  startFeishuRemoteBridge();
};

export const testFeishuApp = async (chatId?: string): Promise<void> => {
  if (!client) startFeishuRemoteBridge();
  if (!client) throw new Error("飞书自建应用未启用或缺少 appId/appSecret");
  if (chatId) {
    await sendFeishuText(chatId, `Claude Code 飞书远程桥测试\n${new Date().toLocaleString()}`);
  }
};
