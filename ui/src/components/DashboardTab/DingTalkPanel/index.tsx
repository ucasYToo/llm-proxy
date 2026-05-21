import { useEffect, useState } from "react";
import type { DingTalkConfig } from "../../../lib/api";
import styles from "../index.module.css";

interface Props {
  config: DingTalkConfig;
  saving: boolean;
  testing: boolean;
  onSave: (accessToken: string, secret: string) => void;
  onTest: (accessToken: string, secret: string) => void;
}

const DingTalkPanel = ({ config, saving, testing, onSave, onTest }: Props) => {
  const [accessToken, setAccessToken] = useState(config.accessToken ?? "");
  const [secret, setSecret] = useState(config.secret ?? "");

  useEffect(() => {
    setAccessToken(config.accessToken ?? "");
    setSecret(config.secret ?? "");
  }, [config.accessToken, config.secret]);

  return (
    <div className={styles.dingPanel}>
      <div className={styles.dingPanelHint}>
        钉钉群机器人 → 群设置 → 智能群助手 → 添加机器人 → 自定义机器人。
        安全设置选择「加签」，把 webhook 里的 <code>access_token</code> 和加签 <code>secret</code> 填进来。
        被勾选的事件触发时会同时推送到钉钉群。
      </div>
      <div className={styles.dingPanelRow}>
        <label className={styles.dingPanelLabel}>access_token</label>
        <input
          type="text"
          className={styles.dingPanelInput}
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="webhook URL 中的 access_token 部分"
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
          placeholder="加签 secret，SEC 开头"
          spellCheck={false}
        />
      </div>
      <div className={styles.dingPanelActions}>
        <button
          type="button"
          className="btnPrimary btnSm"
          disabled={saving}
          onClick={() => onSave(accessToken.trim(), secret.trim())}
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          className="btnGhost btnSm"
          disabled={testing || !accessToken || !secret}
          onClick={() => onTest(accessToken.trim(), secret.trim())}
        >
          {testing ? "发送中…" : "发送测试消息"}
        </button>
      </div>
    </div>
  );
};

export default DingTalkPanel;
