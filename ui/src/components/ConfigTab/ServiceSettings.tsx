import { useEffect, useState } from "react";
import { serviceAction } from "../../lib/api";
import styles from "./index.module.css";

interface ServiceSettings {
  autoStart: boolean;
  autoCheck: boolean;
  raw: {
    indexed: boolean;
    claudeVersion: string | null;
    enabled: boolean;
    conflict: boolean;
    timing: string;
    directory: string;
    pending: number;
    error: string;
  };
}
export function ServiceSettingsPanel() {
  const [state, setState] = useState<ServiceSettings>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const response = await fetch("/api/query?type=service-settings");
    if (!response.ok) throw new Error("无法读取本机配置");
    setState(await response.json());
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  const change = async (action: string, enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      await serviceAction(action, { enabled });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (label: string, action: string, checked: boolean) => (
    <label>
      <input
        type="checkbox"
        disabled={busy}
        checked={checked}
        onChange={(e) => void change(action, e.target.checked)}
      />{" "}
      {label}
    </label>
  );
  return (
    <section className={styles.section}>
      <h3>本机服务与采集</h3>
      {state && (
        <div style={{ display: "grid", gap: 8 }}>
          {toggle(
            "打开 Claude 会话时启动服务",
            "updateAutoStart",
            state.autoStart,
          )}
          {toggle(
            "每天检查 npm 更新",
            "updateCheckPreference",
            state.autoCheck,
          )}
          {toggle(
            "从本地文件采集 Claude 请求",
            "configureRaw",
            state.raw.enabled,
          )}
          <small>
            文件索引需要 Claude Code 2.1.274 或更高版本。
            {state.raw.claudeVersion &&
              "本机版本 " + state.raw.claudeVersion + "。"}
            新会话会将完整会话历史和工具结果写入 {state.raw.directory}。
            {state.raw.enabled &&
              (state.raw.indexed ? "正在采集。" : "等待新会话的首条索引。")}
            {state.raw.conflict ? "现有文件采集设置冲突。" : ""}
            {state.raw.pending ? "待配对 " + state.raw.pending + " 条。" : ""}
            {state.raw.error}
          </small>
          {toggle(
            "通过本机 OTLP 补全请求耗时",
            "configureTiming",
            state.raw.timing === "installed",
          )}
          {state.raw.timing === "conflict" && (
            <small>已有 OTLP 配置，请保留现有端点。</small>
          )}
          {state.raw.timing === "port-mismatch" && (
            <small>服务端口已改变，重新启用以更新接收地址。</small>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
