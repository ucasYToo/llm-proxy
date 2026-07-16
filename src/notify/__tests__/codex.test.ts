import type { HookEntry } from "../../storage/hooks";
import {
  buildCodexWebhookMessage,
  codexWebhookEventKey,
} from "../codex";

const entry = (overrides: Partial<HookEntry> = {}): HookEntry => ({
  id: "hook-1",
  sessionId: "session-abcdef",
  eventName: "Stop",
  toolName: null,
  cwd: "/workspace/example",
  projectRoot: "/workspace/example",
  payload: { last_assistant_message: "任务已经完成。" },
  createdAt: "2026-07-16T12:00:00.000Z",
  ...overrides,
});

describe("Codex webhook notifications", () => {
  test("maps supported Codex events to the shared channel switches", () => {
    expect(codexWebhookEventKey("Stop")).toBe("stop");
    expect(codexWebhookEventKey("SubagentStop")).toBe("subagentStop");
    expect(codexWebhookEventKey("PermissionRequest")).toBe("notification");
    expect(codexWebhookEventKey("PostToolUse")).toBeNull();
  });

  test("builds a Codex completion notification with the final reply", () => {
    const message = buildCodexWebhookMessage(
      entry(),
      new Date("2026-07-16T12:00:00.000Z"),
    );
    expect(message.title).toBe("Codex · example");
    expect(message.eventLabel).toBe("任务完成");
    expect(message.dingTalkMarkdown).toContain("任务已经完成。");
    expect(message.feishuText).toContain("session: abcdef");
  });

  test("labels permission requests with the tool name", () => {
    const message = buildCodexWebhookMessage(
      entry({
        eventName: "PermissionRequest",
        toolName: "Bash",
        payload: { tool_name: "Bash" },
      }),
      new Date("2026-07-16T12:00:00.000Z"),
    );
    expect(message.eventLabel).toBe("等待授权 · Bash");
    expect(message.feishuText).toContain("tool: Bash");
  });
});
