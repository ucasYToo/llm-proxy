import type { Response } from "express";

const clients = new Set<Response>();
const KEEP_ALIVE_MS = 25_000;

let keepAliveTimer: NodeJS.Timeout | null = null;

const startKeepAlive = (): void => {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(": keep-alive\n\n");
      } catch {
        clients.delete(res);
      }
    }
    if (clients.size === 0 && keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }, KEEP_ALIVE_MS);
};

export const addClient = (res: Response): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  clients.add(res);
  startKeepAlive();

  res.on("close", () => {
    clients.delete(res);
  });
};

export const broadcast = (type: string, data: unknown): void => {
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
};

export const clientCount = (): number => clients.size;
