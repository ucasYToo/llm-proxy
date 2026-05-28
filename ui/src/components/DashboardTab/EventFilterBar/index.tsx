import { useRef, useState } from "react";
import type { EventTypeFilter, FilterPreset } from "../types";
import { ALL_EVENT_TYPES, EVENT_TYPE_LABELS } from "../types";
import styles from "../index.module.css";

interface Props {
  preset: FilterPreset;
  enabledTypes: Set<EventTypeFilter>;
  search: string;
  compact?: boolean;
  onSetPreset: (p: "compact" | "all") => void;
  onToggleType: (t: EventTypeFilter) => void;
  onSearchChange: (s: string) => void;
}

const FILTER_ICONS: Record<EventTypeFilter, { path: string; vb?: string }> = {
  PreToolUse:         { path: "M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM6.5 1v1.5M6.5 11v1.5M1 6.5h1.5M11 6.5h1.5M2.7 2.7l1 1M9.3 9.3l1 1M2.7 10.3l1-1M9.3 3.7l1-1", vb: "0 0 13 13" },
  PostToolUse:        { path: "M7 .5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm3 5-3.5 4L4.5 7.5", vb: "0 0 14 14" },
  PostToolUseFailure: { path: "M7 .5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5 5l4 4M9 5 5 9", vb: "0 0 14 14" },
  StopFailure:        { path: "M7 1 .5 12.5h13ZM7 5v3.5M7 10.5v.5", vb: "0 0 14 14" },
  PermissionDenied:   { path: "M10 5V3.5a3 3 0 0 0-6 0V5M3 5h8a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z", vb: "0 0 14 14" },
  Stop:               { path: "M3 1.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 11V3A1.5 1.5 0 0 1 3 1.5Z", vb: "0 0 14 14" },
  UserPromptSubmit:   { path: "M2 1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 3V2a1 1 0 0 1 1-1Z", vb: "0 0 14 14" },
  SubagentStart:      { path: "M4 1.5v11l8-5.5Z", vb: "0 0 14 14" },
  SubagentStop:       { path: "M7 .5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5 5h4v4H5Z", vb: "0 0 14 14" },
  Notification:       { path: "M7 .5a4.5 4.5 0 0 0-4.5 4.5c0 2.5-1.5 4-1.5 4h12s-1.5-1.5-1.5-4A4.5 4.5 0 0 0 7 .5ZM5.5 10.5a1.5 1.5 0 0 0 3 0", vb: "0 0 14 14" },
  SessionEnd:         { path: "M5 1v12M9 4l3 3-3 3M12 7H5", vb: "0 0 14 14" },
  apiLog:             { path: "M2 7h10M8 3l4 4-4 4", vb: "0 0 14 14" },
};

const FilterIcon = ({ type, active }: { type: EventTypeFilter; active: boolean }) => {
  const icon = FILTER_ICONS[type];
  return (
    <svg
      width="14" height="14"
      viewBox={icon.vb ?? "0 0 14 14"}
      fill="none"
      stroke={active ? "var(--accent)" : "var(--text-muted)"}
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={icon.path} />
    </svg>
  );
};

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-muted)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="4.5" />
    <path d="M9.5 9.5 13 13" />
  </svg>
);

const CompactSearch = ({ search, onSearchChange }: { search: string; onSearchChange: (s: string) => void }) => {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!expanded && !search) {
    return (
      <button
        type="button"
        className={`${styles.filterChip} ${styles.filterChipIcon}`}
        title="搜索"
        onClick={() => { setExpanded(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
      >
        <SearchIcon />
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      className={`${styles.filterSearch} ${styles.filterSearchCompact}`}
      placeholder="搜索…"
      value={search}
      autoFocus={expanded}
      onChange={(e) => onSearchChange(e.target.value)}
      onBlur={() => { if (!search) setExpanded(false); }}
    />
  );
};

const EventFilterBar = ({
  preset,
  enabledTypes,
  search,
  compact = false,
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
        {preset === "all" && enabledTypes.size === ALL_EVENT_TYPES.length ? "全不选" : "全部"}
      </button>
    </div>
    <div className={styles.filterChips}>
      {ALL_EVENT_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className={`${styles.filterChip}${enabledTypes.has(type) ? ` ${styles.filterChipActive}` : ""}${compact ? ` ${styles.filterChipIcon}` : ""}`}
          onClick={() => onToggleType(type)}
          title={`${EVENT_TYPE_LABELS[type]} (${type})`}
        >
          {compact ? <FilterIcon type={type} active={enabledTypes.has(type)} /> : type}
        </button>
      ))}
    </div>
    {compact ? (
      <CompactSearch search={search} onSearchChange={onSearchChange} />
    ) : (
      <input
        type="text"
        className={styles.filterSearch}
        placeholder="搜索…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
    )}
  </div>
);

export default EventFilterBar;
