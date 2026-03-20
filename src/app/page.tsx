"use client";
import { useCallback, useEffect, useState } from "react";
import type { Config } from "@/lib/types";
import ConfigTab from "./components/ConfigTab";
import LogsTab from "./components/LogsTab";

type Tab = "config" | "logs";

export default function Home() {
  const [tab, setTab] = useState<Tab>("config");
  const [config, setConfig] = useState<Config>({ activeTarget: "", targets: [] });

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
    <main className="app">
      <div className="app-header">
        <h1>LLM Proxy</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {activeTarget ? (
            <span className="badge">● {activeTarget.name}</span>
          ) : (
            <span style={{ color: "#9ca3af", fontSize: 12 }}>未选择目标</span>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab-btn${tab === "config" ? " active" : ""}`} onClick={() => setTab("config")}>
          配置
        </button>
        <button className={`tab-btn${tab === "logs" ? " active" : ""}`} onClick={() => setTab("logs")}>
          日志
        </button>
      </div>

      {tab === "config" && <ConfigTab config={config} onRefresh={fetchConfig} />}
      {tab === "logs" && <LogsTab config={config} />}
    </main>
  );
}
