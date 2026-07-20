import fs from "fs";
import os from "os";
import path from "path";
import {
  clearCodexData,
  closeCodexDb,
  getCodexHook,
  getCodexOverview,
  getCodexSessionTimeline,
  insertCodexHook,
  queryCodexSessions,
} from "../codex";

describe("independent Codex storage", () => {
  let directory: string;
  const previousPath = process.env.CLAUDE_PROXY_CODEX_DB_PATH;

  beforeEach(() => {
    closeCodexDb();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-db-"));
    process.env.CLAUDE_PROXY_CODEX_DB_PATH = path.join(directory, "codex.db");
  });

  afterEach(() => {
    closeCodexDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  afterAll(() => {
    if (previousPath === undefined) delete process.env.CLAUDE_PROXY_CODEX_DB_PATH;
    else process.env.CLAUDE_PROXY_CODEX_DB_PATH = previousPath;
  });

  it("stores a hook-only conversation timeline in the Codex database", () => {
    insertCodexHook({
      eventName: "UserPromptSubmit",
      sessionId: "session-codex-1",
      cwd: "/tmp/project",
      payload: { prompt: "Inspect the repository", model: "gpt-5" },
    });
    insertCodexHook({
      eventName: "Stop",
      sessionId: "session-codex-1",
      cwd: "/tmp/project",
      payload: { last_assistant_message: "Repository inspected", model: "gpt-5" },
    });

    const sessions = queryCodexSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: "session-codex-1",
      title: "Inspect the repository",
      cwd: "/tmp/project",
      eventCount: 2,
      promptCount: 1,
      replyCount: 1,
      lastAssistantMessage: "Repository inspected",
    });
    expect(getCodexSessionTimeline("session-codex-1").map((entry) => entry.kind)).toEqual([
      "hook",
      "hook",
    ]);
    expect(getCodexOverview()).toMatchObject({
      sessionCount: 1,
      hookCount: 2,
      promptCount: 1,
      replyCount: 1,
    });

    clearCodexData();
    expect(getCodexOverview()).toEqual({
      sessionCount: 0,
      hookCount: 0,
      promptCount: 0,
      replyCount: 0,
      traceBundleCount: 0,
    });
  });

  it("keeps large tool responses out of timeline summaries and loads them on demand", () => {
    const entry = insertCodexHook({
      eventName: "PostToolUse",
      sessionId: "session-codex-large",
      toolName: "view_image",
      cwd: "/tmp/project",
      payload: {
        tool_input: { path: "/tmp/image.png" },
        tool_response: "x".repeat(128 * 1024),
      },
    });

    const timeline = getCodexSessionTimeline("session-codex-large");
    expect(timeline).toHaveLength(1);
    expect(timeline[0].hook.payload).toBeNull();
    expect(getCodexHook(entry.id)?.payload).toMatchObject({
      tool_input: { path: "/tmp/image.png" },
    });
    expect(
      ((getCodexHook(entry.id)?.payload as { tool_response: string }).tool_response).length,
    ).toBe(128 * 1024);
  });
});
