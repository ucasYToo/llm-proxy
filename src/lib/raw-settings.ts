import fs from "fs";
import path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { changeClaudeSettings, readClaudeSettings } from "./claude-settings";
import { localDir, mutateJson, readObject } from "./local-settings";

const exec = promisify(execFile);
let versionCheck: { time: number; result: Promise<string | null> } | undefined;
export function claudeCaptureVersion() {
  if (!versionCheck || Date.now() - versionCheck.time > 60000) {
    const result = exec("claude", ["--version"], {
      timeout: 2000,
      maxBuffer: 2048,
    })
      .then(({ stdout }) => stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null)
      .catch(() => null);
    versionCheck = { time: Date.now(), result };
  }
  return versionCheck.result;
}
const stateFile = path.join(localDir, "raw-settings.json");
export const rawDir = () =>
  path.resolve(
    process.env.CLAUDE_PROXY_RAW_API_BODIES_DIR ||
      path.join(localDir, "raw-api-bodies"),
  );
const rawKey = "OTEL_LOG_RAW_API_BODIES";
function timingVars(port: number) {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:
      "http://localhost:" + port + "/api/otel/v1/logs",
  };
}
export function rawStatus(port: number) {
  const env = readClaudeSettings().env ?? {};
  const state = readObject(stateFile);
  const raw = env[rawKey];
  const expected = "file:" + rawDir();
  const timing = timingVars(port);
  const conflicting =
    Object.entries(timing).some(([k, v]) => env[k] && env[k] !== v) ||
    (!!env.OTEL_EXPORTER_OTLP_PROTOCOL &&
      env.OTEL_EXPORTER_OTLP_PROTOCOL !== "http/json") ||
    !!env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    !!env.OTEL_EXPORTER_OTLP_LOGS_HEADERS ||
    !!env.OTEL_EXPORTER_OTLP_HEADERS;
  const stat = fs.statSync(rawDir(), { throwIfNoEntry: false });
  const owned =
    !!stat &&
    state.dev === stat.dev &&
    state.ino === stat.ino &&
    !fs.lstatSync(rawDir()).isSymbolicLink();
  return {
    directory: rawDir(),
    enabled: raw === expected && state.raw === expected && owned,
    conflict: !!raw && (raw !== expected || !state.raw || !owned),
    timing:
      state.timing && Object.entries(timing).every(([k, v]) => env[k] === v)
        ? "installed"
        : state.timing &&
            env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ===
              state.timing.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
          ? "port-mismatch"
          : conflicting
            ? "conflict"
            : "missing",
  };
}
export function configureRaw(
  kind: "raw" | "timing",
  enabled: boolean,
  port: number,
) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("端口无效");
  mutateJson(stateFile, (state) =>
    changeClaudeSettings((settings) => {
      const env = (settings.env ??= {});
      if (kind === "raw") {
        const value = "file:" + rawDir();
        if (enabled) {
          if (env[rawKey] && (env[rawKey] !== value || state.raw !== value))
            throw new Error("已有其他文件采集设置");
          fs.mkdirSync(rawDir(), { recursive: true, mode: 0o700 });
          if (
            fs.realpathSync(rawDir()) !==
              fs.realpathSync(path.dirname(rawDir())) +
                path.sep +
                path.basename(rawDir()) ||
            !fs.statSync(rawDir()).isDirectory()
          )
            throw new Error("采集目录无效");
          const stat = fs.statSync(rawDir());
          const known =
            state.directory === rawDir() &&
            state.dev === stat.dev &&
            state.ino === stat.ino;
          if (!known && state.raw !== value && fs.readdirSync(rawDir()).length)
            throw new Error("请选择空的专用采集目录");
          state.directory = rawDir();
          if (
            state.raw === value &&
            (state.dev !== stat.dev || state.ino !== stat.ino)
          )
            throw new Error("采集目录已被替换，请先卸载后重新安装");
          state.dev = stat.dev;
          state.ino = stat.ino;
          env[rawKey] = state.raw = value;
        } else {
          if (state.raw && env[rawKey] === state.raw) delete env[rawKey];
          delete state.raw;
        }
      } else {
        const vars = timingVars(port);
        if (enabled) {
          if (
            (env.OTEL_EXPORTER_OTLP_PROTOCOL &&
              env.OTEL_EXPORTER_OTLP_PROTOCOL !== "http/json") ||
            env.OTEL_EXPORTER_OTLP_ENDPOINT ||
            env.OTEL_EXPORTER_OTLP_LOGS_HEADERS ||
            env.OTEL_EXPORTER_OTLP_HEADERS ||
            Object.entries(vars).some(
              ([k, v]) =>
                env[k] !== undefined &&
                env[k] !== v &&
                env[k] !== state.timing?.[k],
            )
          )
            throw new Error("已有 OTLP 导出设置，请保留原端点");
          if (!state.timing && env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT)
            throw new Error("已有 OTLP 日志接收端");
          state.ownedTiming ??= {};
          for (const [key, val] of Object.entries(vars)) {
            if (env[key] === undefined || state.ownedTiming[key])
              state.ownedTiming[key] = val;
            env[key] = val;
          }
          state.timing = vars;
        } else {
          for (const [key, val] of Object.entries(state.ownedTiming ?? {}))
            if (env[key] === val) delete env[key];
          delete state.timing;
          delete state.ownedTiming;
        }
      }
    }),
  );
  return rawStatus(port);
}
