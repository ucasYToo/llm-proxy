"use client";
import { useCallback, useEffect, useState } from "react";
import type { Config } from "@/lib/types";
import ConfigTab from "./components/ConfigTab";
import LogsTab from "./components/LogsTab";
import styles from "./index.module.css";

type Tab = "config" | "logs";

const Home = () => {
  const [tab, setTab] = useState<Tab>("config");
  const [config, setConfig] = useState<Config>({
    activeTarget: "",
    targets: [],
    logCollection: { captureOriginalBody: false, captureRawStreamEvents: false },
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

  return (
    <main className={styles.app}>
      <div className={styles.appHeader}>
        <h1>LLM Proxy</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {activeTarget ? (
            <span className={styles.badge}>● {activeTarget.name}</span>
          ) : (
            <span style={{ color: "#9ca3af", fontSize: 12 }}>未选择目标</span>
          )}
        </div>
      </div>

      <div className={styles.tabs}>
        <button className={`${styles.tabBtn}${tab === "config" ? ` ${styles.active}` : ""}`} onClick={() => setTab("config")}>
          配置
        </button>
        <button className={`${styles.tabBtn}${tab === "logs" ? ` ${styles.active}` : ""}`} onClick={() => setTab("logs")}>
          日志
        </button>
      </div>

      {tab === "config" && <ConfigTab config={config} onRefresh={fetchConfig} />}
      {tab === "logs" && <LogsTab config={config} />}
    </main>
  );
};

export default Home;
