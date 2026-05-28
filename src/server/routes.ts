import { Express, Request, Response } from "express";
import path from "path";
import { readConfig, writeConfig, addChannel, deleteChannel, setChannelActiveTarget, getChannels } from "../config/store";
import { queryLogs, clearLogs } from "../storage/logs";
import { insertHook, queryHooks, recentSessions, clearHooks, aggregateToolUsage, getSubagentRelations } from "../storage/hooks";
import {
  aggregateCostBySession,
  aggregateCostByTimeRange,
  aggregateCostByTarget,
  aggregateCostByModel,
  getBudgetStatus,
  queryCostRecords,
  getTokenTimeSeries,
  clearCostRecords,
} from "../storage/cost";
import { computeHealthScore } from "../cost/health";
import { resolvePricingDetailed } from "../cost/pricing";
import { parseHookPayload } from "../interfaces";
import type { Target, LogCollection, Channel, NotificationSettings, Config, BudgetConfig } from "../interfaces";
import { v4 as uuidv4 } from "uuid";
import { readClaudeSettings, writeClaudeSettings } from "../lib/claude-settings";
import { readAiTitle } from "../lib/transcript";
import { addClient, broadcast } from "./sse";
import { notify } from "../notify/macos";
import { sendDingTalkMarkdown } from "../notify/dingtalk";
import { sendFeishuText } from "../notify/feishu";
import { quoteMarkdown } from "../notify/transcript";
import * as caffeinate from "../system/caffeinate";
import { getServerPort } from "./state";

/**
 * 根据 target 构建 Claude Code 直连模式的环境变量。
 * 用于"直连"操作和切换目标时的自动联动。
 */
const buildDirectEnv = (
  baseEnv: Record<string, string>,
  target: Target,
): Record<string, string> => {
  const newEnv = { ...baseEnv };

  // 1. BASE_URL: 模型提供商 URL
  newEnv.ANTHROPIC_BASE_URL = target.url;

  // 2. MODEL: 前台显示模型名（决定 Claude Code 上下文尺寸）
  if (target.anthropicModel) {
    newEnv.ANTHROPIC_MODEL = target.anthropicModel;
  } else {
    delete newEnv.ANTHROPIC_MODEL;
  }

  // 3. 认证信息：bearer → ANTHROPIC_AUTH_TOKEN（三方代理）；x-api-key → ANTHROPIC_API_KEY（Anthropic 官方）
  if (target.auth?.value) {
    const { type, headerName, value } = target.auth;
    if (type === "bearer") {
      newEnv.ANTHROPIC_AUTH_TOKEN = value;
      delete newEnv.ANTHROPIC_API_KEY;
    } else if (type === "x-api-key") {
      newEnv.ANTHROPIC_API_KEY = value;
      delete newEnv.ANTHROPIC_AUTH_TOKEN;
    } else if (type === "custom" && headerName) {
      // custom header: 写入 settings.env 的自定义 key
      newEnv[headerName] = value;
      delete newEnv.ANTHROPIC_API_KEY;
      delete newEnv.ANTHROPIC_AUTH_TOKEN;
    }
  } else {
    delete newEnv.ANTHROPIC_API_KEY;
    delete newEnv.ANTHROPIC_AUTH_TOKEN;
  }

  // 4. hasCompletedOnboarding: 方便首次使用三方模型
  newEnv.hasCompletedOnboarding = "true";

  return newEnv;
};

/**
 * 根据 target 构建代理模式的环境变量。
 * 用于"更新接入"操作和切换目标时的自动联动。
 */
const buildProxyEnv = (
  baseEnv: Record<string, string>,
  target: Target,
  channelId: string,
  port: number,
): Record<string, string> => {
  const newEnv = { ...baseEnv };

  // 1. BASE_URL: 代理地址
  const proxyPath = channelId === "default" ? "proxy" : `${channelId}/proxy`;
  newEnv.ANTHROPIC_BASE_URL = `http://localhost:${port}/${proxyPath}`;

  // 2. MODEL: 前台显示模型名
  if (target.anthropicModel) {
    newEnv.ANTHROPIC_MODEL = target.anthropicModel;
  } else {
    delete newEnv.ANTHROPIC_MODEL;
  }

  // 3. 认证信息（与直连一致）：bearer → ANTHROPIC_AUTH_TOKEN；x-api-key → ANTHROPIC_API_KEY
  if (target.auth?.value) {
    const { type, headerName, value } = target.auth;
    if (type === "bearer") {
      newEnv.ANTHROPIC_AUTH_TOKEN = value;
      delete newEnv.ANTHROPIC_API_KEY;
    } else if (type === "x-api-key") {
      newEnv.ANTHROPIC_API_KEY = value;
      delete newEnv.ANTHROPIC_AUTH_TOKEN;
    } else if (type === "custom" && headerName) {
      newEnv[headerName] = value;
      delete newEnv.ANTHROPIC_API_KEY;
      delete newEnv.ANTHROPIC_AUTH_TOKEN;
    }
  } else {
    delete newEnv.ANTHROPIC_API_KEY;
    delete newEnv.ANTHROPIC_AUTH_TOKEN;
  }

  // 4. hasCompletedOnboarding: 方便首次使用三方模型
  newEnv.hasCompletedOnboarding = "true";

  return newEnv;
};

/**
 * 自动联动：当通道的活动目标变化时，如果该通道当前已接入 Claude Code，自动更新 settings。
 */
const autoLinkIfConnected = (
  config: Config,
  channelId: string,
  targetId: string,
): void => {
  // 检查该通道是否当前已接入 Claude Code
  if (config.claudeCodeChannelId !== channelId) {
    return; // 未接入，无需联动
  }

  const target = config.targets.find((t) => t.id === targetId);
  if (!target) {
    return; // target 不存在
  }

  const settings = readClaudeSettings();
  const baseEnv = (settings.env ?? {}) as Record<string, string>;
  settings.env = buildProxyEnv(baseEnv, target, channelId, getServerPort());
  writeClaudeSettings(settings);
};

const projectBasename = (p: string | null | undefined): string => {
  if (!p) return "";
  const trimmed = p.replace(/[/\\]+$/, "");
  return path.basename(trimmed);
};

export const setupApiRoutes = (app: Express) => {
  // 查询配置或日志
  app.get("/api/query", (req: Request, res: Response) => {
    const type = req.query.type as string;

    if (type === "config") {
      res.json({ ...readConfig(), serverPort: getServerPort() });
      return;
    }

    if (type === "logs") {
      const limit = Number(req.query.limit ?? 50);
      const offset = Number(req.query.offset ?? 0);
      const targetId = (req.query.targetId as string) ?? undefined;
      const sessionId = (req.query.sessionId as string) ?? undefined;
      const result = queryLogs({ limit, offset, targetId, sessionId });
      res.json(result);
      return;
    }

    if (type === "session-timeline") {
      const sessionId = (req.query.sessionId as string) ?? "";
      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }
      const limit = Number(req.query.limit ?? 200);
      const hookRes = queryHooks({ sessionId, limit });
      const logRes = queryLogs({ sessionId, limit });
      const entries = [
        ...hookRes.entries.map((h) => ({
          kind: "hook" as const,
          at: h.createdAt,
          hook: h,
        })),
        ...logRes.entries.map((l) => ({
          kind: "log" as const,
          at: l.timestamp,
          log: l,
        })),
      ]
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
        .slice(0, limit);
      res.json({ entries });
      return;
    }

    if (type === "hooks") {
      const limit = Number(req.query.limit ?? 100);
      const offset = Number(req.query.offset ?? 0);
      const sessionId = (req.query.sessionId as string) ?? undefined;
      const eventName = (req.query.eventName as string) ?? undefined;
      const result = queryHooks({ limit, offset, sessionId, eventName });
      res.json(result);
      return;
    }

    if (type === "sessions") {
      const withinMsRaw = req.query.withinMs;
      const withinMs =
        withinMsRaw === undefined ? undefined : Number(withinMsRaw);
      const limit =
        req.query.limit === undefined ? undefined : Number(req.query.limit);
      res.json({ sessions: recentSessions(withinMs, limit) });
      return;
    }

    if (type === "caffeinate") {
      res.json({
        supported: caffeinate.isSupported(),
        active: caffeinate.isActive(),
      });
      return;
    }

    if (type === "cost-summary") {
      const config = readConfig();
      const budget = config.budget ?? {};
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const budgetStatus = getBudgetStatus(
        budget.dailyLimitUsd,
        budget.monthlyLimitUsd,
        budget.alertThresholdPct,
      );

      // Total cost (all time)
      const allRecords = queryCostRecords({ limit: 1, offset: 0 });
      const totalCost = queryCostRecords({ limit: 100000, offset: 0 }).records.reduce(
        (sum, r) => sum + r.costUsd,
        0,
      );

      // Today's cost
      const todayRecords = queryCostRecords({ since: todayStart, limit: 100000 });
      const todayCost = todayRecords.records.reduce((sum, r) => sum + r.costUsd, 0);

      const byTarget = aggregateCostByTarget();
      const byModel = aggregateCostByModel();
      const recentTrend = aggregateCostByTimeRange({
        since: thirtyDaysAgo,
        granularity: "day",
      });

      res.json({
        budget: budgetStatus,
        totalCost,
        todayCost,
        byTarget,
        byModel,
        recentTrend,
      });
      return;
    }

    if (type === "cost-trend") {
      const since = (req.query.since as string) ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const until = (req.query.until as string) ?? undefined;
      const granularity = (req.query.granularity as string) ?? "day";
      const validGranularity = ["hour", "day", "week"].includes(granularity)
        ? (granularity as "hour" | "day" | "week")
        : "day";
      const result = aggregateCostByTimeRange({ since, until, granularity: validGranularity });
      res.json(result);
      return;
    }

    if (type === "cost-session") {
      const sessionId = (req.query.sessionId as string) ?? "";
      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }
      const summary = aggregateCostBySession(sessionId);
      const health = computeHealthScore(sessionId);
      const records = queryCostRecords({ sessionId, limit: 500 }).records;
      const tokenTimeSeries = getTokenTimeSeries(sessionId);
      res.json({ summary, health, records, tokenTimeSeries });
      return;
    }

    if (type === "session-analytics") {
      const sessionId = (req.query.sessionId as string) ?? "";
      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }
      const costSummary = aggregateCostBySession(sessionId);
      const health = computeHealthScore(sessionId);
      const toolUsage = aggregateToolUsage(sessionId);
      const tokenTimeSeries = getTokenTimeSeries(sessionId);
      const subagents = getSubagentRelations(sessionId);
      res.json({ costSummary, health, toolUsage, tokenTimeSeries, subagents });
      return;
    }

    if (type === "pricing") {
      const model = (req.query.model as string) ?? "";
      const { pricing, source, matchedKey } = resolvePricingDetailed(
        model || undefined,
      );
      res.json({ model: model || null, pricing, source, matchedKey });
      return;
    }

    res.status(400).json({ error: "type must be one of config | logs | hooks | sessions | session-timeline | caffeinate | cost-summary | cost-trend | cost-session | session-analytics | pricing" });
  });

  // SSE：实时事件流
  app.get("/api/events", (_req: Request, res: Response) => {
    addClient(res);
  });

  // Claude Code hook 入口
  app.post("/api/hooks/:event", (req: Request, res: Response) => {
    const event = req.params.event;
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    const hookPayload = parseHookPayload(rawBody);

    const sessionId = hookPayload?.session_id ?? null;
    const toolEvents = new Set([
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PermissionDenied",
    ]);
    const toolName =
      hookPayload && toolEvents.has(hookPayload.hook_event_name)
        ? (hookPayload as { tool_name?: string }).tool_name ?? null
        : null;
    const cwd = hookPayload?.cwd ?? null;

    const entry = insertHook({
      eventName: event,
      sessionId,
      toolName,
      cwd,
      payload: rawBody,
    });

    broadcast("hook", entry);

    const { notifications } = readConfig();
    const evtKey: "stop" | "subagentStop" | "notification" | null =
      event === "Stop"
        ? "stop"
        : event === "SubagentStop"
          ? "subagentStop"
          : event === "Notification"
            ? "notification"
            : null;

    const macos = notifications?.macos;
    const ding = notifications?.dingtalk;
    const feishu = notifications?.feishu;
    const macosOn = !!evtKey && !!macos?.enabled && !!macos?.events?.[evtKey];
    const dingOn = !!evtKey && !!ding?.enabled && !!ding?.events?.[evtKey];
    const feishuOn = !!evtKey && !!feishu?.enabled && !!feishu?.events?.[evtKey];

    if ((macosOn || dingOn || feishuOn) && hookPayload && evtKey) {
      const projectName = projectBasename(entry.projectRoot ?? entry.cwd);
      const sessionTail = sessionId ? sessionId.slice(-6) : "unknown";
      const title = projectName
        ? `Claude Code · ${projectName}`
        : "Claude Code";

      // 从 transcript 抓 ai-title；可能为 null（早期 session / 还没生成）
      const aiTitle = readAiTitle(hookPayload.transcript_path);
      // macOS body 空间有限，截断到 ~50 字
      const aiTitleShort =
        aiTitle && aiTitle.length > 50 ? `${aiTitle.slice(0, 50)}…` : aiTitle;
      const bodyTail = aiTitleShort ?? `session ${sessionTail}`;

      let body: string;
      let sound: string;
      let eventLabel: string;

      if (hookPayload.hook_event_name === "Stop") {
        body = `任务完成 · ${bodyTail}`;
        sound = "Glass";
        eventLabel = "任务完成";
      } else if (hookPayload.hook_event_name === "SubagentStop") {
        body = `子代理完成 · ${bodyTail}`;
        sound = "Tink";
        eventLabel = "子代理完成";
      } else if (hookPayload.hook_event_name === "Notification") {
        const msg = hookPayload.message || "Claude Code notification";
        body = `${msg} · ${bodyTail}`;
        sound = "Ping";
        eventLabel = msg;
      } else {
        body = `${event} · ${bodyTail}`;
        sound = "Ping";
        eventLabel = event;
      }

      if (macosOn) {
        notify(title, body, sound);
      }

      if (dingOn && ding?.accessToken && ding.secret) {
        const lastAssistant =
          hookPayload.hook_event_name === "Stop" || hookPayload.hook_event_name === "SubagentStop"
            ? hookPayload.last_assistant_message
            : null;
        const sessionLine = aiTitle
          ? `- 会话: ${aiTitle} (\`${sessionTail}\`)`
          : `- session: \`${sessionTail}\``;
        const md = [
          `### ${title}`,
          `**${eventLabel}** (${event})`,
          "",
          sessionLine,
          projectName ? `- project: \`${projectName}\`` : null,
          `- time: ${new Date().toLocaleString()}`,
          lastAssistant
            ? `\n**最后回复**\n\n${quoteMarkdown(lastAssistant)}`
            : null,
        ]
          .filter(Boolean)
          .join("\n");
        void sendDingTalkMarkdown(
          ding.accessToken,
          ding.secret,
          `${title} · ${eventLabel}`,
          md,
        ).then((r) => {
          if (!r.ok) {
            console.warn(`[dingtalk] 发送失败: ${r.error}`);
          }
        });
      }

      if (feishuOn && feishu?.webhookUrl) {
        const lastAssistant =
          hookPayload.hook_event_name === "Stop" || hookPayload.hook_event_name === "SubagentStop"
            ? hookPayload.last_assistant_message
            : null;
        const lines = [
          `${title}`,
          `${eventLabel} (${event})`,
          aiTitle ? `会话: ${aiTitle} (${sessionTail})` : `session: ${sessionTail}`,
          projectName ? `project: ${projectName}` : null,
          `time: ${new Date().toLocaleString()}`,
          lastAssistant ? `\n最后回复:\n${lastAssistant}` : null,
        ].filter(Boolean);
        void sendFeishuText(
          feishu.webhookUrl,
          feishu.secret ?? "",
          lines.join("\n"),
        ).then((r) => {
          if (!r.ok) {
            console.warn(`[feishu] 发送失败: ${r.error}`);
          }
        });
      }
    }

    res.json({ ok: true, id: entry.id });
  });

  // 修改配置
  app.post("/api/set", async (req: Request, res: Response) => {
    const { action } = req.body;
    const config = readConfig();

    switch (action) {
      case "setActive": {
        const { targetId } = req.body as { targetId: string };
        if (!config.targets.find((t) => t.id === targetId)) {
          res.status(404).json({ error: "Target not found" });
          return;
        }
        config.activeTarget = targetId;
        // 同步更新默认通道的活动目标，保持向后兼容
        const defaultChannel = config.channels.find((c) => c.id === "default");
        if (defaultChannel) {
          defaultChannel.activeTarget = targetId;
        }
        writeConfig(config);
        // 自动联动：如果默认通道已接入 Claude Code，更新 settings
        autoLinkIfConnected(config, "default", targetId);
        res.json({ ok: true });
        break;
      }

      case "addTarget": {
        const { target } = req.body as { target: Omit<Target, "id"> };
        const newTarget: Target = { id: uuidv4(), ...target };
        config.targets.push(newTarget);
        if (!config.activeTarget) config.activeTarget = newTarget.id;
        writeConfig(config);
        res.json({ ok: true, target: newTarget });
        break;
      }

      case "updateTarget": {
        const { target } = req.body as { target: Target };
        const idx = config.targets.findIndex((t) => t.id === target.id);
        if (idx === -1) {
          res.status(404).json({ error: "Target not found" });
          return;
        }
        config.targets[idx] = target;
        writeConfig(config);
        res.json({ ok: true });
        break;
      }

      case "deleteTarget": {
        const { targetId } = req.body as { targetId: string };
        config.targets = config.targets.filter((t) => t.id !== targetId);
        if (config.activeTarget === targetId) {
          config.activeTarget = config.targets[0]?.id ?? "";
        }
        writeConfig(config);
        res.json({ ok: true });
        break;
      }

      case "importTargets": {
        const { targets } = req.body as { targets: Omit<Target, "id">[] };
        if (!Array.isArray(targets)) {
          res.status(400).json({ error: "targets must be an array" });
          return;
        }
        const added: Target[] = [];
        for (const t of targets) {
          if (!t.name || !t.url) continue;
          const { id: _, ...rest } = t as Target;
          const newTarget: Target = { id: uuidv4(), ...rest };
          config.targets.push(newTarget);
          added.push(newTarget);
        }
        if (!config.activeTarget && added.length > 0) {
          config.activeTarget = added[0].id;
        }
        writeConfig(config);
        res.json({ ok: true, added: added.length });
        break;
      }

      case "updateLogCollection": {
        const { logCollection } = req.body as { logCollection: LogCollection };
        config.logCollection = {
          ...config.logCollection,
          ...logCollection,
        };
        writeConfig(config);
        res.json({ ok: true });
        break;
      }

      case "caffeinate": {
        const { active } = req.body as { active: boolean };
        if (active) {
          const r = caffeinate.start();
          if (!r.ok) {
            res.status(400).json({ error: r.reason ?? "failed to start caffeinate" });
            return;
          }
        } else {
          caffeinate.stop();
        }
        res.json({
          ok: true,
          active: caffeinate.isActive(),
          supported: caffeinate.isSupported(),
        });
        break;
      }

      case "applyClaudeCodeProxy": {
        const { proxyPort, channelId } = req.body as { proxyPort?: number; channelId?: string };
        const port = proxyPort ?? getServerPort();
        const targetChannelId = channelId ?? "default";
        const settings = readClaudeSettings();
        const baseEnv = (settings.env ?? {}) as Record<string, string>;

        config.claudeCodeChannelId = targetChannelId;
        writeConfig(config);

        const channel = config.channels.find((c) => c.id === targetChannelId);
        const activeTarget = channel
          ? config.targets.find((t) => t.id === channel.activeTarget)
          : undefined;

        const proxyPath = targetChannelId === "default" ? "proxy" : `${targetChannelId}/proxy`;
        const newEnv: Record<string, string> = { ...baseEnv };

        // 1. BASE_URL: 代理地址
        newEnv.ANTHROPIC_BASE_URL = `http://localhost:${port}/${proxyPath}`;

        // 2. MODEL: 前台显示模型名
        if (activeTarget?.anthropicModel) {
          newEnv.ANTHROPIC_MODEL = activeTarget.anthropicModel;
        } else {
          delete newEnv.ANTHROPIC_MODEL;
        }

        // 3. 认证信息（与直连一致）：bearer → ANTHROPIC_AUTH_TOKEN；x-api-key → ANTHROPIC_API_KEY
        if (activeTarget?.auth?.value) {
          const { type, headerName, value } = activeTarget.auth;
          if (type === "bearer") {
            newEnv.ANTHROPIC_AUTH_TOKEN = value;
            delete newEnv.ANTHROPIC_API_KEY;
          } else if (type === "x-api-key") {
            newEnv.ANTHROPIC_API_KEY = value;
            delete newEnv.ANTHROPIC_AUTH_TOKEN;
          } else if (type === "custom" && headerName) {
            newEnv[headerName] = value;
            delete newEnv.ANTHROPIC_API_KEY;
            delete newEnv.ANTHROPIC_AUTH_TOKEN;
          }
        } else {
          delete newEnv.ANTHROPIC_API_KEY;
          delete newEnv.ANTHROPIC_AUTH_TOKEN;
        }

        // 4. hasCompletedOnboarding: 方便首次使用三方模型
        newEnv.hasCompletedOnboarding = "true";

        settings.env = newEnv;
        writeClaudeSettings(settings);
        res.json({ ok: true, channelId: targetChannelId });
        break;
      }

      case "refreshClaudeCodeStatus": {
        const settings = readClaudeSettings();
        const env = (settings.env ?? {}) as Record<string, string>;
        const currentUrl = env["ANTHROPIC_BASE_URL"] ?? "";
        const currentModel = env["ANTHROPIC_MODEL"] ?? "";

        const proxyPattern = /^http:\/\/localhost:\d+\/(?:([a-zA-Z0-9_-]+)\/)?proxy$/;
        const match = currentUrl.match(proxyPattern);

        if (match) {
          config.claudeCodeChannelId = match[1] || "default";
        } else {
          delete config.claudeCodeChannelId;
        }

        writeConfig(config);
        res.json({
          ok: true,
          detected: !!match,
          channelId: match ? (match[1] || "default") : undefined,
          currentUrl: currentUrl || null,
          currentModel: currentModel || null,
        });
        break;
      }

      case "restoreClaudeCodeProxy": {
        const channelId = config.claudeCodeChannelId ?? "default";
        const channel = config.channels.find((c) => c.id === channelId);
        const target = channel
          ? config.targets.find((t) => t.id === channel.activeTarget)
          : undefined;

        if (!target) {
          res.status(400).json({
            error: `通道「${channelId}」无可用 target，无法切到直连。请先为该通道选择一个活动目标。`,
          });
          return;
        }

        const settings = readClaudeSettings();
        const baseEnv = (settings.env ?? {}) as Record<string, string>;
        settings.env = buildDirectEnv(baseEnv, target);
        writeClaudeSettings(settings);

        delete config.claudeCodeChannelId;
        writeConfig(config);
        res.json({
          ok: true,
          restoredUrl: target.url,
          restoredModel: target.anthropicModel ?? null,
          restoredApiKey: target.auth?.value ? true : false,
        });
        break;
      }

      case "addChannel": {
        const { channel } = req.body as { channel: Omit<Channel, "id"> & { id?: string } };
        const channelId = channel.id?.trim() || uuidv4();
        if (!/^[a-zA-Z0-9_-]+$/.test(channelId)) {
          res.status(400).json({ error: "通道 ID 只能包含字母、数字、连字符和下划线" });
          return;
        }
        if (getChannels().find((c) => c.id === channelId)) {
          res.status(400).json({ error: `通道 ID '${channelId}' 已存在` });
          return;
        }
        const newChannel: Channel = { ...channel, id: channelId };
        addChannel(newChannel);
        res.json({ ok: true, channel: newChannel });
        break;
      }

      case "updateChannel": {
        const { channel } = req.body as { channel: Channel };
        const channels = getChannels();
        const idx = channels.findIndex((c) => c.id === channel.id);
        if (idx === -1) {
          res.status(404).json({ error: "Channel not found" });
          return;
        }
        channels[idx] = channel;
        config.channels = channels;
        writeConfig(config);
        res.json({ ok: true });
        break;
      }

      case "deleteChannel": {
        const { channelId } = req.body as { channelId: string };
        if (channelId === "default") {
          res.status(400).json({ error: "Cannot delete default channel" });
          return;
        }
        deleteChannel(channelId);
        res.json({ ok: true });
        break;
      }

      case "setChannelActive": {
        const { channelId, targetId } = req.body as { channelId: string; targetId: string };
        if (!config.targets.find((t) => t.id === targetId)) {
          res.status(404).json({ error: "Target not found" });
          return;
        }
        setChannelActiveTarget(channelId, targetId);
        // 重新读取 config 以获取最新状态
        const updatedConfig = readConfig();
        // 自动联动：如果该通道已接入 Claude Code，更新 settings
        autoLinkIfConnected(updatedConfig, channelId, targetId);
        res.json({ ok: true });
        break;
      }

      case "testDingTalk": {
        const { accessToken, secret } = req.body as {
          accessToken?: string;
          secret?: string;
        };
        const token = accessToken ?? config.notifications?.dingtalk?.accessToken ?? "";
        const sec = secret ?? config.notifications?.dingtalk?.secret ?? "";
        const r = await sendDingTalkMarkdown(
          token,
          sec,
          "Claude Code · 测试",
          `### Claude Code 钉钉通知测试\n\n配置生效 ✅\n\n- time: ${new Date().toLocaleString()}`,
        );
        if (!r.ok) {
          res.status(400).json({ error: r.error ?? "send failed" });
          return;
        }
        res.json({ ok: true });
        break;
      }

      case "testFeishu": {
        const { webhookUrl, secret } = req.body as {
          webhookUrl?: string;
          secret?: string;
        };
        const url = webhookUrl ?? config.notifications?.feishu?.webhookUrl ?? "";
        const sec = secret ?? config.notifications?.feishu?.secret ?? "";
        const r = await sendFeishuText(
          url,
          sec,
          `Claude Code 飞书通知测试 - 配置生效\n\ntime: ${new Date().toLocaleString()}`,
        );
        if (!r.ok) {
          res.status(400).json({ error: r.error ?? "send failed" });
          return;
        }
        res.json({ ok: true });
        break;
      }

      case "updateNotifications": {
        const { notifications } = req.body as { notifications: NotificationSettings };
        const prev = config.notifications ?? {};
        const next: NotificationSettings = { ...prev, ...notifications };
        if (notifications.macos) {
          next.macos = {
            ...(prev.macos ?? {}),
            ...notifications.macos,
            events: notifications.macos.events
              ? { ...(prev.macos?.events ?? {}), ...notifications.macos.events }
              : prev.macos?.events,
          };
        }
        if (notifications.dingtalk) {
          next.dingtalk = {
            ...(prev.dingtalk ?? {}),
            ...notifications.dingtalk,
            events: notifications.dingtalk.events
              ? { ...(prev.dingtalk?.events ?? {}), ...notifications.dingtalk.events }
              : prev.dingtalk?.events,
          };
        }
        if (notifications.feishu) {
          next.feishu = {
            ...(prev.feishu ?? {}),
            ...notifications.feishu,
            events: notifications.feishu.events
              ? { ...(prev.feishu?.events ?? {}), ...notifications.feishu.events }
              : prev.feishu?.events,
          };
        }
        config.notifications = next;
        writeConfig(config);
        res.json({ ok: true, notifications: config.notifications });
        break;
      }

      case "updateBudget": {
        const { budget } = req.body as { budget: BudgetConfig };
        config.budget = { ...(config.budget ?? {}), ...budget };
        writeConfig(config);
        res.json({ ok: true, budget: config.budget });
        break;
      }

      default:
        res.status(400).json({ error: "Unknown action" });
    }
  });

  // 清空日志或 hooks
  app.delete("/api/query", (req: Request, res: Response) => {
    const type = req.query.type as string;

    if (type === "logs") {
      clearLogs();
      res.json({ ok: true });
      return;
    }

    if (type === "hooks") {
      clearHooks();
      res.json({ ok: true });
      return;
    }

    if (type === "cost") {
      clearCostRecords();
      res.json({ ok: true });
      return;
    }

    res.status(400).json({ error: "type must be logs, hooks, or cost" });
  });

  // 关闭服务
  app.post("/api/shutdown", (_req: Request, res: Response) => {
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 200);
  });
};
