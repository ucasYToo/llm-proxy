import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Config, Target, Channel, NotificationSettings, ChannelEvents } from "../interfaces";

const CONFIG_DIR = path.join(process.env.HOME || "~", ".claude-proxy");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CHANNEL: Channel = {
  id: "default",
  name: "默认通道",
  activeTarget: "",
};

const DEFAULT_CONFIG: Config = {
  activeTarget: "",
  targets: [],
  logCollection: {
    captureOriginalBody: false,
    captureRawStreamEvents: false,
  },
  channels: [DEFAULT_CHANNEL],
};

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

const ensureFeishuRemoteSecret = (
  config: Config,
): { config: Config; changed: boolean } => {
  if (!config.feishuRemote) return { config, changed: false };
  if (config.feishuRemote.sidecarSecret) return { config, changed: false };
  return {
    config: {
      ...config,
      feishuRemote: {
        ...config.feishuRemote,
        sidecarSecret: crypto.randomBytes(24).toString("hex"),
      },
    },
    changed: true,
  };
};

let configCache: Config | null = null;
let configCacheMtimeMs = 0;

export const readConfig = (): Config => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG };
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

    let merged: Config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      logCollection: {
        ...DEFAULT_CONFIG.logCollection,
        ...(parsed.logCollection ?? {}),
      },
      channels,
      notifications: migratedNotif,
    };

    const secretResult = ensureFeishuRemoteSecret(merged);
    merged = secretResult.config;

    if (changed || secretResult.changed) {
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
