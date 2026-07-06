import { useEffect, useMemo, useState } from "react";
import type {
  RemoteBridgeConfig,
  RemoteBridgeDeliveryMode,
  RemoteBridgePermissionMode,
} from "../../../lib/api";
import styles from "../index.module.css";

interface Props {
  config: RemoteBridgeConfig | undefined;
  saving: boolean;
  testing: boolean;
  onSave: (next: RemoteBridgeConfig) => void;
  onTest: (chatId?: string) => void;
}

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

const RemoteBridgePanel = ({ config, saving, testing, onSave, onTest }: Props) => {
  const feishu = config?.feishu ?? {};
  const [enabled, setEnabled] = useState(!!config?.enabled);
  const [webEnabled, setWebEnabled] = useState(config?.web?.enabled ?? true);
  const [publicBaseUrl, setPublicBaseUrl] = useState(config?.web?.publicBaseUrl ?? "");
  const [defaultCwd, setDefaultCwd] = useState(config?.defaultCwd ?? "");
  const [allowedCwds, setAllowedCwds] = useState((config?.allowedCwds ?? []).join("\n"));
  const [claudeCommand, setClaudeCommand] = useState(config?.claudeCommand ?? "claude");
  const [permissionMode, setPermissionMode] = useState<RemoteBridgePermissionMode>(
    config?.permissionMode ?? "default",
  );
  const [deliveryMode, setDeliveryMode] = useState<RemoteBridgeDeliveryMode>(
    config?.deliveryMode ?? "cli",
  );
  const [feishuEnabled, setFeishuEnabled] = useState(!!feishu.enabled);
  const [progressCardEnabled, setProgressCardEnabled] = useState(
    feishu.progressCard?.enabled ?? true,
  );
  const [showPartialAnswer, setShowPartialAnswer] = useState(
    feishu.progressCard?.showPartialAnswer ?? true,
  );
  const [showToolEvents, setShowToolEvents] = useState(
    feishu.progressCard?.showToolEvents ?? true,
  );
  const [appId, setAppId] = useState(feishu.appId ?? "");
  const [appSecret, setAppSecret] = useState(feishu.appSecret ?? "");
  const [encryptKey, setEncryptKey] = useState(feishu.encryptKey ?? "");
  const [verificationToken, setVerificationToken] = useState(feishu.verificationToken ?? "");
  const [allowedUserIds, setAllowedUserIds] = useState((feishu.allowedUserIds ?? []).join("\n"));
  const [testChatId, setTestChatId] = useState("");

  useEffect(() => {
    setEnabled(!!config?.enabled);
    setWebEnabled(config?.web?.enabled ?? true);
    setPublicBaseUrl(config?.web?.publicBaseUrl ?? "");
    setDefaultCwd(config?.defaultCwd ?? "");
    setAllowedCwds((config?.allowedCwds ?? []).join("\n"));
    setClaudeCommand(config?.claudeCommand ?? "claude");
    setPermissionMode(config?.permissionMode ?? "default");
    setDeliveryMode(config?.deliveryMode ?? "cli");
    setFeishuEnabled(!!config?.feishu?.enabled);
    setProgressCardEnabled(config?.feishu?.progressCard?.enabled ?? true);
    setShowPartialAnswer(config?.feishu?.progressCard?.showPartialAnswer ?? true);
    setShowToolEvents(config?.feishu?.progressCard?.showToolEvents ?? true);
    setAppId(config?.feishu?.appId ?? "");
    setAppSecret(config?.feishu?.appSecret ?? "");
    setEncryptKey(config?.feishu?.encryptKey ?? "");
    setVerificationToken(config?.feishu?.verificationToken ?? "");
    setAllowedUserIds((config?.feishu?.allowedUserIds ?? []).join("\n"));
  }, [config]);

  const ready = useMemo(
    () => !feishuEnabled || (!!appId.trim() && !!appSecret.trim()),
    [appId, appSecret, feishuEnabled],
  );

  const buildConfig = (): RemoteBridgeConfig => ({
    ...config,
    enabled,
    web: {
      ...(config?.web ?? {}),
      enabled: webEnabled,
      publicBaseUrl: publicBaseUrl.trim(),
    },
    defaultCwd: defaultCwd.trim(),
    allowedCwds: linesToList(allowedCwds),
    claudeCommand: claudeCommand.trim() || "claude",
    permissionMode,
    deliveryMode,
    feishu: {
      ...(config?.feishu ?? {}),
      enabled: feishuEnabled,
      appId: appId.trim(),
      appSecret: appSecret.trim(),
      encryptKey: encryptKey.trim(),
      verificationToken: verificationToken.trim(),
      ingress: config?.feishu?.ingress ?? "longConnection",
      allowedUserIds: linesToList(allowedUserIds),
      progressCard: {
        ...(config?.feishu?.progressCard ?? {}),
        enabled: progressCardEnabled,
        showPartialAnswer,
        showToolEvents,
      },
    },
  });

  return (
    <div className={styles.dingPanel}>
      <div className={styles.remotePanelGrid}>
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
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={progressCardEnabled}
            onChange={(e) => setProgressCardEnabled(e.target.checked)}
          />
          进度卡片
        </label>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={showPartialAnswer}
            onChange={(e) => setShowPartialAnswer(e.target.checked)}
          />
          回复预览
        </label>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={showToolEvents}
            onChange={(e) => setShowToolEvents(e.target.checked)}
          />
          工具摘要
        </label>
      </div>

      <div className={styles.dingPanelRow}>
        <label className={styles.dingPanelLabel}>App ID</label>
        <input
          type="text"
          className={styles.dingPanelInput}
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          placeholder="cli_xxx"
          spellCheck={false}
        />
      </div>
      <div className={styles.dingPanelRow}>
        <label className={styles.dingPanelLabel}>App Secret</label>
        <input
          type="password"
          className={styles.dingPanelInput}
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          placeholder="飞书自建应用密钥"
          spellCheck={false}
        />
      </div>
      <div className={styles.dingPanelRow}>
        <label className={styles.dingPanelLabel}>Encrypt Key</label>
        <input
          type="password"
          className={styles.dingPanelInput}
          value={encryptKey}
          onChange={(e) => setEncryptKey(e.target.value)}
          placeholder="可选，事件与回调加密密钥"
          spellCheck={false}
        />
      </div>
      <div className={styles.dingPanelRow}>
        <label className={styles.dingPanelLabel}>Verify Token</label>
        <input
          type="password"
          className={styles.dingPanelInput}
          value={verificationToken}
          onChange={(e) => setVerificationToken(e.target.value)}
          placeholder="可选，事件与回调 Verification Token"
          spellCheck={false}
        />
      </div>

      <div className={styles.remotePanelGrid}>
        <div className={styles.remotePanelField}>
          <label className={styles.dingPanelLabel}>默认路径</label>
          <input
            type="text"
            className={styles.dingPanelInput}
            value={defaultCwd}
            onChange={(e) => setDefaultCwd(e.target.value)}
            placeholder="/Users/you/project"
            spellCheck={false}
          />
        </div>
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

      <div className={styles.remoteTextareas}>
        <label>
          <span>允许项目路径</span>
          <textarea
            className={styles.remoteTextarea}
            value={allowedCwds}
            onChange={(e) => setAllowedCwds(e.target.value)}
            placeholder="每行一个路径；留空表示不限制"
            spellCheck={false}
          />
        </label>
        <label>
          <span>允许飞书用户</span>
          <textarea
            className={styles.remoteTextarea}
            value={allowedUserIds}
            onChange={(e) => setAllowedUserIds(e.target.value)}
            placeholder="每行一个 open_id/user_id；留空表示不限制"
            spellCheck={false}
          />
        </label>
      </div>

      <div className={styles.dingPanelRow}>
        <label className={styles.dingPanelLabel}>测试 Chat ID</label>
        <input
          type="text"
          className={styles.dingPanelInput}
          value={testChatId}
          onChange={(e) => setTestChatId(e.target.value)}
          placeholder="可选，填 chat_id 后发送测试消息"
          spellCheck={false}
        />
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
        <button
          type="button"
          className="btnGhost btnSm"
          disabled={testing || !appId || !appSecret}
          onClick={() => onTest(testChatId.trim() || undefined)}
        >
          {testing ? "测试中…" : "测试飞书连接"}
        </button>
      </div>
    </div>
  );
};

export default RemoteBridgePanel;
