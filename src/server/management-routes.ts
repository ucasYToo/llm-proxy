import type { Express, Request, Response } from "express";
import { localDashboard, loopback } from "./local-admin";
import {
  rawStatus,
  configureRaw,
  claudeCaptureVersion,
} from "../lib/raw-settings";
import { recordTimings, captureError } from "../lib/raw-capture";
import {
  preferences,
  preferencesPath,
  mutateJson,
} from "../lib/local-settings";
import { checkUpdate, updateStatus, installUpdate } from "../lib/updates";
import { getServerPort } from "./state";
import { listManagedHooks, installHooks } from "../lib/claude-settings";
import { beginNotificationPairing, notificationBotsStatus, testResumeBinding } from "../remote/feishu";
import { getDb } from "../storage/db";

export function setupManagementRoutes(app: Express) {
  app.get("/api/query", async (req, res, next) => {
    try {
      switch (req.query.type) {
        case "feishu-notification": res.json(notificationBotsStatus());return;
        case "update-status":
          res.json(await updateStatus());
          return;
        case "service-settings": {
          const raw = rawStatus(getServerPort());
          const pending = getDb()
            .prepare(
              "SELECT count(*) AS count, MAX(error) AS error FROM raw_pending WHERE directory=?",
            )
            .get(raw.directory) as { count: number; error: string | null };
          const indexed = !!getDb()
            .prepare("SELECT 1 FROM raw_cursors WHERE file=?")
            .get(raw.directory);
          res.json({
            autoStart: preferences().autoStart !== false,
            autoCheck: preferences().updateCheck !== false,
            raw: {
              ...raw,
              claudeVersion:
                raw.enabled && !indexed ? await claudeCaptureVersion() : null,
              indexed,
              error: captureError || pending.error,
              pending: pending.count,
            },
          });
          return;
        }
        default:
          next();
      }
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.post("/api/set", async (req, res, next) => {
    const { action, enabled } = req.body ?? {};
    if (
      ![
        "updateAutoStart",
        "updateCheckPreference",
        "checkUpdate",
        "installUpdate",
        "configureRaw",
        "configureTiming",
        "testResumeBinding",
        "pairFeishuNotification",
      ].includes(action)
    ) {
      next();
      return;
    }
    if (!localDashboard(req)) {
      res.status(403).json({ error: "请通过本机 Dashboard 操作" });
      return;
    }
    try {
      if(action==="pairFeishuNotification"){res.json(beginNotificationPairing(req.body));return;}
      if (action === "testResumeBinding") {
        await testResumeBinding(req.body.botId);
        res.json({ ok: true });
        return;
      }
      if (action === "installUpdate") {
        res.json(await installUpdate(req.body.version));
        return;
      }
      if (action === "checkUpdate") {
        await checkUpdate(true);
        res.json(await updateStatus());
        return;
      }
      if (typeof enabled !== "boolean") throw new Error("enabled 必须为布尔值");
      if (action.startsWith("configure")) {
        res.json(
          configureRaw(
            action === "configureRaw" ? "raw" : "timing",
            enabled,
            getServerPort(),
          ),
        );
        return;
      }
      mutateJson(preferencesPath, (p) => {
        p[action === "updateAutoStart" ? "autoStart" : "updateCheck"] = enabled;
      });
      if (action === "updateAutoStart") {
        const hooks = listManagedHooks();
        const first = hooks.find((h) => h.event === "SessionStart") ?? hooks[0];
        if (first)
          installHooks(Number(new URL(first.url).port), ["SessionStart"]);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.post("/api/otel/v1/logs", (req: Request, res: Response) => {
    if (
      !loopback(req.socket.remoteAddress) ||
      req.headers.origin ||
      rawStatus(getServerPort()).timing !== "installed"
    ) {
      res.sendStatus(403);
      return;
    }
    try {
      recordTimings(req.body);
      res.json({});
    } catch {
      res.status(400).json({ error: "无效的 OTLP 日志" });
    }
  });
}
