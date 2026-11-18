import type { Request } from "express";

export function loopback(address?: string) {
  return (
    address === "::1" ||
    address === "127.0.0.1" ||
    address === "::ffff:127.0.0.1"
  );
}
export function localDashboard(req: Request): boolean {
  if (!loopback(req.socket.remoteAddress)) return false;
  const host = req.headers.host;
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host))
    return false;
  try {
    const origin = new URL(String(req.headers.origin));
    return (
      ["http:", "https:"].includes(origin.protocol) &&
      origin.host === host &&
      req.headers["sec-fetch-site"] !== "cross-site"
    );
  } catch {
    return false;
  }
}
