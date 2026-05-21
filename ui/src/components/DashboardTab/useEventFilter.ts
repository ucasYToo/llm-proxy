import { useMemo, useState } from "react";
import type { TimelineEntry } from "../../lib/api";
import {
  type EventTypeFilter,
  type FilterPreset,
  ALL_EVENT_TYPES,
  COMPACT_EVENT_TYPES,
} from "./types";

export const useEventFilter = () => {
  const [filterPreset, setFilterPreset] = useState<FilterPreset>("compact");
  const [enabledTypes, setEnabledTypes] = useState<Set<EventTypeFilter>>(
    new Set(COMPACT_EVENT_TYPES),
  );
  const [filterSearch, setFilterSearch] = useState("");

  const setPreset = (preset: "compact" | "all") => {
    setFilterPreset(preset);
    setEnabledTypes(
      preset === "compact"
        ? new Set(COMPACT_EVENT_TYPES)
        : new Set(ALL_EVENT_TYPES),
    );
  };

  const toggleType = (type: EventTypeFilter) => {
    setFilterPreset("custom");
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const filterTimeline = (raw: TimelineEntry[]): TimelineEntry[] => {
    const search = filterSearch.trim().toLowerCase();
    return raw.filter((item) => {
      if (item.kind === "hook") {
        const eventName = item.hook.eventName as EventTypeFilter;
        if (!enabledTypes.has(eventName)) return false;
        if (!search) return true;
        const ev = item.hook;
        return (
          ev.eventName.toLowerCase().includes(search) ||
          (ev.toolName?.toLowerCase().includes(search) ?? false) ||
          (ev.sessionId?.toLowerCase().includes(search) ?? false) ||
          (ev.cwd?.toLowerCase().includes(search) ?? false)
        );
      }
      if (!enabledTypes.has("apiLog")) return false;
      if (!search) return true;
      const log = item.log;
      return (
        log.path.toLowerCase().includes(search) ||
        log.targetName.toLowerCase().includes(search) ||
        (log.sessionId?.toLowerCase().includes(search) ?? false)
      );
    });
  };

  return {
    filterPreset,
    enabledTypes,
    filterSearch,
    setFilterSearch,
    setPreset,
    toggleType,
    filterTimeline,
  };
};
