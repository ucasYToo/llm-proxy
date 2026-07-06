import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HookEntry,
  LogEntry,
  RemoteChannelInstance,
  RemoteMessage,
  RemoteThread,
  SessionSummary,
  TimelineEntry,
} from "../../lib/api";
import {
  fetchHooks,
  fetchLogs,
  fetchSessions,
  fetchSessionTimeline,
  fetchCaffeinate,
  fetchRemoteInstances,
  fetchRemoteMessages,
  fetchRemoteThreads,
  setCaffeinate,
  clearHooks,
} from "../../lib/api";
import type { SseStatus, SessionGroup, SelectedDetail } from "./types";
import { basename, MAX_BUFFER, UNKNOWN_GROUP_KEY } from "./utils";
import { useEventFilter } from "./useEventFilter";

export function useDashboardData() {
  const [events, setEvents] = useState<HookEntry[]>([]);
  const [globalLogs, setGlobalLogs] = useState<LogEntry[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionTimeline, setSessionTimeline] = useState<TimelineEntry[]>([]);
  const [sseStatus, setSseStatus] = useState<SseStatus>("connecting");
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetail | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [analyticsSessionId, setAnalyticsSessionId] = useState<string | null>(null);
  const [remoteThreads, setRemoteThreads] = useState<RemoteThread[]>([]);
  const [remoteMessages, setRemoteMessages] = useState<RemoteMessage[]>([]);
  const [remoteInstances, setRemoteInstances] = useState<RemoteChannelInstance[]>([]);
  const [caffeinate, setCaffeinateState] = useState<{ supported: boolean; active: boolean }>({
    supported: false,
    active: false,
  });

  const esRef = useRef<EventSource | null>(null);
  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;

  const filter = useEventFilter();

  const refreshSessionsNow = useCallback(async () => {
    try {
      const res = await fetchSessions();
      setSessions(res.sessions);
    } catch {
      // ignore
    }
  }, []);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSessions = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshSessionsNow();
    }, 3000);
  }, [refreshSessionsNow]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const loadInitial = useCallback(async () => {
    const [hookRes, logRes, remoteThreadRes, remoteMessageRes, remoteInstanceRes] = await Promise.allSettled([
      fetchHooks({ limit: 100 }),
      fetchLogs(100),
      fetchRemoteThreads(100),
      fetchRemoteMessages(undefined, 200),
      fetchRemoteInstances(false),
    ]);
    if (hookRes.status === "fulfilled") setEvents(hookRes.value.entries);
    if (logRes.status === "fulfilled") setGlobalLogs(logRes.value.entries);
    if (remoteThreadRes.status === "fulfilled") setRemoteThreads(remoteThreadRes.value.threads);
    if (remoteMessageRes.status === "fulfilled") setRemoteMessages(remoteMessageRes.value.messages);
    if (remoteInstanceRes.status === "fulfilled") setRemoteInstances(remoteInstanceRes.value.instances);
    await refreshSessionsNow();
  }, [refreshSessionsNow]);

  const refreshRemote = useCallback(async () => {
    const [threadRes, messageRes, instanceRes] = await Promise.allSettled([
      fetchRemoteThreads(100),
      fetchRemoteMessages(undefined, 200),
      fetchRemoteInstances(false),
    ]);
    if (threadRes.status === "fulfilled") setRemoteThreads(threadRes.value.threads);
    if (messageRes.status === "fulfilled") setRemoteMessages(messageRes.value.messages);
    if (instanceRes.status === "fulfilled") setRemoteInstances(instanceRes.value.instances);
  }, []);

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
      .catch(() => {});
  }, [loadInitial]);

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
        const parsed = JSON.parse(msg.data) as { type?: string; data?: unknown };
        if (parsed.type === "hook" && parsed.data) {
          const entry = parsed.data as HookEntry;
          setEvents((prev) => [entry, ...prev].slice(0, MAX_BUFFER));
          if (selectedSessionRef.current && entry.sessionId === selectedSessionRef.current) {
            setSessionTimeline((prev) =>
              [{ kind: "hook" as const, at: entry.createdAt, hook: entry }, ...prev].slice(0, MAX_BUFFER),
            );
          }
          void refreshSessions();
          return;
        }
        if (parsed.type === "log" && parsed.data) {
          const { kind, entry } = parsed.data as { kind: "create" | "update"; entry: LogEntry };
          if (selectedSessionRef.current && entry.sessionId === selectedSessionRef.current) {
            setSessionTimeline((prev) => {
              const idx = prev.findIndex((it) => it.kind === "log" && it.log.id === entry.id);
              const next: TimelineEntry = { kind: "log", at: entry.timestamp, log: entry };
              if (idx >= 0) {
                const copy = prev.slice();
                copy[idx] = next;
                return copy;
              }
              return kind === "create" ? [next, ...prev].slice(0, MAX_BUFFER) : prev;
            });
          }
          setGlobalLogs((prev) => {
            const idx = prev.findIndex((l) => l.id === entry.id);
            if (idx >= 0) {
              const copy = prev.slice();
              copy[idx] = entry;
              return copy;
            }
            return kind === "create" ? [entry, ...prev].slice(0, MAX_BUFFER) : prev;
          });
          setSelectedDetail((cur) =>
            cur && cur.kind === "log" && cur.entry.id === entry.id
              ? { kind: "log", entry }
              : cur,
          );
        }
        if (parsed.type === "remote" && parsed.data) {
          const evt = parsed.data as { kind?: string; data?: unknown };
          if (evt.kind === "thread" && evt.data) {
            const thread = evt.data as RemoteThread;
            setRemoteThreads((prev) => {
              const idx = prev.findIndex((t) => t.id === thread.id);
              if (idx >= 0) {
                const copy = prev.slice();
                copy[idx] = thread;
                return copy.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
              }
              return [thread, ...prev].slice(0, MAX_BUFFER);
            });
          } else if (evt.kind === "message" && evt.data) {
            const message = evt.data as RemoteMessage;
            setRemoteMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === message.id);
              if (idx >= 0) {
                const copy = prev.slice();
                copy[idx] = message;
                return copy.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
              }
              return [...prev, message]
                .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1))
                .slice(-MAX_BUFFER);
            });
          } else if (evt.kind === "instance") {
            void refreshRemote();
          }
        }
      } catch {
        // ignore
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [refreshSessions]);

  const handleToggleCaffeinate = async (active: boolean) => {
    try {
      const next = await setCaffeinate(active);
      setCaffeinateState(next);
    } catch (e) {
      alert("切换防睡眠失败：" + String(e));
    }
  };

  const handleClear = async () => {
    if (!confirm("清空所有记录？")) return;
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

  const rawTimeline = useMemo<TimelineEntry[]>(
    () => (selectedSession ? sessionTimeline : globalTimeline),
    [selectedSession, sessionTimeline, globalTimeline],
  );

  const visibleTimeline = useMemo(
    () => filter.filterTimeline(rawTimeline),
    [filter, rawTimeline],
  );
  const agentOptions = useMemo(
    () => filter.extractAgentOptions(rawTimeline),
    [filter, rawTimeline],
  );

  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const map = new Map<string, SessionGroup>();
    for (const s of sessions) {
      const key = s.cwd ?? UNKNOWN_GROUP_KEY;
      const existing = map.get(key);
      if (existing) {
        existing.sessions.push(s);
        if (s.lastEventAt > existing.lastEventAt) existing.lastEventAt = s.lastEventAt;
      } else {
        map.set(key, {
          key,
          cwd: s.cwd,
          remark: s.remark,
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

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return {
    events,
    globalLogs,
    sessions,
    selectedSession,
    setSelectedSession,
    sessionTimeline,
    sseStatus,
    selectedDetail,
    setSelectedDetail,
    collapsedGroups,
    analyticsSessionId,
    setAnalyticsSessionId,
    caffeinate,
    handleToggleCaffeinate,
    filter,
    globalTimeline,
    rawTimeline,
    visibleTimeline,
    agentOptions,
    sessionGroups,
    toggleGroup,
    handleClear,
    refreshSessions: refreshSessionsNow,
    refreshRemote,
    remoteThreads,
    remoteMessages,
    remoteInstances,
  };
}
