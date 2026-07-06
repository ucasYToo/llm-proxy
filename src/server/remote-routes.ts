import { Express, Request, Response } from "express";
import { readConfig } from "../config/store";
import { addRemoteChannelClient } from "../remote/channel-hub";
import {
  dispatchQueuedMessagesForInstanceId,
  heartbeatRemoteChannel,
  offlineRemoteChannel,
  receivePermissionRequest,
  receiveRemoteReply,
  recordRemoteChannelDelivery,
  registerRemoteChannelInstance,
  sendRemoteMessage,
  submitPermissionVerdict,
} from "../remote/service";

const getBearer = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
};

const remoteTokenFromRequest = (req: Request): string | null => {
  const headerToken = req.headers["x-remote-bridge-token"];
  if (typeof headerToken === "string") return headerToken;
  const bearer = getBearer(req.headers.authorization);
  if (bearer) return bearer;
  const queryToken = req.query.token;
  return typeof queryToken === "string" ? queryToken : null;
};

const isSameOriginDashboardRequest = (req: Request): boolean => {
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

const requireRemoteBridge = (
  req: Request,
  res: Response,
  opts: { allowDashboard?: boolean } = {},
): boolean => {
  const remoteBridge = readConfig().remoteBridge;
  if (!remoteBridge?.enabled) {
    res.status(403).json({ error: "remoteBridge is disabled" });
    return false;
  }
  if (opts.allowDashboard && isSameOriginDashboardRequest(req)) {
    return true;
  }
  if (!remoteBridge.authToken || remoteTokenFromRequest(req) !== remoteBridge.authToken) {
    res.status(401).json({ error: "invalid remote bridge token" });
    return false;
  }
  return true;
};

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

export const setupRemoteRoutes = (app: Express) => {
  app.post(
    "/api/remote/send",
    asyncRoute((req, res) => {
      if (!requireRemoteBridge(req, res, { allowDashboard: true })) return;
      const body = req.body as {
        text?: string;
        mode?: "new" | "continue";
        threadId?: string;
        cwd?: string | null;
        title?: string | null;
      };
      const result = sendRemoteMessage({
        source: "web",
        text: body.text ?? "",
        mode: body.mode,
        threadId: body.threadId,
        cwd: body.cwd,
        title: body.title,
      });
      res.json({ ok: true, ...result });
    }),
  );

  app.post(
    "/api/remote/permission",
    asyncRoute((req, res) => {
      if (!requireRemoteBridge(req, res, { allowDashboard: true })) return;
      const body = req.body as {
        requestId?: string;
        behavior?: "allow" | "deny";
      };
      if (!body.requestId || !body.behavior) {
        res.status(400).json({ error: "requestId and behavior are required" });
        return;
      }
      submitPermissionVerdict({
        requestId: body.requestId,
        behavior: body.behavior,
      });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/remote/channel/register",
    asyncRoute((req, res) => {
      if (!requireRemoteBridge(req, res)) return;
      const body = req.body as {
        instanceId?: string;
        pid?: number | null;
        cwd?: string | null;
        claudeSessionId?: string | null;
        metadata?: unknown;
      };
      const instance = registerRemoteChannelInstance(body);
      res.json({ ok: true, instance });
    }),
  );

  app.get("/api/remote/channel/events", (req, res) => {
    if (!requireRemoteBridge(req, res)) return;
    const instanceId = req.query.instanceId;
    if (typeof instanceId !== "string" || !instanceId) {
      res.status(400).json({ error: "instanceId is required" });
      return;
    }
    addRemoteChannelClient(instanceId, res);
    setImmediate(() => dispatchQueuedMessagesForInstanceId(instanceId));
  });

  app.post(
    "/api/remote/channel/reply",
    asyncRoute(async (req, res) => {
      if (!requireRemoteBridge(req, res)) return;
      const body = req.body as {
        remote_thread_id?: string;
        remoteThreadId?: string;
        text?: string;
        final?: boolean;
        instanceId?: string | null;
      };
      const remoteThreadId = body.remote_thread_id ?? body.remoteThreadId;
      if (!remoteThreadId || !body.text) {
        res.status(400).json({ error: "remote_thread_id and text are required" });
        return;
      }
      const message = await receiveRemoteReply({
        remoteThreadId,
        text: body.text,
        final: body.final,
        channelInstanceId: body.instanceId,
      });
      res.json({ ok: true, message });
    }),
  );

  app.post(
    "/api/remote/channel/delivery",
    asyncRoute((req, res) => {
      if (!requireRemoteBridge(req, res)) return;
      const body = req.body as {
        messageId?: string;
        status?: "delivered" | "failed";
        error?: string | null;
        instanceId?: string | null;
      };
      if (!body.messageId || !body.status) {
        res.status(400).json({ error: "messageId and status are required" });
        return;
      }
      if (body.status !== "delivered" && body.status !== "failed") {
        res.status(400).json({ error: "status must be delivered or failed" });
        return;
      }
      const message = recordRemoteChannelDelivery({
        messageId: body.messageId,
        status: body.status,
        error: body.error,
        instanceId: body.instanceId,
      });
      res.json({ ok: true, message });
    }),
  );

  app.post(
    "/api/remote/channel/permission-request",
    asyncRoute((req, res) => {
      if (!requireRemoteBridge(req, res)) return;
      const body = req.body as {
        instanceId?: string;
        request_id?: string;
        requestId?: string;
        tool_name?: string;
        toolName?: string;
        description?: string;
        input_preview?: string;
        inputPreview?: string;
        remote_thread_id?: string | null;
        remoteThreadId?: string | null;
      };
      const requestId = body.request_id ?? body.requestId;
      const toolName = body.tool_name ?? body.toolName;
      if (!body.instanceId || !requestId || !toolName) {
        res.status(400).json({ error: "instanceId, requestId and toolName are required" });
        return;
      }
      receivePermissionRequest({
        channelInstanceId: body.instanceId,
        requestId,
        toolName,
        description: body.description,
        inputPreview: body.input_preview ?? body.inputPreview,
        remoteThreadId: body.remote_thread_id ?? body.remoteThreadId,
      });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/remote/channel/heartbeat",
    asyncRoute((req, res) => {
      if (!requireRemoteBridge(req, res)) return;
      const body = req.body as {
        instanceId?: string;
        claudeSessionId?: string | null;
      };
      if (!body.instanceId) {
        res.status(400).json({ error: "instanceId is required" });
        return;
      }
      const instance = heartbeatRemoteChannel(
        body.instanceId,
        body.claudeSessionId,
      );
      res.json({ ok: true, instance });
    }),
  );

  app.post(
    "/api/remote/channel/offline",
    asyncRoute((req, res) => {
      if (!requireRemoteBridge(req, res)) return;
      const body = req.body as { instanceId?: string };
      if (body.instanceId) offlineRemoteChannel(body.instanceId);
      res.json({ ok: true });
    }),
  );
};
