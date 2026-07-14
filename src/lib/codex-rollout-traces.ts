import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  getCodexTraceBundle,
  queryCodexTraceBundles,
  replaceCodexTraceBundles,
  type CodexTraceBundleIndex,
} from "../storage/codex";

export const CODEX_ROLLOUT_TRACE_ROOT_ENV = "CODEX_ROLLOUT_TRACE_ROOT";
export const CODEX_TRACE_MAX_BYTES = 1024 * 1024 * 1024;
const TRACE_EVENT_READ_BYTES = 32 * 1024 * 1024;
const TRACE_DETAIL_READ_BYTES = 64 * 1024 * 1024;
const TRACE_MAINTENANCE_INTERVAL_MS = 20_000;

interface TraceManifest {
  trace_id: string;
  root_thread_id: string;
  started_at_unix_ms: number;
}

export interface CodexTraceBundleDescriptor {
  id: string;
  sessionId: string;
  bundlePath: string;
  startedAt: string;
  sizeBytes: number;
}

export interface CodexTraceStatus {
  configured: boolean;
  configuredRoot: string | null;
  rootPath: string;
  maxBytes: number;
  usedBytes: number;
  bundleCount: number;
  restartRequired: true;
}

export interface CodexTraceEventSummary {
  kind: "trace";
  id: string;
  bundleId: string;
  seq: number;
  at: string;
  sessionId: string;
  threadId: string | null;
  turnId: string | null;
  eventType: string;
  category: "model" | "tool" | "lifecycle";
  summary: string;
  model: string | null;
  provider: string | null;
  hasPayload: boolean;
}

export interface CodexTracePayloadDetail {
  kind: string;
  path: string;
  content: unknown;
}

export interface CodexTraceEventDetail {
  event: Record<string, unknown>;
  payloads: CodexTracePayloadDetail[];
  bundlePath: string;
}

let captureOwnedByProcess = false;
let maintenanceTimer: NodeJS.Timeout | null = null;
let lastStatus: CodexTraceStatus | null = null;
let lastSyncAt = 0;

export const getCodexTraceRoot = (): string =>
  path.resolve(
    process.env.CLAUDE_PROXY_CODEX_TRACE_ROOT ||
      path.join(process.env.HOME || "~", ".claude-proxy", "codex-rollout-traces"),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readManifest = (bundlePath: string): TraceManifest | null => {
  try {
    const raw = fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf-8");
    const value = JSON.parse(raw) as Partial<TraceManifest>;
    if (
      typeof value.trace_id !== "string" ||
      typeof value.root_thread_id !== "string" ||
      typeof value.started_at_unix_ms !== "number"
    ) {
      return null;
    }
    return value as TraceManifest;
  } catch {
    return null;
  }
};

const directorySize = (directory: string): number => {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      total += directorySize(entryPath);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      total += fs.statSync(entryPath).size;
    } catch {
      // A live trace can rotate files between readdir and stat.
    }
  }
  return total;
};

export const discoverCodexTraceBundles = (
  rootPath = getCodexTraceRoot(),
): CodexTraceBundleDescriptor[] => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const bundles: CodexTraceBundleDescriptor[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const bundlePath = path.join(rootPath, entry.name);
    const manifest = readManifest(bundlePath);
    if (!manifest) continue;
    bundles.push({
      id: manifest.trace_id,
      sessionId: manifest.root_thread_id,
      bundlePath,
      startedAt: new Date(manifest.started_at_unix_ms).toISOString(),
      sizeBytes: directorySize(bundlePath),
    });
  }
  return bundles.sort((left, right) =>
    left.startedAt < right.startedAt ? -1 : left.startedAt > right.startedAt ? 1 : 0,
  );
};

export const pruneCodexTraceBundles = (
  rootPath = getCodexTraceRoot(),
  maxBytes = CODEX_TRACE_MAX_BYTES,
): { bundles: CodexTraceBundleDescriptor[]; removed: string[]; usedBytes: number } => {
  const bundles = discoverCodexTraceBundles(rootPath);
  let usedBytes = bundles.reduce((sum, bundle) => sum + bundle.sizeBytes, 0);
  const removed: string[] = [];
  const retained = [...bundles];

  while (usedBytes > maxBytes && retained.length > 0) {
    const bundle = retained.shift();
    if (!bundle) break;
    fs.rmSync(bundle.bundlePath, { recursive: true, force: true });
    usedBytes -= bundle.sizeBytes;
    removed.push(bundle.bundlePath);
  }

  return { bundles: retained, removed, usedBytes: Math.max(usedBytes, 0) };
};

const launchctlEnabled = (): boolean =>
  process.platform === "darwin" &&
  process.env.CLAUDE_PROXY_CODEX_TRACE_SKIP_LAUNCHCTL !== "1" &&
  fs.existsSync("/bin/launchctl");

const readConfiguredTraceRoot = (): string | null => {
  if (launchctlEnabled()) {
    const result = spawnSync("/bin/launchctl", ["getenv", CODEX_ROLLOUT_TRACE_ROOT_ENV], {
      encoding: "utf-8",
    });
    const value = result.status === 0 ? result.stdout.trim() : "";
    if (value) return path.resolve(value);
  }
  const value = process.env[CODEX_ROLLOUT_TRACE_ROOT_ENV];
  return value ? path.resolve(value) : null;
};

const setConfiguredTraceRoot = (rootPath: string): void => {
  if (launchctlEnabled()) {
    const result = spawnSync(
      "/bin/launchctl",
      ["setenv", CODEX_ROLLOUT_TRACE_ROOT_ENV, rootPath],
      { encoding: "utf-8" },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || "launchctl setenv failed");
    }
  }
  process.env[CODEX_ROLLOUT_TRACE_ROOT_ENV] = rootPath;
};

const unsetConfiguredTraceRoot = (): void => {
  if (launchctlEnabled()) {
    const result = spawnSync(
      "/bin/launchctl",
      ["unsetenv", CODEX_ROLLOUT_TRACE_ROOT_ENV],
      { encoding: "utf-8" },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || "launchctl unsetenv failed");
    }
  }
  delete process.env[CODEX_ROLLOUT_TRACE_ROOT_ENV];
};

export const syncCodexTraceIndex = (
  rootPath = getCodexTraceRoot(),
  maxBytes = CODEX_TRACE_MAX_BYTES,
  options: { force?: boolean } = {},
): CodexTraceStatus => {
  if (
    !options.force &&
    lastStatus &&
    lastStatus.rootPath === rootPath &&
    lastStatus.maxBytes === maxBytes &&
    Date.now() - lastSyncAt < 2_000
  ) {
    return lastStatus;
  }
  fs.mkdirSync(rootPath, { recursive: true, mode: 0o700 });
  const { bundles, usedBytes } = pruneCodexTraceBundles(rootPath, maxBytes);
  replaceCodexTraceBundles(
    bundles.map(({ id, sessionId, bundlePath, startedAt }) => ({
      id,
      sessionId,
      bundlePath,
      startedAt,
    })),
  );
  const configuredRoot = readConfiguredTraceRoot();
  lastStatus = {
    configured: configuredRoot !== null,
    configuredRoot,
    rootPath,
    maxBytes,
    usedBytes,
    bundleCount: bundles.length,
    restartRequired: true,
  };
  lastSyncAt = Date.now();
  return lastStatus;
};

export const getCodexTraceStatus = (): CodexTraceStatus =>
  lastStatus ?? syncCodexTraceIndex();

export const startCodexTraceCapture = (): CodexTraceStatus => {
  const rootPath = getCodexTraceRoot();
  fs.mkdirSync(rootPath, { recursive: true, mode: 0o700 });
  setConfiguredTraceRoot(rootPath);
  captureOwnedByProcess = true;
  lastStatus = null;
  return syncCodexTraceIndex(rootPath, CODEX_TRACE_MAX_BYTES, { force: true });
};

export const stopCodexTraceCapture = (
  options: { onlyIfOwned?: boolean } = {},
): CodexTraceStatus => {
  if (!options.onlyIfOwned || captureOwnedByProcess) {
    unsetConfiguredTraceRoot();
    captureOwnedByProcess = false;
  }
  lastStatus = null;
  return syncCodexTraceIndex(getCodexTraceRoot(), CODEX_TRACE_MAX_BYTES, { force: true });
};

export const startCodexTraceMaintenance = (
  onChange?: (status: CodexTraceStatus) => void,
): void => {
  if (maintenanceTimer) return;
  lastStatus = syncCodexTraceIndex(getCodexTraceRoot(), CODEX_TRACE_MAX_BYTES, { force: true });
  maintenanceTimer = setInterval(() => {
    try {
      const before = lastStatus;
      const next = syncCodexTraceIndex(getCodexTraceRoot(), CODEX_TRACE_MAX_BYTES, { force: true });
      if (
        !before ||
        before.usedBytes !== next.usedBytes ||
        before.bundleCount !== next.bundleCount ||
        before.configured !== next.configured
      ) {
        onChange?.(next);
      }
    } catch {
      // Trace collection is diagnostic and must not take down the proxy.
    }
  }, TRACE_MAINTENANCE_INTERVAL_MS);
  maintenanceTimer.unref();
};

export const stopCodexTraceMaintenance = (): void => {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
};

const readTailText = (file: string, maximumBytes: number): string => {
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maximumBytes);
  const length = stat.size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  let text = buffer.toString("utf-8");
  if (start > 0) {
    const newline = text.indexOf("\n");
    text = newline >= 0 ? text.slice(newline + 1) : "";
  }
  return text;
};

interface RawPayloadRef {
  raw_payload_id: string;
  kind: string;
  path: string;
}

const payloadKind = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value;
  if (isRecord(value) && typeof value.type === "string" && value.type.trim()) {
    return value.type;
  }
  return null;
};

const collectPayloadRefs = (value: unknown, refs: RawPayloadRef[] = []): RawPayloadRef[] => {
  if (Array.isArray(value)) {
    for (const entry of value) collectPayloadRefs(entry, refs);
    return refs;
  }
  if (!isRecord(value)) return refs;
  const kind = payloadKind(value.kind);
  if (typeof value.raw_payload_id === "string" && kind && typeof value.path === "string") {
    refs.push({
      raw_payload_id: value.raw_payload_id,
      kind,
      path: value.path,
    });
    return refs;
  }
  for (const entry of Object.values(value)) collectPayloadRefs(entry, refs);
  return refs;
};

const traceCategory = (eventType: string): CodexTraceEventSummary["category"] => {
  if (eventType.startsWith("inference_") || eventType.startsWith("compaction_request_")) {
    return "model";
  }
  if (eventType.startsWith("tool_") || eventType.startsWith("code_cell_")) {
    return "tool";
  }
  return "lifecycle";
};

const compactValue = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isRecord(value)) {
    for (const key of ["name", "title", "command", "message", "type"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return null;
};

const traceSummary = (eventType: string, payload: Record<string, unknown>): string => {
  if (eventType === "inference_started") {
    return [payload.model, payload.provider_name].filter((value) => typeof value === "string").join(" · ");
  }
  for (const key of ["summary", "status", "reason", "error", "event_type", "kind", "response_id"]) {
    const summary = compactValue(payload[key]);
    if (summary) return summary;
  }
  return eventType.replace(/_/g, " ");
};

const rawEventToSummary = (
  bundle: CodexTraceBundleIndex,
  raw: Record<string, unknown>,
): CodexTraceEventSummary | null => {
  const seq = raw.seq;
  const wallTime = raw.wall_time_unix_ms;
  const payload = raw.payload;
  if (typeof seq !== "number" || typeof wallTime !== "number" || !isRecord(payload)) return null;
  const eventType = typeof payload.type === "string" ? payload.type : "unknown";
  const threadId = typeof raw.thread_id === "string" ? raw.thread_id : null;
  const turnId = typeof raw.codex_turn_id === "string" ? raw.codex_turn_id : null;
  return {
    kind: "trace",
    id: `${bundle.id}:${seq}`,
    bundleId: bundle.id,
    seq,
    at: new Date(wallTime).toISOString(),
    sessionId: threadId ?? bundle.sessionId,
    threadId,
    turnId,
    eventType,
    category: traceCategory(eventType),
    summary: traceSummary(eventType, payload),
    model: typeof payload.model === "string" ? payload.model : null,
    provider: typeof payload.provider_name === "string" ? payload.provider_name : null,
    hasPayload: collectPayloadRefs(payload).length > 0,
  };
};

const readBundleEvents = (
  bundle: CodexTraceBundleIndex,
): CodexTraceEventSummary[] => {
  const file = path.join(bundle.bundlePath, "trace.jsonl");
  let text: string;
  try {
    text = readTailText(file, TRACE_EVENT_READ_BYTES);
  } catch {
    return [];
  }
  const events: CodexTraceEventSummary[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const summary = rawEventToSummary(bundle, JSON.parse(line) as Record<string, unknown>);
      if (summary) events.push(summary);
    } catch {
      // Ignore a concurrently-written partial final line or a future schema entry.
    }
  }
  return events;
};

const readTraceEvents = (
  bundles: CodexTraceBundleIndex[],
  limit: number,
): CodexTraceEventSummary[] =>
  bundles
    .flatMap(readBundleEvents)
    .sort((left, right) => (left.at < right.at ? 1 : -1))
    .slice(0, Math.max(1, limit));

export const getCodexTraceEvents = (limit = 300): CodexTraceEventSummary[] =>
  readTraceEvents(queryCodexTraceBundles(), limit);

export const getCodexTraceEventsForSession = (
  sessionId: string,
  limit = 300,
): CodexTraceEventSummary[] => readTraceEvents(queryCodexTraceBundles(sessionId), limit);

const findRawEvent = (
  bundle: CodexTraceBundleIndex,
  seq: number,
): Record<string, unknown> | null => {
  const file = path.join(bundle.bundlePath, "trace.jsonl");
  const text = readTailText(file, TRACE_DETAIL_READ_BYTES);
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.seq === seq) return event;
    } catch {
      // Ignore partial lines while an active bundle is being written.
    }
  }
  return null;
};

const readPayload = (
  bundlePath: string,
  ref: RawPayloadRef,
): CodexTracePayloadDetail => {
  const payloadRoot = path.resolve(bundlePath, "payloads");
  const payloadPath = path.resolve(bundlePath, ref.path);
  if (payloadPath !== payloadRoot && !payloadPath.startsWith(`${payloadRoot}${path.sep}`)) {
    throw new Error("trace payload path escapes its bundle");
  }
  const stat = fs.lstatSync(payloadPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("invalid trace payload file");
  if (stat.size > TRACE_DETAIL_READ_BYTES) throw new Error("trace payload is larger than 64 MB");
  const raw = fs.readFileSync(payloadPath, "utf-8");
  let content: unknown = raw;
  try {
    content = JSON.parse(raw);
  } catch {
    // Preserve non-JSON future payload formats verbatim.
  }
  return { kind: ref.kind, path: ref.path, content };
};

export const getCodexTraceEventDetail = (
  bundleId: string,
  seq: number,
): CodexTraceEventDetail | null => {
  const bundle = getCodexTraceBundle(bundleId);
  if (!bundle) return null;
  const manifest = readManifest(bundle.bundlePath);
  if (!manifest || manifest.trace_id !== bundle.id) return null;
  const event = findRawEvent(bundle, seq);
  if (!event) return null;
  return {
    event,
    payloads: collectPayloadRefs(event.payload).map((ref) => readPayload(bundle.bundlePath, ref)),
    bundlePath: bundle.bundlePath,
  };
};

export const clearCodexTraceBundles = (): void => {
  const rootPath = getCodexTraceRoot();
  for (const bundle of discoverCodexTraceBundles(rootPath)) {
    fs.rmSync(bundle.bundlePath, { recursive: true, force: true });
  }
  replaceCodexTraceBundles([]);
  lastStatus = null;
  lastSyncAt = 0;
};
