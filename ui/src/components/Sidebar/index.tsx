import { useState } from "react";
import styles from "./index.module.css";

export type Tab = "config" | "logs" | "dashboard" | "analytics";

interface Props {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  activeTargetName?: string;
  onShutdown: () => void;
  isShuttingDown: boolean;
}

const navItems: { id: Tab; label: string; icon: JSX.Element }[] = [
  {
    id: "config",
    label: "配置",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="3" />
        <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M3.4 3.4l1.4 1.4M15.2 15.2l1.4 1.4M3.4 16.6l1.4-1.4M15.2 4.8l1.4-1.4" />
      </svg>
    ),
  },
  {
    id: "logs",
    label: "日志",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="2" width="14" height="16" rx="2" />
        <line x1="7" y1="6" x2="13" y2="6" />
        <line x1="7" y1="10" x2="13" y2="10" />
        <line x1="7" y1="14" x2="10" y2="14" />
      </svg>
    ),
  },
  {
    id: "dashboard",
    label: "Dashboard",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="7" height="7" rx="1" />
        <rect x="11" y="2" width="7" height="4" rx="1" />
        <rect x="2" y="11" width="7" height="4" rx="1" />
        <rect x="11" y="8" width="7" height="10" rx="1" />
      </svg>
    ),
  },
  {
    id: "analytics",
    label: "分析",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3,16 7,10 11,13 17,4" />
        <line x1="3" y1="18" x2="17" y2="18" />
        <line x1="3" y1="2" x2="3" y2="18" />
      </svg>
    ),
  },
];

const Sidebar = ({ tab, onTabChange, activeTargetName, onShutdown, isShuttingDown }: Props) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`${styles.sidebar}${collapsed ? ` ${styles.collapsed}` : ""}`}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.brandMark}>
          <svg width="28" height="28" viewBox="0 0 64 64" fill="none">
            <rect width="64" height="64" rx="14" fill="var(--text)" />
            <circle cx="32" cy="32" r="16" stroke="var(--accent)" strokeWidth="4" fill="none" />
            <circle cx="32" cy="32" r="6" fill="var(--accent)" />
            <line x1="32" y1="8" x2="32" y2="14" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="32" y1="50" x2="32" y2="56" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="8" y1="32" x2="14" y2="32" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="50" y1="32" x2="56" y2="32" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
        {!collapsed && (
          <div className={styles.brandText}>
            <span className={styles.brandTitle}>LLM Proxy</span>
            {activeTargetName ? (
              <span className={styles.brandSub}>{activeTargetName}</span>
            ) : (
              <span className={styles.brandSubMuted}>未选择目标</span>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {!collapsed && <div className={styles.navLabel}>导航</div>}
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`${styles.navItem}${tab === item.id ? ` ${styles.navItemActive}` : ""}`}
            onClick={() => onTabChange(item.id)}
            title={collapsed ? item.label : undefined}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            {!collapsed && <span className={styles.navLabel2}>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className={styles.footer}>
        {!collapsed && (
          <button className={styles.shutdownBtn} onClick={onShutdown} disabled={isShuttingDown}>
            {isShuttingDown ? "关闭中…" : "关闭服务"}
          </button>
        )}
        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: collapsed ? "rotate(180deg)" : "none",
              transition: "transform 0.2s var(--ease)",
            }}
          >
            <polyline points="10,3 5,8 10,13" />
          </svg>
          {!collapsed && <span>折叠</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
