import { randomUUID } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

type RemoteChannelEvent =
  | {
      type: "message";
      messageId: string;
      threadId: string;
      content: string;
      meta: Record<string, string>;
    }
  | {
      type: "permission_verdict";
      requestId: string;
      behavior: "allow" | "deny";
    };

const PermissionRequestSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string().optional(),
    input_preview: z.string().optional(),
  }),
});

const log = (...args: unknown[]): void => {
  console.error("[claude-proxy-channel]", ...args);
};

const env = process.env;
const port = env.CLAUDE_PROXY_REMOTE_PORT || env.CLAUDE_PROXY_PORT || "1998";
const baseUrl =
  env.CLAUDE_PROXY_REMOTE_BASE_URL || `http://localhost:${port}`;
const token = env.CLAUDE_PROXY_REMOTE_TOKEN || "";
const instanceId = env.CLAUDE_PROXY_REMOTE_INSTANCE_ID || randomUUID();

if (!token) {
  log("CLAUDE_PROXY_REMOTE_TOKEN is required");
  process.exit(1);
}

const apiFetch = async (
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Remote-Bridge-Token": token,
      ...(init.headers ?? {}),
    },
  });
};

const mcp = new Server(
  { name: "claude-proxy-remote", version: "0.1.0" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
      tools: {},
    },
    instructions:
      "Remote chat messages arrive as <channel source=\"claude-proxy-remote\" remote_thread_id=\"...\" remote_message_id=\"...\">. " +
      "Treat each inbound channel message as a user message that needs a user-facing answer. " +
      "Send remote answers with the remote_reply tool, passing the exact remote_thread_id from the channel tag. " +
      "Do not rely on terminal-only output for remote users. Set final=true when your user-facing answer is complete.",
  },
);

let lastRemoteThreadId: string | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let stopped = false;

type RemoteMessageEvent = Extract<RemoteChannelEvent, { type: "message" }>;

const formatRemoteChannelContent = (event: RemoteMessageEvent): string => {
  const shortId = event.meta.remote_short_id
    ? `#${event.meta.remote_short_id}`
    : event.threadId;
  const source = event.meta.source || "remote";
  return [
    `Remote user message from ${source} ${shortId}`,
    `remote_thread_id: ${event.threadId}`,
    `remote_message_id: ${event.messageId}`,
    "",
    event.content,
    "",
    "Treat the text above as the current user's new message.",
    `When you reply, call remote_reply with remote_thread_id="${event.threadId}" and text set to the user-facing answer.`,
    "Set final=true once the answer is complete. Do not only print the answer in the local terminal.",
  ].join("\n");
};

const reportDelivery = async (
  messageId: string,
  status: "delivered" | "failed",
  error?: unknown,
): Promise<void> => {
  try {
    await apiFetch("/api/remote/channel/delivery", {
      method: "POST",
      body: JSON.stringify({
        instanceId,
        messageId,
        status,
        error:
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : undefined,
      }),
    });
  } catch (err) {
    log("delivery report failed", err);
  }
};

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "remote_reply",
      description: "Send a user-facing reply back to the remote web/Feishu thread",
      inputSchema: {
        type: "object",
        properties: {
          remote_thread_id: {
            type: "string",
            description: "The remote_thread_id attribute from the inbound channel tag",
          },
          text: {
            type: "string",
            description: "The reply text to send to the remote user",
          },
          final: {
            type: "boolean",
            description: "Whether this is the final answer for the current turn",
          },
        },
        required: ["remote_thread_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "remote_reply") {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  const args = (req.params.arguments ?? {}) as {
    remote_thread_id?: string;
    remoteThreadId?: string;
    text?: string;
    final?: boolean;
  };
  const remoteThreadId = args.remote_thread_id ?? args.remoteThreadId;
  if (!remoteThreadId || !args.text) {
    throw new Error("remote_thread_id and text are required");
  }
  const res = await apiFetch("/api/remote/channel/reply", {
    method: "POST",
    body: JSON.stringify({
      instanceId,
      remote_thread_id: remoteThreadId,
      text: args.text,
      final: !!args.final,
    }),
  });
  if (!res.ok) {
    throw new Error(`remote reply failed: ${await res.text()}`);
  }
  return { content: [{ type: "text", text: "sent" }] };
});

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  const res = await apiFetch("/api/remote/channel/permission-request", {
    method: "POST",
    body: JSON.stringify({
      instanceId,
      request_id: params.request_id,
      tool_name: params.tool_name,
      description: params.description,
      input_preview: params.input_preview,
      remote_thread_id: lastRemoteThreadId,
    }),
  });
  if (!res.ok) {
    log("permission request relay failed", await res.text());
  }
});

const registerInstance = async (): Promise<void> => {
  const res = await apiFetch("/api/remote/channel/register", {
    method: "POST",
    body: JSON.stringify({
      instanceId,
      pid: process.pid,
      cwd: process.cwd(),
      metadata: {
        argv: process.argv,
        node: process.version,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`register failed: ${await res.text()}`);
  }
};

const heartbeat = async (): Promise<void> => {
  try {
    await apiFetch("/api/remote/channel/heartbeat", {
      method: "POST",
      body: JSON.stringify({ instanceId }),
    });
  } catch (err) {
    log("heartbeat failed", err);
  }
};

const sendOffline = async (): Promise<void> => {
  try {
    await apiFetch("/api/remote/channel/offline", {
      method: "POST",
      body: JSON.stringify({ instanceId }),
    });
  } catch {
    // process is exiting; best effort only
  }
};

const parseSse = async (
  res: Response,
  onEvent: (event: RemoteChannelEvent) => Promise<void>,
): Promise<void> => {
  if (!res.body) throw new Error("SSE response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!stopped) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const raw = dataLines.join("\n");
      try {
        await onEvent(JSON.parse(raw) as RemoteChannelEvent);
      } catch (err) {
        log("failed to process SSE event", err);
      }
    }
  }
};

const connectEvents = async (): Promise<void> => {
  while (!stopped) {
    try {
      const url =
        `/api/remote/channel/events?instanceId=${encodeURIComponent(instanceId)}`;
      const res = await fetch(`${baseUrl}${url}`, {
        headers: { "X-Remote-Bridge-Token": token },
      });
      if (!res.ok) throw new Error(`events failed: ${await res.text()}`);
      await parseSse(res, async (event) => {
        if (event.type === "message") {
          lastRemoteThreadId = event.threadId;
          try {
            await mcp.notification({
              method: "notifications/claude/channel",
              params: {
                content: formatRemoteChannelContent(event),
                meta: event.meta,
              },
            });
            await reportDelivery(event.messageId, "delivered");
          } catch (err) {
            await reportDelivery(event.messageId, "failed", err);
            throw err;
          }
        } else if (event.type === "permission_verdict") {
          await mcp.notification({
            method: "notifications/claude/channel/permission",
            params: {
              request_id: event.requestId,
              behavior: event.behavior,
            },
          });
        }
      });
    } catch (err) {
      log("event stream disconnected", err);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
};

const main = async (): Promise<void> => {
  await mcp.connect(new StdioServerTransport());
  await registerInstance();
  heartbeatTimer = setInterval(() => void heartbeat(), 15_000);
  void heartbeat();
  void connectEvents();
};

const shutdown = (): void => {
  stopped = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  void sendOffline().finally(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  stopped = true;
});

void main().catch((err) => {
  log(err);
  process.exit(1);
});
