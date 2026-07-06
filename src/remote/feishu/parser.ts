export type FeishuRemoteCommand =
  | { kind: "help" }
  | { kind: "new"; input: string }
  | { kind: "continue"; threadId: string; prompt: string }
  | { kind: "projects" }
  | { kind: "status" }
  | { kind: "use"; target: string };

export const parseFeishuTextContent = (content: unknown): string => {
  if (typeof content !== "string") return "";
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : content;
  } catch {
    return content;
  }
};

export const parsePermissionReply = (
  text: string,
): { behavior: "allow" | "deny"; requestId: string } | null => {
  const match = /^\s*(y|yes|同意|允许|n|no|否|拒绝)\s+([a-z0-9_-]{3,})\s*$/i.exec(text);
  if (!match) return null;
  return {
    behavior: /^(y|yes|同意|允许)$/i.test(match[1]) ? "allow" : "deny",
    requestId: match[2].toLowerCase(),
  };
};

const splitCommand = (
  text: string,
): { body: string; force: boolean } | null => {
  const trimmed = text.trim();
  const cc = /^\/cc(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (cc) return { body: (cc[1] ?? "").trim(), force: true };
  if (!trimmed.startsWith("/")) return null;
  return { body: trimmed.slice(1).trim(), force: false };
};

export const parseFeishuRemoteCommand = (
  text: string,
): FeishuRemoteCommand | null => {
  const parsed = splitCommand(text);
  if (!parsed) return null;
  const body = parsed.body.replace(/^\/+/, "");
  if (!body) return parsed.force ? { kind: "help" } : null;

  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(body);
  if (!match) return parsed.force ? { kind: "help" } : null;
  const name = match[1].toLowerCase();
  const rest = (match[2] ?? "").trim();

  if (name === "help" || name === "?") return { kind: "help" };
  if (name === "projects" || name === "project") return { kind: "projects" };
  if (name === "status") return { kind: "status" };
  if (name === "new") {
    return rest ? { kind: "new", input: rest } : { kind: "help" };
  }
  if (name === "continue" || name === "cont") {
    const cont = /^(\S+)\s+([\s\S]+)$/.exec(rest);
    return cont
      ? { kind: "continue", threadId: cont[1], prompt: cont[2].trim() }
      : { kind: "help" };
  }
  if (name === "use") {
    return rest ? { kind: "use", target: rest } : { kind: "help" };
  }

  return parsed.force ? { kind: "help" } : null;
};
