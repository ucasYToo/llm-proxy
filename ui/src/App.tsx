import { useCallback, useEffect, useState } from "react";
import type { Config } from "./lib/api";
import ConfigTab from "./components/ConfigTab/index";
import LogsTab from "./components/LogsTab/index";
import styles from "./App.module.css";

type Tab = "config" | "logs";

const App = () => {
  const [tab, setTab] = useState<Tab>("config");
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [config, setConfig] = useState<Config>({
    activeTarget: "",
    targets: [],
    logCollection: {
      captureOriginalBody: false,
      captureRawStreamEvents: false,
    },
  });

  const fetchConfig = useCallback(async () => {
    const res = await fetch("/api/query?type=config");
    const data = (await res.json()) as Config;
    setConfig(data);
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const activeTarget = config.targets.find((t) => t.id === config.activeTarget);

  const handleShutdown = async () => {
    if (!confirm("确认关闭服务？服务关闭后需要重新启动才能使用。")) return;
    setIsShuttingDown(true);
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch {
      // 服务关闭后请求会断开，忽略网络错误
    }
    setTimeout(() => window.location.reload(), 3000);
  };

  return (
    <main className={styles.app}>
      <div className={styles.appHeader}>
        <h1>LLM Proxy</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {activeTarget ? (
            <span className={styles.badge}>{activeTarget.name}</span>
          ) : (
            <span style={{ color: "#9ca3af", fontSize: 12 }}>未选择目标</span>
          )}
          <button
            className="btnDanger btnSm"
            onClick={handleShutdown}
            disabled={isShuttingDown}
          >
            {isShuttingDown ? "关闭中…" : "关闭服务"}
          </button>
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tabBtn}${tab === "config" ? ` ${styles.active}` : ""}`}
          onClick={() => setTab("config")}
        >
          配置
        </button>
        <button
          className={`${styles.tabBtn}${tab === "logs" ? ` ${styles.active}` : ""}`}
          onClick={() => setTab("logs")}
        >
          日志
        </button>
      </div>

      {tab === "config" && (
        <ConfigTab config={config} onRefresh={fetchConfig} />
      )}
      {tab === "logs" && <LogsTab config={config} />}
    </main>
  );
};

export default App;
