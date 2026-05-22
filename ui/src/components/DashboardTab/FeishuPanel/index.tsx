import { useEffect, useState } from "react";
import type { FeishuConfig } from "../../../lib/api";
import styles from "../index.module.css";

interface Props {
  config: FeishuConfig;
  saving: boolean;
  testing: boolean;
  onSave: (webhookUrl: string, secret: string) => void;
  onTest: (webhookUrl: string, secret: string) => void;
}

const FeishuPanel = ({ config, saving, testing, onSave, onTest }: Props) => {
  const [webhookUrl, setWebhookUrl] = useState(config.webhookUrl ?? "");
  const [secret, setSecret] = useState(config.secret ?? "");

  useEffect(() => {
    setWebhookUrl(config.webhookUrl ?? "");
    setSecret(config.secret ?? "");
  }, [config.webhookUrl, config.secret]);

  return (
    <div className={styles.dingPanel}>
      <div className={styles.dingPanelHint}>
        飞书群组 → 设置 → 群机器人 → 添加机器人 → 自定义机器人。
        安全设置选择「签名校验」，把 webhook 地址和签名校验 secret 填进来。
        被勾选的事件触发时会同时推送到飞书群。
      </div>
      <div className={styles.dingPanelRow}>
        <label className={styles.dingPanelLabel}>webhook URL</label>
        <input
          type="text"
          className={styles.dingPanelInput}
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
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
          placeholder="签名校验 secret（可选）"
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
          disabled={testing || !webhookUrl.trim()}
          onClick={() => onTest(webhookUrl.trim(), secret.trim())}
        >
          {testing ? "发送中…" : "发送测试消息"}
        </button>
      </div>
    </div>
  );
};

export default FeishuPanel;
