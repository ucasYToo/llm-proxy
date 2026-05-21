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
  fetchHooks,
  fetchLogs,
  fetchSessions,
  fetchSessionTimeline,
  fetchCaffeinate,
  setCaffeinate,
  testDingTalk,
  updateNotifications,
  clearHooks,
} from "../../lib/api";
import { LogDetailPanel } from "../LogDetailPanel";
import { HookDetailPanel } from "../HookDetailPanel";
import type { SseStatus, SessionGroup, SelectedDetail } from "./types";
import { basename, cwdFromEntry, MAX_BUFFER, UNKNOWN_GROUP_KEY } from "./utils";
import { useEventFilter } from "./useEventFilter";
import SessionList from "./SessionList";
import EventStream from "./EventStream";
import DingTalkPanel from "./DingTalkPanel";
import ProjectCard from "./ProjectCard";
import styles from "./index.module.css";

interface Props {
  config: Config;
  onRefresh: () => void;
}

const DashboardTab = ({ config, onRefresh }: Props) => {
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
  const esRef = useRef<EventSource | null>(null);

  const filter = useEventFilter();
  const notifications: NotificationSettings = config.notifications ?? {};
  const dingtalk = notifications.dingtalk ?? {};

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetchSessions();
      setSessions(res.sessions);
    } catch {
      // ignore
    }
  }, []);

  const loadInitial = useCallback(async () => {
    const [hookRes, logRes] = await Promise.allSettled([
      fetchHooks({ limit: 100 }),
      fetchLogs(100),
    ]);
    if (hookRes.status === "fulfilled") setEvents(hookRes.value.entries);
    if (logRes.status === "fulfilled") setGlobalLogs(logRes.value.entries);
    await refreshSessions();
  }, [refreshSessions]);

  const loadSessionTimeline = useCallback(async (sessionId: string) => {
    try {
      const res = await fetchSessionTimeline(sessionId, 200);
      setSessionTimeline(res.entries);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadInitial();
    void fetchCaffeinate()
      .then(setCaffeinateState)
      .catch(() => {
        // ignore
      });
  }, [loadInitial]);

  const handleToggleCaffeinate = async (active: boolean) => {
    try {
      const next = await setCaffeinate(active);
      setCaffeinateState(next);
    } catch (e) {
      alert("切换防睡眠失败：" + String(e));
    }
  };

  useEffect(() => {
    if (!selectedSession) {
      setSessionTimeline([]);
      return;
    }
    void loadSessionTimeline(selectedSession);
  }, [selectedSession, loadSessionTimeline]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;
    setSseStatus("connecting");

    es.addEventListener("ready", () => setSseStatus("open"));
    es.onopen = () => setSseStatus("open");
    es.onerror = () => setSseStatus("closed");
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as {
          type?: string;
          data?: unknown;
        };
        if (parsed.type === "hook" && parsed.data) {
          const entry = parsed.data as HookEntry;
          setEvents((prev) => [entry, ...prev].slice(0, MAX_BUFFER));
          if (selectedSession && entry.sessionId === selectedSession) {
            setSessionTimeline((prev) =>
              [{ kind: "hook" as const, at: entry.createdAt, hook: entry }, ...prev].slice(
                0,
                MAX_BUFFER,
              ),
            );
          }
          void refreshSessions();
          return;
        }
        if (parsed.type === "log" && parsed.data) {
          const { kind, entry } = parsed.data as {
            kind: "create" | "update";
            entry: LogEntry;
          };
          if (selectedSession && entry.sessionId === selectedSession) {
            setSessionTimeline((prev) => {
              const idx = prev.findIndex(
                (it) => it.kind === "log" && it.log.id === entry.id,
              );
              const next: TimelineEntry = {
                kind: "log",
                at: entry.timestamp,
                log: entry,
              };
              if (idx >= 0) {
                const copy = prev.slice();
                copy[idx] = next;
                return copy;
              }
              return kind === "create"
                ? [next, ...prev].slice(0, MAX_BUFFER)
                : prev;
            });
          }
          // 全局视图：同时更新 globalLogs
          setGlobalLogs((prev) => {
            const idx = prev.findIndex((l) => l.id === entry.id);
            if (idx >= 0) {
              const copy = prev.slice();
              copy[idx] = entry;
              return copy;
            }
            return kind === "create"
              ? [entry, ...prev].slice(0, MAX_BUFFER)
              : prev;
          });
          setSelectedDetail((cur) =>
            cur && cur.kind === "log" && cur.entry.id === entry.id
              ? { kind: "log", entry }
              : cur,
          );
        }
      } catch {
        // ignore
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [selectedSession, refreshSessions]);

  const handleToggle = async (key: keyof NotificationSettings, value: boolean) => {
    try {
      await updateNotifications({ [key]: value });
      onRefresh();
    } catch (e) {
      alert("更新通知设置失败：" + String(e));
    }
  };

  const [dingSaving, setDingSaving] = useState(false);
  const [dingTesting, setDingTesting] = useState(false);

  const handleToggleDingTalk = async (enabled: boolean) => {
    try {
      await updateNotifications({ dingtalk: { enabled } });
      onRefresh();
    } catch (e) {
      alert("更新钉钉通知失败：" + String(e));
    }
  };

  const handleSaveDingTalk = async (accessToken: string, secret: string) => {
    setDingSaving(true);
    try {
      await updateNotifications({ dingtalk: { accessToken, secret } });
      onRefresh();
    } catch (e) {
      alert("保存钉钉配置失败：" + String(e));
    } finally {
      setDingSaving(false);
    }
  };

  const handleTestDingTalk = async (accessToken: string, secret: string) => {
    setDingTesting(true);
    try {
      await testDingTalk(accessToken, secret);
      alert("已发送测试消息，请到钉钉群确认");
    } catch (e) {
      alert("钉钉测试失败：" + String(e));
    } finally {
      setDingTesting(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("清空所有 hook 事件记录？")) return;
    try {
      await clearHooks();
      setEvents([]);
      setGlobalLogs([]);
      setSessionTimeline([]);
      setSessions([]);
      setSelectedDetail(null);
    } catch (e) {
      alert("清空失败：" + String(e));
    }
  };

  const globalTimeline = useMemo<TimelineEntry[]>(() => {
    const hooks: TimelineEntry[] = events.map((ev) => ({
      kind: "hook" as const,
      at: ev.createdAt,
      hook: ev,
    }));
    const logs: TimelineEntry[] = globalLogs.map((log) => ({
      kind: "log" as const,
      at: log.timestamp,
      log,
    }));
    return [...hooks, ...logs].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [events, globalLogs]);

  const rawTimeline = useMemo<TimelineEntry[]>(() => {
    return selectedSession ? sessionTimeline : globalTimeline;
  }, [selectedSession, sessionTimeline, globalTimeline]);

  const visibleTimeline = useMemo(() => filter.filterTimeline(rawTimeline), [filter, rawTimeline]);

  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const map = new Map<string, SessionGroup>();
    for (const s of sessions) {
      const key = s.cwd ?? UNKNOWN_GROUP_KEY;
      const existing = map.get(key);
      if (existing) {
        existing.sessions.push(s);
        if (s.lastEventAt > existing.lastEventAt) {
          existing.lastEventAt = s.lastEventAt;
        }
      } else {
        map.set(key, {
          key,
          cwd: s.cwd,
          folder: basename(s.cwd) || (s.cwd ? s.cwd : "未知路径"),
          sessions: [s],
          lastEventAt: s.lastEventAt,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.lastEventAt < b.lastEventAt ? 1 : a.lastEventAt > b.lastEventAt ? -1 : 0,
    );
  }, [sessions]);

  const eventsByProject = useMemo(() => {
    // sessionId -> group key (cwd)
    const sessionKeyMap = new Map<string, string>();
    for (const s of sessions) {
      if (s.sessionId) {
        sessionKeyMap.set(s.sessionId, s.cwd ?? UNKNOWN_GROUP_KEY);
      }
    }
    const map = new Map<string, TimelineEntry[]>();
    for (const entry of globalTimeline) {
      let key: string;
      if (entry.kind === "hook") {
        // 优先通过 sessionId 匹配（和 log 一致），再 fallback 到 cwd
        const bySession = entry.hook.sessionId
          ? sessionKeyMap.get(entry.hook.sessionId)
          : undefined;
        key = bySession ?? cwdFromEntry(entry.hook) ?? UNKNOWN_GROUP_KEY;
      } else {
        const bySession = entry.log.sessionId
          ? sessionKeyMap.get(entry.log.sessionId)
          : undefined;
        key = bySession ?? UNKNOWN_GROUP_KEY;
      }
      const list = map.get(key);
      if (list) {
        list.push(entry);
      } else {
        map.set(key, [entry]);
      }
    }
    return map;
  }, [globalTimeline, sessions]);

  // 不属于任何 session group 的孤立事件
  const orphanEvents = useMemo<TimelineEntry[]>(() => {
    const sessionKeys = new Set(sessionGroups.map((g) => g.key));
    const result: TimelineEntry[] = [];
    for (const [key, entries] of eventsByProject) {
      if (!sessionKeys.has(key)) {
        result.push(...entries);
      }
    }
    return result.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [eventsByProject, sessionGroups]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className={styles.dashboard}>
      <div className={styles.toolbar}>
        <div className={styles.statusGroup}>
          <span
            className={`${styles.statusDot}${sseStatus === "open" ? ` ${styles.statusDotOpen}` : sseStatus === "closed" ? ` ${styles.statusDotClosed}` : ""}`}
          />
          <span className={styles.statusLabel}>
            {sseStatus === "open" ? "实时连接" : sseStatus === "closed" ? "已断开" : "连接中…"}
          </span>
        </div>

        <div className={styles.toggleGroup}>
          <span className={styles.toggleGroupLabel}>macOS 通知：</span>
          <label className={styles.toggleChip}>
            <input
              type="checkbox"
              checked={!!notifications.stop}
              onChange={(e) => handleToggle("stop", e.target.checked)}
            />
            Stop
          </label>
          <label className={styles.toggleChip}>
            <input
              type="checkbox"
              checked={!!notifications.subagentStop}
              onChange={(e) => handleToggle("subagentStop", e.target.checked)}
            />
            SubagentStop
          </label>
          <label className={styles.toggleChip}>
            <input
              type="checkbox"
              checked={!!notifications.notification}
              onChange={(e) => handleToggle("notification", e.target.checked)}
            />
            Notification
          </label>
        </div>

        {caffeinate.supported && (
          <div className={styles.toggleGroup}>
            <label className={styles.toggleChip} title="启动 caffeinate -s -i：锁屏 / 合盖时也保持系统不睡眠">
              <input
                type="checkbox"
                checked={caffeinate.active}
                onChange={(e) => void handleToggleCaffeinate(e.target.checked)}
              />
              防止睡眠
            </label>
          </div>
        )}

        <div className={styles.toggleGroup}>
          <label className={styles.toggleChip} title="开启后，被勾选的事件会同时推送钉钉群机器人">
            <input
              type="checkbox"
              checked={!!dingtalk.enabled}
              onChange={(e) => void handleToggleDingTalk(e.target.checked)}
            />
            钉钉
          </label>
          <button
            type="button"
            className="btnGhost btnSm"
            onClick={() => setDingtalkOpen((v) => !v)}
          >
            {dingtalkOpen ? "收起" : "配置"}
          </button>
        </div>

        <div className={styles.toolbarSpacer} />

        {selectedSession && (
          <button className="btnGhost btnSm" onClick={() => setSelectedSession(null)}>
            ← 返回概览
          </button>
        )}

        <button className="btnGhost btnSm" onClick={handleClear}>
          清空记录
        </button>
      </div>

      {dingtalkOpen && (
        <DingTalkPanel
          config={dingtalk}
          saving={dingSaving}
          testing={dingTesting}
          onSave={handleSaveDingTalk}
          onTest={handleTestDingTalk}
        />
      )}

      {!selectedSession ? (
        <div className={styles.projectGrid}>
          {sessionGroups.length === 0 && orphanEvents.length === 0 ? (
            <div className={styles.emptyHint}>
              暂无活跃项目。在终端运行 <code>claude-llm-proxy hook install</code> 把 hook 注册到 Claude Code。
            </div>
          ) : (
            <>
              {sessionGroups.map((group) => (
                <ProjectCard
                  key={group.key}
                  folder={group.folder}
                  cwd={group.cwd}
                  sessions={group.sessions}
                  events={eventsByProject.get(group.key) ?? []}
                  selectedDetail={selectedDetail}
                  onSelectDetail={setSelectedDetail}
                  onEnterProject={() => {
                    const latest = group.sessions[0];
                    if (latest) setSelectedSession(latest.sessionId);
                  }}
                />
              ))}
              {orphanEvents.length > 0 && (
                <ProjectCard
                  key="__orphan__"
                  folder="其他事件"
                  cwd={null}
                  sessions={[]}
                  events={orphanEvents}
                  selectedDetail={selectedDetail}
                  onSelectDetail={setSelectedDetail}
                  onEnterProject={() => {}}
                />
              )}
            </>
          )}
        </div>
      ) : (
        <div className={styles.layout}>
          <SessionList
            sessionGroups={sessionGroups}
            sessions={sessions}
            selectedSession={selectedSession}
            collapsedGroups={collapsedGroups}
            eventCount={events.length + globalLogs.length}
            onSelectSession={setSelectedSession}
            onToggleGroup={toggleGroup}
          />

          <EventStream
            selectedSession={selectedSession}
            sessions={sessions}
            timeline={visibleTimeline}
            filterPreset={filter.filterPreset}
            enabledTypes={filter.enabledTypes}
            filterSearch={filter.filterSearch}
            selectedDetail={selectedDetail}
            onSelectDetail={setSelectedDetail}
            onSetPreset={filter.setPreset}
            onToggleType={filter.toggleType}
            onSearchChange={filter.setFilterSearch}
          />
        </div>
      )}

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

export default DashboardTab;
