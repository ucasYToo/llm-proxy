import fs from "fs";
import path from "path";
import type { Config, Target, Channel } from "./types";

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

export const readConfig = (): Config => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Config;
    // 与默认值合并，处理旧配置文件中缺失的字段
    const channels = parsed.channels && parsed.channels.length > 0
      ? parsed.channels
      : DEFAULT_CONFIG.channels;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      logCollection: {
        ...DEFAULT_CONFIG.logCollection,
        ...(parsed.logCollection ?? {}),
      },
      channels,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
};

export const writeConfig = (config: Config): void => {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
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
