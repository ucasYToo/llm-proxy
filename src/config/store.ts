import fs from "fs";
import path from "path";
import crypto from "crypto";
import type {
  Config,
  Target,
  Channel,
  NotificationSettings,
  ChannelEvents,
  DingTalkConfig,
  FeishuConfig,
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

/* ── Config Export / Import ── */

type ImportableConfig = Pick<Config, "activeTarget" | "targets" | "logCollection" | "channels"> &
  Partial<Omit<Config, "activeTarget" | "targets" | "logCollection" | "channels">>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRedactedSecret = (value: unknown): boolean =>
  typeof value !== "string" || value.length === 0 || /^\*{4,}/.test(value);

const isSensitiveHeader = (name: string): boolean => {
  const normalized = name.toLowerCase().replace(/_/g, "-");
  return (
    normalized === "authorization" ||
    normalized === "proxy-authorization" ||
    normalized === "api-key" ||
    normalized === "x-api-key" ||
    normalized.endsWith("-api-key") ||
    /(^|-)(auth-token|access-token|secret|credential|cookie)($|-)/.test(normalized)
  );
};

const currentHeaderValue = (
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined => {
  const matched = Object.keys(headers ?? {}).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return matched ? headers?.[matched] : undefined;
};

const importedSecret = (
  imported: string | undefined,
  current: string | undefined,
): string | undefined => (isRedactedSecret(imported) ? current : imported);

const validateBooleanFields = (
  value: Record<string, unknown>,
  fields: readonly string[],
  pathPrefix: string,
): string | null => {
  for (const field of fields) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") {
      return `${pathPrefix}.${field} must be a boolean`;
    }
  }
  return null;
};

const validateStringFields = (
  value: Record<string, unknown>,
  fields: readonly string[],
  pathPrefix: string,
): string | null => {
  for (const field of fields) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      return `${pathPrefix}.${field} must be a string`;
    }
  }
  return null;
};

const validateEvents = (value: unknown, pathPrefix: string): string | null => {
  if (value === undefined) return null;
  if (!isRecord(value)) return `${pathPrefix} must be an object`;
  return validateBooleanFields(
    value,
    ["stop", "subagentStop", "notification"],
    pathPrefix,
  );
};

const validateNotifications = (value: unknown, pathPrefix: string): string | null => {
  if (value === undefined) return null;
  if (!isRecord(value)) return `${pathPrefix} must be an object`;
  const deprecatedError = validateBooleanFields(
    value,
    ["stop", "subagentStop", "notification"],
    pathPrefix,
  );
  if (deprecatedError) return deprecatedError;

  for (const channel of ["macos", "dingtalk", "feishu"] as const) {
    const rawChannel = value[channel];
    if (rawChannel === undefined) continue;
    if (!isRecord(rawChannel)) return `${pathPrefix}.${channel} must be an object`;
    const enabledError = validateBooleanFields(
      rawChannel,
      ["enabled"],
      `${pathPrefix}.${channel}`,
    );
    if (enabledError) return enabledError;
    const eventsError = validateEvents(
      rawChannel.events,
      `${pathPrefix}.${channel}.events`,
    );
    if (eventsError) return eventsError;
    const credentialFields = channel === "dingtalk"
      ? ["accessToken", "secret"]
      : channel === "feishu"
        ? ["webhookUrl", "secret"]
        : [];
    const credentialError = validateStringFields(
      rawChannel,
      credentialFields,
      `${pathPrefix}.${channel}`,
    );
    if (credentialError) return credentialError;
  }
  return null;
};

const validateProgressCard = (value: unknown, pathPrefix: string): string | null => {
  if (value === undefined) return null;
  if (!isRecord(value)) return `${pathPrefix} must be an object`;
  return validateBooleanFields(
    value,
    ["enabled", "showPartialAnswer", "showToolEvents"],
    pathPrefix,
  );
};

const validateRemoteBot = (value: unknown, pathPrefix: string): string | null => {
  if (!isRecord(value)) return `${pathPrefix} must be an object`;
  const stringError = validateStringFields(
    value,
    [
      "id",
      "name",
      "defaultCwd",
      "appId",
      "appSecret",
      "encryptKey",
      "verificationToken",
    ],
    pathPrefix,
  );
  if (stringError) return stringError;
  const booleanError = validateBooleanFields(value, ["enabled"], pathPrefix);
  if (booleanError) return booleanError;
  if (
    value.allowedUserIds !== undefined &&
    (!Array.isArray(value.allowedUserIds) ||
      value.allowedUserIds.some((item) => typeof item !== "string"))
  ) {
    return `${pathPrefix}.allowedUserIds must be an array of strings`;
  }
  return validateProgressCard(value.progressCard, `${pathPrefix}.progressCard`);
};

const validateRemoteBridge = (value: unknown): string | null => {
  if (value === undefined) return null;
  if (!isRecord(value)) return "config.remoteBridge must be an object";
  const stringError = validateStringFields(
    value,
    ["authToken", "defaultCwd", "claudeCommand"],
    "config.remoteBridge",
  );
  if (stringError) return stringError;
  const booleanError = validateBooleanFields(value, ["enabled"], "config.remoteBridge");
  if (booleanError) return booleanError;
  if (
    value.allowedCwds !== undefined &&
    (!Array.isArray(value.allowedCwds) ||
      value.allowedCwds.some((item) => typeof item !== "string"))
  ) {
    return "config.remoteBridge.allowedCwds must be an array of strings";
  }
  if (
    value.permissionMode !== undefined &&
    !["default", "acceptEdits", "bypassPermissions", "plan"].includes(
      value.permissionMode as string,
    )
  ) {
    return "config.remoteBridge.permissionMode is invalid";
  }
  if (
    value.deliveryMode !== undefined &&
    !["cli", "channel", "auto"].includes(value.deliveryMode as string)
  ) {
    return "config.remoteBridge.deliveryMode is invalid";
  }
  if (value.web !== undefined) {
    if (!isRecord(value.web)) return "config.remoteBridge.web must be an object";
    const webBooleanError = validateBooleanFields(
      value.web,
      ["enabled"],
      "config.remoteBridge.web",
    );
    if (webBooleanError) return webBooleanError;
    const webStringError = validateStringFields(
      value.web,
      ["publicBaseUrl"],
      "config.remoteBridge.web",
    );
    if (webStringError) return webStringError;
  }
  if (value.feishu !== undefined) {
    if (!isRecord(value.feishu)) return "config.remoteBridge.feishu must be an object";
    const feishuBooleanError = validateBooleanFields(
      value.feishu,
      ["enabled"],
      "config.remoteBridge.feishu",
    );
    if (feishuBooleanError) return feishuBooleanError;
    const feishuStringError = validateStringFields(
      value.feishu,
      ["appId", "appSecret", "encryptKey", "verificationToken"],
      "config.remoteBridge.feishu",
    );
    if (feishuStringError) return feishuStringError;
    if (
      value.feishu.ingress !== undefined &&
      !["longConnection", "callbackUrl"].includes(value.feishu.ingress as string)
    ) {
      return "config.remoteBridge.feishu.ingress is invalid";
    }
    if (
      value.feishu.allowedUserIds !== undefined &&
      (!Array.isArray(value.feishu.allowedUserIds) ||
        value.feishu.allowedUserIds.some((item) => typeof item !== "string"))
    ) {
      return "config.remoteBridge.feishu.allowedUserIds must be an array of strings";
    }
    const progressError = validateProgressCard(
      value.feishu.progressCard,
      "config.remoteBridge.feishu.progressCard",
    );
    if (progressError) return progressError;
    if (value.feishu.bots !== undefined) {
      if (!Array.isArray(value.feishu.bots)) {
        return "config.remoteBridge.feishu.bots must be an array";
      }
      for (const [index, bot] of value.feishu.bots.entries()) {
        const botError = validateRemoteBot(
          bot,
          `config.remoteBridge.feishu.bots[${index}]`,
        );
        if (botError) return botError;
      }
    }
  }
  return null;
};

/**
 * Strip known credentials while retaining enough structure for a safe round-trip import.
 */
export const sanitizeConfigForExport = (config: Config): Config => {
  const exported = JSON.parse(JSON.stringify(config)) as Config;

  // Strip remoteBridge authToken
  if (exported.remoteBridge) {
    delete exported.remoteBridge.authToken;
  }

  // Clear target auth and credential-like header values. Empty values are restored
  // from the current machine when the file is imported again.
  for (const target of exported.targets) {
    if (target.auth) {
      target.auth.value = "";
    }
    for (const name of Object.keys(target.headers)) {
      if (isSensitiveHeader(name)) target.headers[name] = "";
    }
  }

  // Strip notification credentials
  if (exported.notifications?.dingtalk) {
    delete exported.notifications.dingtalk.accessToken;
    delete exported.notifications.dingtalk.secret;
  }
  if (exported.notifications?.feishu) {
    delete exported.notifications.feishu.webhookUrl;
    delete exported.notifications.feishu.secret;
  }
  if (exported.codexNotifications?.dingtalk) {
    delete exported.codexNotifications.dingtalk.accessToken;
    delete exported.codexNotifications.dingtalk.secret;
  }
  if (exported.codexNotifications?.feishu) {
    delete exported.codexNotifications.feishu.webhookUrl;
    delete exported.codexNotifications.feishu.secret;
  }

  // Strip both legacy single-bot and current multi-bot Feishu credentials.
  const remoteFeishu = exported.remoteBridge?.feishu;
  if (remoteFeishu) {
    delete remoteFeishu.appSecret;
    delete remoteFeishu.encryptKey;
    delete remoteFeishu.verificationToken;
    for (const bot of remoteFeishu.bots ?? []) {
      delete bot.appSecret;
      delete bot.encryptKey;
      delete bot.verificationToken;
    }
  }

  // Older configs can contain dangling references after a target/channel was
  // deleted. Keep exports self-consistent so they always pass import validation.
  const targetIds = new Set(exported.targets.map((target) => target.id));
  if (exported.activeTarget && !targetIds.has(exported.activeTarget)) {
    exported.activeTarget = exported.targets[0]?.id ?? "";
  }
  for (const channel of exported.channels) {
    if (channel.activeTarget && !targetIds.has(channel.activeTarget)) {
      channel.activeTarget = "";
    }
    if (channel.cwdRoutes) {
      channel.cwdRoutes = channel.cwdRoutes.filter((route) => targetIds.has(route.targetId));
    }
  }
  const channelIds = new Set(exported.channels.map((channel) => channel.id));
  if (exported.claudeCodeChannelId && !channelIds.has(exported.claudeCodeChannelId)) {
    delete exported.claudeCodeChannelId;
  }

  // Add metadata
  (exported as unknown as Record<string, unknown>).__exportedAt = new Date().toISOString();

  return exported;
};

/** Validate the required shape and target references before persisting an import. */
export const validateConfigImport = (value: unknown): string | null => {
  if (!isRecord(value)) return "config must be an object";
  if (typeof value.activeTarget !== "string") return "config.activeTarget must be a string";
  if (!Array.isArray(value.targets)) return "config.targets must be an array";
  if (!Array.isArray(value.channels)) return "config.channels must be an array";
  if (!isRecord(value.logCollection)) return "config.logCollection must be an object";
  if (
    typeof value.logCollection.captureOriginalBody !== "boolean" ||
    typeof value.logCollection.captureRawStreamEvents !== "boolean"
  ) {
    return "config.logCollection capture flags must be booleans";
  }

  const targetIds = new Set<string>();
  for (const [index, rawTarget] of value.targets.entries()) {
    if (!isRecord(rawTarget)) return `config.targets[${index}] must be an object`;
    if (
      typeof rawTarget.id !== "string" ||
      !rawTarget.id ||
      typeof rawTarget.name !== "string" ||
      typeof rawTarget.url !== "string" ||
      !isRecord(rawTarget.headers) ||
      !isRecord(rawTarget.bodyParams)
    ) {
      return `config.targets[${index}] is missing required fields`;
    }
    if (Object.values(rawTarget.headers).some((header) => typeof header !== "string")) {
      return `config.targets[${index}].headers values must be strings`;
    }
    if (rawTarget.auth !== undefined) {
      if (
        !isRecord(rawTarget.auth) ||
        !["bearer", "x-api-key", "custom"].includes(rawTarget.auth.type as string) ||
        typeof rawTarget.auth.value !== "string" ||
        (rawTarget.auth.headerName !== undefined &&
          typeof rawTarget.auth.headerName !== "string")
      ) {
        return `config.targets[${index}].auth is invalid`;
      }
    }
    if (rawTarget.anthropicModel !== undefined && typeof rawTarget.anthropicModel !== "string") {
      return `config.targets[${index}].anthropicModel must be a string`;
    }
    if (rawTarget.pricing !== undefined) {
      if (
        !isRecord(rawTarget.pricing) ||
        Object.values(rawTarget.pricing).some(
          (price) => typeof price !== "number" || !Number.isFinite(price) || price < 0,
        )
      ) {
        return `config.targets[${index}].pricing is invalid`;
      }
    }
    if (targetIds.has(rawTarget.id)) return `duplicate target id: ${rawTarget.id}`;
    targetIds.add(rawTarget.id);
  }

  if (value.activeTarget && !targetIds.has(value.activeTarget)) {
    return `config.activeTarget references missing target: ${value.activeTarget}`;
  }

  const channelIds = new Set<string>();
  for (const [index, rawChannel] of value.channels.entries()) {
    if (!isRecord(rawChannel)) return `config.channels[${index}] must be an object`;
    if (
      typeof rawChannel.id !== "string" ||
      !rawChannel.id ||
      typeof rawChannel.name !== "string" ||
      typeof rawChannel.activeTarget !== "string"
    ) {
      return `config.channels[${index}] is missing required fields`;
    }
    if (channelIds.has(rawChannel.id)) return `duplicate channel id: ${rawChannel.id}`;
    channelIds.add(rawChannel.id);
    if (rawChannel.activeTarget && !targetIds.has(rawChannel.activeTarget)) {
      return `config.channels[${index}].activeTarget references a missing target`;
    }
    if (rawChannel.cwdRoutes !== undefined) {
      if (!Array.isArray(rawChannel.cwdRoutes)) {
        return `config.channels[${index}].cwdRoutes must be an array`;
      }
      for (const [routeIndex, rawRoute] of rawChannel.cwdRoutes.entries()) {
        if (
          !isRecord(rawRoute) ||
          typeof rawRoute.cwd !== "string" ||
          typeof rawRoute.targetId !== "string" ||
          !targetIds.has(rawRoute.targetId)
        ) {
          return `config.channels[${index}].cwdRoutes[${routeIndex}] is invalid`;
        }
      }
    }
  }

  if (
    value.claudeCodeChannelId !== undefined &&
    (typeof value.claudeCodeChannelId !== "string" ||
      (value.claudeCodeChannelId.length > 0 && !channelIds.has(value.claudeCodeChannelId)))
  ) {
    return "config.claudeCodeChannelId references a missing channel";
  }

  const maxEntries = value.logCollection.maxEntries;
  if (
    maxEntries !== undefined &&
    (typeof maxEntries !== "number" || !Number.isInteger(maxEntries) || maxEntries <= 0)
  ) {
    return "config.logCollection.maxEntries must be a positive integer";
  }

  const notificationsError = validateNotifications(value.notifications, "config.notifications");
  if (notificationsError) return notificationsError;
  const codexNotificationsError = validateNotifications(
    value.codexNotifications,
    "config.codexNotifications",
  );
  if (codexNotificationsError) return codexNotificationsError;
  const remoteBridgeError = validateRemoteBridge(value.remoteBridge);
  if (remoteBridgeError) return remoteBridgeError;
  if (value.budget !== undefined) {
    if (!isRecord(value.budget)) return "config.budget must be an object";
    for (const field of ["dailyLimitUsd", "monthlyLimitUsd", "alertThresholdPct"] as const) {
      const amount = value.budget[field];
      if (amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount))) {
        return `config.budget.${field} must be a finite number`;
      }
    }
  }
  const serverPort = value.serverPort;
  if (
    serverPort !== undefined &&
    (typeof serverPort !== "number" ||
      !Number.isInteger(serverPort) ||
      serverPort <= 0 ||
      serverPort > 65535)
  ) {
    return "config.serverPort must be an integer between 1 and 65535";
  }

  return null;
};

/**
 * Merge an imported config with the current config.
 * Preserves current sensitive values when the import provides empty or masked values.
 */
export const mergeConfig = (imported: ImportableConfig, current: Config): Config => {
  const merged = JSON.parse(JSON.stringify(current)) as Config;

  // Replace targets, restoring credentials redacted by export for matching IDs.
  const currentTargets = new Map(current.targets.map((target) => [target.id, target]));
  merged.targets = imported.targets.map((target) => {
    const candidate = currentTargets.get(target.id);
    const previous = candidate?.url === target.url ? candidate : undefined;
    const previousAuth =
      target.auth &&
      previous?.auth?.type === target.auth.type &&
      previous.auth.headerName === target.auth.headerName
        ? previous.auth
        : undefined;
    const headers = Object.fromEntries(
      Object.entries(target.headers).map(([name, value]) => [
        name,
        isSensitiveHeader(name) && isRedactedSecret(value)
          ? (currentHeaderValue(previous?.headers, name) ?? "")
          : value,
      ]),
    );
    return {
      ...target,
      headers,
      auth: target.auth
        ? {
            ...target.auth,
            value: importedSecret(target.auth.value, previousAuth?.value) ?? "",
          }
        : undefined,
    };
  });

  merged.channels = imported.channels;

  // Replace logCollection
  if (imported.logCollection) {
    merged.logCollection = {
      ...merged.logCollection,
      ...imported.logCollection,
    };
  }

  // Merge notifications — preserve credentials if imported values are empty
  if (imported.notifications) {
    merged.notifications = deepMergeNotifications(
      current.notifications,
      imported.notifications,
    );
  }
  if (imported.codexNotifications) {
    merged.codexNotifications = deepMergeNotifications(
      current.codexNotifications,
      imported.codexNotifications,
    );
  }

  // Merge remoteBridge and restore all credentials removed by export.
  if (imported.remoteBridge) {
    merged.remoteBridge = mergeImportedRemoteBridge(
      imported.remoteBridge,
      current.remoteBridge,
    );
  }

  // Replace budget if provided
  if (imported.budget) {
    merged.budget = { ...merged.budget, ...imported.budget };
  }

  merged.activeTarget = imported.activeTarget;
  merged.claudeCodeChannelId = imported.claudeCodeChannelId;

  return merged;
};

function mergeImportedRemoteBridge(
  imported: RemoteBridgeConfig,
  current: RemoteBridgeConfig | undefined,
): RemoteBridgeConfig {
  const importedFeishu = imported.feishu;
  const currentFeishu = current?.feishu;
  const currentBots = currentFeishu?.bots ?? [];
  const bots = importedFeishu?.bots?.map((bot, index) => {
    const candidate = bot.id
      ? currentBots.find((candidate) => candidate.id === bot.id)
      : currentBots[index];
    const previous = candidate?.appId === bot.appId ? candidate : undefined;
    return {
      ...previous,
      ...bot,
      appSecret: importedSecret(bot.appSecret, previous?.appSecret),
      encryptKey: importedSecret(bot.encryptKey, previous?.encryptKey),
      verificationToken: importedSecret(bot.verificationToken, previous?.verificationToken),
      progressCard: {
        ...(previous?.progressCard ?? {}),
        ...(bot.progressCard ?? {}),
      },
    };
  });

  return {
    ...(current ?? {}),
    ...imported,
    authToken: current?.authToken,
    web: {
      ...(current?.web ?? {}),
      ...(imported.web ?? {}),
    },
    feishu: importedFeishu
      ? {
          ...(currentFeishu ?? {}),
          ...importedFeishu,
          appSecret: importedSecret(
            importedFeishu.appSecret,
            importedFeishu.appId === currentFeishu?.appId
              ? currentFeishu?.appSecret
              : undefined,
          ),
          encryptKey: importedSecret(
            importedFeishu.encryptKey,
            importedFeishu.appId === currentFeishu?.appId
              ? currentFeishu?.encryptKey
              : undefined,
          ),
          verificationToken: importedSecret(
            importedFeishu.verificationToken,
            importedFeishu.appId === currentFeishu?.appId
              ? currentFeishu?.verificationToken
              : undefined,
          ),
          progressCard: {
            ...(currentFeishu?.progressCard ?? {}),
            ...(importedFeishu.progressCard ?? {}),
          },
          bots: bots ?? currentBots,
        }
      : currentFeishu,
  };
}

function deepMergeNotifications(
  current: NotificationSettings | undefined,
  imported: NotificationSettings,
): NotificationSettings {
  const result = { ...(current ?? {}), ...imported };

  // For each credential channel, merge but don't clear credentials
  const channels = ["dingtalk", "feishu"] as const;
  for (const channel of channels) {
    const imp = imported[channel] as DingTalkConfig | FeishuConfig | undefined;
    if (!imp) continue;

    const curr = (current?.[channel] ?? {}) as DingTalkConfig & FeishuConfig;
    const merged_channel: Record<string, unknown> = { ...curr, ...imp };

    // Only overwrite credentials if the imported value is not empty or masked.
    if ("accessToken" in imp) {
      merged_channel.accessToken = importedSecret(imp.accessToken, curr.accessToken);
    }
    if ("secret" in imp) {
      merged_channel.secret = importedSecret(imp.secret, curr.secret);
    }
    if ("webhookUrl" in imp) {
      merged_channel.webhookUrl = importedSecret(
        (imp as FeishuConfig).webhookUrl,
        curr.webhookUrl,
      );
    }

    result[channel] = merged_channel as unknown as DingTalkConfig & FeishuConfig;
  }

  return result;
}
