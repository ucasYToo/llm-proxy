import { useCallback, useEffect, useState } from "react";
import type { Config } from "./lib/api";
import ConfigTab from "./components/ConfigTab/index";
import LogsTab from "./components/LogsTab/index";
import DashboardTab from "./components/DashboardTab/index";
import AnalyticsTab from "./components/AnalyticsTab/index";
import ProjectsTab from "./components/ProjectsTab/index";
import StatusBarPanel from "./components/StatusBarPanel/index";
import Sidebar, { type Tab } from "./components/Sidebar/index";
import styles from "./App.module.css";

type AppTab = Tab | "panel";
const VALID_TABS = new Set<AppTab>(["config", "logs", "dashboard", "analytics", "projects", "panel"]);

const tabFromHash = (): AppTab => {
  const raw = window.location.hash.replace(/^#/, "") as AppTab;
  return VALID_TABS.has(raw) ? raw : "dashboard";
};

const App = () => {
  const [tab, setTab] = useState<AppTab>(tabFromHash);

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleTabChange = (next: AppTab) => {
    window.location.hash = next;
    setTab(next);
  };
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [config, setConfig] = useState<Config>({
    activeTarget: "",
    targets: [],
    channels: [],
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

  if (tab === "panel") {
    return <StatusBarPanel />;
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        tab={tab as Tab}
        onTabChange={handleTabChange}
        activeTargetName={activeTarget?.name}
        onShutdown={handleShutdown}
        isShuttingDown={isShuttingDown}
      />

      <main className={styles.content}>
        <div className={`${styles.contentInner}${tab === "dashboard" || tab === "analytics" ? ` ${styles.flexCol}` : ""}`}>
          {tab === "config" && (
            <ConfigTab config={config} onRefresh={fetchConfig} />
          )}
          {tab === "logs" && <LogsTab config={config} />}
          {tab === "dashboard" && (
            <DashboardTab config={config} onRefresh={fetchConfig} />
          )}
          {tab === "analytics" && <AnalyticsTab />}
          {tab === "projects" && <ProjectsTab />}
        </div>
      </main>
    </div>
  );
};

export default App;
