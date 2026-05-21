import type { HookEntry, LogEntry, SessionSummary, TimelineEntry } from "../../../lib/api";
import type { EventTypeFilter, FilterPreset, SelectedDetail } from "../types";
import { basename, cwdFromEntry, formatTime, shortSession } from "../utils";
import { formatTTFT, formatTPS } from "../../../lib/format";
import EventFilterBar from "../EventFilterBar";
import styles from "../index.module.css";

interface Props {
  selectedSession: string | null;
  sessions: SessionSummary[];
  timeline: TimelineEntry[];
  filterPreset: FilterPreset;
  enabledTypes: Set<EventTypeFilter>;
  filterSearch: string;
  selectedDetail: SelectedDetail | null;
  onSelectDetail: (d: SelectedDetail | null) => void;
  onSetPreset: (p: "compact" | "all") => void;
  onToggleType: (t: EventTypeFilter) => void;
  onSearchChange: (s: string) => void;
}

const EventStream = ({
  selectedSession,
  sessions,
  timeline,
  filterPreset,
  enabledTypes,
  filterSearch,
  selectedDetail,
  onSelectDetail,
  onSetPreset,
  onToggleType,
  onSearchChange,
}: Props) => {
  const headerTitle = selectedSession
    ? `${basename(sessions.find((s) => s.sessionId === selectedSession)?.cwd) || shortSession(selectedSession)} 时间轴`
    : "全局事件流（实时）";

  return (
    <section className={styles.eventStream}>
      <div className={styles.eventStreamHeader}>
        <span>{headerTitle}</span>
        <span className={styles.eventStreamCount}>{timeline.length} 条</span>
      </div>

      <EventFilterBar
        preset={filterPreset}
        enabledTypes={enabledTypes}
        search={filterSearch}
        onSetPreset={onSetPreset}
        onToggleType={onToggleType}
        onSearchChange={onSearchChange}
      />

      {timeline.length === 0 ? (
        <div className={styles.emptyHint}>
          暂无事件。在终端运行 <code>claude-llm-proxy hook install</code> 把 hook 注册到 Claude Code。
        </div>
      ) : (
        <ul className={styles.eventList}>
          {timeline.map((item) => {
            if (item.kind === "hook") {
              return (
                <HookRow
                  key={`h-${item.hook.id}`}
                  entry={item.hook}
                  isActive={selectedDetail?.kind === "hook" && selectedDetail.entry.id === item.hook.id}
                  onClick={() => onSelectDetail({ kind: "hook", entry: item.hook })}
                />
              );
            }
            return (
              <LogRow
                key={`l-${item.log.id}`}
                entry={item.log}
                isActive={selectedDetail?.kind === "log" && selectedDetail.entry.id === item.log.id}
                onClick={() => onSelectDetail({ kind: "log", entry: item.log })}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
};

export const HookRow = ({
  entry,
  isActive,
  onClick,
}: {
  entry: HookEntry;
  isActive: boolean;
  onClick: () => void;
}) => {
  const folder = basename(cwdFromEntry(entry));
  return (
    <li
      className={`${styles.eventItem}${isActive ? ` ${styles.eventItemActive}` : ""}`}
      onClick={onClick}
    >
      <span className={styles.eventTime}>{formatTime(entry.createdAt)}</span>
      <span className={styles.eventKind} title="hook">◎</span>
      <span className={styles.eventNameTool}>
        <span className={styles.eventName}>{entry.eventName}</span>
        {entry.toolName && <span className={styles.eventTool}>{entry.toolName}</span>}
      </span>
      {folder && <span className={styles.eventCwd}>{folder}</span>}
      <span className={styles.eventSession}>{shortSession(entry.sessionId)}</span>
    </li>
  );
};

export const LogRow = ({
  entry,
  isActive,
  onClick,
}: {
  entry: LogEntry;
  isActive: boolean;
  onClick: () => void;
}) => {
  const statusClass =
    entry.responseStatus >= 500
      ? styles.logStatusErr
      : entry.responseStatus >= 400
        ? styles.logStatusWarn
        : entry.responseStatus > 0
          ? styles.logStatusOk
          : styles.logStatusPending;
  return (
    <li
      className={`${styles.eventItem} ${styles.eventItemLog}${isActive ? ` ${styles.eventItemActive}` : ""}`}
      onClick={onClick}
    >
      <span className={styles.eventTime}>{formatTime(entry.timestamp)}</span>
      <span className={styles.eventKind} title="api log">→</span>
      <span className={styles.eventNameTool}>
        <span className={styles.eventName}>
          {entry.method} {entry.path}
        </span>
        <span className={styles.eventTool}>{entry.targetName}</span>
      </span>
      <span className={`${styles.logStatus} ${statusClass}`}>
        {entry.responseStatus || (entry.status ?? "—")}
      </span>
      <span className={styles.logMeta}>
        {entry.durationMs > 0 && <span>{entry.durationMs}ms</span>}
        <span title="首包延迟">{formatTTFT(entry.firstChunkMs)}</span>
        <span title="tokens/sec (decode)">
          {formatTPS(entry.tokenUsage?.outputTokens, entry.durationMs, entry.firstChunkMs)}
        </span>
      </span>
      <span className={styles.eventSession}>{shortSession(entry.sessionId)}</span>
    </li>
  );
};

export default EventStream;
