import type { SessionSummary, TimelineEntry } from "../../../lib/api";
import type { SelectedDetail } from "../types";
import { HookRow, LogRow } from "../EventStream";
import styles from "../index.module.css";

interface Props {
  folder: string;
  cwd: string | null;
  sessions: SessionSummary[];
  events: TimelineEntry[];
  selectedDetail: SelectedDetail | null;
  onSelectDetail: (d: SelectedDetail | null) => void;
  onEnterProject: () => void;
  onNewRemoteThread?: () => void;
}

const ProjectCard = ({
  folder,
  cwd,
  sessions,
  events,
  selectedDetail,
  onSelectDetail,
  onEnterProject,
  onNewRemoteThread,
}: Props) => {
  const recentEvents = events.slice(0, 5);

  return (
    <section className={styles.eventStream}>
      <div className={styles.eventStreamHeader}>
        <button
          type="button"
          className={styles.projectCardHeaderBtn}
          onClick={onEnterProject}
          title={cwd ?? folder}
        >
          <span>{folder}</span>
          <span className={styles.eventStreamCount}>
            {sessions.length} session · {events.length} 条
          </span>
        </button>
        {cwd && onNewRemoteThread && (
          <button
            type="button"
            className={styles.projectRemoteAction}
            onClick={onNewRemoteThread}
            title="在这个项目中新建远程 Claude Code 对话"
            aria-label="新建远程对话"
          >
            <span aria-hidden="true">+</span>
            <span>远程</span>
          </button>
        )}
      </div>

      {recentEvents.length === 0 ? (
        <div className={styles.emptyHint}>暂无事件</div>
      ) : (
        <ul className={styles.eventList}>
          {recentEvents.map((item) => {
            if (item.kind === "hook") {
              return (
                <HookRow
                  key={`h-${item.hook.id}`}
                  entry={item.hook}
                  isActive={
                    selectedDetail?.kind === "hook" &&
                    selectedDetail.entry.id === item.hook.id
                  }
                  onClick={() => onSelectDetail({ kind: "hook", entry: item.hook })}
                />
              );
            }
            return (
              <LogRow
                key={`l-${item.log.id}`}
                entry={item.log}
                isActive={
                  selectedDetail?.kind === "log" &&
                  selectedDetail.entry.id === item.log.id
                }
                onClick={() => onSelectDetail({ kind: "log", entry: item.log })}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default ProjectCard;
