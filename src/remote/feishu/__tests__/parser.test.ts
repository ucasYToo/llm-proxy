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
    expect(parseFeishuRemoteCommand("/cc")).toEqual({ kind: "help" });
    expect(parseFeishuRemoteCommand("hello")).toBeNull();
  });

  test("requires permission replies to include request id", () => {
    expect(parsePermissionReply("yes abcde")).toEqual({
      behavior: "allow",
      requestId: "abcde",
    });
    expect(parsePermissionReply("n kmnop")).toEqual({
      behavior: "deny",
      requestId: "kmnop",
    });
    expect(parsePermissionReply("yes")).toBeNull();
    expect(parsePermissionReply("yes abcle")).toBeNull();
  });

  test("extracts text message content", () => {
    expect(parseFeishuTextContent(JSON.stringify({ text: "hello" }))).toBe("hello");
    expect(parseFeishuTextContent("raw")).toBe("raw");
    expect(parseFeishuTextContent({ text: "nope" })).toBe("");
  });
});
