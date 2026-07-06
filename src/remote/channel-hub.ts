import type { Response } from "express";

export type RemoteChannelEvent =
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

const clients = new Map<string, Set<Response>>();
const KEEP_ALIVE_MS = 25_000;
let keepAliveTimer: NodeJS.Timeout | null = null;

const writeEvent = (res: Response, event: RemoteChannelEvent): void => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

const startKeepAlive = (): void => {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    for (const [instanceId, set] of clients) {
      for (const res of set) {
        try {
          res.write(": keep-alive\n\n");
        } catch {
          set.delete(res);
        }
      }
      if (set.size === 0) clients.delete(instanceId);
    }
    if (clients.size === 0 && keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }, KEEP_ALIVE_MS);
};

export const addRemoteChannelClient = (
  instanceId: string,
  res: Response,
): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, instanceId })}\n\n`);

  const set = clients.get(instanceId) ?? new Set<Response>();
  set.add(res);
  clients.set(instanceId, set);
  startKeepAlive();

  res.on("close", () => {
    set.delete(res);
    if (set.size === 0) clients.delete(instanceId);
  });
};

export const pushRemoteChannelEvent = (
  instanceId: string,
  event: RemoteChannelEvent,
): boolean => {
  const set = clients.get(instanceId);
  if (!set || set.size === 0) return false;
  for (const res of set) {
    try {
      writeEvent(res, event);
    } catch {
      set.delete(res);
    }
  }
  if (set.size === 0) clients.delete(instanceId);
  return true;
};

export const remoteChannelClientCount = (instanceId?: string): number => {
  if (instanceId) return clients.get(instanceId)?.size ?? 0;
  let total = 0;
  for (const set of clients.values()) total += set.size;
  return total;
};
