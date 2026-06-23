import * as Lark from "@larksuiteoapi/node-sdk";
import { readConfig } from "../../config/store";
import {
  handleFeishuRemoteInbound,
  setFeishuRemoteSdkState,
  setFeishuRemoteSender,
} from "./service";
import { parseFeishuTextContent } from "./parser";

type LarkClient = InstanceType<typeof Lark.Client>;
type LarkWsClient = InstanceType<typeof Lark.WSClient>;

let client: LarkClient | null = null;
let wsClient: LarkWsClient | null = null;

const domainFor = (domain?: string): Lark.Domain =>
  domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;

const stopCurrent = (): void => {
  if (wsClient) {
    try {
      wsClient.close({ force: true });
    } catch {
      // ignore
    }
  }
  wsClient = null;
  client = null;
  setFeishuRemoteSender(null);
  setFeishuRemoteSdkState({
    started: false,
    connected: false,
    state: "idle",
    lastError: null,
    startedAt: null,
  });
};

export const stopFeishuRemoteClient = (): void => {
  stopCurrent();
};

export const startFeishuRemoteClient = async (): Promise<void> => {
  const config = readConfig().feishuRemote;
  stopCurrent();

  if (!config?.enabled) {
    return;
  }
  if (!config.appId || !config.appSecret) {
    setFeishuRemoteSdkState({
      started: false,
      connected: false,
      state: "failed",
      lastError: "appId/appSecret 未配置",
    });
    return;
  }

  const baseConfig = {
    appId: config.appId,
    appSecret: config.appSecret,
    domain: domainFor(config.domain),
    loggerLevel: Lark.LoggerLevel.warn,
  };

  client = new Lark.Client(baseConfig);
  setFeishuRemoteSender(async (chatId, text) => {
    if (!client) throw new Error("Feishu client is not ready");
    await client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ text }),
        msg_type: "text",
      },
    });
  });

  const dispatcher = new Lark.EventDispatcher({
    encryptKey: config.encryptKey,
    verificationToken: config.verificationToken,
    loggerLevel: Lark.LoggerLevel.warn,
  }).register({
    "im.message.receive_v1": async (data: {
      event?: {
        message?: {
          message_id?: string;
          chat_id?: string;
          content?: string;
        };
        sender?: {
          sender_id?: {
            user_id?: string;
            open_id?: string;
            union_id?: string;
          };
        };
      };
      message?: {
        message_id?: string;
        chat_id?: string;
        content?: string;
      };
      sender?: {
        sender_id?: {
          user_id?: string;
          open_id?: string;
          union_id?: string;
        };
      };
    }) => {
      const event = data.event ?? data;
      const message = event.message;
      const sender = event.sender?.sender_id;
      const chatId = message?.chat_id ?? "";
      const userId = sender?.user_id ?? sender?.open_id ?? sender?.union_id ?? "";
      const messageId = message?.message_id ?? `${chatId}-${Date.now()}`;
      const text = parseFeishuTextContent(message?.content);
      if (!chatId || !userId || !text.trim()) return;
      await handleFeishuRemoteInbound({
        messageId,
        chatId,
        userId,
        text,
        raw: data,
      });
    },
  });

  wsClient = new Lark.WSClient({
    ...baseConfig,
    autoReconnect: true,
    handshakeTimeoutMs: 20_000,
    wsConfig: { pingTimeout: 10 },
    onReady: () => {
      const status = wsClient?.getConnectionStatus();
      setFeishuRemoteSdkState({
        started: true,
        connected: true,
        state: status?.state ?? "connected",
        lastError: null,
      });
    },
    onError: (err) => {
      const status = wsClient?.getConnectionStatus();
      setFeishuRemoteSdkState({
        started: true,
        connected: false,
        state: status?.state ?? "failed",
        lastError: err.message,
      });
    },
    onReconnecting: () => {
      setFeishuRemoteSdkState({
        started: true,
        connected: false,
        state: "reconnecting",
      });
    },
    onReconnected: () => {
      setFeishuRemoteSdkState({
        started: true,
        connected: true,
        state: "connected",
        lastError: null,
      });
    },
  });

  setFeishuRemoteSdkState({
    started: true,
    connected: false,
    state: "connecting",
    lastError: null,
    startedAt: new Date().toISOString(),
  });

  try {
    await wsClient.start({ eventDispatcher: dispatcher });
    const status = wsClient.getConnectionStatus();
    setFeishuRemoteSdkState({
      started: true,
      connected: status.state === "connected",
      state: status.state,
    });
  } catch (err) {
    setFeishuRemoteSdkState({
      started: true,
      connected: false,
      state: "failed",
      lastError: String(err),
    });
  }
};

export const restartFeishuRemoteClient = async (): Promise<void> => {
  await startFeishuRemoteClient();
};
