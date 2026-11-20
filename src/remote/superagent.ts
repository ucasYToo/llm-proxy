import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createHash } from "node:crypto";
import type { Express, RequestHandler } from "express";
import type { Bot, Delivery, SuperAgent, Workspace } from "claude-super-agent";
import type { Client } from "@larksuiteoapi/node-sdk";
import { readConfig } from "../config/store";
import { assertAllowedCwd } from "./service";
import type { RemoteBridgeFeishuBotConfig } from "../interfaces";

type BotConfig = RemoteBridgeFeishuBotConfig & { id: string; appId: string };
type BotRuntime = {
  bot: BotConfig;
  client: Client;
  wsClient?: { getConnectionStatus?: () => unknown };
};
type BotLookup = (id: string) => BotRuntime | undefined;
let pending: Promise<SuperAgent> | undefined;
let lookup: BotLookup = () => undefined;

function workspaces(): Workspace[] {
  const bridge = readConfig().remoteBridge;
  if (!bridge?.enabled || !bridge.feishu?.enabled) return [];

  return (bridge.feishu.bots || []).flatMap((bot) => {
    if (
      bot.handler !== "superagent" ||
      bot.enabled === false ||
      !bot.appId ||
      !bot.id ||
      !bot.defaultCwd
    )
      return [];
    try {
      assertAllowedCwd(bot.defaultCwd);
      return [
        {
          id: workspaceId(bot as BotConfig),
          cwd: fs.realpathSync(bot.defaultCwd),
          allowedCwds: (bridge.allowedCwds || []).filter((cwd) =>
            fs.existsSync(cwd),
          ),
        },
      ];
    } catch {
      return [];
    }
  });
}

function workspaceId(bot: BotConfig) {
  const digest = createHash("sha256")
    .update(bot.appId + "\n" + fs.realpathSync(bot.defaultCwd!))
    .digest("hex")
    .slice(0, 12);
  return bot.id + "-" + digest;
}

async function deliver(envelope: Delivery) {
  const target = envelope.route.target;
  if (target.kind !== "feishu") return;
  const runtime = lookup(target.botId);
  if (
    !runtime ||
    runtime.bot.appId !== target.appId ||
    runtime.bot.handler !== "superagent" ||
    !runtime.bot.allowedUserIds?.some(
      (id) => target.appId + ":" + id === envelope.route.scope.ownerId,
    )
  ) {
    throw Error("原机器人的 SuperAgent 授权已变更");
  }
  const { sendFeishu } = await import("claude-super-agent");
  // The adapter uses only public IM methods, shared across compatible Feishu SDK versions.
  return sendFeishu(runtime.client, envelope);
}

export function getSuperAgent() {
  if (!pending) {
    pending = (async () => {
      const { createSuperAgent } = await import("claude-super-agent");
      const agent = createSuperAgent({
        dataDir:
          process.env.CLAUDE_PROXY_SUPERAGENT_DIR ||
          path.join(os.homedir(), ".claude-proxy", "superagent"),
        resolveWorkspace: (id) =>
          workspaces().find((workspace) => workspace.id === id),
        claudeCommand: readConfig().remoteBridge?.claudeCommand || "claude",
        deliver,
      });
      await agent.start();
      return agent;
    })().catch((error) => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}

export function bindSuperAgentClients(find: BotLookup) {
  lookup = find;
  if (workspaces().length) {
    void getSuperAgent()
      .then((agent) => {
        for (const workspace of workspaces()) agent.workspace(workspace.id);
      })
      .catch((error) => console.error("SuperAgent:", error.message));
  }
}

export async function stopSuperAgent() {
  const current = pending;
  if (current) await (await current).stop();
  if (pending === current) pending = undefined;
}

export async function acceptSuperAgentMessage(
  bot: BotConfig,
  client: Client,
  event: unknown,
) {
  const { acceptFeishu } = await import("claude-super-agent");
  if (!bot.defaultCwd) return;
  const config: Bot = {
    id: bot.id,
    appId: bot.appId,
    workspaceId: workspaceId(bot),
    allowedOpenIds: bot.allowedUserIds ?? [],
  };
  await acceptFeishu(await getSuperAgent(), config, client, event);
}

function consoleConnections() {
  const allowed = new Set(workspaces().map((w) => w.id));
  return (readConfig().remoteBridge?.feishu?.bots || []).flatMap((bot) => {
    const current = bot.id && lookup(bot.id);
    if (
      !current ||
      current.bot.handler !== "superagent" ||
      !current.bot.defaultCwd ||
      !fs.existsSync(current.bot.defaultCwd)
    )
      return [];
    const id = workspaceId(current.bot);
    if (!allowed.has(id)) return [];
    return [
      {
        id: current.bot.id,
        workspaceId: id,
        state: current.wsClient?.getConnectionStatus?.() || { state: "ready" },
        allowedOpenIds: bot.allowedUserIds || [],
      },
    ];
  });
}

export function mountSuperAgent(app: Express, authorize: RequestHandler) {
  let consoleRouter: RequestHandler | undefined;
  app.use("/superagent", async (req, res, next) => {
    if (!workspaces().length) {
      res.status(403).json({
        error: "请先配置启用 SuperAgent 的飞书机器人和工作区",
      });
      return;
    }
    try {
      const agent = await getSuperAgent();
      if (!consoleRouter) {
        const { createConsoleRouter } = await import("claude-super-agent");
        consoleRouter = createConsoleRouter({
          agent: () => agent,
          workspaces: () => workspaces().map((workspace) => workspace.id),
          authorize,
          hostSettingsUrl: "/",
          connections: consoleConnections,
          testBot: async (workspaceId, botId, openId) => {
            const current = lookup(botId);
            const authorized = consoleConnections().some(
              (bot) =>
                bot.id === botId &&
                bot.workspaceId === workspaceId &&
                bot.allowedOpenIds.includes(openId),
            );
            if (!authorized || !current)
              throw Error("测试接收人未获此机器人的授权");
            const { sendFeishuTest } = await import("claude-super-agent");
            await sendFeishuTest(current.client, openId);
          },
        });
      }
      consoleRouter!(req, res, next);
    } catch (error) {
      next(error);
    }
  });
}
