import { useState } from "react";
import type { TimelineEntry } from "../../lib/api";
import {
  type EventTypeFilter,
  type FilterPreset,
  ALL_EVENT_TYPES,
  COMPACT_EVENT_TYPES,
} from "./types";

export type AgentRoleFilter = "all" | "main" | "subagent";

export interface AgentOption {
  agentId: string;
  agentType: string;
  count: number;
}

export const useEventFilter = () => {
  const [filterPreset, setFilterPreset] = useState<FilterPreset>("compact");
  const [enabledTypes, setEnabledTypes] = useState<Set<EventTypeFilter>>(
    new Set(COMPACT_EVENT_TYPES),
  );
  const [filterSearch, setFilterSearch] = useState("");
  const [agentRoleFilter, setAgentRoleFilter] = useState<AgentRoleFilter>("all");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const setPreset = (preset: "compact" | "all") => {
    if (preset === "all" && filterPreset === "all" && enabledTypes.size === ALL_EVENT_TYPES.length) {
      setFilterPreset("all");
      setEnabledTypes(new Set());
    } else {
      setFilterPreset(preset);
      setEnabledTypes(
        preset === "compact"
          ? new Set(COMPACT_EVENT_TYPES)
          : new Set(ALL_EVENT_TYPES),
      );
    }
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

  const extractAgentOptions = (raw: TimelineEntry[]): AgentOption[] => {
    const map = new Map<string, { agentType: string; count: number }>();
    for (const item of raw) {
      if (item.kind === "hook") {
        const payload = item.hook.payload as Record<string, unknown> | null;
        const agentId = payload?.agent_id as string | undefined;
        const agentType = payload?.agent_type as string | undefined;
        if (!agentId || !agentType) continue;
        if (!map.has(agentId)) map.set(agentId, { agentType, count: 0 });
      } else {
        const { agentId } = item.log;
        if (!agentId) continue;
        const existing = map.get(agentId);
        if (existing) existing.count++;
      }
    }
    return Array.from(map.entries())
      .filter(([, v]) => v.agentType)
      .map(([agentId, { agentType, count }]) => ({ agentId, agentType, count }));
  };

  const filterTimeline = (raw: TimelineEntry[]): TimelineEntry[] => {
    const search = filterSearch.trim().toLowerCase();

    return raw.filter((item) => {
      if (item.kind === "hook") {
        const eventName = item.hook.eventName as EventTypeFilter;
        if (!enabledTypes.has(eventName)) return false;
        if (selectedAgentId) {
          const payload = item.hook.payload as Record<string, unknown> | null;
          if (payload?.agent_id !== selectedAgentId) return false;
        }
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
      if (selectedAgentId) {
        if (item.log.agentId !== selectedAgentId) return false;
      } else if (agentRoleFilter !== "all") {
        const isSubagent = !!item.log.agentId;
        if (agentRoleFilter === "main" && isSubagent) return false;
        if (agentRoleFilter === "subagent" && !isSubagent) return false;
      }
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
    agentRoleFilter,
    selectedAgentId,
    setFilterSearch,
    setAgentRoleFilter,
    setSelectedAgentId,
    setPreset,
    toggleType,
    filterTimeline,
    extractAgentOptions,
  };
};
