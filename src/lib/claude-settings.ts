import fs from "fs";
import path from "path";

export const CLAUDE_SETTINGS_PATH = path.join(
  process.env.HOME || "~",
  ".claude",
  "settings.json",
);

export const readClaudeSettings = (): Record<string, unknown> => {
  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const writeClaudeSettings = (
  settings: Record<string, unknown>,
): void => {
  const dir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    CLAUDE_SETTINGS_PATH,
    JSON.stringify(settings, null, 2),
    "utf-8",
  );
};

/** 由本工具自动写入的 hook 标记字段名 */
export const HOOK_MANAGED_BY = "claude-llm-proxy";

/** 我们默认接管的 Claude Code 钩子事件列表 */
export const MANAGED_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "StopFailure",
  "PermissionDenied",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "SessionEnd",
] as const;

export type ManagedHookEvent = (typeof MANAGED_HOOK_EVENTS)[number];

interface HookEntry {
  type?: string;
  url?: string;
  command?: string;
  _managedBy?: string;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
  _managedBy?: string;
  [key: string]: unknown;
}

const isHookGroup = (val: unknown): val is HookGroup => {
  return (
    typeof val === "object" &&
    val !== null &&
    Array.isArray((val as { hooks?: unknown }).hooks)
  );
};

/**
 * 为指定端口安装一组 managed 的 http hook 到 ~/.claude/settings.json。
 * 幂等：每次调用都会先清掉自己管理的旧记录再重写。
 */
export const installHooks = (
  port: number,
  events: readonly ManagedHookEvent[] = MANAGED_HOOK_EVENTS,
): { installed: ManagedHookEvent[] } => {
  const settings = readClaudeSettings();
  const hooksRoot = (settings.hooks ?? {}) as Record<string, unknown>;

  for (const event of events) {
    const existing = (hooksRoot[event] ?? []) as unknown[];
    const cleaned = existing.filter((g) => {
      if (!isHookGroup(g)) return true;
      if (g._managedBy === HOOK_MANAGED_BY) return false;
      const inner = g.hooks ?? [];
      const hasManagedInner = inner.some(
        (h) => h && (h as HookEntry)._managedBy === HOOK_MANAGED_BY,
      );
      return !hasManagedInner;
    });

    const newGroup: HookGroup = {
      _managedBy: HOOK_MANAGED_BY,
      hooks: [
        {
          type: "http",
          url: `http://localhost:${port}/api/hooks/${event}`,
          _managedBy: HOOK_MANAGED_BY,
        },
      ],
    };

    hooksRoot[event] = [...cleaned, newGroup];
  }

  settings.hooks = hooksRoot;
  writeClaudeSettings(settings);

  return { installed: [...events] };
};

/**
 * 移除所有由本工具管理的 hook 记录。
 * 不触碰用户自己的 hook 配置。
 */
export const uninstallHooks = (): { removed: string[] } => {
  const settings = readClaudeSettings();
  const hooksRoot = (settings.hooks ?? {}) as Record<string, unknown>;
  const removed: string[] = [];

  for (const event of Object.keys(hooksRoot)) {
    const existing = (hooksRoot[event] ?? []) as unknown[];
    const cleaned = existing.filter((g) => {
      if (!isHookGroup(g)) return true;
      if (g._managedBy === HOOK_MANAGED_BY) {
        removed.push(event);
        return false;
      }
      const inner = g.hooks ?? [];
      const hasManagedInner = inner.some(
        (h) => h && (h as HookEntry)._managedBy === HOOK_MANAGED_BY,
      );
      if (hasManagedInner) removed.push(event);
      return !hasManagedInner;
    });

    if (cleaned.length === 0) {
      delete hooksRoot[event];
    } else {
      hooksRoot[event] = cleaned;
    }
  }

  if (Object.keys(hooksRoot).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooksRoot;
  }
  writeClaudeSettings(settings);

  return { removed };
};

/**
 * 列出当前 settings.json 中由本工具管理的 hook。
 */
export const listManagedHooks = (): Array<{ event: string; url: string }> => {
  const settings = readClaudeSettings();
  const hooksRoot = (settings.hooks ?? {}) as Record<string, unknown>;
  const result: Array<{ event: string; url: string }> = [];

  for (const event of Object.keys(hooksRoot)) {
    const groups = (hooksRoot[event] ?? []) as unknown[];
    for (const g of groups) {
      if (!isHookGroup(g)) continue;
      const inner = g.hooks ?? [];
      for (const h of inner) {
        const entry = h as HookEntry;
        if (entry._managedBy === HOOK_MANAGED_BY && entry.url) {
          result.push({ event, url: entry.url });
        }
      }
    }
  }

  return result;
};
