import type { EventTypeFilter, FilterPreset } from "../types";
import { ALL_EVENT_TYPES, EVENT_TYPE_LABELS } from "../types";
import styles from "../index.module.css";

interface Props {
  preset: FilterPreset;
  enabledTypes: Set<EventTypeFilter>;
  search: string;
  onSetPreset: (p: "compact" | "all") => void;
  onToggleType: (t: EventTypeFilter) => void;
  onSearchChange: (s: string) => void;
}

const EventFilterBar = ({
  preset,
  enabledTypes,
  search,
  onSetPreset,
  onToggleType,
  onSearchChange,
}: Props) => (
  <div className={styles.filterBar}>
    <div className={styles.filterPresets}>
      <button
        type="button"
        className={`${styles.presetBtn}${preset === "compact" ? ` ${styles.presetBtnActive}` : ""}`}
        onClick={() => onSetPreset("compact")}
        title="只看关键事件：任务完成、子代理完成、通知、API 日志"
      >
        精简
      </button>
      <button
        type="button"
        className={`${styles.presetBtn}${preset === "all" ? ` ${styles.presetBtnActive}` : ""}`}
        onClick={() => onSetPreset("all")}
      >
        全部
      </button>
    </div>
    <div className={styles.filterChips}>
      {ALL_EVENT_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className={`${styles.filterChip}${enabledTypes.has(type) ? ` ${styles.filterChipActive}` : ""}`}
          onClick={() => onToggleType(type)}
          title={EVENT_TYPE_LABELS[type]}
        >
          {type}
        </button>
      ))}
    </div>
    <input
      type="text"
      className={styles.filterSearch}
      placeholder="搜索…"
      value={search}
      onChange={(e) => onSearchChange(e.target.value)}
    />
  </div>
);

export default EventFilterBar;
