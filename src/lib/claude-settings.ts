import fs from "fs";
import {
  mutateJson,
  preferences,
  readObject,
  settingsPath,
} from "./local-settings";
import { cliPath } from "./service-process";
import { shellQuote } from "../remote/session";

export const CLAUDE_SETTINGS_PATH = settingsPath;
export const readClaudeSettings = () => readObject(settingsPath);
export const changeClaudeSettings = (
  edit: (settings: Record<string, any>) => void,
) => mutateJson(settingsPath, edit);
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

type Hook = Record<string, any>;
type ListedHook = { event: string; url: string; command?: string };
const forwardedEvents = new Set(["SessionStart", "Stop", "StopFailure"]);

function commandFor(event: string, port: number, autoStart: boolean) {
  return [
    shellQuote(process.execPath),
    shellQuote(cliPath),
    "hook forward",
    event,
    "--port",
    String(port),
    ...(event === "SessionStart" && autoStart ? ["--auto-start"] : []),
  ].join(" ");
}
function portFor(hook: Hook, event: string): number | null {
  if (!hook || typeof hook !== "object") return null;
  if (hook.type === "http" && typeof hook.url === "string") {
    const match =
      /^http:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/api\/hooks\/([A-Za-z]+)$/.exec(
        hook.url,
      );
    return match?.[2] === event ? Number(match[1]) : null;
  }
  if (hook.type === "command" && typeof hook.command === "string") {
    const match =
      / hook forward ([A-Za-z]+) --port (\d+)(?: --auto-start)?$/.exec(
        hook.command,
      );
    return match?.[1] === event ? Number(match[2]) : null;
  }
  return null;
}
function owned(hook: Hook, event: string, group: Hook) {
  if (hook?._managedBy === HOOK_MANAGED_BY) return true;
  if (
    !MANAGED_HOOK_EVENTS.includes(event as ManagedHookEvent) ||
    group.matcher ||
    !portFor(hook, event)
  )
    return false;
  if (hook.type === "http")
    return Object.keys(hook).every((k) => k === "type" || k === "url");
  const port = portFor(hook, event)!;
  return (
    [true, false].some(
      (auto) => hook.command === commandFor(event, port, auto),
    ) &&
    Object.keys(hook).every((k) => ["type", "command", "timeout"].includes(k))
  );
}
function strip(groups: Hook[], event: string) {
  return groups.flatMap((group) => {
    if (!Array.isArray(group?.hooks)) return [group];
    const keep = group.hooks.filter((h: Hook) => !owned(h, event, group));
    if (keep.length === group.hooks.length) return [group];
    if (!keep.length) return [];
    const { _managedBy, ...rest } = group;
    return [{ ...rest, hooks: keep }];
  });
}
export function installHooks(
  port: number,
  events: readonly ManagedHookEvent[] = MANAGED_HOOK_EVENTS,
) {
  const auto = preferences().autoStart !== false;
  changeClaudeSettings((settings) => {
    const root = (settings.hooks ??= {});
    for (const event of events) {
      const hook = forwardedEvents.has(event)
        ? {
            type: "command",
            command: commandFor(event, port, auto),
            timeout: 30,
          }
        : {
            type: "http",
            url: "http://localhost:" + port + "/api/hooks/" + event,
          };
      root[event] = [
        ...strip(root[event] ?? [], event),
        { hooks: [{ ...hook, _managedBy: HOOK_MANAGED_BY }] },
      ];
    }
  });
  return { installed: [...events] };
}
export function uninstallHooks() {
  const removed: string[] = [];
  changeClaudeSettings((settings) => {
    for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
      if (!Array.isArray(groups)) continue;
      const kept = strip(groups, event);
      if (JSON.stringify(kept) === JSON.stringify(groups)) continue;
      removed.push(event);
      if (kept.length) settings.hooks[event] = kept;
      else delete settings.hooks[event];
    }
    if (settings.hooks && !Object.keys(settings.hooks).length)
      delete settings.hooks;
  });
  return { removed };
}
export function listManagedHooks(): ListedHook[] {
  const result: ListedHook[] = [];
  for (const [event, groups] of Object.entries(
    readClaudeSettings().hooks ?? {},
  )) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups)
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        if (!owned(hook, event, group)) continue;
        result.push({
          event,
          url:
            hook.url ??
            "http://localhost:" + portFor(hook, event) + "/api/hooks/" + event,
          command: hook.command,
        });
      }
  }
  return result;
}
export function areManagedHooksCurrent(events: ListedHook[], port: number) {
  return (
    events.length === MANAGED_HOOK_EVENTS.length &&
    MANAGED_HOOK_EVENTS.every((event) =>
      events.some(
        (h) =>
          h.event === event &&
          h.url === "http://localhost:" + port + "/api/hooks/" + event,
      ),
    )
  );
}
export function getManagedHookStatus(port: number) {
  const events = listManagedHooks();
  const autoStart = preferences().autoStart !== false;
  const installed =
    areManagedHooksCurrent(events, port) &&
    fs.existsSync(cliPath) &&
    events.every((h) =>
      forwardedEvents.has(h.event)
        ? h.command === commandFor(h.event, port, autoStart)
        : !h.command,
    );
  return { installed, autoStart, count: events.length, events };
}
