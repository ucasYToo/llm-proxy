import type { HookEntry } from "../../lib/api";

export const MAX_BUFFER = 500;
export const UNKNOWN_GROUP_KEY = "__unknown__";

export const shortSession = (sid: string | null | undefined): string => {
  if (!sid) return "—";
  return sid.length > 8 ? `${sid.slice(0, 4)}…${sid.slice(-4)}` : sid;
};

export const basename = (p: string | null | undefined): string => {
  if (!p) return "";
  const trimmed = p.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
};

export const cwdFromEntry = (e: HookEntry): string | null => {
  if (e.cwd) return e.cwd;
  const payload = e.payload as Record<string, unknown> | null;
  const fromPayload = payload?.cwd ?? payload?.workingDirectory;
  return typeof fromPayload === "string" ? fromPayload : null;
};

export const formatTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
};
