import { useCallback, useEffect, useState } from "react";
import { fetchConfig as apiFetchConfig, updateProjectRemarkApi } from "../../lib/api";
import type { Config } from "../../lib/api";
import { LogDetailPanel } from "../LogDetailPanel";
import { HookDetailPanel } from "../HookDetailPanel";
import SessionAnalyticsPanel from "../SessionAnalyticsPanel";
import { useDashboardData } from "../DashboardTab/useDashboardData";
import { useNotifications } from "../DashboardTab/useNotifications";
import SessionList from "../DashboardTab/SessionList";
import EventStream from "../DashboardTab/EventStream";
import DingTalkPanel from "../DashboardTab/DingTalkPanel";
import FeishuPanel from "../DashboardTab/FeishuPanel";
import MacosNotifyPanel from "../DashboardTab/MacosNotifyPanel";
import { isShowFeishu } from "../../constant";
import styles from "./index.module.css";

const StatusBarPanel = () => {
  const [config, setConfig] = useState<Config>({
    activeTarget: "",
    targets: [],
    channels: [],
    logCollection: { captureOriginalBody: false, captureRawStreamEvents: false },
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  const refreshConfig = useCallback(async () => {
    try {
      const c = await apiFetchConfig();
      setConfig(c);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { void refreshConfig(); }, [refreshConfig]);

  const data = useDashboardData();
  const notify = useNotifications({
    notifications: config.notifications ?? {},
    onRefresh: () => void refreshConfig(),
  });

  return (
    <div className={styles.panel}>
      {/* Header bar */}
      <div className={styles.header}>
        <span className={`${styles.statusDot}${data.sseStatus === "open" ? ` ${styles.statusDotOpen}` : data.sseStatus === "closed" ? ` ${styles.statusDotClosed}` : ""}`} />
        <span className={styles.statusText}>
          {data.sseStatus === "open" ? "LIVE" : data.sseStatus === "closed" ? "OFFLINE" : "..."}
        </span>
        <span className={styles.headerSpacer} />
        <span className={styles.headerTitle}>LLM Proxy</span>
        <span className={styles.headerSpacer} />
        <button
          className={styles.iconBtn}
          title="在浏览器中打开"
          onClick={() => window.open(`${window.location.origin}/#dashboard`, "_blank")}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 7.5v4a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H7" />
            <path d="M9 1.5h3.5V5" />
            <path d="M5.5 8.5 12.5 1.5" />
          </svg>
        </button>
      </div>

      {/* Controls strip */}
      <div className={styles.controls}>
        <label className={`${styles.controlChip}${notify.macos.enabled ? ` ${styles.controlChipActive}` : ""}`}>
          <input type="checkbox" checked={!!notify.macos.enabled} onChange={(e) => void notify.handleToggleMacos(e.target.checked)} />
          macOS
          {!!notify.macos.enabled && !notify.macosArmed && <span className={styles.warnBadge}>!</span>}
        </label>
        <button type="button" className={styles.iconBtn} onClick={() => notify.setMacosOpen((v) => !v)} title="macOS 通知配置">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="2" /><path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.3 2.3l.7.7M9 9l.7.7M2.3 9.7l.7-.7M9 3l.7-.7" />
          </svg>
        </button>

        <label className={`${styles.controlChip}${notify.dingtalk.enabled ? ` ${styles.controlChipActive}` : ""}`}>
          <input type="checkbox" checked={!!notify.dingtalk.enabled} onChange={(e) => void notify.handleToggleDingTalk(e.target.checked)} />
          钉钉
          {!!notify.dingtalk.enabled && !notify.dingtalkArmed && <span className={styles.warnBadge}>!</span>}
        </label>
        <button type="button" className={styles.iconBtn} onClick={() => notify.setDingtalkOpen((v) => !v)} title="钉钉通知配置">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="2" /><path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.3 2.3l.7.7M9 9l.7.7M2.3 9.7l.7-.7M9 3l.7-.7" />
          </svg>
        </button>

        {isShowFeishu && (
          <>
            <label className={`${styles.controlChip}${notify.feishu.enabled ? ` ${styles.controlChipActive}` : ""}`}>
              <input type="checkbox" checked={!!notify.feishu.enabled} onChange={(e) => void notify.handleToggleFeishu(e.target.checked)} />
              飞书
              {!!notify.feishu.enabled && !notify.feishuArmed && <span className={styles.warnBadge}>!</span>}
            </label>
            <button type="button" className={styles.iconBtn} onClick={() => notify.setFeishuOpen((v) => !v)} title="飞书通知配置">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="2" /><path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.3 2.3l.7.7M9 9l.7.7M2.3 9.7l.7-.7M9 3l.7-.7" />
              </svg>
            </button>
          </>
        )}

        {data.caffeinate.supported && (
          <label className={`${styles.controlChip}${data.caffeinate.active ? ` ${styles.controlChipActive}` : ""}`}>
            <input type="checkbox" checked={data.caffeinate.active} onChange={(e) => void data.handleToggleCaffeinate(e.target.checked)} />
            睡眠
          </label>
        )}

        <span className={styles.controlSep} />

        <div className={styles.controlActions}>
          {!data.analyticsSessionId && data.sessions.length > 0 && (
            <button
              className={styles.controlBtnPrimary}
              onClick={() => data.setAnalyticsSessionId(data.selectedSession ?? data.sessions[0].sessionId)}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 9V5M4 9V3M7 9V1" />
              </svg>
              分析
            </button>
          )}
          {data.analyticsSessionId && (
            <button className={styles.controlBtnPrimary} onClick={() => data.setAnalyticsSessionId(null)}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 1L1 5l2 4M7 1l2 4-2 4" />
              </svg>
              事件流
            </button>
          )}
          <button className={styles.controlBtnDanger} onClick={data.handleClear}>
            清空
          </button>
        </div>
      </div>

      {/* Notification config panels */}
      {notify.macosOpen && (
        <div className={styles.configSection}>
          <MacosNotifyPanel events={notify.macos.events} onChange={(next) => void notify.handleChangeMacosEvents(next)} />
        </div>
      )}
      {notify.dingtalkOpen && (
        <div className={styles.configSection}>
          <DingTalkPanel
            config={notify.dingtalk} saving={notify.dingSaving} testing={notify.dingTesting}
            onSave={notify.handleSaveDingTalk} onTest={notify.handleTestDingTalk}
            onChangeEvents={(next) => void notify.handleChangeDingtalkEvents(next)}
          />
        </div>
      )}
      {isShowFeishu && notify.feishuOpen && (
        <div className={styles.configSection}>
          <FeishuPanel
            config={notify.feishu} saving={notify.feishuSaving} testing={notify.feishuTesting}
            onSave={notify.handleSaveFeishu}
            onTest={notify.handleTestFeishu}
            onChangeEvents={(next) => void notify.handleChangeFeishuEvents(next)}
          />
        </div>
      )}

      {/* Split layout */}
      <div className={`${styles.layout}${sidebarCollapsed ? ` ${styles.layoutCollapsed}` : ""}`}>
        {sidebarCollapsed ? (
          <div className={styles.miniSidebar}>
            <button
              className={styles.miniToggle}
              onClick={() => setSidebarCollapsed(false)}
              title="展开会话列表"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 1 7 5 3 9" />
              </svg>
            </button>
            {data.sessionGroups.map((group) => {
              const letter = group.folder.charAt(0).toUpperCase();
              const latestSid = group.sessions[0]?.sessionId;
              const isActive = latestSid && data.selectedSession === latestSid;
              return (
                <button
                  key={group.key}
                  className={`${styles.miniIcon}${isActive ? ` ${styles.miniIconActive}` : ""}`}
                  title={group.folder}
                  onClick={() => {
                    if (latestSid) { data.setSelectedSession(latestSid); data.setAnalyticsSessionId(null); }
                  }}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        ) : (
          <div className={styles.sessionPane}>
            <button
              className={styles.collapseToggle}
              onClick={() => setSidebarCollapsed(true)}
              title="收起会话列表"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 1 3 5 7 9" />
              </svg>
            </button>
            <SessionList
              sessionGroups={data.sessionGroups}
              sessions={data.sessions}
              selectedSession={data.selectedSession}
              collapsedGroups={data.collapsedGroups}
              eventCount={data.events.length + data.globalLogs.length}
              onSelectSession={(sid) => { data.setSelectedSession(sid); data.setAnalyticsSessionId(null); }}
              onToggleGroup={data.toggleGroup}
              onSaveRemark={async (cwd, remark) => {
                await updateProjectRemarkApi(cwd, remark);
                await data.refreshSessions();
              }}
            />
          </div>
        )}

        <div className={styles.eventPane}>
          {data.analyticsSessionId ? (
            <SessionAnalyticsPanel sessionId={data.analyticsSessionId} onClose={() => data.setAnalyticsSessionId(null)} />
          ) : (
            <EventStream
              selectedSession={data.selectedSession}
              sessions={data.sessions}
              timeline={data.visibleTimeline}
              filterPreset={data.filter.filterPreset}
              enabledTypes={data.filter.enabledTypes}
              filterSearch={data.filter.filterSearch}
              agentRoleFilter="all"
              agentOptions={[]}
              selectedAgentId={null}
              selectedDetail={data.selectedDetail}
              targetCount={config.targets.length}
              compactFilter
              onSelectDetail={data.setSelectedDetail}
              onSetPreset={data.filter.setPreset}
              onToggleType={data.filter.toggleType}
              onSearchChange={data.filter.setFilterSearch}
              onAgentRoleChange={() => undefined}
              onSelectAgent={() => undefined}
            />
          )}
        </div>
      </div>

      <LogDetailPanel
        log={data.selectedDetail?.kind === "log" ? data.selectedDetail.entry : null}
        onClose={() => data.setSelectedDetail(null)}
      />
      <HookDetailPanel
        entry={data.selectedDetail?.kind === "hook" ? data.selectedDetail.entry : null}
        onClose={() => data.setSelectedDetail(null)}
      />
    </div>
  );
};

export default StatusBarPanel;
