import { spawn } from "child_process";
import type { RemoteBridgeConfig } from "../interfaces";
import {
  buildClaudePermissionArgs,
  shellQuote,
  splitCommand,
} from "./session";

export interface ClaudePrintResult {
  ok: boolean;
  text: string;
  sessionId: string | null;
  command: string;
  raw?: unknown;
  error?: string;
}

const parseClaudeJson = (stdout: string): Record<string, unknown> | null => {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const line = trimmed
      .split(/\r?\n/)
      .reverse()
      .find((item) => item.trim().startsWith("{"));
    if (!line) return null;
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
};

const stringifyCommand = (argv: string[]): string =>
  argv.map(shellQuote).join(" ");

export const parseClaudeStreamLine = (
  line: string,
): Record<string, unknown> | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const buildClaudePrintArgv = (input: {
  config: RemoteBridgeConfig;
  prompt: string;
  resumeSessionId?: string | null;
}): string[] => {
  const base = splitCommand(input.config.claudeCommand || "claude");
  return [
    ...base,
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--include-hook-events",
    ...buildClaudePermissionArgs(input.config),
    ...(input.resumeSessionId ? ["--resume", input.resumeSessionId] : []),
    "--",
    input.prompt,
  ];
};

export const runClaudePrint = (input: {
  cwd: string;
  config: RemoteBridgeConfig;
  prompt: string;
  resumeSessionId?: string | null;
  timeoutMs?: number;
  onEvent?: (event: unknown) => void;
}): Promise<ClaudePrintResult> => {
  const argv = buildClaudePrintArgv(input);
  const command = stringifyCommand(argv);

  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: input.cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let resultEvent: Record<string, unknown> | null = null;
    let settled = false;
    const consumeLine = (line: string): void => {
      const event = parseClaudeStreamLine(line);
      if (!event) return;
      if (event.type === "result") resultEvent = event;
      input.onEvent?.(event);
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        text: "",
        sessionId: null,
        command,
        error: `Claude CLI timed out after ${input.timeoutMs ?? 30 * 60_000}ms`,
      });
    }, input.timeoutMs ?? 30 * 60_000);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      lineBuffer += text;
      let idx: number;
      while ((idx = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, idx);
        lineBuffer = lineBuffer.slice(idx + 1);
        consumeLine(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        text: "",
        sessionId: null,
        command,
        error: err.message,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (lineBuffer.trim()) consumeLine(lineBuffer);
      const parsed = resultEvent ?? parseClaudeJson(stdout);
      const isError = parsed?.is_error === true;
      const result = typeof parsed?.result === "string" ? parsed.result : "";
      const sessionId =
        typeof parsed?.session_id === "string" ? parsed.session_id : null;
      if (code === 0 && parsed && !isError && result) {
        resolve({
          ok: true,
          text: result,
          sessionId,
          command,
          raw: parsed,
        });
        return;
      }
      resolve({
        ok: false,
        text: result,
        sessionId,
        command,
        raw: parsed ?? stdout,
        error:
          (typeof parsed?.result === "string" && parsed.result) ||
          stderr.trim() ||
          stdout.trim() ||
          `Claude CLI exited with code ${code ?? "unknown"}`,
      });
    });
  });
};
