import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Config,
  HookEntry,
  LogEntry,
  NotificationSettings,
  SessionSummary,
  TimelineEntry,
} from "../../lib/api";
import {
  fetchConfig as apiFetchConfig,
  fetchHooks,
  fetchLogs,
  fetchSessions,
  fetchSessionTimeline,
  fetchCaffeinate,
  setCaffeinate,
  testDingTalk,
  updateNotifications,
  clearHooks,
  updateProjectRemarkApi,
} from "../../lib/api";
import type { SseStatus, SessionGroup, SelectedDetail } from "../DashboardTab/types";
import { basename, MAX_BUFFER, UNKNOWN_GROUP_KEY } from "../DashboardTab/utils";
import { useEventFilter } from "../DashboardTab/useEventFilter";
import SessionList from "../DashboardTab/SessionList";
import EventStream from "../DashboardTab/EventStream";
import DingTalkPanel from "../DashboardTab/DingTalkPanel";
import MacosNotifyPanel from "../DashboardTab/MacosNotifyPanel";
import SessionAnalyticsPanel from "../SessionAnalyticsPanel";
import { LogDetailPanel } from "../LogDetailPanel";
import { HookDetailPanel } from "../HookDetailPanel";
import styles from "./index.module.css";

const StatusBarPanel = () => {
  const [config, setConfig] = useState<Config>({
    activeTarget: "",
    targets: [],
    channels: [],
    logCollection: { captureOriginalBody: false, captureRawStreamEvents: false },
  });
  const [events, setEvents] = useState<HookEntry[]>([]);
  const [globalLogs, setGlobalLogs] = useState<LogEntry[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionTimeline, setSessionTimeline] = useState<TimelineEntry[]>([]);
  const [sseStatus, setSseStatus] = useState<SseStatus>("connecting");
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetail | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [caffeinate, setCaffeinateState] = useState<{ supported: boolean; active: boolean }>({
    supported: false,
    active: false,
  });
  const [dingtalkOpen, setDingtalkOpen] = useState(false);
  const [macosOpen, setMacosOpen] = useState(false);
  const [analyticsSessionId, setAnalyticsSessionId] = useState<string | null>(null);
  const [dingSaving, setDingSaving] = useState(false);
  const [dingTesting, setDingTesting] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const esRef = useRef<EventSource | null>(null);
  const filter = useEventFilter();

  const notifications: NotificationSettings = config.notifications ?? {};
  const macos = notifications.macos ?? {};
  const dingtalk = notifications.dingtalk ?? {};
  const eventsAnyOn = (e?: { stop?: boolean; subagentStop?: boolean; notification?: boolean }) =>
    !!(e?.stop || e?.subagentStop || e?.notification);
  const macosArmed = !!macos.enabled && eventsAnyOn(macos.events);
  const dingtalkArmed = !!dingtalk.enabled && eventsAnyOn(dingtalk.events) && !!dingtalk.accessToken && !!dingtalk.secret;

  const refreshConfig = useCallback(async () => {
    try { const data = await apiFetchConfig(); setConfig(data); } catch { /* ignore */ }
  }, []);
  const refreshSessions = useCallback(async () => {
    try { const res = await fetchSessions(); setSessions(res.sessions); } catch { /* ignore */ }
  }, []);
  const loadInitial = useCallback(async () => {
    const [hookRes, logRes] = await Promise.allSettled([fetchHooks({ limit: 100 }), fetchLogs(100)]);
    if (hookRes.status === "fulfilled") setEvents(hookRes.value.entries);
    if (logRes.status === "fulfilled") setGlobalLogs(logRes.value.entries);
    await refreshSessions();
  }, [refreshSessions]);
  const loadSessionTimeline = useCallback(async (sessionId: string) => {
    try { const res = await fetchSessionTimeline(sessionId, 200); setSessionTimeline(res.entries); } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refreshConfig(); void loadInitial(); void fetchCaffeinate().then(setCaffeinateState).catch(() => {}); }, [refreshConfig, loadInitial]);
  useEffect(() => { if (!selectedSession) { setSessionTimeline([]); return; } void loadSessionTimeline(selectedSession); }, [selectedSession, loadSessionTimeline]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;
    setSseStatus("connecting");
    es.addEventListener("ready", () => setSseStatus("open"));
    es.onopen = () => setSseStatus("open");
    es.onerror = () => setSseStatus("closed");
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as { type?: string; data?: unknown };
        if (parsed.type === "hook" && parsed.data) {
          const entry = parsed.data as HookEntry;
          setEvents((prev) => [entry, ...prev].slice(0, MAX_BUFFER));
          if (selectedSession && entry.sessionId === selectedSession) {
            setSessionTimeline((prev) => [{ kind: "hook" as const, at: entry.createdAt, hook: entry }, ...prev].slice(0, MAX_BUFFER));
          }
          void refreshSessions();
          return;
        }
        if (parsed.type === "log" && parsed.data) {
          const { kind, entry } = parsed.data as { kind: "create" | "update"; entry: LogEntry };
          if (selectedSession && entry.sessionId === selectedSession) {
            setSessionTimeline((prev) => {
              const idx = prev.findIndex((it) => it.kind === "log" && it.log.id === entry.id);
              const next: TimelineEntry = { kind: "log", at: entry.timestamp, log: entry };
              if (idx >= 0) { const copy = prev.slice(); copy[idx] = next; return copy; }
              return kind === "create" ? [next, ...prev].slice(0, MAX_BUFFER) : prev;
            });
          }
          setGlobalLogs((prev) => {
            const idx = prev.findIndex((l) => l.id === entry.id);
            if (idx >= 0) { const copy = prev.slice(); copy[idx] = entry; return copy; }
            return kind === "create" ? [entry, ...prev].slice(0, MAX_BUFFER) : prev;
          });
          setSelectedDetail((cur) => cur && cur.kind === "log" && cur.entry.id === entry.id ? { kind: "log", entry } : cur);
        }
      } catch { /* ignore */ }
    };
    return () => { es.close(); esRef.current = null; };
  }, [selectedSession, refreshSessions]);

  const handleToggleMacos = async (enabled: boolean) => { try { await updateNotifications({ macos: { enabled } }); void refreshConfig(); } catch { /* */ } };
  const handleChangeMacosEvents = async (ev: { stop?: boolean; subagentStop?: boolean; notification?: boolean }) => { try { await updateNotifications({ macos: { events: ev } }); void refreshConfig(); } catch { /* */ } };
  const handleToggleDingTalk = async (enabled: boolean) => { try { await updateNotifications({ dingtalk: { enabled } }); void refreshConfig(); } catch { /* */ } };
  const handleChangeDingtalkEvents = async (ev: { stop?: boolean; subagentStop?: boolean; notification?: boolean }) => { try { await updateNotifications({ dingtalk: { events: ev } }); void refreshConfig(); } catch { /* */ } };
  const handleSaveDingTalk = async (accessToken: string, secret: string) => { setDingSaving(true); try { await updateNotifications({ dingtalk: { accessToken, secret } }); void refreshConfig(); } finally { setDingSaving(false); } };
  const handleTestDingTalk = async (accessToken: string, secret: string) => { setDingTesting(true); try { await testDingTalk(accessToken, secret); alert("已发送测试消息"); } catch (e) { alert("测试失败：" + String(e)); } finally { setDingTesting(false); } };
  const handleToggleCaffeinate = async (active: boolean) => { try { const next = await setCaffeinate(active); setCaffeinateState(next); } catch { /* */ } };
  const handleClear = async () => {
    if (!confirm("清空所有记录？")) return;
    try { await clearHooks(); setEvents([]); setGlobalLogs([]); setSessionTimeline([]); setSessions([]); setSelectedDetail(null); } catch { /* */ }
  };

  const globalTimeline = useMemo<TimelineEntry[]>(() => {
    const hooks: TimelineEntry[] = events.map((ev) => ({ kind: "hook" as const, at: ev.createdAt, hook: ev }));
    const logs: TimelineEntry[] = globalLogs.map((log) => ({ kind: "log" as const, at: log.timestamp, log }));
    return [...hooks, ...logs].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [events, globalLogs]);

  const rawTimeline = selectedSession ? sessionTimeline : globalTimeline;
  const visibleTimeline = useMemo(() => filter.filterTimeline(rawTimeline), [filter, rawTimeline]);

  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const map = new Map<string, SessionGroup>();
    for (const s of sessions) {
      const key = s.cwd ?? UNKNOWN_GROUP_KEY;
      const existing = map.get(key);
      if (existing) {
        existing.sessions.push(s);
        if (s.lastEventAt > existing.lastEventAt) existing.lastEventAt = s.lastEventAt;
      } else {
        map.set(key, { key, cwd: s.cwd, remark: s.remark, folder: basename(s.cwd) || (s.cwd ? s.cwd : "未知路径"), sessions: [s], lastEventAt: s.lastEventAt });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.lastEventAt < b.lastEventAt ? 1 : a.lastEventAt > b.lastEventAt ? -1 : 0);
  }, [sessions]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  };

  return (
    <div className={styles.panel}>
      {/* ── Header bar ── */}
      <div className={styles.header}>
        <span className={`${styles.statusDot}${sseStatus === "open" ? ` ${styles.statusDotOpen}` : sseStatus === "closed" ? ` ${styles.statusDotClosed}` : ""}`} />
        <span className={styles.statusText}>
          {sseStatus === "open" ? "LIVE" : sseStatus === "closed" ? "OFFLINE" : "..."}
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

      {/* ── Scrollable controls strip ── */}
      <div className={styles.controls}>
        <label className={`${styles.controlChip}${macos.enabled ? ` ${styles.controlChipActive}` : ""}`}>
          <input type="checkbox" checked={!!macos.enabled} onChange={(e) => void handleToggleMacos(e.target.checked)} />
          macOS
          {!!macos.enabled && !macosArmed && <span className={styles.warnBadge}>!</span>}
        </label>
        <button type="button" className={styles.iconBtn} onClick={() => setMacosOpen((v) => !v)} title="macOS 通知配置">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="2" /><path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.3 2.3l.7.7M9 9l.7.7M2.3 9.7l.7-.7M9 3l.7-.7" />
          </svg>
        </button>

        <label className={`${styles.controlChip}${dingtalk.enabled ? ` ${styles.controlChipActive}` : ""}`}>
          <input type="checkbox" checked={!!dingtalk.enabled} onChange={(e) => void handleToggleDingTalk(e.target.checked)} />
          钉钉
          {!!dingtalk.enabled && !dingtalkArmed && <span className={styles.warnBadge}>!</span>}
        </label>
        <button type="button" className={styles.iconBtn} onClick={() => setDingtalkOpen((v) => !v)} title="钉钉通知配置">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="2" /><path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.3 2.3l.7.7M9 9l.7.7M2.3 9.7l.7-.7M9 3l.7-.7" />
          </svg>
        </button>

        {caffeinate.supported && (
          <label className={`${styles.controlChip}${caffeinate.active ? ` ${styles.controlChipActive}` : ""}`}>
            <input type="checkbox" checked={caffeinate.active} onChange={(e) => void handleToggleCaffeinate(e.target.checked)} />
            睡眠
          </label>
        )}

        <span className={styles.controlSep} />

        <div className={styles.controlActions}>
          {!analyticsSessionId && sessions.length > 0 && (
            <button
              className={styles.controlBtnPrimary}
              onClick={() => setAnalyticsSessionId(selectedSession ?? sessions[0].sessionId)}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 9V5M4 9V3M7 9V1" />
              </svg>
              分析
            </button>
          )}
          {analyticsSessionId && (
            <button className={styles.controlBtnPrimary} onClick={() => setAnalyticsSessionId(null)}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 1L1 5l2 4M7 1l2 4-2 4" />
              </svg>
              事件流
            </button>
          )}
          <button className={styles.controlBtnDanger} onClick={handleClear}>
            清空
          </button>
        </div>
      </div>

      {/* ── Notification config panels ── */}
      {macosOpen && (
        <div className={styles.configSection}>
          <MacosNotifyPanel events={macos.events} onChange={(next) => void handleChangeMacosEvents(next)} />
        </div>
      )}
      {dingtalkOpen && (
        <div className={styles.configSection}>
          <DingTalkPanel
            config={dingtalk} saving={dingSaving} testing={dingTesting}
            onSave={handleSaveDingTalk} onTest={handleTestDingTalk}
            onChangeEvents={(next) => void handleChangeDingtalkEvents(next)}
          />
        </div>
      )}

      {/* ── Split layout ── */}
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
            {sessionGroups.map((group) => {
              const letter = group.folder.charAt(0).toUpperCase();
              const latestSid = group.sessions[0]?.sessionId;
              const isActive = latestSid && selectedSession === latestSid;
              return (
                <button
                  key={group.key}
                  className={`${styles.miniIcon}${isActive ? ` ${styles.miniIconActive}` : ""}`}
                  title={group.folder}
                  onClick={() => {
                    if (latestSid) { setSelectedSession(latestSid); setAnalyticsSessionId(null); }
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
              sessionGroups={sessionGroups}
              sessions={sessions}
              selectedSession={selectedSession}
              collapsedGroups={collapsedGroups}
              eventCount={events.length + globalLogs.length}
              onSelectSession={(sid) => { setSelectedSession(sid); setAnalyticsSessionId(null); }}
              onToggleGroup={toggleGroup}
              onSaveRemark={async (cwd, remark) => {
                await updateProjectRemarkApi(cwd, remark);
                await refreshSessions();
              }}
            />
          </div>
        )}

        <div className={styles.eventPane}>
          {analyticsSessionId ? (
            <SessionAnalyticsPanel sessionId={analyticsSessionId} onClose={() => setAnalyticsSessionId(null)} />
          ) : (
            <EventStream
              selectedSession={selectedSession}
              sessions={sessions}
              timeline={visibleTimeline}
              filterPreset={filter.filterPreset}
              enabledTypes={filter.enabledTypes}
              filterSearch={filter.filterSearch}
              selectedDetail={selectedDetail}
              targetCount={config.targets.length}
              compactFilter
              onSelectDetail={setSelectedDetail}
              onSetPreset={filter.setPreset}
              onToggleType={filter.toggleType}
              onSearchChange={filter.setFilterSearch}
            />
          )}
        </div>
      </div>

      <LogDetailPanel
        log={selectedDetail?.kind === "log" ? selectedDetail.entry : null}
        onClose={() => setSelectedDetail(null)}
      />
      <HookDetailPanel
        entry={selectedDetail?.kind === "hook" ? selectedDetail.entry : null}
        onClose={() => setSelectedDetail(null)}
      />
    </div>
  );
};

export default StatusBarPanel;
