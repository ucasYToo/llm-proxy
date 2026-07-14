import type { Express, Request, Response } from "express";
import {
  clearCodexData,
  getCodexDbPath,
  getCodexOverview,
  getCodexSessionTimeline,
  insertCodexHook,
  queryCodexHooks,
  queryCodexSessions,
} from "../storage/codex";
import {
  getCodexHookStatus,
  installCodexHooks,
  uninstallCodexHooks,
} from "../lib/codex-hooks";
import {
  clearCodexTraceBundles,
  getCodexTraceEventDetail,
  getCodexTraceEvents,
  getCodexTraceEventsForSession,
  startCodexTraceCapture,
  startCodexTraceMaintenance,
  stopCodexTraceCapture,
  syncCodexTraceIndex,
} from "../lib/codex-rollout-traces";
import { broadcast } from "./sse";
import { getServerPort } from "./state";

const stringField = (
  value: Record<string, unknown>,
  key: string,
): string | null => (typeof value[key] === "string" ? (value[key] as string) : null);

const queryInteger = (
  value: unknown,
  fallback: number,
  maximum: number,
): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, maximum)
    : fallback;
};

export const setupCodexRoutes = (app: Express): void => {
  startCodexTraceMaintenance((status) => broadcast("codex-trace", status));

  app.get("/api/codex/status", (_req: Request, res: Response) => {
    res.json({
      hooks: getCodexHookStatus(),
      trace: syncCodexTraceIndex(),
      databasePath: getCodexDbPath(),
      captureMode: "hooks+rollout-trace",
      preservesLogin: true,
    });
  });

  app.post("/api/codex/setup/hooks", (_req: Request, res: Response) => {
    res.json({ ok: true, hooks: installCodexHooks(getServerPort()) });
  });

  app.delete("/api/codex/setup/hooks", (_req: Request, res: Response) => {
    res.json({ ok: true, hooks: uninstallCodexHooks() });
  });

  app.post("/api/codex/hooks/:event", (req: Request, res: Response) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const eventName = stringField(raw, "hook_event_name") ?? req.params.event;
    const toolEvents = new Set(["PreToolUse", "PermissionRequest", "PostToolUse"]);
    const entry = insertCodexHook({
      eventName,
      sessionId: stringField(raw, "session_id"),
      toolName: toolEvents.has(eventName) ? stringField(raw, "tool_name") : null,
      cwd: stringField(raw, "cwd"),
      payload: raw,
    });
    broadcast("codex-hook", entry);
    res.json({ ok: true });
  });

  app.get("/api/codex/hooks", (req: Request, res: Response) => {
    res.json(
      queryCodexHooks({
        limit: queryInteger(req.query.limit, 100, 1000),
        offset: queryInteger(req.query.offset, 0, 100_000),
        sessionId: (req.query.sessionId as string) || undefined,
        eventName: (req.query.eventName as string) || undefined,
      }),
    );
  });

  app.get("/api/codex/sessions", (req: Request, res: Response) => {
    syncCodexTraceIndex();
    res.json({
      sessions: queryCodexSessions(queryInteger(req.query.limit, 200, 500)),
    });
  });

  app.get("/api/codex/sessions/:sessionId/timeline", (req: Request, res: Response) => {
    syncCodexTraceIndex();
    const limit = queryInteger(req.query.limit, 300, 1000);
    const entries = [
      ...getCodexSessionTimeline(req.params.sessionId, limit),
      ...getCodexTraceEventsForSession(req.params.sessionId, limit),
    ]
      .sort((left, right) => (left.at < right.at ? 1 : -1))
      .slice(0, limit);
    res.json({
      entries,
    });
  });

  app.get("/api/codex/timeline", (req: Request, res: Response) => {
    syncCodexTraceIndex();
    const limit = queryInteger(req.query.limit, 300, 1000);
    const hooks = queryCodexHooks({ limit }).entries.map((hook) => ({
      kind: "hook" as const,
      at: hook.createdAt,
      hook,
    }));
    const entries = [...hooks, ...getCodexTraceEvents(limit)]
      .sort((left, right) => (left.at < right.at ? 1 : -1))
      .slice(0, limit);
    res.json({ entries });
  });

  app.get("/api/codex/traces/:bundleId/events/:seq", (req: Request, res: Response) => {
    const seq = Number(req.params.seq);
    if (!Number.isInteger(seq) || seq < 0) {
      res.status(400).json({ error: "invalid trace event sequence" });
      return;
    }
    try {
      const detail = getCodexTraceEventDetail(req.params.bundleId, seq);
      if (!detail) {
        res.status(404).json({ error: "trace event not found" });
        return;
      }
      res.json(detail);
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/codex/traces/capture", (_req: Request, res: Response) => {
    try {
      const trace = startCodexTraceCapture();
      broadcast("codex-trace", trace);
      res.json({
        ok: true,
        trace,
        message: "原文日志已配置；完全退出并重开 Codex 后，新任务开始写入。",
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/codex/traces/capture", (_req: Request, res: Response) => {
    try {
      const trace = stopCodexTraceCapture();
      broadcast("codex-trace", trace);
      res.json({
        ok: true,
        trace,
        message: "原文日志环境开关已关闭；完全退出 Codex 后，当前进程才会停止写入。",
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/codex/overview", (_req: Request, res: Response) => {
    syncCodexTraceIndex();
    res.json(getCodexOverview());
  });

  app.delete("/api/codex/data", (_req: Request, res: Response) => {
    stopCodexTraceCapture();
    clearCodexTraceBundles();
    clearCodexData();
    broadcast("codex-clear", { at: new Date().toISOString() });
    res.json({ ok: true });
  });
};
