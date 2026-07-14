import fs from "fs";
import path from "path";

export const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const;

export type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number];

interface CodexHookHandler {
  type?: string;
  command?: string;
  timeout?: number;
  statusMessage?: string;
  [key: string]: unknown;
}

interface CodexHookGroup {
  matcher?: string;
  hooks?: CodexHookHandler[];
  [key: string]: unknown;
}

interface CodexHooksFile {
  hooks?: Record<string, CodexHookGroup[]>;
  [key: string]: unknown;
}

const MANAGED_COMMAND_MARKER = "codex hook relay";

export const codexHooksPath = (): string =>
  path.join(process.env.CODEX_HOME || path.join(process.env.HOME || "~", ".codex"), "hooks.json");

const readHooksFile = (file: string): CodexHooksFile => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as CodexHooksFile;
  } catch {
    return {};
  }
};

const writeHooksFile = (file: string, value: CodexHooksFile): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  fs.renameSync(temp, file);
};

const isManagedHandler = (handler: CodexHookHandler): boolean =>
  handler.type === "command" &&
  typeof handler.command === "string" &&
  handler.command.includes(MANAGED_COMMAND_MARKER);

const cleanManagedGroups = (groups: unknown): CodexHookGroup[] => {
  if (!Array.isArray(groups)) return [];
  const next: CodexHookGroup[] = [];
  for (const raw of groups) {
    if (!raw || typeof raw !== "object") continue;
    const group = raw as CodexHookGroup;
    const hooks = Array.isArray(group.hooks)
      ? group.hooks.filter((handler) => !isManagedHandler(handler))
      : [];
    if (hooks.length > 0) next.push({ ...group, hooks });
  }
  return next;
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const defaultCliPath = (): string => path.resolve(__dirname, "../../bin/cli.js");

export const buildCodexHookRelayCommand = (
  port: number,
  cliPath = defaultCliPath(),
): string =>
  `${shellQuote(process.execPath)} ${shellQuote(cliPath)} codex hook relay --port ${port}`;

export const installCodexHooks = (
  port: number,
  options: { file?: string; cliPath?: string } = {},
): { file: string; installed: CodexHookEvent[]; command: string } => {
  const file = options.file ?? codexHooksPath();
  const config = readHooksFile(file);
  const root = config.hooks ?? {};
  const command = buildCodexHookRelayCommand(port, options.cliPath);

  for (const event of CODEX_HOOK_EVENTS) {
    const existing = cleanManagedGroups(root[event]);
    root[event] = [
      ...existing,
      {
        hooks: [
          {
            type: "command",
            command,
            timeout: 5,
            statusMessage: "同步到 Codex Dashboard",
          },
        ],
      },
    ];
  }

  config.hooks = root;
  writeHooksFile(file, config);
  return { file, installed: [...CODEX_HOOK_EVENTS], command };
};

export const uninstallCodexHooks = (
  options: { file?: string } = {},
): { file: string; removed: string[] } => {
  const file = options.file ?? codexHooksPath();
  const config = readHooksFile(file);
  const root = config.hooks ?? {};
  const removed: string[] = [];

  for (const event of Object.keys(root)) {
    const before = Array.isArray(root[event]) ? root[event] : [];
    const after = cleanManagedGroups(before);
    if (after.length !== before.length || JSON.stringify(after) !== JSON.stringify(before)) {
      removed.push(event);
    }
    if (after.length) root[event] = after;
    else delete root[event];
  }

  if (Object.keys(root).length) config.hooks = root;
  else delete config.hooks;
  writeHooksFile(file, config);
  return { file, removed };
};

export const getCodexHookStatus = (
  options: { file?: string } = {},
): { file: string; installed: boolean; events: string[] } => {
  const file = options.file ?? codexHooksPath();
  const root = readHooksFile(file).hooks ?? {};
  const events = Object.entries(root)
    .filter(([, groups]) =>
      Array.isArray(groups) &&
      groups.some((group) => group.hooks?.some((handler) => isManagedHandler(handler))),
    )
    .map(([event]) => event);
  return {
    file,
    installed: CODEX_HOOK_EVENTS.every((event) => events.includes(event)),
    events,
  };
};

export const relayCodexHook = async (input: {
  port: number;
  payload: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<boolean> => {
  const event = input.payload.hook_event_name;
  if (typeof event !== "string" || !event.trim()) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 2500);
  const path = `/api/codex/hooks/${encodeURIComponent(event)}`;
  const origins = [
    `http://localhost:${input.port}`,
    `http://127.0.0.1:${input.port}`,
    `http://[::1]:${input.port}`,
  ];
  try {
    for (const origin of origins) {
      try {
        const response = await fetch(`${origin}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.payload),
          signal: controller.signal,
        });
        return response.ok;
      } catch {
        if (controller.signal.aborted) return false;
        // localhost can resolve to only one loopback family; try the others.
      }
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
};
