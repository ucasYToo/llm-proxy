import { useMemo, useState } from "react";
import type { RemoteThread, SessionSummary } from "../../../lib/api";
import type { SessionGroup } from "../types";
import { basename, shortSession, formatTime } from "../utils";
import styles from "../index.module.css";

const REMOTE_STATUS_LABELS: Record<RemoteThread["status"], string> = {
  pending: "待启动",
  queued: "排队",
  running: "运行中",
  waiting_permission: "待审批",
  done: "完成",
  failed: "失败",
};

const REMOTE_STATUS_WEIGHT: Record<RemoteThread["status"], number> = {
  waiting_permission: 50,
  running: 40,
  queued: 30,
  pending: 20,
  failed: 10,
  done: 0,
};

const remoteTime = (thread: RemoteThread): number => {
  const value = thread.lastMessageAt ?? thread.updatedAt ?? thread.createdAt;
  return Number.isNaN(Date.parse(value)) ? 0 : Date.parse(value);
};

const compareRemotePriority = (a: RemoteThread, b: RemoteThread): number => {
  const weight = REMOTE_STATUS_WEIGHT[b.status] - REMOTE_STATUS_WEIGHT[a.status];
  return weight || remoteTime(b) - remoteTime(a);
};

const compareRemoteRecency = (a: RemoteThread, b: RemoteThread): number =>
  remoteTime(b) - remoteTime(a);

const remoteThreadLabel = (thread: RemoteThread): string =>
  thread.title || basename(thread.cwd) || (thread.source === "feishu" ? "飞书远程" : "Web 远程");

const remoteThreadTooltip = (thread: RemoteThread): string =>
  `#${thread.shortId} · ${REMOTE_STATUS_LABELS[thread.status]}\n${thread.title || thread.cwd || thread.id}`;

interface Props {
  sessionGroups: SessionGroup[];
  sessions: SessionSummary[];
  selectedSession: string | null;
  collapsedGroups: Set<string>;
  eventCount: number;
  remoteThreads?: RemoteThread[];
  onSelectSession: (id: string | null) => void;
  onToggleGroup: (key: string) => void;
  onSaveRemark?: (cwd: string, remark: string) => Promise<void> | void;
}

const SessionList = ({
  sessionGroups,
  sessions,
  selectedSession,
  collapsedGroups,
  eventCount,
  remoteThreads = [],
  onSelectSession,
  onToggleGroup,
  onSaveRemark,
}: Props) => {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const sortedRemoteThreads = useMemo(
    () => [...remoteThreads].sort(compareRemoteRecency),
    [remoteThreads],
  );
  const recentRemoteThreads = sortedRemoteThreads.slice(0, 4);
  const activeRemoteCount = remoteThreads.filter(
    (thread) => thread.status !== "done" && thread.status !== "failed",
  ).length;
  const remoteBySessionId = useMemo(() => {
    const map = new Map<string, RemoteThread>();
    for (const thread of [...remoteThreads].sort(compareRemotePriority)) {
      if (thread.claudeSessionId && !map.has(thread.claudeSessionId)) {
        map.set(thread.claudeSessionId, thread);
      }
    }
    return map;
  }, [remoteThreads]);
  const remoteByGroupKey = useMemo(() => {
    const map = new Map<string, RemoteThread>();
    for (const group of sessionGroups) {
      const sessionIds = new Set(group.sessions.map((s) => s.sessionId));
      const best = remoteThreads
        .filter(
          (thread) =>
            (!!thread.cwd && !!group.cwd && thread.cwd === group.cwd) ||
            (!!thread.claudeSessionId && sessionIds.has(thread.claudeSessionId)),
        )
        .sort(compareRemotePriority)[0];
      if (best) map.set(group.key, best);
    }
    return map;
  }, [remoteThreads, sessionGroups]);

  const startEdit = (group: SessionGroup) => {
    setEditingKey(group.key);
    setEditingValue(group.remark ?? "");
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditingValue("");
  };

  const submitEdit = async (cwd: string) => {
    if (!onSaveRemark) return cancelEdit();
    await onSaveRemark(cwd, editingValue.trim());
    cancelEdit();
  };

  return (
    <aside className={styles.sessionList}>
      <div className={styles.sessionListHeader}>
        <span>全部 Session</span>
        {remoteThreads.length > 0 && (
          <span className={styles.sessionListHeaderBadge}>
            {activeRemoteCount > 0 ? `${activeRemoteCount} 远程中` : `${remoteThreads.length} 远程`}
          </span>
        )}
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
          const displayLabel = group.remark || group.cwd;
          const isEditing = editingKey === group.key;
          const groupRemote = remoteByGroupKey.get(group.key);
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
                <span className={styles.sessionGroupTitle}>
                  {group.remark || group.folder}
                </span>
                {groupRemote && (
                  <span
                    className={`${styles.remoteInlineBadge} ${styles[`remoteStatus_${groupRemote.status}`] ?? ""}`}
                    title={remoteThreadTooltip(groupRemote)}
                  >
                    远程 {REMOTE_STATUS_LABELS[groupRemote.status]}
                  </span>
                )}
                <span className={styles.sessionGroupCount}>{group.sessions.length}</span>
              </button>
              {!collapsed && displayLabel && (
                <div className={styles.sessionGroupCwd} title={group.cwd ?? undefined}>
                  {isEditing ? (
                    <span className={styles.sessionGroupRemarkEdit}>
                      <input
                        type="text"
                        autoFocus
                        value={editingValue}
                        placeholder={group.cwd ?? ""}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (group.cwd) submitEdit(group.cwd);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                        className={styles.sessionGroupRemarkInput}
                      />
                      <button
                        type="button"
                        className={styles.sessionGroupRemarkBtn}
                        onClick={() => group.cwd && submitEdit(group.cwd)}
                        title="保存（Enter）"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className={styles.sessionGroupRemarkBtn}
                        onClick={cancelEdit}
                        title="取消（Esc）"
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <>
                      <span className={styles.sessionGroupRemarkText}>{displayLabel}</span>
                      {onSaveRemark && group.cwd && (
                        <button
                          type="button"
                          className={styles.sessionGroupRemarkBtn}
                          onClick={() => startEdit(group)}
                          title={group.remark ? "编辑备注" : "添加备注"}
                        >
                          ✎
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {!collapsed && (
                <div className={styles.sessionGroupBody}>
                  {group.sessions.map((s) => {
                    const hasTitle = !!s.title;
                    const displayTitle = s.title ?? shortSession(s.sessionId);
                    const tooltip = hasTitle
                      ? `${s.title}\n${s.sessionId}`
                      : s.sessionId;
                    const sessionRemote = remoteBySessionId.get(s.sessionId);
                    return (
                      <button
                        key={s.sessionId}
                        className={`${styles.sessionItem} ${styles.sessionItemNested}${selectedSession === s.sessionId ? ` ${styles.sessionItemActive}` : ""}`}
                        onClick={() => onSelectSession(s.sessionId)}
                        title={tooltip}
                      >
                        <div className={styles.sessionItemNestedTop}>
                          <span className={styles.sessionItemTitleText}>{displayTitle}</span>
                          {sessionRemote && (
                            <span
                              className={`${styles.remoteInlineBadge} ${styles.remoteInlineBadgeCompact} ${styles[`remoteStatus_${sessionRemote.status}`] ?? ""}`}
                              title={remoteThreadTooltip(sessionRemote)}
                            >
                              #{sessionRemote.shortId} {REMOTE_STATUS_LABELS[sessionRemote.status]}
                            </span>
                          )}
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
      {recentRemoteThreads.length > 0 && (
        <div className={styles.remoteMiniPanel}>
          <div className={styles.remoteMiniHeader}>
            <span>远程对话</span>
            <span>{activeRemoteCount > 0 ? `${activeRemoteCount} 进行中` : `${remoteThreads.length} 条`}</span>
          </div>
          {recentRemoteThreads.map((thread) => (
            <div key={thread.id} className={styles.remoteMiniItem} title={remoteThreadTooltip(thread)}>
              <span className={styles.remoteThreadId}>#{thread.shortId}</span>
              <span className={`${styles.remoteMiniStatus} ${styles[`remoteStatus_${thread.status}`] ?? ""}`}>
                {REMOTE_STATUS_LABELS[thread.status]}
              </span>
              <span className={styles.remoteMiniTitle}>{remoteThreadLabel(thread)}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
};

export default SessionList;
