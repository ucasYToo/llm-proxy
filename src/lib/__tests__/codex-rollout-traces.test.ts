import fs from "fs";
import os from "os";
import path from "path";
import {
  CODEX_ROLLOUT_TRACE_ROOT_ENV,
  discoverCodexTraceBundles,
  getCodexTraceEventDetail,
  getCodexTraceEventsForSession,
  pruneCodexTraceBundles,
  startCodexTraceCapture,
  stopCodexTraceCapture,
  syncCodexTraceIndex,
} from "../codex-rollout-traces";
import { closeCodexDb, queryCodexTraceBundles } from "../../storage/codex";

const writeBundle = (input: {
  root: string;
  id: string;
  sessionId: string;
  startedAt: number;
  reasoning: string;
}): string => {
  const bundlePath = path.join(input.root, `trace-${input.id}-${input.sessionId}`);
  const payloads = path.join(bundlePath, "payloads");
  fs.mkdirSync(payloads, { recursive: true });
  fs.writeFileSync(
    path.join(bundlePath, "manifest.json"),
    JSON.stringify({
      schema_version: 1,
      trace_id: input.id,
      rollout_id: input.sessionId,
      root_thread_id: input.sessionId,
      started_at_unix_ms: input.startedAt,
      raw_event_log: "trace.jsonl",
      payloads_dir: "payloads",
    }),
  );
  fs.writeFileSync(
    path.join(payloads, "1.json"),
    JSON.stringify({
      output_items: [{ type: "reasoning", content: [{ type: "text", text: input.reasoning }] }],
    }),
  );
  fs.writeFileSync(
    path.join(bundlePath, "trace.jsonl"),
    `${JSON.stringify({
      schema_version: 1,
      seq: 1,
      wall_time_unix_ms: input.startedAt + 1,
      rollout_id: input.sessionId,
      thread_id: input.sessionId,
      codex_turn_id: "turn-1",
      payload: {
        type: "inference_completed",
        inference_call_id: "call-1",
        response_id: "response-1",
        response_payload: {
          raw_payload_id: "raw_payload:1",
          kind: { type: "inference_response" },
          path: "payloads/1.json",
        },
      },
    })}\n`,
  );
  return bundlePath;
};

describe("Codex Rollout Trace integration", () => {
  let directory: string;
  let root: string;
  const previousDb = process.env.CLAUDE_PROXY_CODEX_DB_PATH;
  const previousRoot = process.env.CLAUDE_PROXY_CODEX_TRACE_ROOT;
  const previousSkip = process.env.CLAUDE_PROXY_CODEX_TRACE_SKIP_LAUNCHCTL;
  const previousTrace = process.env[CODEX_ROLLOUT_TRACE_ROOT_ENV];

  beforeEach(() => {
    closeCodexDb();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-trace-"));
    root = path.join(directory, "traces");
    process.env.CLAUDE_PROXY_CODEX_DB_PATH = path.join(directory, "codex.db");
    process.env.CLAUDE_PROXY_CODEX_TRACE_ROOT = root;
    process.env.CLAUDE_PROXY_CODEX_TRACE_SKIP_LAUNCHCTL = "1";
    delete process.env[CODEX_ROLLOUT_TRACE_ROOT_ENV];
  });

  afterEach(() => {
    stopCodexTraceCapture();
    closeCodexDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  afterAll(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("CLAUDE_PROXY_CODEX_DB_PATH", previousDb);
    restore("CLAUDE_PROXY_CODEX_TRACE_ROOT", previousRoot);
    restore("CLAUDE_PROXY_CODEX_TRACE_SKIP_LAUNCHCTL", previousSkip);
    restore(CODEX_ROLLOUT_TRACE_ROOT_ENV, previousTrace);
  });

  it("indexes only bundle paths and reads reasoning from the Codex payload on demand", () => {
    const bundlePath = writeBundle({
      root,
      id: "trace-1",
      sessionId: "session-1",
      startedAt: 1_700_000_000_000,
      reasoning: "private local reasoning",
    });

    const status = syncCodexTraceIndex();
    expect(status.bundleCount).toBe(1);
    expect(queryCodexTraceBundles()).toEqual([
      expect.objectContaining({
        id: "trace-1",
        sessionId: "session-1",
        bundlePath,
      }),
    ]);

    const events = getCodexTraceEventsForSession("session-1");
    expect(events).toEqual([
      expect.objectContaining({ eventType: "inference_completed", hasPayload: true }),
    ]);
    expect(getCodexTraceEventDetail("trace-1", 1)).toEqual(
      expect.objectContaining({
        payloads: [
          expect.objectContaining({
            kind: "inference_response",
            content: expect.objectContaining({
              output_items: [
                expect.objectContaining({ content: [{ type: "text", text: "private local reasoning" }] }),
              ],
            }),
          }),
        ],
      }),
    );
  });

  it("removes the oldest bundles when the configured byte budget is exceeded", () => {
    const older = writeBundle({
      root,
      id: "trace-old",
      sessionId: "session-old",
      startedAt: 1_700_000_000_000,
      reasoning: "old",
    });
    const newer = writeBundle({
      root,
      id: "trace-new",
      sessionId: "session-new",
      startedAt: 1_700_000_001_000,
      reasoning: "new",
    });
    const discovered = discoverCodexTraceBundles(root);
    const newerBytes = discovered.find((bundle) => bundle.bundlePath === newer)?.sizeBytes ?? 0;

    const result = pruneCodexTraceBundles(root, newerBytes);

    expect(result.removed).toContain(older);
    expect(fs.existsSync(older)).toBe(false);
    expect(fs.existsSync(newer)).toBe(true);
    expect(result.usedBytes).toBeLessThanOrEqual(newerBytes);
  });

  it("keeps raw capture off by default and toggles it explicitly", () => {
    expect(syncCodexTraceIndex().configured).toBe(false);
    expect(startCodexTraceCapture().configured).toBe(true);
    expect(process.env[CODEX_ROLLOUT_TRACE_ROOT_ENV]).toBe(root);
    expect(stopCodexTraceCapture().configured).toBe(false);
    expect(process.env[CODEX_ROLLOUT_TRACE_ROOT_ENV]).toBeUndefined();
  });
});
