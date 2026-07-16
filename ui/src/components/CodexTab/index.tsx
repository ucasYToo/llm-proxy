import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CodexOverview,
  CodexSessionSummary,
  CodexStatus,
  CodexTimelineEntry,
  CodexTraceEventDetail,
  CodexTraceEventSummary,
  Config,
  HookEntry,
} from "../../lib/api";
import {
  clearCodexDataApi,
  fetchCaffeinate,
  fetchCodexGlobalTimeline,
  fetchCodexOverview,
  fetchCodexSessions,
  fetchCodexStatus,
  fetchCodexTimeline,
  fetchCodexTraceEventDetail,
  installCodexHooksApi,
  setCaffeinate,
  startCodexTraceCaptureApi,
  stopCodexTraceCaptureApi,
} from "../../lib/api";
import { CodexLogo } from "../CodexLogo";
import DingTalkPanel from "../DashboardTab/DingTalkPanel";
import FeishuPanel from "../DashboardTab/FeishuPanel";
import { useNotifications } from "../DashboardTab/useNotifications";
import { HookDetailPanel } from "../HookDetailPanel";
import { JsonViewer } from "../JsonViewer";
import styles from "./index.module.css";

type KindFilter = "all" | "conversation" | "model" | "tool";

interface CodexProjectGroup {
  key: string;
  cwd: string | null;
  folder: string;
  sessions: CodexSessionSummary[];
  events: CodexTimelineEntry[];
  lastEventAt: string;
}

interface Props {
  config: Config;
  onRefresh: () => void;
}

const EMPTY_OVERVIEW: CodexOverview = {
  sessionCount: 0,
  hookCount: 0,
  promptCount: 0,
  replyCount: 0,
  traceBundleCount: 0,
};

const UNKNOWN_PROJECT = "__codex_unknown_project__";
const CONVERSATION_EVENTS = new Set(["UserPromptSubmit", "Stop"]);
const TOOL_EVENTS = new Set(["PreToolUse", "PermissionRequest", "PostToolUse"]);

const shortId = (value: string | null): string => {
  if (!value) return "—";
  return value.length > 15 ? `${value.slice(0, 6)}…${value.slice(-5)}` : value;
};

const basename = (value: string | null): string => {
  if (!value) return "";
  return value.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
};

const formatTime = (value: string): string =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const formatBytes = (value: number): string => {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
};

const compactText = (value: unknown, max = 160): string => {
  let text = "";
  if (typeof value === "string") text = value;
  else if (value !== null && value !== undefined) {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const eventSummary = (hook: HookEntry): string => {
  const payload = hook.payload as Record<string, unknown> | null;
  if (hook.eventName === "UserPromptSubmit") return compactText(payload?.prompt);
  if (hook.eventName === "Stop") return compactText(payload?.last_assistant_message);
  if (hook.toolName) return compactText(payload?.tool_input ?? payload?.tool_response) || hook.toolName;
  for (const key of ["message", "source", "reason", "model"]) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim()) return compactText(value);
  }
  return hook.cwd ?? "Codex lifecycle event";
};

const entrySessionId = (entry: CodexTimelineEntry): string | null =>
  entry.kind === "hook" ? entry.hook.sessionId : entry.sessionId;

const entryName = (entry: CodexTimelineEntry): string =>
  entry.kind === "hook" ? entry.hook.eventName : entry.eventType;

const entrySummary = (entry: CodexTimelineEntry): string =>
  entry.kind === "hook" ? eventSummary(entry.hook) : entry.summary;

const entryBadge = (entry: CodexTimelineEntry): string | null => {
  if (entry.kind === "hook") return entry.hook.toolName;
  return entry.model ?? (entry.hasPayload ? "payload" : null);
};

const entryKind = (entry: CodexTimelineEntry): { label: string; className: string } => {
  if (entry.kind === "trace") {
    if (entry.category === "model") return { label: "M", className: styles.modelKind };
    if (entry.category === "tool") return { label: "T", className: styles.toolKind };
    return { label: "R", className: styles.traceKind };
  }
  if (entry.hook.eventName === "UserPromptSubmit") return { label: "U", className: styles.promptKind };
  if (entry.hook.eventName === "Stop") return { label: "A", className: styles.replyKind };
  if (TOOL_EVENTS.has(entry.hook.eventName)) return { label: "T", className: styles.toolKind };
  return { label: "◎", className: styles.hookKind };
};

const isSelectedEntry = (
  entry: CodexTimelineEntry,
  hookDetail: HookEntry | null,
  traceSelection: CodexTraceEventSummary | null,
): boolean => entry.kind === "hook"
  ? hookDetail?.id === entry.hook.id
  : traceSelection?.id === entry.id;

export default function CodexTab({ config, onRefresh }: Props) {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [overview, setOverview] = useState<CodexOverview>(EMPTY_OVERVIEW);
  const [sessions, setSessions] = useState<CodexSessionSummary[]>([]);
  const [globalTimeline, setGlobalTimeline] = useState<CodexTimelineEntry[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionTimeline, setSessionTimeline] = useState<CodexTimelineEntry[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [hookDetail, setHookDetail] = useState<HookEntry | null>(null);
  const [traceSelection, setTraceSelection] = useState<CodexTraceEventSummary | null>(null);
  const [traceDetail, setTraceDetail] = useState<CodexTraceEventDetail | null>(null);
  const [traceConfigOpen, setTraceConfigOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [captureChanging, setCaptureChanging] = useState(false);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sse, setSse] = useState<"connecting" | "live" | "offline">("connecting");
  const [caffeinate, setCaffeinateState] = useState({ supported: false, active: false });
  const selectedRef = useRef<string | null>(null);
  const notify = useNotifications({
    notifications: config.codexNotifications ?? {},
    onRefresh,
    scope: "codex",
  });

  useEffect(() => {
    selectedRef.current = selectedSession;
  }, [selectedSession]);

  const loadBase = useCallback(async () => {
    const [nextStatus, nextOverview, nextSessions, nextTimeline] = await Promise.all([
      fetchCodexStatus(),
      fetchCodexOverview(),
      fetchCodexSessions(),
      fetchCodexGlobalTimeline(),
    ]);
    setStatus(nextStatus);
    setOverview(nextOverview);
    setSessions(nextSessions.sessions);
    setGlobalTimeline(nextTimeline.entries);
  }, []);

  const loadTimeline = useCallback(async (sessionId: string) => {
    const result = await fetchCodexTimeline(sessionId);
    setSessionTimeline(result.entries);
  }, []);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      loadBase(),
      fetchCaffeinate().then(setCaffeinateState).catch(() => undefined),
    ])
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [loadBase]);

  useEffect(() => {
    if (!selectedSession) {
      setSessionTimeline([]);
      return;
    }
    void loadTimeline(selectedSession).catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [loadTimeline, selectedSession]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onopen = () => setSse("live");
    source.addEventListener("ready", () => setSse("live"));
    source.onerror = () => setSse("offline");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { type?: string };
        if (!event.type?.startsWith("codex-")) return;
        void loadBase();
        if (selectedRef.current) void loadTimeline(selectedRef.current);
      } catch {
        // Ignore unrelated or malformed dashboard events.
      }
    };
    return () => source.close();
  }, [loadBase, loadTimeline]);

  const projectGroups = useMemo<CodexProjectGroup[]>(() => {
    const sessionProject = new Map<string, string>();
    const map = new Map<string, CodexProjectGroup>();

    for (const session of sessions) {
      const key = session.cwd ?? UNKNOWN_PROJECT;
      sessionProject.set(session.sessionId, key);
      const existing = map.get(key);
      if (existing) {
        existing.sessions.push(session);
        if (session.lastEventAt > existing.lastEventAt) existing.lastEventAt = session.lastEventAt;
      } else {
        map.set(key, {
          key,
          cwd: session.cwd,
          folder: basename(session.cwd) || "未知路径",
          sessions: [session],
          events: [],
          lastEventAt: session.lastEventAt,
        });
      }
    }

    for (const entry of globalTimeline) {
      const sessionId = entrySessionId(entry);
      const hookCwd = entry.kind === "hook" ? entry.hook.cwd : null;
      const key = (sessionId ? sessionProject.get(sessionId) : null) ?? hookCwd ?? UNKNOWN_PROJECT;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          cwd: hookCwd,
          folder: basename(hookCwd) || "其他事件",
          sessions: [],
          events: [],
          lastEventAt: entry.at,
        };
        map.set(key, group);
      }
      group.events.push(entry);
      if (entry.at > group.lastEventAt) group.lastEventAt = entry.at;
    }

    return [...map.values()].sort((left, right) =>
      left.lastEventAt < right.lastEventAt ? 1 : left.lastEventAt > right.lastEventAt ? -1 : 0,
    );
  }, [globalTimeline, sessions]);

  const rawTimeline = selectedSession ? sessionTimeline : globalTimeline;
  const visibleTimeline = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rawTimeline.filter((entry) => {
      if (filter === "conversation") {
        if (entry.kind !== "hook" || !CONVERSATION_EVENTS.has(entry.hook.eventName)) return false;
      }
      if (filter === "model" && (entry.kind !== "trace" || entry.category !== "model")) return false;
      if (filter === "tool") {
        const isTool = entry.kind === "trace"
          ? entry.category === "tool"
          : TOOL_EVENTS.has(entry.hook.eventName);
        if (!isTool) return false;
      }
      if (!normalized) return true;
      return `${entryName(entry)} ${entrySummary(entry)} ${entryBadge(entry) ?? ""} ${entrySessionId(entry) ?? ""}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [filter, query, rawTimeline]);

  const selectedSummary = useMemo(
    () => sessions.find((session) => session.sessionId === selectedSession) ?? null,
    [selectedSession, sessions],
  );

  const installHooks = async () => {
    setInstalling(true);
    setError(null);
    try {
      await installCodexHooksApi();
      setStatus(await fetchCodexStatus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInstalling(false);
    }
  };

  const toggleTraceCapture = async () => {
    if (!status) return;
    setCaptureChanging(true);
    setCaptureMessage(null);
    setError(null);
    try {
      const result = status.trace.configured
        ? await stopCodexTraceCaptureApi()
        : await startCodexTraceCaptureApi();
      setStatus((current) => current ? { ...current, trace: result.trace } : current);
      setCaptureMessage(result.message);
      await loadBase();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCaptureChanging(false);
    }
  };

  const toggleCaffeinate = async (active: boolean) => {
    try {
      setCaffeinateState(await setCaffeinate(active));
    } catch (reason) {
      setError(`切换防睡眠失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const openTraceDetail = async (entry: CodexTraceEventSummary) => {
    setTraceSelection(entry);
    setTraceDetail(null);
    setDetailLoading(true);
    setError(null);
    try {
      setTraceDetail(await fetchCodexTraceEventDetail(entry.bundleId, entry.seq));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDetailLoading(false);
    }
  };

  const openEntry = (entry: CodexTimelineEntry) => {
    if (entry.kind === "hook") setHookDetail(entry.hook);
    else void openTraceDetail(entry);
  };

  const closeTraceDetail = () => {
    setTraceSelection(null);
    setTraceDetail(null);
  };

  const clearData = async () => {
    if (!confirm("确认停止原文采集并清空 Codex hooks、trace 文件和索引？Claude 日志不会受影响。")) return;
    try {
      await clearCodexDataApi();
      setSelectedSession(null);
      setSessionTimeline([]);
      setHookDetail(null);
      closeTraceDetail();
      setCaptureMessage("采集已关闭；完全退出 Codex 后，当前进程才会停止写入。trace 文件已清空。");
      await loadBase();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderEvent = (entry: CodexTimelineEntry, scoped = false) => {
    const kind = entryKind(entry);
    const sessionId = entrySessionId(entry);
    return (
      <button
        type="button"
        className={`${styles.eventItem}${isSelectedEntry(entry, hookDetail, traceSelection) ? ` ${styles.eventItemActive}` : ""}`}
        key={entry.kind === "hook" ? `hook-${entry.hook.id}` : entry.id}
        onClick={() => openEntry(entry)}
      >
        <span className={styles.eventTime}>{formatTime(entry.at)}</span>
        <span className={`${styles.eventKind} ${kind.className}`}>{kind.label}</span>
        <span className={styles.eventNameTool}>
          <span className={styles.eventName}>{entryName(entry)}</span>
          <span className={styles.eventSummary}>{entrySummary(entry)}</span>
          {entryBadge(entry) && <span className={styles.eventTool}>{entryBadge(entry)}</span>}
        </span>
        {!scoped && <span className={styles.eventSession}>{shortId(sessionId)}</span>}
      </button>
    );
  };

  return (
    <section className={styles.dashboard}>
      <div className={styles.toolbar}>
        <div className={styles.statusGroup}>
          <CodexLogo size={18} className={styles.logo} />
          <span
            className={`${styles.statusDot}${sse === "live" ? ` ${styles.statusDotOpen}` : sse === "offline" ? ` ${styles.statusDotClosed}` : ""}`}
          />
          <span className={styles.statusLabel}>
            {sse === "live" ? "实时连接" : sse === "offline" ? "已断开" : "连接中…"}
          </span>
        </div>

        <div className={styles.toggleGroup}>
          <span className={styles.toggleGroupLabel}>Hooks：</span>
          <span className={`${styles.statusDot}${status?.hooks.installed ? ` ${styles.statusDotOpen}` : ` ${styles.statusDotClosed}`}`} />
          <span className={styles.statusLabel}>{status?.hooks.installed ? "已连接" : "未安装"}</span>
          {!status?.hooks.installed && (
            <button type="button" className="btnGhost btnSm" disabled={installing} onClick={() => void installHooks()}>
              {installing ? "安装中…" : "安装 Hooks"}
            </button>
          )}
        </div>

        <div className={styles.toggleGroup}>
          <span className={styles.toggleGroupLabel}>通知：</span>
          <label
            className={styles.toggleChip}
            title={
              !!notify.dingtalk.enabled && !notify.dingtalkArmed
                ? "已启用但缺少事件勾选 / token / secret，点配置补全"
                : "Codex 钉钉群机器人通知"
            }
          >
            <input
              type="checkbox"
              checked={!!notify.dingtalk.enabled}
              onChange={(event) => void notify.handleToggleDingTalk(event.target.checked)}
            />
            钉钉
            {!!notify.dingtalk.enabled && !notify.dingtalkArmed && (
              <span className={styles.warnDot} title="未完成配置">!</span>
            )}
          </label>
          <button type="button" className="btnGhost btnSm" onClick={() => notify.setDingtalkOpen((open) => !open)}>
            {notify.dingtalkOpen ? "收起" : "配置"}
          </button>

          <label
            className={styles.toggleChip}
            title={
              !!notify.feishu.enabled && !notify.feishuArmed
                ? "已启用但缺少事件勾选 / webhook URL / secret，点配置补全"
                : "Codex 飞书群机器人通知"
            }
          >
            <input
              type="checkbox"
              checked={!!notify.feishu.enabled}
              onChange={(event) => void notify.handleToggleFeishu(event.target.checked)}
            />
            飞书
            {!!notify.feishu.enabled && !notify.feishuArmed && (
              <span className={styles.warnDot} title="未完成配置">!</span>
            )}
          </label>
          <button type="button" className="btnGhost btnSm" onClick={() => notify.setFeishuOpen((open) => !open)}>
            {notify.feishuOpen ? "收起" : "配置"}
          </button>
        </div>

        {status && (
          <div className={styles.toggleGroup}>
            <span className={styles.toggleGroupLabel}>原文：</span>
            <span className={`${styles.statusDot}${status.trace.configured ? ` ${styles.statusDotOpen}` : ` ${styles.statusDotClosed}`}`} />
            <span className={styles.statusLabel}>
              {status.trace.configured ? "采集已开启" : "默认关闭"} · {formatBytes(status.trace.usedBytes)}
            </span>
            <button type="button" className="btnGhost btnSm" onClick={() => setTraceConfigOpen((open) => !open)}>
              {traceConfigOpen ? "收起" : "配置"}
            </button>
          </div>
        )}

        {caffeinate.supported && (
          <div className={styles.toggleGroup}>
            <label className={styles.toggleChip} title="锁屏或合盖时也保持系统不睡眠">
              <input
                type="checkbox"
                checked={caffeinate.active}
                onChange={(event) => void toggleCaffeinate(event.target.checked)}
              />
              防止睡眠
            </label>
          </div>
        )}

        <div className={styles.toolbarSpacer} />
        <span className={styles.summaryLabel}>
          {overview.sessionCount} 会话 · {overview.hookCount} hooks · {overview.traceBundleCount} traces
        </span>
        {selectedSession && (
          <button type="button" className="btnGhost btnSm" onClick={() => setSelectedSession(null)}>
            ← 返回项目列表
          </button>
        )}
        <button type="button" className="btnGhost btnSm" onClick={() => void clearData()}>
          清空记录
        </button>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {notify.dingtalkOpen && (
        <DingTalkPanel
          config={notify.dingtalk}
          saving={notify.dingSaving}
          testing={notify.dingTesting}
          notificationLabel="PermissionRequest"
          onSave={notify.handleSaveDingTalk}
          onTest={notify.handleTestDingTalk}
          onChangeEvents={(next) => void notify.handleChangeDingtalkEvents(next)}
        />
      )}

      {notify.feishuOpen && (
        <FeishuPanel
          config={notify.feishu}
          saving={notify.feishuSaving}
          testing={notify.feishuTesting}
          notificationLabel="PermissionRequest"
          onSave={notify.handleSaveFeishu}
          onTest={notify.handleTestFeishu}
          onChangeEvents={(next) => void notify.handleChangeFeishuEvents(next)}
        />
      )}

      {!status?.hooks.installed && !loading && (
        <div className={styles.setupPanel}>
          <div>
            <strong>连接 Codex Hooks</strong>
            <p>只安装日志 Hooks，不修改登录或 API 地址；安装后请在 Codex CLI 运行 <code>/hooks</code> 完成一次信任。</p>
          </div>
          <button type="button" className={styles.primaryButton} disabled={installing} onClick={() => void installHooks()}>
            {installing ? "安装中…" : "安装 Hooks"}
          </button>
        </div>
      )}

      {traceConfigOpen && status && (
        <div className={styles.tracePanelConfig}>
          <div className={styles.traceConfigLead}>
            <div>
              <strong>模型请求原文</strong>
              <p>
                {status.trace.configured ? "环境开关已开启" : "默认关闭，手动开启"}
                {" · "}{formatBytes(status.trace.usedBytes)} / {formatBytes(status.trace.maxBytes)}
                {" · "}{status.trace.bundleCount} bundles
              </p>
            </div>
            <code title={status.trace.rootPath}>{status.trace.rootPath}</code>
            {captureMessage && <small>{captureMessage}</small>}
          </div>
          <div className={styles.traceConfigActions}>
            <span>切换后需完全退出并重开 Codex</span>
            <button
              type="button"
              className={status.trace.configured ? styles.stopButton : styles.primaryButton}
              disabled={captureChanging}
              onClick={() => void toggleTraceCapture()}
            >
              {captureChanging ? "处理中…" : status.trace.configured ? "结束采集" : "开启原文日志"}
            </button>
          </div>
        </div>
      )}

      {!selectedSession ? (
        <div className={styles.projectGrid}>
          {!loading && projectGroups.length === 0 ? (
            <div className={styles.emptyHint}>
              暂无活跃项目。在终端运行 <code>claude-proxy codex hook install</code> 安装 Codex Hooks。
            </div>
          ) : (
            projectGroups.map((group) => (
              <section className={styles.eventStream} key={group.key}>
                <div className={styles.eventStreamHeader}>
                  <button
                    type="button"
                    className={styles.projectCardHeaderBtn}
                    disabled={group.sessions.length === 0}
                    onClick={() => group.sessions[0] && setSelectedSession(group.sessions[0].sessionId)}
                    title={group.cwd ?? group.folder}
                  >
                    <span>{group.folder}</span>
                    <span className={styles.eventStreamCount}>
                      {group.sessions.length} session · {group.events.length} 条
                    </span>
                  </button>
                </div>
                {group.events.length === 0 ? (
                  <div className={styles.emptyHint}>暂无事件</div>
                ) : (
                  <div className={styles.eventList}>
                    {group.events.slice(0, 5).map((entry) => renderEvent(entry))}
                  </div>
                )}
              </section>
            ))
          )}
        </div>
      ) : (
        <div className={styles.layout}>
          <aside className={styles.sessionList}>
            <div className={styles.sessionListHeader}>
              <span>全部 Session</span>
              <span className={styles.sessionListHeaderBadge}>{sessions.length} 个</span>
            </div>
            <button type="button" className={styles.sessionItem} onClick={() => setSelectedSession(null)}>
              <span className={styles.sessionItemTitle}>项目总览</span>
              <span className={styles.sessionItemMeta}>{globalTimeline.length} 条最近事件</span>
            </button>
            {projectGroups.filter((group) => group.sessions.length > 0).map((group) => {
              const collapsed = collapsedGroups.has(group.key);
              return (
                <div className={styles.sessionGroup} key={group.key}>
                  <button
                    type="button"
                    className={styles.sessionGroupHeader}
                    onClick={() => toggleGroup(group.key)}
                    title={group.cwd ?? group.folder}
                  >
                    <span className={styles.sessionGroupCaret}>{collapsed ? "▶" : "▼"}</span>
                    <span className={styles.sessionGroupTitle}>{group.folder}</span>
                    <span className={styles.sessionGroupCount}>{group.sessions.length}</span>
                  </button>
                  {!collapsed && group.cwd && <div className={styles.sessionGroupCwd}>{group.cwd}</div>}
                  {!collapsed && (
                    <div className={styles.sessionGroupBody}>
                      {group.sessions.map((session) => (
                        <button
                          type="button"
                          className={`${styles.sessionItem} ${styles.sessionItemNested}${selectedSession === session.sessionId ? ` ${styles.sessionItemActive}` : ""}`}
                          key={session.sessionId}
                          onClick={() => setSelectedSession(session.sessionId)}
                          title={`${session.title ?? session.sessionId}\n${session.cwd ?? ""}`}
                        >
                          <span className={styles.sessionItemTitleText}>{session.title || shortId(session.sessionId)}</span>
                          <span className={styles.sessionItemMeta}>
                            {session.eventCount} 事件 · {session.lastEventName || "—"} · {formatTime(session.lastEventAt)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </aside>

          <section className={styles.eventStream}>
            <div className={styles.eventStreamHeader}>
              <span>{basename(selectedSummary?.cwd ?? null) || shortId(selectedSession)} 时间轴</span>
              <span className={styles.eventStreamCount}>{visibleTimeline.length} 条</span>
            </div>
            <div className={styles.filterBar}>
              <div className={styles.filterChips}>
                {(["all", "conversation", "model", "tool"] as const).map((kind) => (
                  <button
                    type="button"
                    className={`${styles.filterChip}${filter === kind ? ` ${styles.filterChipActive}` : ""}`}
                    key={kind}
                    onClick={() => setFilter(kind)}
                  >
                    {kind === "all" ? "全部" : kind === "conversation" ? "对话" : kind === "model" ? "模型原文" : "工具"}
                  </button>
                ))}
              </div>
              <input
                className={styles.filterSearch}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索消息、工具或模型"
              />
            </div>
            {visibleTimeline.length === 0 ? (
              <div className={styles.emptyHint}>这里还没有匹配的事件</div>
            ) : (
              <div className={styles.eventList}>
                {visibleTimeline.map((entry) => renderEvent(entry, true))}
              </div>
            )}
          </section>
        </div>
      )}

      <HookDetailPanel entry={hookDetail} onClose={() => setHookDetail(null)} />
      {traceSelection && (
        <div className={styles.traceBackdrop} onClick={closeTraceDetail}>
          <aside className={styles.traceDetailPanel} onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>rollout trace</span>
                <strong>{traceSelection.eventType}</strong>
              </div>
              <button type="button" className="btnGhost btnSm" onClick={closeTraceDetail}>✕</button>
            </header>
            <div className={styles.traceMeta}>
              <span>seq {traceSelection.seq}</span>
              <span>{new Date(traceSelection.at).toLocaleString()}</span>
              <span>{shortId(traceSelection.threadId)}</span>
            </div>
            <div className={styles.traceDetailBody}>
              {detailLoading && <p className={styles.empty}>正在从 Codex trace 文件读取…</p>}
              {!detailLoading && traceDetail && (
                <>
                  <p className={styles.detailTitle}>Event envelope</p>
                  <JsonViewer data={traceDetail.event} />
                  {traceDetail.payloads.map((payload, index) => (
                    <section className={styles.payloadSection} key={`${payload.path}:${index}`}>
                      <div>
                        <strong>{payload.kind}</strong>
                        <code>{payload.path}</code>
                      </div>
                      {typeof payload.content === "object"
                        ? <JsonViewer data={payload.content} />
                        : <pre>{String(payload.content)}</pre>}
                    </section>
                  ))}
                  {traceDetail.payloads.length === 0 && <p className={styles.empty}>此事件没有外部 payload</p>}
                  <footer title={traceDetail.bundlePath}>{traceDetail.bundlePath}</footer>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
