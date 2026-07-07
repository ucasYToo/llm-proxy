import {
  createInitialProgressSnapshot,
  markProgressFailed,
  reduceClaudeStreamEvent,
} from "../progress";
import { buildFeishuProgressCard } from "../feishu-card";
import { buildClaudePrintArgv, parseClaudeStreamLine } from "../cli-runner";
import type { RemoteMessage, RemoteThread } from "../../storage/remote";

const thread: RemoteThread = {
  id: "thread-1",
  shortId: "abc12345",
  source: "feishu",
  sourceBotId: null,
  sourceThreadId: "chat",
  sourceUserId: "user",
  sourceChatId: "chat",
  cwd: "/Users/me/project",
  claudeSessionId: null,
  channelInstanceId: null,
  status: "running",
  title: "hello",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastMessageAt: null,
};

const message: RemoteMessage = {
  id: "message-1",
  threadId: "thread-1",
  direction: "inbound",
  source: "feishu",
  sourceBotId: null,
  sourceMessageId: "om_1",
  sourceUserId: "user",
  text: "请读取文件并总结",
  status: "sent",
  error: null,
  raw: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  deliveredAt: null,
};

describe("remote progress", () => {
  test("reduces tool, text and final events", () => {
    let snapshot = createInitialProgressSnapshot({ thread, message });
    snapshot = reduceClaudeStreamEvent(snapshot, {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "tool_use", name: "Read" },
        ],
      },
    });
    snapshot = reduceClaudeStreamEvent(snapshot, {
      type: "assistant",
      message: { content: [{ type: "text", text: "这是预览" }] },
    });
    snapshot = reduceClaudeStreamEvent(snapshot, {
      type: "result",
      is_error: false,
      result: "最终回复",
      session_id: "s1",
    });

    expect(snapshot.status).toBe("done");
    expect(snapshot.tools).toContain("Read");
    expect(snapshot.answerPreview).toBe("最终回复");
    expect(JSON.stringify(snapshot)).not.toContain("hidden");
  });

  test("marks failures with visible error", () => {
    const snapshot = createInitialProgressSnapshot({ thread, message });
    const failed = markProgressFailed(snapshot, "boom");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("boom");
  });
});

describe("feishu progress card", () => {
  test("builds compact shared interactive card config", () => {
    const snapshot = {
      ...createInitialProgressSnapshot({ thread, message }),
      status: "done" as const,
      phase: "已完成",
      events: ["已接收远程消息", "Claude 正在处理", "生成完成"],
      answerPreview: "回复预览不应出现在卡片内",
      finalText: "最终回复不应出现在卡片内",
      elapsedMs: 7000,
    };
    const card = buildFeishuProgressCard(snapshot);
    const json = JSON.stringify(card);
    expect(card.config).toMatchObject({
      wide_screen_mode: true,
      update_multi: true,
    });
    expect(json).toContain("#abc12345");
    expect(json).toContain("**项目**");
    expect(json).toContain("**状态** 已完成");
    expect(json).toContain("**耗时** 7s");
    expect(json).toContain("**过程**");
    expect(json).not.toContain("用户消息");
    expect(json).not.toContain("最终回复");
    expect(json).not.toContain("回复预览");
    expect(json).not.toContain(message.text);
  });
});

describe("claude stream parser", () => {
  test("parses json lines and ignores malformed lines", () => {
    expect(parseClaudeStreamLine('{"type":"result","result":"ok"}')).toEqual({
      type: "result",
      result: "ok",
    });
    expect(parseClaudeStreamLine("not json")).toBeNull();
  });

  test("uses verbose mode for stream-json print output", () => {
    const argv = buildClaudePrintArgv({
      config: { claudeCommand: "claude" },
      prompt: "hello",
      resumeSessionId: "session-1",
    });
    expect(argv).toEqual(
      expect.arrayContaining([
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--include-hook-events",
        "--resume",
        "session-1",
        "--",
      ]),
    );
    expect(argv.at(-1)).toBe("hello");
  });
});
