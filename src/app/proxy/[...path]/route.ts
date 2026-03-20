import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getActiveTarget } from "@/lib/config";
import { appendLog } from "@/lib/logger";

type Params = Promise<{ path: string[] }>;

async function handler(req: NextRequest, { params }: { params: Params }) {
  const { path } = await params;
  const target = getActiveTarget();

  if (!target) {
    return NextResponse.json(
      { error: "No active target configured" },
      { status: 503 }
    );
  }

  const targetUrl = `${target.url.replace(/\/$/, "")}/${path.join("/")}`;
  const search = req.nextUrl.search;
  const fullUrl = search ? `${targetUrl}${search}` : targetUrl;

  // Build merged headers
  const forwardHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    // Skip hop-by-hop and Next.js internal headers
    if (!["host", "connection", "transfer-encoding"].includes(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  });
  Object.assign(forwardHeaders, target.headers);

  // Build merged body
  let requestBody: unknown = undefined;
  let originalBody: unknown = undefined;
  let modifiedBody: unknown = undefined;
  const contentType = req.headers.get("content-type") ?? "";

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (contentType.includes("application/json")) {
      const json = await req.json().catch(() => ({}));
      originalBody = json;
      const merged = { ...(json as Record<string, unknown>), ...target.bodyParams };
      modifiedBody = merged;
      requestBody = JSON.stringify(merged);
      forwardHeaders["content-type"] = "application/json";
    } else {
      const buffer = await req.arrayBuffer();
      originalBody = "[binary]";
      modifiedBody = "[binary]";
      requestBody = buffer;
    }
  }

  const startMs = Date.now();
  const logId = uuidv4();

  // Capture original request headers for logging
  const originalHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    originalHeaders[key] = value;
  });

  // Capture modified headers for logging
  const modifiedHeaders: Record<string, string> = { ...forwardHeaders };

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(fullUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: requestBody as BodyInit | undefined,
      // @ts-expect-error Node 18+ supports this
      duplex: "half",
    });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    appendLog({
      id: logId,
      timestamp: new Date().toISOString(),
      targetId: target.id,
      targetName: target.name,
      method: req.method,
      path: `/${path.join("/")}`,
      originalRequestHeaders: originalHeaders,
      originalRequestBody: originalBody,
      modifiedRequestHeaders: modifiedHeaders,
      modifiedRequestBody: modifiedBody,
      responseStatus: 0,
      responseBody: null,
      durationMs,
      error: String(err),
    });
    return NextResponse.json(
      { error: "Upstream request failed", detail: String(err) },
      { status: 502 }
    );
  }

  const resContentType = upstreamRes.headers.get("content-type") ?? "";
  const isStream = resContentType.includes("text/event-stream");

  // Build response headers
  const resHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
    if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
      resHeaders.set(key, value);
    }
  });

  if (isStream) {
    // Pass through streaming response; log minimal info
    const durationMs = Date.now() - startMs;
    appendLog({
      id: logId,
      timestamp: new Date().toISOString(),
      targetId: target.id,
      targetName: target.name,
      method: req.method,
      path: `/${path.join("/")}`,
      originalRequestHeaders: originalHeaders,
      originalRequestBody: originalBody,
      modifiedRequestHeaders: modifiedHeaders,
      modifiedRequestBody: modifiedBody,
      responseStatus: upstreamRes.status,
      responseBody: "[stream]",
      durationMs,
    });

    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      headers: resHeaders,
    });
  }

  // Non-streaming: buffer and log
  const resText = await upstreamRes.text();
  const durationMs = Date.now() - startMs;
  let resBodyLog: unknown = resText;
  try {
    resBodyLog = JSON.parse(resText);
  } catch {
    // keep as text
  }

  appendLog({
    id: logId,
    timestamp: new Date().toISOString(),
    targetId: target.id,
    targetName: target.name,
    method: req.method,
    path: `/${path.join("/")}`,
    originalRequestHeaders: originalHeaders,
    originalRequestBody: originalBody,
    modifiedRequestHeaders: modifiedHeaders,
    modifiedRequestBody: modifiedBody,
    responseStatus: upstreamRes.status,
    responseBody: resBodyLog,
    durationMs,
  });

  return new NextResponse(resText, {
    status: upstreamRes.status,
    headers: resHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
