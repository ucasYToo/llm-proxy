import path from "path";
import { readConfig, writeConfig } from "../../config/store";
import { getKnownProjects, type KnownProject } from "../../core/session";
import { broadcast } from "../../server/sse";
import type { FeishuRemoteConfig } from "../../interfaces";
import {
  parseFeishuRemoteCommand,
  parsePermissionReply,
  type PermissionReply,
} from "./parser";

type SidecarQueueItem =
  | {
      kind: "channel";
      content: string;
      meta: Record<string, string>;
    }
  | {
      kind: "permission";
      requestId: string;
      behavior: "allow" | "deny";
    };

export interface FeishuRemoteInboundMessage {
  messageId: string;
  chatId: string;
  userId: string;
  text: string;
  raw?: unknown;
}

export interface FeishuRemoteSidecar {
  id: string;
  cwd: string;
  pid: number | null;
  version: string | null;
  registeredAt: string;
  lastSeenAt: string;
  queue: SidecarQueueItem[];
}

export interface FeishuRemoteRecentMessage {
  id: string;
  direction: "in" | "out" | "system";
  chatId: string;
  userId?: string | null;
  cwd?: string | null;
  text: string;
  createdAt: string;
}

export interface FeishuRemoteRuntimeState {
  sdk: {
    started: boolean;
    connected: boolean;
    state: string;
    lastError: string | null;
    startedAt: string | null;
  };
  sidecars: Array<Omit<FeishuRemoteSidecar, "queue"> & { queueLength: number }>;
  recentMessages: FeishuRemoteRecentMessage[];
}

export interface FeishuRemoteStatus {
  config: Omit<FeishuRemoteConfig, "appSecret" | "sidecarSecret"> & {
    hasAppSecret: boolean;
    hasSidecarSecret: boolean;
  };
  runtime: FeishuRemoteRuntimeState;
  projects: KnownProject[];
}

const MAX_RECENT_MESSAGES = 80;
const MAX_DEDUP_IDS = 500;
const SIDECAR_STALE_MS = 90_000;

const sidecars = new Map<string, FeishuRemoteSidecar>();
const recentMessages: FeishuRemoteRecentMessage[] = [];
const seenMessageIds: string[] = [];
const seenMessageSet = new Set<string>();

let sender: ((chatId: string, text: string) => Promise<void>) | null = null;
let sdkState: FeishuRemoteRuntimeState["sdk"] = {
  started: false,
  connected: false,
  state: "idle",
  lastError: null,
  startedAt: null,
};

const nowIso = (): string => new Date().toISOString();

const redactConfig = (
  config: FeishuRemoteConfig | undefined,
): FeishuRemoteStatus["config"] => {
  const remote = config ?? {};
  return {
    enabled: remote.enabled,
    appId: remote.appId,
    encryptKey: remote.encryptKey ? "configured" : undefined,
    verificationToken: remote.verificationToken ? "configured" : undefined,
    domain: remote.domain,
    allowedUserIds: remote.allowedUserIds ?? [],
    allowedChatIds: remote.allowedChatIds ?? [],
    defaultCwd: remote.defaultCwd,
    chatBindings: remote.chatBindings ?? {},
    hasAppSecret: !!remote.appSecret,
    hasSidecarSecret: !!remote.sidecarSecret,
  };
};

const addRecent = (message: Omit<FeishuRemoteRecentMessage, "createdAt">): void => {
  recentMessages.unshift({ ...message, createdAt: nowIso() });
  if (recentMessages.length > MAX_RECENT_MESSAGES) {
    recentMessages.splice(MAX_RECENT_MESSAGES);
  }
  broadcast("feishu-remote", { kind: "message", message: recentMessages[0] });
};

const rememberMessageId = (messageId: string): boolean => {
  if (!messageId) return false;
  if (seenMessageSet.has(messageId)) return true;
  seenMessageSet.add(messageId);
  seenMessageIds.push(messageId);
  while (seenMessageIds.length > MAX_DEDUP_IDS) {
    const old = seenMessageIds.shift();
    if (old) seenMessageSet.delete(old);
  }
  return false;
};

const normalizeList = (items: string[] | undefined): Set<string> =>
  new Set((items ?? []).map((it) => it.trim()).filter(Boolean));

const isAllowed = (
  config: FeishuRemoteConfig | undefined,
  chatId: string,
  userId: string,
): boolean => {
  const users = normalizeList(config?.allowedUserIds);
  const chats = normalizeList(config?.allowedChatIds);
  if (users.size === 0 && chats.size === 0) return false;
  return users.has(userId) || chats.has(chatId);
};

const projectLabel = (project: KnownProject, index: number): string => {
  const name = project.remark?.trim() || path.basename(project.cwd) || project.cwd;
  return `${index + 1}. ${name}\n   ${project.cwd}`;
};

const findProject = (
  projects: KnownProject[],
  target: string,
): KnownProject | null => {
  const trimmed = target.trim();
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= projects.length) {
    return projects[index - 1];
  }
  const lower = trimmed.toLowerCase();
  return (
    projects.find((project) => project.cwd === trimmed) ??
    projects.find((project) => project.remark?.toLowerCase() === lower) ??
    projects.find((project) => path.basename(project.cwd).toLowerCase() === lower) ??
    null
  );
};

const activeSidecarForCwd = (cwd: string): FeishuRemoteSidecar | null => {
  const cutoff = Date.now() - SIDECAR_STALE_MS;
  const candidates = Array.from(sidecars.values()).filter(
    (sidecar) =>
      sidecar.cwd === cwd && Date.parse(sidecar.lastSeenAt) >= cutoff,
  );
  candidates.sort((a, b) =>
    a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0,
  );
  return candidates[0] ?? null;
};

const chatCwd = (
  config: FeishuRemoteConfig | undefined,
  chatId: string,
): string | null =>
  config?.chatBindings?.[chatId]?.cwd ?? config?.defaultCwd ?? null;

const reply = async (chatId: string, text: string): Promise<void> => {
  addRecent({
    id: `out-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    direction: "out",
    chatId,
    text,
  });
  if (!sender) {
    console.warn(`[feishu-remote] sender is not ready; dropping reply to ${chatId}`);
    return;
  }
  await sender(chatId, text);
};

const enqueueForChat = async (
  chatId: string,
  cwd: string,
  item: SidecarQueueItem,
): Promise<boolean> => {
  const sidecar = activeSidecarForCwd(cwd);
  if (!sidecar) {
    await reply(
      chatId,
      [
        "当前项目没有活跃的 Claude Code channel sidecar。",
        "",
        `项目: ${cwd}`,
        "请先在该目录运行：",
        `claude --dangerously-load-development-channels server:claude-proxy-feishu`,
      ].join("\n"),
    );
    return false;
  }
  sidecar.queue.push(item);
  sidecar.lastSeenAt = nowIso();
  broadcast("feishu-remote", { kind: "sidecar", sidecarId: sidecar.id });
  return true;
};

const handleCommand = async (
  message: FeishuRemoteInboundMessage,
  config: FeishuRemoteConfig | undefined,
): Promise<void> => {
  const command = parseFeishuRemoteCommand(message.text);
  if (!command) return;

  if (command.kind === "help") {
    await reply(
      message.chatId,
      [
        "Claude Code 远程控制命令：",
        "/cc projects - 列出已识别项目",
        "/cc use <序号|别名|路径> - 绑定当前飞书会话到项目",
        "/cc status - 查看当前绑定和 sidecar 状态",
        "普通文本会发送到已绑定项目的 Claude Code session。",
      ].join("\n"),
    );
    return;
  }

  const projects = getKnownProjects();

  if (command.kind === "projects") {
    if (projects.length === 0) {
      await reply(message.chatId, "暂无已识别项目。先在本机运行一次 Claude Code 并触发 hook。");
      return;
    }
    await reply(
      message.chatId,
      ["已识别项目：", ...projects.map(projectLabel)].join("\n"),
    );
    return;
  }

  if (command.kind === "use") {
    const project = findProject(projects, command.target);
    if (!project) {
      await reply(message.chatId, `未找到项目：${command.target}\n可用 /cc projects 查看列表。`);
      return;
    }
    const nextConfig = readConfig();
    nextConfig.feishuRemote = {
      ...(nextConfig.feishuRemote ?? {}),
      chatBindings: {
        ...(nextConfig.feishuRemote?.chatBindings ?? {}),
        [message.chatId]: { cwd: project.cwd, updatedAt: nowIso() },
      },
    };
    writeConfig(nextConfig);
    await reply(message.chatId, `已绑定到项目：${project.remark || path.basename(project.cwd)}\n${project.cwd}`);
    return;
  }

  const cwd = chatCwd(config, message.chatId);
  const sidecar = cwd ? activeSidecarForCwd(cwd) : null;
  await reply(
    message.chatId,
    [
      `远程控制：${config?.enabled ? "已启用" : "未启用"}`,
      `当前绑定：${cwd ?? "未绑定"}`,
      `sidecar：${sidecar ? `在线 (${sidecar.id})` : "未在线"}`,
      `允许用户数：${config?.allowedUserIds?.length ?? 0}`,
      `允许会话数：${config?.allowedChatIds?.length ?? 0}`,
    ].join("\n"),
  );
};

export const setFeishuRemoteSender = (
  fn: ((chatId: string, text: string) => Promise<void>) | null,
): void => {
  sender = fn;
};

export const setFeishuRemoteSdkState = (
  next: Partial<FeishuRemoteRuntimeState["sdk"]>,
): void => {
  sdkState = { ...sdkState, ...next };
  broadcast("feishu-remote", { kind: "sdk", sdk: sdkState });
};

export const handleFeishuRemoteInbound = async (
  message: FeishuRemoteInboundMessage,
): Promise<void> => {
  if (rememberMessageId(message.messageId)) return;

  const config = readConfig().feishuRemote;
  addRecent({
    id: message.messageId,
    direction: "in",
    chatId: message.chatId,
    userId: message.userId,
    cwd: chatCwd(config, message.chatId),
    text: message.text,
  });

  if (!config?.enabled) {
    await reply(message.chatId, "飞书远程控制未启用。");
    return;
  }
  if (!isAllowed(config, message.chatId, message.userId)) {
    await reply(message.chatId, "当前飞书用户或会话未加入远控 allowlist，已拒绝。");
    return;
  }

  const permission = parsePermissionReply(message.text);
  if (permission) {
    const cwd = chatCwd(config, message.chatId);
    if (!cwd) {
      await reply(message.chatId, "当前飞书会话尚未绑定项目，无法提交权限确认。");
      return;
    }
    await enqueuePermissionReply(message.chatId, cwd, permission);
    return;
  }

  if (parseFeishuRemoteCommand(message.text)) {
    await handleCommand(message, config);
    return;
  }

  const cwd = chatCwd(config, message.chatId);
  if (!cwd) {
    await reply(message.chatId, "当前飞书会话尚未绑定项目。使用 /cc projects 和 /cc use <序号> 先选择项目。");
    return;
  }
  await enqueueForChat(message.chatId, cwd, {
    kind: "channel",
    content: message.text,
    meta: {
      chat_id: message.chatId,
      user_id: message.userId,
      cwd,
      source: "feishu",
    },
  });
};

export const enqueuePermissionReply = async (
  chatId: string,
  cwd: string,
  permission: PermissionReply,
): Promise<void> => {
  const ok = await enqueueForChat(chatId, cwd, {
    kind: "permission",
    requestId: permission.requestId,
    behavior: permission.behavior,
  });
  if (ok) {
    await reply(
      chatId,
      `已提交权限确认：${permission.behavior === "allow" ? "允许" : "拒绝"} ${permission.requestId}`,
    );
  }
};

export const registerFeishuRemoteSidecar = (params: {
  id: string;
  cwd: string;
  pid?: number | null;
  version?: string | null;
  secret: string;
}): { ok: true; sidecar: FeishuRemoteSidecar } | { ok: false; error: string } => {
  const expected = readConfig().feishuRemote?.sidecarSecret;
  if (!expected || params.secret !== expected) {
    return { ok: false, error: "invalid sidecar secret" };
  }
  const existing = sidecars.get(params.id);
  const sidecar: FeishuRemoteSidecar = {
    id: params.id,
    cwd: params.cwd,
    pid: params.pid ?? null,
    version: params.version ?? null,
    registeredAt: existing?.registeredAt ?? nowIso(),
    lastSeenAt: nowIso(),
    queue: existing?.queue ?? [],
  };
  sidecars.set(params.id, sidecar);
  broadcast("feishu-remote", { kind: "sidecar", sidecarId: sidecar.id });
  return { ok: true, sidecar };
};

export const pollFeishuRemoteSidecar = (params: {
  id: string;
  secret: string;
}): { ok: true; messages: SidecarQueueItem[] } | { ok: false; error: string } => {
  const expected = readConfig().feishuRemote?.sidecarSecret;
  if (!expected || params.secret !== expected) {
    return { ok: false, error: "invalid sidecar secret" };
  }
  const sidecar = sidecars.get(params.id);
  if (!sidecar) return { ok: false, error: "sidecar not registered" };
  sidecar.lastSeenAt = nowIso();
  const messages = sidecar.queue.splice(0, sidecar.queue.length);
  return { ok: true, messages };
};

export const handleFeishuRemoteSidecarReply = async (params: {
  chatId: string;
  text: string;
  secret: string;
}): Promise<{ ok: true } | { ok: false; error: string }> => {
  const expected = readConfig().feishuRemote?.sidecarSecret;
  if (!expected || params.secret !== expected) {
    return { ok: false, error: "invalid sidecar secret" };
  }
  await reply(params.chatId, params.text);
  return { ok: true };
};

export const handleFeishuRemotePermissionRequest = async (params: {
  cwd: string;
  chatId: string;
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
  secret: string;
}): Promise<{ ok: true } | { ok: false; error: string }> => {
  const expected = readConfig().feishuRemote?.sidecarSecret;
  if (!expected || params.secret !== expected) {
    return { ok: false, error: "invalid sidecar secret" };
  }
  const config = readConfig().feishuRemote;
  const targetChatIds = params.chatId
    ? [params.chatId]
    : Object.entries(config?.chatBindings ?? {})
        .filter(([, binding]) => binding.cwd === params.cwd)
        .map(([chatId]) => chatId);
  if (targetChatIds.length === 0) {
    return { ok: false, error: "no chat binding for permission request" };
  }
  const text = [
      `Claude Code 请求权限：${params.toolName}`,
      params.description,
      params.inputPreview ? `\n${params.inputPreview}` : "",
      "",
      `回复 yes ${params.requestId} 或 no ${params.requestId}`,
    ].join("\n");
  for (const chatId of targetChatIds) {
    await reply(chatId, text);
  }
  return { ok: true };
};

export const getFeishuRemoteStatus = (): FeishuRemoteStatus => {
  const config = readConfig().feishuRemote;
  const sidecarList = Array.from(sidecars.values()).map((sidecar) => ({
    id: sidecar.id,
    cwd: sidecar.cwd,
    pid: sidecar.pid,
    version: sidecar.version,
    registeredAt: sidecar.registeredAt,
    lastSeenAt: sidecar.lastSeenAt,
    queueLength: sidecar.queue.length,
  }));
  return {
    config: redactConfig(config),
    runtime: {
      sdk: sdkState,
      sidecars: sidecarList,
      recentMessages,
    },
    projects: getKnownProjects(),
  };
};
