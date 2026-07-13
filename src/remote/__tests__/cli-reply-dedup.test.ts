import type { RemoteMessage, RemoteThread } from "../../storage/remote";
import { readConfig } from "../../config/store";
import { runClaudePrint } from "../cli-runner";
import {
  receiveRemoteReply,
  registerRemoteOutboundSender,
  sendRemoteMessage,
} from "../service";

const mockThreads = new Map<string, RemoteThread>();
const mockMessages = new Map<string, RemoteMessage>();
let mockNextId = 1;

jest.mock("../../config/store", () => ({
  readConfig: jest.fn(),
}));

jest.mock("../../core/session", () => ({
  getKnownProjects: jest.fn(() => []),
}));

jest.mock("../../server/state", () => ({
  getServerPort: jest.fn(() => 1998),
}));

jest.mock("../cli-runner", () => ({
  runClaudePrint: jest.fn(),
}));

jest.mock("../../storage/remote", () => {
  const timestamp = "2026-07-13T00:00:00.000Z";
  const createThread = (input: Record<string, unknown>): RemoteThread => {
    const id = `thread-${mockNextId++}`;
    const thread: RemoteThread = {
      id,
      shortId: id.slice(-8).padStart(8, "0"),
      source: input.source as RemoteThread["source"],
      sourceBotId: (input.sourceBotId as string | null | undefined) ?? null,
      sourceThreadId: (input.sourceThreadId as string | null | undefined) ?? null,
      sourceUserId: (input.sourceUserId as string | null | undefined) ?? null,
      sourceChatId: (input.sourceChatId as string | null | undefined) ?? null,
      cwd: (input.cwd as string | null | undefined) ?? null,
      claudeSessionId: (input.claudeSessionId as string | null | undefined) ?? null,
      channelInstanceId: null,
      status: "pending",
      title: (input.title as string | null | undefined) ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastMessageAt: null,
    };
    mockThreads.set(id, thread);
    return thread;
  };
  const insertMessage = (input: Record<string, unknown>): RemoteMessage => {
    const id = `message-${mockNextId++}`;
    const message: RemoteMessage = {
      id,
      threadId: input.threadId as string,
      direction: input.direction as RemoteMessage["direction"],
      source: input.source as RemoteMessage["source"],
      sourceBotId: (input.sourceBotId as string | null | undefined) ?? null,
      sourceMessageId: (input.sourceMessageId as string | null | undefined) ?? null,
      sourceUserId: (input.sourceUserId as string | null | undefined) ?? null,
      text: input.text as string,
      status: (input.status as RemoteMessage["status"] | undefined) ?? "queued",
      error: (input.error as string | null | undefined) ?? null,
      raw: input.raw ?? null,
      createdAt: timestamp,
      deliveredAt: null,
    };
    mockMessages.set(id, message);
    return message;
  };
  return {
    createRemotePermission: jest.fn(),
    createRemoteThread: jest.fn(createThread),
    findLatestInstanceForCwd: jest.fn(() => null),
    findLatestRemoteThreadForSource: jest.fn(() => null),
    findRemoteMessageBySource: jest.fn(() => null),
    getRemoteChannelInstance: jest.fn(() => null),
    getRemoteMessage: jest.fn((id: string) => mockMessages.get(id) ?? null),
    getRemoteThread: jest.fn((id: string) => mockThreads.get(id) ?? null),
    heartbeatRemoteChannelInstance: jest.fn(() => null),
    insertRemoteMessage: jest.fn(insertMessage),
    markRemoteChannelInstanceOffline: jest.fn(),
    queryRemoteChannelInstances: jest.fn(() => ({ instances: [], total: 0 })),
    queryRemoteMessages: jest.fn(() => ({ messages: [], total: 0 })),
    queryRemotePermissions: jest.fn(() => ({ permissions: [], total: 0 })),
    queryRemoteThreads: jest.fn(() => ({ threads: [], total: 0 })),
    resolveRemotePermissionById: jest.fn(() => null),
    updateRemoteMessageStatus: jest.fn((id: string, status: RemoteMessage["status"], error?: string | null) => {
      const message = mockMessages.get(id);
      if (!message) return null;
      message.status = status;
      message.error = error ?? null;
      return message;
    }),
    updateRemoteThread: jest.fn((id: string, changes: Partial<RemoteThread>) => {
      const thread = mockThreads.get(id);
      if (!thread) return null;
      Object.assign(thread, changes);
      return thread;
    }),
    upsertRemoteChannelInstance: jest.fn(),
  };
});

const mockedReadConfig = readConfig as jest.MockedFunction<typeof readConfig>;
const mockedRunClaudePrint = runClaudePrint as jest.MockedFunction<
  typeof runClaudePrint
>;

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("timed out waiting for remote CLI task");
};

describe("CLI remote reply delivery", () => {
  let unregisterSender: (() => void) | null = null;

  beforeEach(() => {
    mockThreads.clear();
    mockMessages.clear();
    mockNextId = 1;
    jest.clearAllMocks();
    mockedReadConfig.mockReturnValue({
      activeTarget: "",
      targets: [],
      logCollection: {
        captureOriginalBody: false,
        captureRawStreamEvents: false,
      },
      channels: [],
      remoteBridge: {
        enabled: true,
        authToken: "test-token",
        deliveryMode: "cli",
        allowedCwds: [process.cwd()],
        claudeCommand: "claude",
        permissionMode: "default",
        web: { enabled: true },
        feishu: { enabled: false, bots: [] },
      },
    });
  });

  afterEach(() => {
    unregisterSender?.();
    unregisterSender = null;
  });

  it("does not forward the CLI result after an explicit remote_reply", async () => {
    const outbound: string[] = [];
    unregisterSender = registerRemoteOutboundSender((_thread, message) => {
      outbound.push(message.text);
    });

    let threadId = "";
    mockedRunClaudePrint.mockImplementation(async () => {
      await receiveRemoteReply({
        remoteThreadId: threadId,
        text: "已通过 remote_reply 发送",
        final: true,
      });
      return {
        ok: true,
        text: "CLI 自动最终文本，不应再次发送",
        sessionId: "session-1",
        command: "claude -p",
      };
    });

    const result = sendRemoteMessage({
      source: "web",
      cwd: process.cwd(),
      text: "请处理这个任务",
    });
    threadId = result.thread.id;

    await waitFor(() => outbound.length === 1);

    expect(outbound).toEqual(["已通过 remote_reply 发送"]);
    expect(
      [...mockMessages.values()].find(
        (message) => message.direction === "inbound",
      )?.status,
    ).toBe("delivered");
  });

  it("forwards the CLI result when no explicit remote_reply was sent", async () => {
    const outbound: string[] = [];
    unregisterSender = registerRemoteOutboundSender((_thread, message) => {
      outbound.push(message.text);
    });
    mockedRunClaudePrint.mockResolvedValue({
      ok: true,
      text: "CLI 最终文本",
      sessionId: "session-1",
      command: "claude -p",
    });

    sendRemoteMessage({
      source: "web",
      cwd: process.cwd(),
      text: "请处理这个任务",
    });

    await waitFor(() => outbound.length === 1);

    expect(outbound).toEqual(["CLI 最终文本"]);
  });
});
