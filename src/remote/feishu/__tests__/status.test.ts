import { buildFeishuStatusContextLines } from "../status";

describe("Feishu status context", () => {
  test("includes user, remote thread, chat and source thread ids", () => {
    expect(
      buildFeishuStatusContextLines({
        senderId: "ou_user",
        chatId: "oc_chat",
        sourceThreadId: "om_root",
        remoteThreadId: "remote-thread-id",
        remoteThreadShortId: "abc12345",
      }),
    ).toEqual([
      "当前上下文",
      "当前用户飞书 ID：ou_user",
      "当前对话 ID：remote-thread-id",
      "当前对话短 ID：#abc12345",
      "当前群/私聊 ID（Chat ID）：oc_chat",
      "当前消息链 ID：om_root",
    ]);
  });

  test("uses explicit placeholders when no remote thread is active", () => {
    const lines = buildFeishuStatusContextLines({
      senderId: null,
      chatId: "oc_chat",
      sourceThreadId: "oc_chat",
    });

    expect(lines).toContain("当前用户飞书 ID：未知");
    expect(lines).toContain("当前对话 ID：暂无");
    expect(lines).toContain("当前对话短 ID：暂无");
  });
});
