import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CodexOverview,
  CodexSessionSummary,
  CodexStatus,
  CodexTimelineEntry,
  CodexTraceEventDetail,
  CodexTraceEventSummary,
  HookEntry,
} from "../../lib/api";
import {
  clearCodexDataApi,
  fetchCodexGlobalTimeline,
  fetchCodexOverview,
  fetchCodexSessions,
  fetchCodexStatus,
  fetchCodexTimeline,
  fetchCodexTraceEventDetail,
  installCodexHooksApi,
  startCodexTraceCaptureApi,
  stopCodexTraceCaptureApi,
} from "../../lib/api";
import { CodexLogo } from "../CodexLogo";
import { HookDetailPanel } from "../HookDetailPanel";
import { JsonViewer } from "../JsonViewer";
import styles from "./index.module.css";

type KindFilter = "all" | "conversation" | "model" | "tool";

const EMPTY_OVERVIEW: CodexOverview = {
  sessionCount: 0,
  hookCount: 0,
  promptCount: 0,
  replyCount: 0,
  traceBundleCount: 0,
};

const CONVERSATION_EVENTS = new Set(["UserPromptSubmit", "Stop"]);
const TOOL_EVENTS = new Set(["PreToolUse", "PermissionRequest", "PostToolUse"]);

const shortId = (value: string | null): string => {
  if (!value) return "—";
  return value.length > 15 ? `${value.slice(0, 6)}…${value.slice(-5)}` : value;
};

const formatNumber = (value: number): string =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}m`
    : value >= 1_000
      ? `${(value / 1_000).toFixed(1)}k`
      : String(value);

const eventSummary = (hook: HookEntry): string => {
  if (hook.toolName) return hook.toolName;
  const payload = hook.payload as Record<string, unknown> | null;
  for (const key of ["last_assistant_message", "prompt", "source", "reason", "model"]) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return hook.cwd ?? "Codex lifecycle event";
};

const eventMark = (eventName: string): { label: string; className: string } => {
  if (eventName === "UserPromptSubmit") return { label: "U", className: styles.promptMark };
  if (eventName === "Stop") return { label: "A", className: styles.replyMark };
  if (TOOL_EVENTS.has(eventName)) return { label: "T", className: styles.toolMark };
  return { label: "H", className: styles.hookMark };
};

const traceMark = (entry: CodexTraceEventSummary): { label: string; className: string } => {
  if (entry.category === "model") return { label: "M", className: styles.modelMark };
  if (entry.category === "tool") return { label: "T", className: styles.toolMark };
  return { label: "R", className: styles.traceMark };
};

const formatBytes = (value: number): string => {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
};

export default function CodexTab() {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [overview, setOverview] = useState<CodexOverview>(EMPTY_OVERVIEW);
  const [sessions, setSessions] = useState<CodexSessionSummary[]>([]);
  const [globalTimeline, setGlobalTimeline] = useState<CodexTimelineEntry[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionTimeline, setSessionTimeline] = useState<CodexTimelineEntry[]>([]);
  const [hookDetail, setHookDetail] = useState<HookEntry | null>(null);
  const [traceSelection, setTraceSelection] = useState<CodexTraceEventSummary | null>(null);
  const [traceDetail, setTraceDetail] = useState<CodexTraceEventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [captureChanging, setCaptureChanging] = useState(false);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sse, setSse] = useState<"connecting" | "live" | "offline">("connecting");
  const selectedRef = useRef<string | null>(null);

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
    void loadBase()
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

  const visibleTimeline = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (selectedSession ? sessionTimeline : globalTimeline).filter((entry) => {
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
      const haystack = entry.kind === "hook"
        ? `${entry.hook.eventName} ${entry.hook.toolName ?? ""} ${eventSummary(entry.hook)} ${entry.hook.sessionId ?? ""}`
        : `${entry.eventType} ${entry.summary} ${entry.model ?? ""} ${entry.provider ?? ""} ${entry.sessionId}`;
      return haystack.toLowerCase().includes(normalized);
    });
  }, [filter, globalTimeline, query, selectedSession, sessionTimeline]);

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

  const closeTraceDetail = () => {
    setTraceSelection(null);
    setTraceDetail(null);
  };

  const clearData = async () => {
    if (!confirm("确认停止原文采集并清空 Codex hooks、trace 文件和索引？Claude 日志不会受影响。")) return;
    await clearCodexDataApi();
    setSelectedSession(null);
    setSessionTimeline([]);
    setHookDetail(null);
    closeTraceDetail();
    setCaptureMessage("采集已关闭；完全退出 Codex 后，当前进程才会停止写入。trace 文件已清空。");
    await loadBase();
  };

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroIdentity}>
          <CodexLogo size={52} className={styles.logo} />
          <div>
            <div className={styles.eyebrow}>Hooks + optional local rollout trace</div>
            <h1>Codex Dashboard</h1>
            <p>对话索引写入独立 SQLite；模型原文按路径读取 Codex 本地 trace。</p>
          </div>
        </div>
        <div className={styles.heroActions}>
          <span className={`${styles.livePill} ${styles[sse]}`}>
            <i /> {sse === "live" ? "实时连接" : sse === "connecting" ? "连接中" : "已离线"}
          </span>
          <button className={styles.secondaryButton} onClick={() => void clearData()}>
            清空数据
          </button>
        </div>
      </header>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {!status?.hooks.installed && !loading && (
        <div className={styles.setup}>
          <div className={styles.setupLead}>
            <span className={styles.setupIndex}>01</span>
            <div>
              <strong>连接 Codex Hooks</strong>
              <p>只安装日志 Hooks，不修改登录或 API 地址；桌面 App 用户需在终端启动 <code>codex</code>，再运行 <code>/hooks</code> 完成一次信任。</p>
            </div>
          </div>
          <button className={styles.primaryButton} disabled={installing} onClick={() => void installHooks()}>
            {installing ? "安装中…" : "安装 Hooks"}
          </button>
        </div>
      )}

      {status && (
        <div className={`${styles.traceControl}${status.trace.configured ? ` ${styles.traceConfigured}` : ""}`}>
          <div className={styles.traceLead}>
            <span className={styles.traceDot} />
            <div>
              <strong>模型请求原文</strong>
              <p>
                {status.trace.configured ? "环境开关已开启" : "默认关闭，手动开启"}
                {" · "}{formatBytes(status.trace.usedBytes)} / {formatBytes(status.trace.maxBytes)}
                {" · "}{status.trace.bundleCount} bundles
              </p>
              <code title={status.trace.rootPath}>{status.trace.rootPath}</code>
              {captureMessage && <small>{captureMessage}</small>}
            </div>
          </div>
          <div className={styles.traceActions}>
            <span>切换后需完全退出并重开 Codex</span>
            <button
              className={status.trace.configured ? styles.stopButton : styles.primaryButton}
              disabled={captureChanging}
              onClick={() => void toggleTraceCapture()}
            >
              {captureChanging ? "处理中…" : status.trace.configured ? "结束采集" : "开启原文日志"}
            </button>
          </div>
        </div>
      )}

      <div className={styles.metrics}>
        {[
          ["会话", overview.sessionCount, "sessions"],
          ["用户消息", overview.promptCount, "prompts"],
          ["助手回复", overview.replyCount, "final replies"],
          ["原文日志", overview.traceBundleCount, status ? formatBytes(status.trace.usedBytes) : "bundles"],
        ].map(([label, value, note]) => (
          <article className={styles.metric} key={label}>
            <span>{label}</span>
            <strong>{loading ? "—" : formatNumber(value as number)}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>

      <div className={styles.workspace}>
        <aside className={styles.sessions}>
          <div className={styles.panelHeading}>
            <div><span>Conversations</span><strong>对话索引</strong></div>
            <em>{sessions.length}</em>
          </div>
          <button
            className={`${styles.allSessions}${selectedSession === null ? ` ${styles.sessionActive}` : ""}`}
            onClick={() => setSelectedSession(null)}
          >
            <span className={styles.sessionGlyph}>∞</span>
            <span><strong>全部活动</strong><small>跨会话事件流</small></span>
          </button>
          <div className={styles.sessionList}>
            {sessions.map((session) => (
              <button
                className={`${styles.session}${selectedSession === session.sessionId ? ` ${styles.sessionActive}` : ""}`}
                key={session.sessionId}
                onClick={() => setSelectedSession(session.sessionId)}
              >
                <span className={styles.sessionTop}>
                  <strong>{session.title || shortId(session.sessionId)}</strong>
                  <time>{new Date(session.lastEventAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </span>
                <span className={styles.sessionPath} title={session.cwd ?? session.sessionId}>
                  {session.cwd ?? session.sessionId}
                </span>
                <span className={styles.sessionMeta}>
                  <i>{session.promptCount} prompts</i>
                  <i>{session.replyCount} replies</i>
                  <i>{session.eventCount} events</i>
                  {session.traceBundleCount > 0 && <i>{session.traceBundleCount} raw</i>}
                </span>
              </button>
            ))}
            {!loading && sessions.length === 0 && <p className={styles.empty}>等待第一段 Codex 对话</p>}
          </div>
        </aside>

        <main className={styles.stream}>
          <div className={styles.streamHeader}>
            <div><span>Event stream</span><strong>{selectedSession ? shortId(selectedSession) : "全部活动"}</strong></div>
            <div className={styles.controls}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索消息、工具或路径" />
              <div className={styles.segmented}>
                {(["all", "conversation", "model", "tool"] as const).map((kind) => (
                  <button className={filter === kind ? styles.filterActive : ""} key={kind} onClick={() => setFilter(kind)}>
                    {kind === "all" ? "全部" : kind === "conversation" ? "对话" : kind === "model" ? "模型原文" : "工具"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.timeline}>
            {visibleTimeline.map((entry) => {
              const mark = entry.kind === "hook" ? eventMark(entry.hook.eventName) : traceMark(entry);
              const name = entry.kind === "hook" ? entry.hook.eventName : entry.eventType;
              const summary = entry.kind === "hook" ? eventSummary(entry.hook) : entry.summary;
              const sessionId = entry.kind === "hook" ? entry.hook.sessionId : entry.sessionId;
              return (
                <button
                  className={styles.eventRow}
                  key={entry.kind === "hook" ? entry.hook.id : entry.id}
                  onClick={() => entry.kind === "hook" ? setHookDetail(entry.hook) : void openTraceDetail(entry)}
                >
                  <span className={`${styles.kindMark} ${mark.className}`}>{mark.label}</span>
                  <span className={styles.eventBody}>
                    <span className={styles.eventTitle}>
                      <strong>{name}</strong>
                      {entry.kind === "hook" && entry.hook.toolName && <code>{entry.hook.toolName}</code>}
                      {entry.kind === "trace" && entry.model && <code>{entry.model}</code>}
                      {entry.kind === "trace" && entry.hasPayload && <code>payload</code>}
                    </span>
                    <small>{summary}</small>
                  </span>
                  <span className={styles.eventAside}>
                    <time>{new Date(entry.at).toLocaleTimeString()}</time>
                    <small>{shortId(sessionId)}</small>
                  </span>
                </button>
              );
            })}
            {!loading && visibleTimeline.length === 0 && <p className={styles.empty}>这里还没有匹配的事件</p>}
          </div>
          <footer className={styles.dataFooter}>
            <span>Database</span>
            <code title={status?.databasePath}>{status?.databasePath ?? "~/.claude-proxy/codex-logs.db"}</code>
            <em>{status?.trace.configured ? "raw trace configured" : status?.hooks.installed ? "hooks connected" : "login unchanged"}</em>
          </footer>
        </main>
      </div>

      <HookDetailPanel entry={hookDetail} onClose={() => setHookDetail(null)} />
      {traceSelection && (
        <div className={styles.traceBackdrop} onClick={closeTraceDetail}>
          <aside className={styles.tracePanel} onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>rollout trace</span>
                <strong>{traceSelection.eventType}</strong>
              </div>
              <button className={styles.secondaryButton} onClick={closeTraceDetail}>✕</button>
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
