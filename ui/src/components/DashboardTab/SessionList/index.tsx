import type { SessionSummary } from "../../../lib/api";
import type { SessionGroup } from "../types";
import { basename, shortSession, formatTime } from "../utils";
import styles from "../index.module.css";

interface Props {
  sessionGroups: SessionGroup[];
  sessions: SessionSummary[];
  selectedSession: string | null;
  collapsedGroups: Set<string>;
  eventCount: number;
  onSelectSession: (id: string | null) => void;
  onToggleGroup: (key: string) => void;
}

const SessionList = ({
  sessionGroups,
  sessions,
  selectedSession,
  collapsedGroups,
  eventCount,
  onSelectSession,
  onToggleGroup,
}: Props) => (
  <aside className={styles.sessionList}>
    <div className={styles.sessionListHeader}>
      <span>全部 Session</span>
    </div>
    <button
      className={`${styles.sessionItem}${!selectedSession ? ` ${styles.sessionItemActive}` : ""}`}
      onClick={() => onSelectSession(null)}
    >
      <div className={styles.sessionItemTitle}>全部</div>
      <div className={styles.sessionItemMeta}>{eventCount} 条最近事件</div>
    </button>
    {sessionGroups.length === 0 ? (
      <div className={styles.emptyHint}>暂无活跃 session</div>
    ) : (
      sessionGroups.map((group) => {
        const collapsed = collapsedGroups.has(group.key);
        return (
          <div key={group.key} className={styles.sessionGroup}>
            <button
              type="button"
              className={styles.sessionGroupHeader}
              onClick={() => onToggleGroup(group.key)}
              title={group.cwd ?? group.folder}
            >
              <span className={styles.sessionGroupCaret}>
                {collapsed ? "▶" : "▼"}
              </span>
              <span className={styles.sessionGroupTitle}>{group.folder}</span>
              <span className={styles.sessionGroupCount}>{group.sessions.length}</span>
            </button>
            {!collapsed && group.cwd && (
              <div className={styles.sessionGroupCwd}>{group.cwd}</div>
            )}
            {!collapsed && (
              <div className={styles.sessionGroupBody}>
                {group.sessions.map((s) => {
                  const hasTitle = !!s.title;
                  const displayTitle = s.title ?? shortSession(s.sessionId);
                  const tooltip = hasTitle
                    ? `${s.title}\n${s.sessionId}`
                    : s.sessionId;
                  return (
                    <button
                      key={s.sessionId}
                      className={`${styles.sessionItem} ${styles.sessionItemNested}${selectedSession === s.sessionId ? ` ${styles.sessionItemActive}` : ""}`}
                      onClick={() => onSelectSession(s.sessionId)}
                      title={tooltip}
                    >
                      <div className={styles.sessionItemNestedTop}>
                        <span className={styles.sessionItemTitleText}>{displayTitle}</span>
                      </div>
                      <div className={styles.sessionItemMeta}>
                        {s.eventCount} 事件 · {s.lastEventName || "—"} · {formatTime(s.lastEventAt)}
                        {hasTitle && (
                          <span className={styles.sessionItemSidInline}>
                            {" · "}{shortSession(s.sessionId)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })
    )}
  </aside>
);

export default SessionList;
