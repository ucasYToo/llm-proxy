import styles from "./index.module.css";

export const PROJECT_CARD_LIMIT = 4;
export interface ProjectOverviewRow {
  key: string;
  name: string;
  cwd: string | null;
  title?: string | null;
  event?: string | null;
  lastEventAt: string;
  sessions: number;
  events: number;
  open: () => void;
  startRemote?: () => void;
}

function relativeTime(timestamp: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(timestamp)) / 60000),
  );
  if (!Number.isFinite(minutes)) return "—";
  if (!minutes) return "刚刚";
  if (minutes < 60) return minutes + " 分钟前";
  if (minutes < 1440) return Math.floor(minutes / 60) + " 小时前";
  return Math.floor(minutes / 1440) + " 天前";
}

export function ProjectOverviewList({ rows }: { rows: ProjectOverviewRow[] }) {
  if (!rows.length) return null;
  return (
    <ul className={styles.list}>
      {rows.map((row) => (
        <li key={row.key}>
          <button type="button" className={styles.row} onClick={row.open}>
            <span title={row.cwd ?? row.name}>
              <strong>{row.name}</strong>
              <small>{row.cwd}</small>
            </span>
            <span title={row.title ?? undefined}>
              {row.title}
              <small>{row.event}</small>
            </span>
            <small>
              {row.sessions} 会话 · {row.events} 条
            </small>
            <time dateTime={row.lastEventAt}>
              {relativeTime(row.lastEventAt)}
            </time>
          </button>
          {row.startRemote && (
            <button className="btnGhost btnSm" onClick={row.startRemote}>
              新建远程对话
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
