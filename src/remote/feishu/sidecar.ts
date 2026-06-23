import crypto from "crypto";
import pkg from "../../../package.json";
import { readConfig } from "../../config/store";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

interface SidecarOptions {
  port: number;
  host?: string;
  id?: string;
  pollIntervalMs?: number;
}

interface QueueItem {
  kind: "channel" | "permission";
  content?: string;
  meta?: Record<string, string>;
  requestId?: string;
  behavior?: "allow" | "deny";
}

let lastChatId = "";

const log = (message: string): void => {
  process.stderr.write(`[feishu-remote-sidecar] ${message}\n`);
};

const send = (message: JsonRpcMessage): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const ok = (id: JsonRpcMessage["id"], result: unknown): void => {
  send({ jsonrpc: "2.0", id, result });
};

const fail = (
  id: JsonRpcMessage["id"],
  code: number,
  message: string,
): void => {
  send({ jsonrpc: "2.0", id, error: { code, message } });
};

const apiBase = (options: SidecarOptions): string => {
  const host = options.host ?? "localhost";
  return `http://${host}:${options.port}`;
};

const postJson = async <T>(
  options: SidecarOptions,
  path: string,
  body: unknown,
): Promise<T> => {
  const res = await fetch(`${apiBase(options)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};

const getSecret = (): string => {
  const secret = readConfig().feishuRemote?.sidecarSecret;
  if (!secret) {
    throw new Error("feishuRemote.sidecarSecret is not configured");
  }
  return secret;
};

const register = async (
  options: SidecarOptions,
  id: string,
  secret: string,
): Promise<void> => {
  await postJson(options, "/api/feishu-remote/sidecar/register", {
    id,
    cwd: process.cwd(),
    pid: process.pid,
    version: pkg.version,
    secret,
  });
};

const poll = async (
  options: SidecarOptions,
  id: string,
  secret: string,
): Promise<QueueItem[]> => {
  const data = await postJson<{ messages?: QueueItem[] }>(
    options,
    "/api/feishu-remote/sidecar/poll",
    { id, secret },
  );
  return data.messages ?? [];
};

const sendChannel = (item: QueueItem): void => {
  if (!item.content) return;
  if (item.meta?.chat_id) {
    lastChatId = item.meta.chat_id;
  }
  send({
    jsonrpc: "2.0",
    method: "notifications/claude/channel",
    params: {
      content: item.content,
      meta: item.meta ?? {},
    },
  });
};

const sendPermission = (item: QueueItem): void => {
  if (!item.requestId || !item.behavior) return;
  send({
    jsonrpc: "2.0",
    method: "notifications/claude/channel/permission",
    params: {
      request_id: item.requestId,
      behavior: item.behavior,
    },
  });
};

const startPolling = (
  options: SidecarOptions,
  id: string,
  secret: string,
): void => {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void poll(options, id, secret)
      .then((items) => {
        for (const item of items) {
          if (item.kind === "channel") sendChannel(item);
          if (item.kind === "permission") sendPermission(item);
        }
      })
      .catch((err) => log(`poll failed: ${String(err)}`))
      .finally(() => {
        running = false;
      });
  }, pollIntervalMs);
};

const handleToolCall = async (
  options: SidecarOptions,
  secret: string,
  id: JsonRpcMessage["id"],
  params: Record<string, unknown>,
): Promise<void> => {
  const name = params.name;
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  if (name !== "reply") {
    fail(id, -32601, `unknown tool: ${String(name)}`);
    return;
  }
  const chatId = String(args.chat_id ?? "");
  const text = String(args.text ?? "");
  if (!chatId || !text) {
    fail(id, -32602, "reply requires chat_id and text");
    return;
  }
  await postJson(options, "/api/feishu-remote/sidecar/reply", {
    chatId,
    text,
    secret,
  });
  ok(id, { content: [{ type: "text", text: "sent" }] });
};

const handlePermissionRequest = async (
  options: SidecarOptions,
  secret: string,
  params: Record<string, unknown>,
): Promise<void> => {
  const chatIdFromMeta =
    typeof params.meta === "object" && params.meta
      ? String((params.meta as Record<string, unknown>).chat_id ?? "")
      : "";
  const chatId = chatIdFromMeta || lastChatId;
  await postJson(options, "/api/feishu-remote/sidecar/permission-request", {
    cwd: process.cwd(),
    chatId,
    requestId: String(params.request_id ?? ""),
    toolName: String(params.tool_name ?? ""),
    description: String(params.description ?? ""),
    inputPreview: String(params.input_preview ?? ""),
    secret,
  });
};

const handleMessage = async (
  options: SidecarOptions,
  secret: string,
  message: JsonRpcMessage,
): Promise<void> => {
  const { id, method, params = {} } = message;
  try {
    if (method === "initialize") {
      ok(id, {
        protocolVersion: params.protocolVersion ?? "2024-11-05",
        capabilities: {
          experimental: {
            "claude/channel": {},
            "claude/channel/permission": {},
          },
          tools: {},
        },
        serverInfo: {
          name: "claude-proxy-feishu",
          version: pkg.version,
        },
        instructions:
          "Messages arrive as <channel source=\"feishu\" chat_id=\"...\">. Reply through the reply tool with the same chat_id.",
      });
      return;
    }
    if (method === "tools/list") {
      ok(id, {
        tools: [
          {
            name: "reply",
            description: "Send a message back to the Feishu chat that invoked this session",
            inputSchema: {
              type: "object",
              properties: {
                chat_id: { type: "string" },
                text: { type: "string" },
              },
              required: ["chat_id", "text"],
            },
          },
        ],
      });
      return;
    }
    if (method === "tools/call") {
      await handleToolCall(options, secret, id, params);
      return;
    }
    if (method === "ping") {
      ok(id, {});
      return;
    }
    if (method === "notifications/initialized") {
      return;
    }
    if (method === "notifications/claude/channel/permission_request") {
      await handlePermissionRequest(options, secret, params);
      return;
    }
    if (id !== undefined) {
      fail(id, -32601, `method not found: ${method ?? ""}`);
    }
  } catch (err) {
    if (id !== undefined) fail(id, -32000, String(err));
    else log(String(err));
  }
};

export const runFeishuRemoteSidecar = async (
  options: SidecarOptions,
): Promise<void> => {
  const id =
    options.id ??
    `fr-${crypto.randomBytes(8).toString("hex")}-${process.pid}`;
  const secret = getSecret();
  await register(options, id, secret);
  log(`registered ${id} for ${process.cwd()}`);
  startPolling(options, id, secret);

  let buffer = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx < 0) break;
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as JsonRpcMessage;
        void handleMessage(options, secret, message);
      } catch (err) {
        log(`invalid json-rpc message: ${String(err)}`);
      }
    }
  });
  process.stdin.resume();
};
