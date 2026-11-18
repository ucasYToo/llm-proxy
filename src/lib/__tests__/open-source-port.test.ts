import fs from "fs";
import os from "os";
import path from "path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-port-test-"));
const before = {
  home: process.env.HOME,
  claude: process.env.CLAUDE_CONFIG_DIR,
  raw: process.env.CLAUDE_PROXY_RAW_API_BODIES_DIR,
};
let settings: typeof import("../claude-settings"),
  capture: typeof import("../raw-capture"),
  raw: typeof import("../raw-settings");
let db: ReturnType<typeof import("../../storage/db").getDb>;
let logs: typeof import("../../storage/logs"),
  correlation: typeof import("../../storage/request-correlation");
beforeAll(() => {
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = path.join(home, "claude");
  delete process.env.CLAUDE_PROXY_RAW_API_BODIES_DIR;
  jest.resetModules();
  settings = require("../claude-settings");
  raw = require("../raw-settings");
  capture = require("../raw-capture");
  db = require("../../storage/db").getDb();
  logs = require("../../storage/logs");
  correlation = require("../../storage/request-correlation");
});
afterAll(() => {
  require("../../storage/db").closeDb();
  for (const [key, value] of Object.entries({
    HOME: before.home,
    CLAUDE_CONFIG_DIR: before.claude,
    CLAUDE_PROXY_RAW_API_BODIES_DIR: before.raw,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
});
test("repair mixed hooks, preserve user commands and report old ports", () => {
  const user = { type: "command", command: "echo user" };
  settings.changeClaudeSettings((s) => {
    s.hooks = {
      Stop: [
        {
          hooks: [
            { type: "http", url: "http://localhost:1998/api/hooks/Stop" },
            user,
          ],
        },
      ],
    };
    s.env = { CUSTOM: "yes" };
  });
  settings.installHooks(2998);
  settings.installHooks(2998);
  expect(settings.getManagedHookStatus(2998).installed).toBe(true);
  expect(settings.getManagedHookStatus(1998).installed).toBe(false);
  expect(
    settings.readClaudeSettings().hooks.SessionStart[0].hooks[0].command,
  ).toContain("hook forward SessionStart");
  settings.uninstallHooks();
  expect(settings.readClaudeSettings()).toEqual({
    env: { CUSTOM: "yes" },
    hooks: { Stop: [{ hooks: [user] }] },
  });
});
test("OTLP and capture preserve user settings on conflict and uninstall", () => {
  settings.changeClaudeSettings((s) => {
    s.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://collector.test";
  });
  expect(() => raw.configureRaw("timing", true, 1998)).toThrow();
  settings.changeClaudeSettings((s) => {
    delete s.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    s.env.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
  });
  expect(raw.configureRaw("timing", true, 1998).timing).toBe("installed");
  expect(raw.rawStatus(2998).timing).toBe("port-mismatch");
  raw.configureRaw("timing", false, 1998);
  expect(settings.readClaudeSettings().env).toEqual({
    CUSTOM: "yes",
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  });
});
test("partial index, cross-source arrival order, redaction, replay and late timing", () => {
  raw.configureRaw("raw", true, 1998);
  const dir = raw.rawDir(),
    index = path.join(dir, "index.jsonl");
  const stamp = new Date().toISOString();
  const response = (id: string) => ({
    id: "msg_" + id,
    model: "claude-sonnet-4",
    usage: { input_tokens: 5, output_tokens: 7 },
    content: [
      { type: "thinking", thinking: "PRIVATE-CANARY" },
      { type: "text", text: "ok" },
    ],
  });
  const write = (id: string) => {
    const row = {
      session_id: "session",
      request_id: id,
      message_id: "msg_" + id,
      model: "claude-sonnet-4",
      query_source: "repl_main_thread",
      request_file: id + ".request.json",
      response_file: id + ".response.json",
      timestamp: stamp,
    };
    fs.writeFileSync(
      path.join(dir, row.request_file),
      JSON.stringify({ messages: ["PRIVATE-REQUEST"] }),
    );
    fs.writeFileSync(
      path.join(dir, row.response_file),
      JSON.stringify(response(id)),
    );
    return JSON.stringify(row);
  };
  const proxy = (id: string) => {
    logs.createLog({
      id: "proxy-" + id,
      timestamp: stamp,
      targetId: "target",
      targetName: "target",
      sessionId: "session",
      method: "POST",
      path: "/messages",
      originalRequestHeaders: {},
      modifiedRequestHeaders: {},
      originalRequestBody: null,
      modifiedRequestBody: null,
      responseStatus: 0,
      durationMs: 0,
      responseBody: null,
      status: "pending",
    });
    correlation.finishProxyLog(
      "proxy-" + id,
      "session",
      new Headers({ "request-id": id }),
      response(id),
      {
        responseBody: response(id),
        responseStatus: 200,
        tokenUsage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
        status: "completed",
        durationMs: 40,
      },
    );
  };
  const line = write("one");
  fs.writeFileSync(index, line);
  capture.ingestRaw();
  expect(logs.queryLogs().total).toBe(0);
  fs.appendFileSync(index, "\n");
  capture.ingestRaw();
  expect(logs.queryLogs().total).toBe(1);
  expect(JSON.stringify(logs.queryLogs())).not.toMatch(/PRIVATE/);
  proxy("one");
  proxy("two");
  fs.appendFileSync(index, write("two") + "\n" + write("three") + "\n");
  capture.ingestRaw();
  expect(logs.queryLogs().total).toBe(3);
  expect(logs.queryLogs({ source: "file" }).total).toBe(1);
  expect(logs.queryLogs({ source: "file" }).entries[0].durationMs).toBeNull();
  expect(db.prepare("SELECT count(*) n FROM cost_records").get()).toEqual({
    n: 3,
  });
  capture.recordTimings({
    resourceLogs: [
      {
        scopeLogs: [
          {
            logRecords: [
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "api_request" } },
                  { key: "request_id", value: { stringValue: "three" } },
                  { key: "duration_ms", value: { intValue: "230" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  expect(logs.queryLogs({ source: "file" }).entries[0].durationMs).toBe(230);
  fs.appendFileSync(index, line + "\n");
  capture.ingestRaw();
  expect(
    db
      .prepare("SELECT count(*) n,SUM(totalTokens) tokens FROM cost_records")
      .get(),
  ).toEqual({ n: 3, tokens: 36 });
  expect(fs.readdirSync(dir)).toEqual(["index.jsonl"]);
  raw.configureRaw("raw", false, 1998);
  expect(raw.configureRaw("raw", true, 1998).enabled).toBe(true);
  fs.appendFileSync(index, "x".repeat(1100000) + "\n" + write("four") + "\n");
  capture.ingestRaw();
  capture.ingestRaw();
  expect(logs.queryLogs().total).toBe(4);
  const distinct = JSON.parse(write("five"));
  distinct.message_id = "msg_four";
  fs.appendFileSync(index, JSON.stringify(distinct) + "\n");
  capture.ingestRaw();
  expect(logs.queryLogs().total).toBe(5);
  expect(db.prepare("SELECT count(*) n FROM cost_records").get()).toEqual({
    n: 5,
  });
  raw.configureRaw("raw", false, 1998);
});
test("malformed Claude settings survive install", () => {
  fs.writeFileSync(settings.CLAUDE_SETTINGS_PATH, "{");
  expect(() => settings.installHooks(1998)).toThrow();
  expect(fs.readFileSync(settings.CLAUDE_SETTINGS_PATH, "utf8")).toBe("{");
});
