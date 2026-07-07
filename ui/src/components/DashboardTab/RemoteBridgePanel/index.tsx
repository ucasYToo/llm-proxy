import { useEffect, useMemo, useState } from "react";
import type {
  RemoteBridgeConfig,
  RemoteBridgeDeliveryMode,
  RemoteBridgeFeishuBotConfig,
  RemoteBridgePermissionMode,
} from "../../../lib/api";
import styles from "../index.module.css";

interface Props {
  config: RemoteBridgeConfig | undefined;
  saving: boolean;
  testing: boolean;
  onSave: (next: RemoteBridgeConfig) => void;
  onTest: (botId?: string, chatId?: string) => void;
}

interface FeishuBotDraft {
  id: string;
  name: string;
  enabled: boolean;
  defaultCwd: string;
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
  allowedUserIds: string;
  progressCardEnabled: boolean;
  showPartialAnswer: boolean;
  showToolEvents: boolean;
  testChatId: string;
}

type FeishuProgressCardDraft = NonNullable<RemoteBridgeConfig["feishu"]>["progressCard"];

const permissionModes: Array<{ value: RemoteBridgePermissionMode; label: string }> = [
  { value: "default", label: "default" },
  { value: "acceptEdits", label: "acceptEdits" },
  { value: "bypassPermissions", label: "bypassPermissions" },
  { value: "plan", label: "plan" },
];

const deliveryModes: Array<{ value: RemoteBridgeDeliveryMode; label: string }> = [
  { value: "cli", label: "CLI fallback" },
  { value: "channel", label: "MCP channel" },
  { value: "auto", label: "auto" },
];

const linesToList = (raw: string): string[] =>
  raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

const createBotId = (): string =>
  `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const normalizeBotId = (id: string | undefined, index: number): string => {
  const value = id?.trim();
  if (value && /^[a-zA-Z0-9_-]+$/.test(value)) return value;
  return index === 0 ? "default" : `bot-${index + 1}`;
};

const emptyBot = (index: number): FeishuBotDraft => ({
  id: createBotId(),
  name: index === 0 ? "默认机器人" : `机器人 ${index + 1}`,
  enabled: true,
  defaultCwd: "",
  appId: "",
  appSecret: "",
  encryptKey: "",
  verificationToken: "",
  allowedUserIds: "",
  progressCardEnabled: true,
  showPartialAnswer: true,
  showToolEvents: true,
  testChatId: "",
});

const botFromConfig = (
  bot: RemoteBridgeFeishuBotConfig,
  index: number,
  fallbackAllowedUserIds: string[] = [],
  fallbackDefaultCwd = "",
  fallbackProgressCard: FeishuProgressCardDraft = {},
): FeishuBotDraft => ({
  id: normalizeBotId(bot.id, index),
  name: bot.name?.trim() || (index === 0 ? "默认机器人" : `机器人 ${index + 1}`),
  enabled: bot.enabled ?? true,
  defaultCwd: bot.defaultCwd ?? fallbackDefaultCwd,
  appId: bot.appId ?? "",
  appSecret: bot.appSecret ?? "",
  encryptKey: bot.encryptKey ?? "",
  verificationToken: bot.verificationToken ?? "",
  allowedUserIds: (bot.allowedUserIds ?? fallbackAllowedUserIds).join("\n"),
  progressCardEnabled: bot.progressCard?.enabled ?? fallbackProgressCard?.enabled ?? true,
  showPartialAnswer:
    bot.progressCard?.showPartialAnswer ?? fallbackProgressCard?.showPartialAnswer ?? true,
  showToolEvents: bot.progressCard?.showToolEvents ?? fallbackProgressCard?.showToolEvents ?? true,
  testChatId: "",
});

const botsFromConfig = (config: RemoteBridgeConfig | undefined): FeishuBotDraft[] => {
  const feishu = config?.feishu ?? {};
  const bots = feishu.bots ?? [];
  if (bots.length > 0) {
    return bots.map((bot, index) =>
      botFromConfig(
        bot,
        index,
        feishu.allowedUserIds ?? [],
        config?.defaultCwd ?? "",
        feishu.progressCard ?? {},
      ),
    );
  }
  if (feishu.appId || feishu.appSecret || feishu.encryptKey || feishu.verificationToken) {
    return [
      botFromConfig(
        {
          id: "default",
          name: "默认机器人",
          enabled: true,
          defaultCwd: config?.defaultCwd,
          appId: feishu.appId,
          appSecret: feishu.appSecret,
          encryptKey: feishu.encryptKey,
          verificationToken: feishu.verificationToken,
          allowedUserIds: feishu.allowedUserIds,
          progressCard: feishu.progressCard,
        },
        0,
        [],
        config?.defaultCwd ?? "",
        feishu.progressCard ?? {},
      ),
    ];
  }
  return [emptyBot(0)];
};

const RemoteBridgePanel = ({ config, saving, testing, onSave, onTest }: Props) => {
  const [enabled, setEnabled] = useState(!!config?.enabled);
  const [webEnabled, setWebEnabled] = useState(config?.web?.enabled ?? true);
  const [publicBaseUrl, setPublicBaseUrl] = useState(config?.web?.publicBaseUrl ?? "");
  const [allowedCwds, setAllowedCwds] = useState((config?.allowedCwds ?? []).join("\n"));
  const [claudeCommand, setClaudeCommand] = useState(config?.claudeCommand ?? "claude");
  const [permissionMode, setPermissionMode] = useState<RemoteBridgePermissionMode>(
    config?.permissionMode ?? "default",
  );
  const [deliveryMode, setDeliveryMode] = useState<RemoteBridgeDeliveryMode>(
    config?.deliveryMode ?? "cli",
  );
  const [feishuEnabled, setFeishuEnabled] = useState(!!config?.feishu?.enabled);
  const [bots, setBots] = useState<FeishuBotDraft[]>(() => botsFromConfig(config));

  useEffect(() => {
    setEnabled(!!config?.enabled);
    setWebEnabled(config?.web?.enabled ?? true);
    setPublicBaseUrl(config?.web?.publicBaseUrl ?? "");
    setAllowedCwds((config?.allowedCwds ?? []).join("\n"));
    setClaudeCommand(config?.claudeCommand ?? "claude");
    setPermissionMode(config?.permissionMode ?? "default");
    setDeliveryMode(config?.deliveryMode ?? "cli");
    setFeishuEnabled(!!config?.feishu?.enabled);
    setBots(botsFromConfig(config));
  }, [config]);

  const enabledBots = useMemo(
    () => bots.filter((bot) => bot.enabled),
    [bots],
  );
  const ready = useMemo(
    () =>
      !feishuEnabled ||
      (enabledBots.length > 0 &&
        enabledBots.every((bot) => bot.appId.trim() && bot.appSecret.trim() && bot.defaultCwd.trim())),
    [enabledBots, feishuEnabled],
  );

  const updateBot = (id: string, patch: Partial<FeishuBotDraft>) => {
    setBots((current) =>
      current.map((bot) => (bot.id === id ? { ...bot, ...patch } : bot)),
    );
  };

  const addBot = () => {
    setBots((current) => [...current, emptyBot(current.length)]);
  };

  const removeBot = (id: string) => {
    setBots((current) => {
      const next = current.filter((bot) => bot.id !== id);
      return next.length > 0 ? next : [emptyBot(0)];
    });
  };

  const buildConfig = (): RemoteBridgeConfig => ({
    ...config,
    enabled,
    web: {
      ...(config?.web ?? {}),
      enabled: webEnabled,
      publicBaseUrl: publicBaseUrl.trim(),
    },
    allowedCwds: linesToList(allowedCwds),
    claudeCommand: claudeCommand.trim() || "claude",
    permissionMode,
    deliveryMode,
    feishu: {
      ...(config?.feishu ?? {}),
      enabled: feishuEnabled,
      ingress: config?.feishu?.ingress ?? "longConnection",
      bots: bots.map((bot, index) => ({
        id: normalizeBotId(bot.id, index),
        name: bot.name.trim() || (index === 0 ? "默认机器人" : `机器人 ${index + 1}`),
        enabled: bot.enabled,
        defaultCwd: bot.defaultCwd.trim(),
        appId: bot.appId.trim(),
        appSecret: bot.appSecret.trim(),
        encryptKey: bot.encryptKey.trim(),
        verificationToken: bot.verificationToken.trim(),
        allowedUserIds: linesToList(bot.allowedUserIds),
        progressCard: {
          enabled: bot.progressCardEnabled,
          showPartialAnswer: bot.showPartialAnswer,
          showToolEvents: bot.showToolEvents,
        },
      })),
      progressCard: config?.feishu?.progressCard,
    },
  });

  return (
    <div className={styles.dingPanel}>
      <div className={styles.remotePanelSwitches}>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          启用远程对话
        </label>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={webEnabled}
            onChange={(e) => setWebEnabled(e.target.checked)}
          />
          Web 入口
        </label>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={feishuEnabled}
            onChange={(e) => setFeishuEnabled(e.target.checked)}
          />
          飞书入口
        </label>
      </div>

      <div className={styles.remotePanelGrid}>
        <div className={styles.remotePanelField}>
          <label className={styles.dingPanelLabel}>Claude 命令</label>
          <input
            type="text"
            className={styles.dingPanelInput}
            value={claudeCommand}
            onChange={(e) => setClaudeCommand(e.target.value)}
            placeholder="claude"
            spellCheck={false}
          />
        </div>
        <div className={styles.remotePanelField}>
          <label className={styles.dingPanelLabel}>Dashboard URL</label>
          <input
            type="text"
            className={styles.dingPanelInput}
            value={publicBaseUrl}
            onChange={(e) => setPublicBaseUrl(e.target.value)}
            placeholder="https://your-tunnel.example.com"
            spellCheck={false}
          />
        </div>
      </div>

      {feishuEnabled && (
        <div className={styles.feishuBotList}>
          <div className={styles.feishuBotListHeader}>
            <span>飞书机器人</span>
            <button type="button" className="btnGhost btnSm" onClick={addBot}>
              添加机器人
            </button>
          </div>

          {bots.map((bot, index) => (
            <div key={bot.id} className={styles.feishuBotCard}>
              <div className={styles.feishuBotHeader}>
                <label className={styles.toggleChip}>
                  <input
                    type="checkbox"
                    checked={bot.enabled}
                    onChange={(e) => updateBot(bot.id, { enabled: e.target.checked })}
                  />
                  启用
                </label>
                <input
                  type="text"
                  className={`${styles.dingPanelInput} ${styles.feishuBotNameInput}`}
                  value={bot.name}
                  onChange={(e) => updateBot(bot.id, { name: e.target.value })}
                  placeholder={`机器人 ${index + 1}`}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btnGhost btnSm"
                  disabled={testing || !bot.appId.trim() || !bot.appSecret.trim()}
                  onClick={() => onTest(bot.id, bot.testChatId.trim() || undefined)}
                >
                  {testing ? "测试中…" : "测试"}
                </button>
                <button
                  type="button"
                  className="btnGhost btnSm"
                  disabled={bots.length <= 1}
                  onClick={() => removeBot(bot.id)}
                >
                  删除
                </button>
              </div>

              <div className={styles.feishuBotMainGrid}>
                <div className={styles.remotePanelField}>
                  <label className={styles.dingPanelLabel}>默认路径</label>
                  <input
                    type="text"
                    className={styles.dingPanelInput}
                    value={bot.defaultCwd}
                    onChange={(e) => updateBot(bot.id, { defaultCwd: e.target.value })}
                    placeholder="/Users/you/project"
                    spellCheck={false}
                  />
                </div>
                <div className={styles.remotePanelField}>
                  <label className={styles.dingPanelLabel}>App ID</label>
                  <input
                    type="text"
                    className={styles.dingPanelInput}
                    value={bot.appId}
                    onChange={(e) => updateBot(bot.id, { appId: e.target.value })}
                    placeholder="cli_xxx"
                    spellCheck={false}
                  />
                </div>
                <div className={styles.remotePanelField}>
                  <label className={styles.dingPanelLabel}>App Secret</label>
                  <input
                    type="password"
                    className={styles.dingPanelInput}
                    value={bot.appSecret}
                    onChange={(e) => updateBot(bot.id, { appSecret: e.target.value })}
                    placeholder="飞书自建应用密钥"
                    spellCheck={false}
                  />
                </div>
                <div className={styles.remotePanelField}>
                  <label className={styles.dingPanelLabel}>测试 Chat ID</label>
                  <input
                    type="text"
                    className={styles.dingPanelInput}
                    value={bot.testChatId}
                    onChange={(e) => updateBot(bot.id, { testChatId: e.target.value })}
                    placeholder="可选"
                    spellCheck={false}
                  />
                </div>
              </div>

              <details className={styles.remoteAdvanced}>
                <summary>高级配置</summary>
                <div className={styles.feishuBotMainGrid}>
                  <div className={styles.remotePanelField}>
                    <label className={styles.dingPanelLabel}>Encrypt Key</label>
                    <input
                      type="password"
                      className={styles.dingPanelInput}
                      value={bot.encryptKey}
                      onChange={(e) => updateBot(bot.id, { encryptKey: e.target.value })}
                      placeholder="可选"
                      spellCheck={false}
                    />
                  </div>
                  <div className={styles.remotePanelField}>
                    <label className={styles.dingPanelLabel}>Verify Token</label>
                    <input
                      type="password"
                      className={styles.dingPanelInput}
                      value={bot.verificationToken}
                      onChange={(e) => updateBot(bot.id, { verificationToken: e.target.value })}
                      placeholder="可选"
                      spellCheck={false}
                    />
                  </div>
                </div>
                <div className={styles.remotePanelSwitches}>
                  <label className={styles.toggleChip}>
                    <input
                      type="checkbox"
                      checked={bot.progressCardEnabled}
                      onChange={(e) => updateBot(bot.id, { progressCardEnabled: e.target.checked })}
                    />
                    进度卡片
                  </label>
                  <label className={styles.toggleChip}>
                    <input
                      type="checkbox"
                      checked={bot.showPartialAnswer}
                      onChange={(e) => updateBot(bot.id, { showPartialAnswer: e.target.checked })}
                    />
                    回复预览
                  </label>
                  <label className={styles.toggleChip}>
                    <input
                      type="checkbox"
                      checked={bot.showToolEvents}
                      onChange={(e) => updateBot(bot.id, { showToolEvents: e.target.checked })}
                    />
                    工具摘要
                  </label>
                </div>
                <label className={styles.remoteTextareaField}>
                  <span>允许飞书用户</span>
                  <textarea
                    className={styles.remoteTextarea}
                    value={bot.allowedUserIds}
                    onChange={(e) => updateBot(bot.id, { allowedUserIds: e.target.value })}
                    placeholder="每行一个 open_id/user_id；留空表示不限制"
                    spellCheck={false}
                  />
                </label>
              </details>
            </div>
          ))}
        </div>
      )}

      <div className={styles.remoteExecutionSection}>
        <div className={styles.feishuBotListHeader}>
          <span>执行设置</span>
        </div>
        <div className={styles.remotePanelGrid}>
          <div className={styles.remotePanelField}>
            <label className={styles.dingPanelLabel}>权限模式</label>
            <select
              className={styles.dingPanelInput}
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value as RemoteBridgePermissionMode)}
            >
              {permissionModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.remotePanelField}>
            <label className={styles.dingPanelLabel}>执行方式</label>
            <select
              className={styles.dingPanelInput}
              value={deliveryMode}
              onChange={(e) => setDeliveryMode(e.target.value as RemoteBridgeDeliveryMode)}
            >
              {deliveryModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className={styles.remoteTextareaField}>
          <span>允许项目路径</span>
          <textarea
            className={styles.remoteTextarea}
            value={allowedCwds}
            onChange={(e) => setAllowedCwds(e.target.value)}
            placeholder="每行一个路径；留空表示不限制"
            spellCheck={false}
          />
        </label>
      </div>

      <div className={styles.dingPanelActions}>
        <button
          type="button"
          className="btnPrimary btnSm"
          disabled={saving || !ready}
          onClick={() => onSave(buildConfig())}
        >
          {saving ? "保存中…" : "保存并应用"}
        </button>
      </div>
    </div>
  );
};

export default RemoteBridgePanel;
