export type FeishuRemoteCommand =
  | { kind: "help" }
  | { kind: "projects" }
  | { kind: "use"; target: string }
  | { kind: "status" };

export interface PermissionReply {
  behavior: "allow" | "deny";
  requestId: string;
}

const CC_PREFIX_RE = /^\/cc(?:\s+|$)/i;
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

export const parsePermissionReply = (text: string): PermissionReply | null => {
  const match = PERMISSION_REPLY_RE.exec(text);
  if (!match) return null;
  return {
    behavior: match[1].toLowerCase().startsWith("y") ? "allow" : "deny",
    requestId: match[2].toLowerCase(),
  };
};

export const parseFeishuRemoteCommand = (
  text: string,
): FeishuRemoteCommand | null => {
  const trimmed = text.trim();
  if (!CC_PREFIX_RE.test(trimmed)) return null;
  const rest = trimmed.replace(CC_PREFIX_RE, "").trim();
  if (!rest || rest === "help") return { kind: "help" };
  if (rest === "projects") return { kind: "projects" };
  if (rest === "status") return { kind: "status" };
  const useMatch = /^use\s+(.+)$/i.exec(rest);
  if (useMatch) {
    return { kind: "use", target: useMatch[1].trim() };
  }
  return { kind: "help" };
};

export const parseFeishuTextContent = (content: unknown): string => {
  if (typeof content !== "string") return "";
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    if (typeof parsed.text === "string") return parsed.text;
  } catch {
    // fall through to raw content
  }
  return content;
};
