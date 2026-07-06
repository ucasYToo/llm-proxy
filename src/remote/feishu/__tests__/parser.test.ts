import {
  parseFeishuRemoteCommand,
  parseFeishuTextContent,
  parsePermissionReply,
} from "../parser";

describe("feishu remote parser", () => {
  test("parses cc commands", () => {
    expect(parseFeishuRemoteCommand("/cc projects")).toEqual({ kind: "projects" });
    expect(parseFeishuRemoteCommand("/cc status")).toEqual({ kind: "status" });
    expect(parseFeishuRemoteCommand("/cc use 2")).toEqual({ kind: "use", target: "2" });
    expect(parseFeishuRemoteCommand("/cc new 小星 写测试")).toEqual({
      kind: "new",
      input: "小星 写测试",
    });
    expect(parseFeishuRemoteCommand("/cc continue abc123 继续写")).toEqual({
      kind: "continue",
      threadId: "abc123",
      prompt: "继续写",
    });
    expect(parseFeishuRemoteCommand("/cc")).toEqual({ kind: "help" });
    expect(parseFeishuRemoteCommand("hello")).toBeNull();
  });

  test("parses direct slash commands", () => {
    expect(parseFeishuRemoteCommand("/help")).toEqual({ kind: "help" });
    expect(parseFeishuRemoteCommand("/projects")).toEqual({ kind: "projects" });
    expect(parseFeishuRemoteCommand("/status")).toEqual({ kind: "status" });
    expect(parseFeishuRemoteCommand("/use abc123")).toEqual({ kind: "use", target: "abc123" });
    expect(parseFeishuRemoteCommand("/new 写一个测试")).toEqual({
      kind: "new",
      input: "写一个测试",
    });
    expect(parseFeishuRemoteCommand("/continue abc123 继续写")).toEqual({
      kind: "continue",
      threadId: "abc123",
      prompt: "继续写",
    });
    expect(parseFeishuRemoteCommand("/model opus")).toBeNull();
  });

  test("requires permission replies to include request id", () => {
    expect(parsePermissionReply("yes abcde")).toEqual({
      behavior: "allow",
      requestId: "abcde",
    });
    expect(parsePermissionReply("同意 req_123")).toEqual({
      behavior: "allow",
      requestId: "req_123",
    });
    expect(parsePermissionReply("n kmnop")).toEqual({
      behavior: "deny",
      requestId: "kmnop",
    });
    expect(parsePermissionReply("yes")).toBeNull();
    expect(parsePermissionReply("yes ab")).toBeNull();
  });

  test("extracts text message content", () => {
    expect(parseFeishuTextContent(JSON.stringify({ text: "hello" }))).toBe("hello");
    expect(parseFeishuTextContent("raw")).toBe("raw");
    expect(parseFeishuTextContent({ text: "nope" })).toBe("");
  });
});
