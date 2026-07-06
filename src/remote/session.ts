import { spawn } from "child_process";
import type { RemoteBridgeConfig } from "../interfaces";

export interface LaunchClaudeSessionResult {
  ok: boolean;
  pid?: number;
  command: string;
  error?: string;
}

export const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;

export const splitCommand = (raw: string): string[] => {
  const matches = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((m) => m.replace(/^(['"])(.*)\1$/, "$2"));
};

export const buildClaudePermissionArgs = (
  config: RemoteBridgeConfig,
): string[] => {
  const args: string[] = [];
  const mode = config.permissionMode ?? "default";
  if (mode === "bypassPermissions") {
    args.push("--dangerously-skip-permissions");
  } else if (mode === "acceptEdits" || mode === "plan") {
    args.push("--permission-mode", mode);
  }
  return args;
};

const buildClaudeArgs = (config: RemoteBridgeConfig): string[] => [
  "--dangerously-load-development-channels",
  "server:claude-proxy-remote",
  ...buildClaudePermissionArgs(config),
];

export const buildClaudeLaunchCommand = (
  config: RemoteBridgeConfig,
): string[] => {
  const command = config.claudeCommand || "claude";
  return [...splitCommand(command), ...buildClaudeArgs(config)];
};

export const launchClaudeSession = (
  cwd: string,
  config: RemoteBridgeConfig,
): LaunchClaudeSessionResult => {
  const argv = buildClaudeLaunchCommand(config);
  const commandText = argv.map(shellQuote).join(" ");

  if (process.platform === "darwin") {
    const terminalCommand = `cd ${shellQuote(cwd)} && ${commandText}`;
    const script = [
      'tell application "Terminal"',
      "activate",
      `do script ${JSON.stringify(terminalCommand)}`,
      "end tell",
    ].join("\n");
    try {
      const child = spawn("osascript", ["-e", script], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { ok: true, pid: child.pid, command: terminalCommand };
    } catch (err) {
      return {
        ok: false,
        command: terminalCommand,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
    return { ok: true, pid: child.pid, command: commandText };
  } catch (err) {
    return {
      ok: false,
      command: commandText,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
