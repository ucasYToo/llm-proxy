import { useEffect, useState } from "react";
import type { ChannelEvents, FeishuConfig } from "../../../lib/api";
import styles from "../index.module.css";

interface Props {
  config: FeishuConfig;
  saving: boolean;
  testing: boolean;
  onSave: (webhookUrl: string, secret: string) => void;
  onTest: (webhookUrl: string, secret: string) => void;
  onChangeEvents: (next: ChannelEvents) => void;
}

const FeishuPanel = ({ config, saving, testing, onSave, onTest, onChangeEvents }: Props) => {
  const [webhookUrl, setWebhookUrl] = useState(config.webhookUrl ?? "");
  const [secret, setSecret] = useState(config.secret ?? "");
  const { stop = false, subagentStop = false, notification = false } = config.events ?? {};

  useEffect(() => {
    setWebhookUrl(config.webhookUrl ?? "");
    setSecret(config.secret ?? "");
  }, [config.webhookUrl, config.secret]);

  return (
    <div className={styles.dingPanel}>
      <div className={styles.dingPanelHint}>
        飞书群机器人 → 群设置 → 群机器人 → 添加机器人 → 自定义机器人。
        安全设置选择「签名校验」，把完整的 <code>webhook URL</code> 和签名 <code>secret</code> 填进来。
        勾选下方事件以选择哪些事件会推送到飞书群。
      </div>
      <div className={styles.notifyEventsRow}>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={stop}
            onChange={(e) => onChangeEvents({ stop: e.target.checked })}
          />
          Stop
        </label>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={subagentStop}
            onChange={(e) => onChangeEvents({ subagentStop: e.target.checked })}
          />
          SubagentStop
        </label>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={notification}
            onChange={(e) => onChangeEvents({ notification: e.target.checked })}
          />
          Notification
        </label>
      </div>
      <div className={styles.dingPanelRow}>
        <label className={styles.dingPanelLabel}>webhook URL</label>
        <input
          type="text"
          className={styles.dingPanelInput}
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="完整 webhook URL，https://open.feishu.cn/open-apis/bot/v2/hook/..."
          spellCheck={false}
        />
      </div>
      <div className={styles.dingPanelRow}>
        <label className={styles.dingPanelLabel}>secret</label>
        <input
          type="password"
          className={styles.dingPanelInput}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="签名校验 secret"
          spellCheck={false}
        />
      </div>
      <div className={styles.dingPanelActions}>
        <button
          type="button"
          className="btnPrimary btnSm"
          disabled={saving}
          onClick={() => onSave(webhookUrl.trim(), secret.trim())}
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          className="btnGhost btnSm"
          disabled={testing || !webhookUrl}
          onClick={() => onTest(webhookUrl.trim(), secret.trim())}
        >
          {testing ? "发送中…" : "发送测试消息"}
        </button>
      </div>
    </div>
  );
};

export default FeishuPanel;
