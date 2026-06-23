import { useEffect, useMemo, useState } from "react";
import type { FeishuRemoteConfig, FeishuRemoteStatus } from "../../../lib/api";
import {
  fetchFeishuRemoteStatus,
  installFeishuRemoteMcp,
  restartFeishuRemote,
  updateFeishuRemote,
} from "../../../lib/api";
import styles from "../index.module.css";

interface Props {
  initialConfig?: FeishuRemoteConfig;
  serverPort?: number;
}

const listToText = (items?: string[]) => (items ?? []).join("\n");

const textToList = (text: string) =>
  text
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

const basename = (cwd: string) => cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || cwd;

const FeishuRemotePanel = ({ initialConfig, serverPort }: Props) => {
  const [status, setStatus] = useState<FeishuRemoteStatus | null>(null);
  const [enabled, setEnabled] = useState(!!initialConfig?.enabled);
  const [domain, setDomain] = useState(initialConfig?.domain ?? "feishu");
  const [appId, setAppId] = useState(initialConfig?.appId ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [encryptKey, setEncryptKey] = useState(initialConfig?.encryptKey ?? "");
  const [verificationToken, setVerificationToken] = useState(initialConfig?.verificationToken ?? "");
  const [allowedUserIds, setAllowedUserIds] = useState(listToText(initialConfig?.allowedUserIds));
  const [allowedChatIds, setAllowedChatIds] = useState(listToText(initialConfig?.allowedChatIds));
  const [defaultCwd, setDefaultCwd] = useState(initialConfig?.defaultCwd ?? "");
  const [saving, setSaving] = useState(false);
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const next = await fetchFeishuRemoteStatus();
    setStatus(next);
    setEnabled(!!next.config.enabled);
    setDomain(next.config.domain ?? "feishu");
    setAppId(next.config.appId ?? "");
    setEncryptKey(next.config.encryptKey === "configured" ? encryptKey : next.config.encryptKey ?? "");
    setVerificationToken(next.config.verificationToken === "configured" ? verificationToken : next.config.verificationToken ?? "");
    setAllowedUserIds(listToText(next.config.allowedUserIds));
    setAllowedChatIds(listToText(next.config.allowedChatIds));
    setDefaultCwd(next.config.defaultCwd ?? "");
  };

  useEffect(() => {
    void load().catch((err) => setMessage(String(err)));
    const timer = setInterval(() => {
      void fetchFeishuRemoteStatus().then(setStatus).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const sdk = status?.runtime.sdk;
  const sidecarsByCwd = useMemo(() => {
    const map = new Map<string, number>();
    for (const sidecar of status?.runtime.sidecars ?? []) {
      map.set(sidecar.cwd, (map.get(sidecar.cwd) ?? 0) + 1);
    }
    return map;
  }, [status]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateFeishuRemote({
        enabled,
        domain,
        appId: appId.trim(),
        appSecret: appSecret.trim() || undefined,
        encryptKey: encryptKey.trim() || undefined,
        verificationToken: verificationToken.trim() || undefined,
        allowedUserIds: textToList(allowedUserIds),
        allowedChatIds: textToList(allowedChatIds),
        defaultCwd: defaultCwd.trim() || undefined,
      });
      setAppSecret("");
      await load();
      setMessage("已保存并重启飞书远控连接");
    } catch (err) {
      setMessage(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const next = await restartFeishuRemote();
      setStatus(next);
      setMessage("已重启飞书远控连接");
    } catch (err) {
      setMessage(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleInstall = async (cwd: string) => {
    setBusyProject(cwd);
    setMessage(null);
    try {
      const result = await installFeishuRemoteMcp(cwd, serverPort);
      setMessage(`已写入 ${result.install.mcpPath}。启动：${result.launchCommand}`);
      await load();
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusyProject(null);
    }
  };

  return (
    <div className={styles.remotePanel}>
      <div className={styles.remoteHeader}>
        <div>
          <div className={styles.remoteTitle}>飞书远程控制</div>
          <div className={styles.remoteMeta}>
            SDK: {sdk?.state ?? "idle"} · sidecar: {status?.runtime.sidecars.length ?? 0}
          </div>
        </div>
        <span className={`${styles.remoteBadge}${sdk?.connected ? ` ${styles.remoteBadgeOk}` : ""}`}>
          {sdk?.connected ? "connected" : "offline"}
        </span>
      </div>

      {sdk?.lastError && <div className={styles.remoteError}>{sdk.lastError}</div>}
      {message && <div className={styles.remoteNotice}>{message}</div>}

      <div className={styles.remoteGrid}>
        <label className={styles.remoteCheck}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          启用飞书自建应用长连接
        </label>
        <label className={styles.remoteField}>
          <span>domain</span>
          <select value={domain} onChange={(e) => setDomain(e.target.value as "feishu" | "lark")}>
            <option value="feishu">Feishu</option>
            <option value="lark">Lark</option>
          </select>
        </label>
        <label className={styles.remoteField}>
          <span>appId</span>
          <input value={appId} onChange={(e) => setAppId(e.target.value)} spellCheck={false} />
        </label>
        <label className={styles.remoteField}>
          <span>appSecret</span>
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder={status?.config.hasAppSecret ? "已配置，留空保持不变" : ""}
            spellCheck={false}
          />
        </label>
        <label className={styles.remoteField}>
          <span>encryptKey</span>
          <input value={encryptKey} onChange={(e) => setEncryptKey(e.target.value)} spellCheck={false} />
        </label>
        <label className={styles.remoteField}>
          <span>verificationToken</span>
          <input value={verificationToken} onChange={(e) => setVerificationToken(e.target.value)} spellCheck={false} />
        </label>
        <label className={styles.remoteField}>
          <span>defaultCwd</span>
          <input value={defaultCwd} onChange={(e) => setDefaultCwd(e.target.value)} spellCheck={false} />
        </label>
        <label className={styles.remoteField}>
          <span>allowedUserIds</span>
          <textarea value={allowedUserIds} onChange={(e) => setAllowedUserIds(e.target.value)} spellCheck={false} />
        </label>
        <label className={styles.remoteField}>
          <span>allowedChatIds</span>
          <textarea value={allowedChatIds} onChange={(e) => setAllowedChatIds(e.target.value)} spellCheck={false} />
        </label>
      </div>

      <div className={styles.remoteActions}>
        <button type="button" className="btnPrimary btnSm" disabled={saving} onClick={handleSave}>
          {saving ? "保存中…" : "保存配置"}
        </button>
        <button type="button" className="btnGhost btnSm" disabled={saving} onClick={handleRestart}>
          重启连接
        </button>
      </div>

      <div className={styles.remoteSections}>
        <section>
          <div className={styles.remoteSectionTitle}>项目 Channel</div>
          <div className={styles.remoteProjectList}>
            {(status?.projects ?? []).map((project) => (
              <div key={project.cwd} className={styles.remoteProjectRow}>
                <div>
                  <div className={styles.remoteProjectName}>{project.remark || basename(project.cwd)}</div>
                  <div className={styles.remoteProjectCwd}>{project.cwd}</div>
                </div>
                <div className={styles.remoteProjectActions}>
                  <span>{sidecarsByCwd.get(project.cwd) ?? 0} 在线</span>
                  <button
                    type="button"
                    className="btnGhost btnSm"
                    disabled={busyProject === project.cwd}
                    onClick={() => void handleInstall(project.cwd)}
                  >
                    安装 MCP
                  </button>
                </div>
              </div>
            ))}
            {(status?.projects.length ?? 0) === 0 && <div className={styles.emptyHint}>暂无已识别项目</div>}
          </div>
        </section>

        <section>
          <div className={styles.remoteSectionTitle}>最近消息</div>
          <div className={styles.remoteMessageList}>
            {(status?.runtime.recentMessages ?? []).slice(0, 8).map((item) => (
              <div key={item.id} className={styles.remoteMessageRow}>
                <span>{item.direction}</span>
                <p>{item.text}</p>
              </div>
            ))}
            {(status?.runtime.recentMessages.length ?? 0) === 0 && <div className={styles.emptyHint}>暂无远程消息</div>}
          </div>
        </section>
      </div>
    </div>
  );
};

export default FeishuRemotePanel;
