import fs from "fs";
import path from "path";
import crypto from "crypto";
import type {
  Config,
  Target,
  Channel,
  NotificationSettings,
  ChannelEvents,
  RemoteBridgeConfig,
  RemoteBridgeFeishuBotConfig,
} from "../interfaces";

const CONFIG_DIR = path.join(process.env.HOME || "~", ".claude-proxy");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CHANNEL: Channel = {
  id: "default",
  name: "默认通道",
  activeTarget: "",
};

const createRemoteBridgeDefaults = (): RemoteBridgeConfig => ({
  enabled: false,
  authToken: crypto.randomBytes(24).toString("hex"),
  web: { enabled: true },
  allowedCwds: [],
  claudeCommand: "claude",
  permissionMode: "default",
  deliveryMode: "cli",
  feishu: {
    enabled: false,
    ingress: "longConnection",
    bots: [],
    progressCard: {
      enabled: true,
      showPartialAnswer: true,
      showToolEvents: true,
    },
  },
});

const createDefaultConfig = (): Config => ({
  activeTarget: "",
  targets: [],
  logCollection: {
    captureOriginalBody: false,
    captureRawStreamEvents: false,
  },
  channels: [DEFAULT_CHANNEL],
  remoteBridge: createRemoteBridgeDefaults(),
});

const DEFAULT_CONFIG: Config = createDefaultConfig();

export const ensureConfigDir = (): void => {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
};

/**
 * 把扁平的 notifications.{stop, subagentStop, notification} 迁移到新结构
 * notifications.macos.events.*。返回 { notifications, changed }；changed=true 表示
 * 调用方应当持久化新结构（写回去 + 删除扁平字段）。
 *
 * - macos.events 已存在 → no-op（已迁移过）
 * - 没有 notifications → no-op
 * - macos.enabled 默认值：只要有任一事件为 true 就视为启用，全 false 则关闭
 * - 旧逻辑里 dingtalk 跟着 macos 的事件走，所以迁移时把 events copy 给 dingtalk 一份
 */
const migrateNotifications = (
  n: NotificationSettings | undefined,
): { notifications: NotificationSettings | undefined; changed: boolean } => {
  if (!n) return { notifications: n, changed: false };
  if (n.macos?.events) return { notifications: n, changed: false };

  const hasFlat =
    typeof n.stop !== "undefined" ||
    typeof n.subagentStop !== "undefined" ||
    typeof n.notification !== "undefined";

  if (!hasFlat) {
    // 老配置完全没设过通知字段 → 不强行造结构
    return { notifications: n, changed: false };
  }

  const events: ChannelEvents = {
    stop: !!n.stop,
    subagentStop: !!n.subagentStop,
    notification: !!n.notification,
  };
  const anyOn = events.stop || events.subagentStop || events.notification;

  const migrated: NotificationSettings = {
    macos: { enabled: anyOn, events },
  };
  if (n.dingtalk) {
    migrated.dingtalk = {
      ...n.dingtalk,
      events: n.dingtalk.events ?? { ...events },
    };
  }

  return { notifications: migrated, changed: true };
};

let configCache: Config | null = null;
let configCacheMtimeMs = 0;

const normalizeFeishuBotId = (raw: string | undefined, index: number): string => {
  const value = raw?.trim();
  if (value && /^[a-zA-Z0-9_-]+$/.test(value)) return value;
  return index === 0 ? "default" : `bot-${index + 1}`;
};

const normalizeFeishuBots = (
  raw: RemoteBridgeConfig["feishu"] | undefined,
  fallbackDefaultCwd = "",
): RemoteBridgeFeishuBotConfig[] => {
  const configured = Array.isArray(raw?.bots) ? raw.bots : [];
  const source =
    configured.length > 0
      ? configured
      : raw?.appId || raw?.appSecret || raw?.encryptKey || raw?.verificationToken
        ? [
            {
              id: "default",
              name: "默认机器人",
              enabled: true,
              defaultCwd: fallbackDefaultCwd,
              appId: raw?.appId,
              appSecret: raw?.appSecret,
              encryptKey: raw?.encryptKey,
              verificationToken: raw?.verificationToken,
              allowedUserIds: raw?.allowedUserIds,
              progressCard: raw?.progressCard,
            },
          ]
        : [];

  const seen = new Set<string>();
  return source.map((bot, index) => {
    let id = normalizeFeishuBotId(bot.id, index);
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return {
      ...bot,
      id,
      name: bot.name?.trim() || (index === 0 ? "默认机器人" : `机器人 ${index + 1}`),
      enabled: bot.enabled ?? true,
      defaultCwd: bot.defaultCwd ?? fallbackDefaultCwd,
      appId: bot.appId ?? "",
      appSecret: bot.appSecret ?? "",
      encryptKey: bot.encryptKey ?? "",
      verificationToken: bot.verificationToken ?? "",
      allowedUserIds: Array.isArray(bot.allowedUserIds)
        ? bot.allowedUserIds
        : Array.isArray(raw?.allowedUserIds)
          ? raw.allowedUserIds
          : [],
      progressCard: {
        ...(raw?.progressCard ?? {}),
        ...(bot.progressCard ?? {}),
      },
    };
  });
};

const mergeRemoteBridge = (
  raw: RemoteBridgeConfig | undefined,
): RemoteBridgeConfig => {
  const defaults = createRemoteBridgeDefaults();
  return {
    ...defaults,
    ...(raw ?? {}),
    authToken: raw?.authToken || defaults.authToken,
    web: {
      ...(defaults.web ?? {}),
      ...(raw?.web ?? {}),
    },
    allowedCwds: Array.isArray(raw?.allowedCwds)
      ? raw.allowedCwds
      : defaults.allowedCwds,
    feishu: {
      ...(defaults.feishu ?? {}),
      ...(raw?.feishu ?? {}),
      ingress: raw?.feishu?.ingress ?? "longConnection",
      allowedUserIds: Array.isArray(raw?.feishu?.allowedUserIds)
        ? raw.feishu.allowedUserIds
        : [],
      progressCard: {
        ...(defaults.feishu?.progressCard ?? {}),
        ...(raw?.feishu?.progressCard ?? {}),
      },
      bots: normalizeFeishuBots(raw?.feishu, raw?.defaultCwd ?? ""),
    },
  };
};

export const readConfig = (): Config => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const fresh = createDefaultConfig();
      writeConfig(fresh);
      return fresh;
    }
    const stat = fs.statSync(CONFIG_PATH);
    if (configCache && stat.mtimeMs === configCacheMtimeMs) {
      return configCache;
    }
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Config;
    // 与默认值合并，处理旧配置文件中缺失的字段
    const channels = parsed.channels && parsed.channels.length > 0
      ? parsed.channels
      : DEFAULT_CONFIG.channels;

    const { notifications: migratedNotif, changed } = migrateNotifications(parsed.notifications);

    const merged: Config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      logCollection: {
        ...DEFAULT_CONFIG.logCollection,
        ...(parsed.logCollection ?? {}),
      },
      channels,
      notifications: migratedNotif,
      remoteBridge: mergeRemoteBridge(parsed.remoteBridge),
    };

    const remoteChanged =
      !parsed.remoteBridge ||
      !parsed.remoteBridge.authToken ||
      !parsed.remoteBridge.web ||
      !parsed.remoteBridge.feishu ||
      !Array.isArray(parsed.remoteBridge.feishu.bots);

    if (changed || remoteChanged) {
      writeConfig(merged);
    }

    configCache = merged;
    configCacheMtimeMs = stat.mtimeMs;
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
};

export const writeConfig = (config: Config): void => {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  configCache = null;
};

export const getActiveTarget = (): Target | null => {
  const config = readConfig();
  return config.targets.find((t) => t.id === config.activeTarget) ?? null;
};

/**
 * 获取指定通道的活动目标
 */
export const getChannelActiveTarget = (channelId: string): Target | null => {
  const config = readConfig();
  const channel = config.channels.find((c) => c.id === channelId);
  if (!channel || !channel.activeTarget) {
    return null;
  }
  return config.targets.find((t) => t.id === channel.activeTarget) ?? null;
};

/**
 * 设置通道的活动目标
 */
export const setChannelActiveTarget = (
  channelId: string,
  targetId: string,
): void => {
  const config = readConfig();
  const channel = config.channels.find((c) => c.id === channelId);
  if (channel) {
    channel.activeTarget = targetId;
    writeConfig(config);
  }
};

/**
 * 添加新通道
 */
export const addChannel = (channel: Channel): void => {
  const config = readConfig();
  config.channels.push(channel);
  writeConfig(config);
};

/**
 * 删除通道
 */
export const deleteChannel = (channelId: string): void => {
  const config = readConfig();
  config.channels = config.channels.filter((c) => c.id !== channelId);
  writeConfig(config);
};

/**
 * 获取所有通道
 */
export const getChannels = (): Channel[] => {
  const config = readConfig();
  return config.channels;
};

/**
 * 根据 cwd 查找通道的覆盖目标
 */
export const getChannelCwdTarget = (
  channelId: string,
  cwd: string,
): Target | null => {
  const config = readConfig();
  const channel = config.channels.find((c) => c.id === channelId);
  if (!channel?.cwdRoutes?.length) return null;
  const route = channel.cwdRoutes.find((r) => r.cwd === cwd);
  if (!route) return null;
  return config.targets.find((t) => t.id === route.targetId) ?? null;
};
