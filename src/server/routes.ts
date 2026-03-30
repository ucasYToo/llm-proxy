import { Express, Request, Response } from "express";
import { readConfig, writeConfig, addChannel, deleteChannel, setChannelActiveTarget, getChannels } from "../config/store";
import { queryLogs, clearLogs } from "../storage/logs";
import type { Target, LogCollection, Channel } from "../config/types";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

const CLAUDE_SETTINGS_PATH = path.join(
  process.env.HOME || "~",
  ".claude",
  "settings.json",
);

const readClaudeSettings = (): Record<string, unknown> => {
  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const writeClaudeSettings = (settings: Record<string, unknown>): void => {
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
};

export const setupApiRoutes = (app: Express) => {
  // 查询配置或日志
  app.get("/api/query", (req: Request, res: Response) => {
    const type = req.query.type as string;

    if (type === "config") {
      res.json(readConfig());
      return;
    }

    if (type === "logs") {
      const limit = Number(req.query.limit ?? 50);
      const offset = Number(req.query.offset ?? 0);
      const targetId = (req.query.targetId as string) ?? undefined;
      const result = queryLogs({ limit, offset, targetId });
      res.json(result);
      return;
    }

    res.status(400).json({ error: "type must be config or logs" });
  });

  // 修改配置
  app.post("/api/set", (req: Request, res: Response) => {
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

      case "applyClaudeCodeProxy": {
        const { proxyPort } = req.body as { proxyPort?: number };
        const port = proxyPort ?? 1998;
        const settings = readClaudeSettings();
        const env = (settings.env ?? {}) as Record<string, string>;
        const originalUrl = env["ANTHROPIC_BASE_URL"] ?? "";
        // 备份原始 URL 到代理 config
        config.claudeCodeOriginalBaseUrl = originalUrl;
        writeConfig(config);
        // 写入新的代理地址到 ~/.claude/settings.json
        settings.env = { ...env, ANTHROPIC_BASE_URL: `http://localhost:${port}/proxy` };
        writeClaudeSettings(settings);
        res.json({ ok: true, originalUrl });
        break;
      }

      case "restoreClaudeCodeProxy": {
        const originalUrl = config.claudeCodeOriginalBaseUrl;
        if (!originalUrl && originalUrl !== "") {
          res.status(400).json({ error: "No backup URL found" });
          return;
        }
        const settings = readClaudeSettings();
        const env = (settings.env ?? {}) as Record<string, string>;
        if (originalUrl) {
          settings.env = { ...env, ANTHROPIC_BASE_URL: originalUrl };
        } else {
          // 原始值为空时删除该字段
          const { ANTHROPIC_BASE_URL: _removed, ...rest } = env;
          settings.env = rest;
        }
        writeClaudeSettings(settings);
        // 清除备份
        delete config.claudeCodeOriginalBaseUrl;
        writeConfig(config);
        res.json({ ok: true });
        break;
      }

      case "addChannel": {
        const { channel } = req.body as { channel: Omit<Channel, "id"> };
        const newChannel: Channel = { id: uuidv4(), ...channel };
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
        res.json({ ok: true });
        break;
      }

      default:
        res.status(400).json({ error: "Unknown action" });
    }
  });

  // 清空日志
  app.delete("/api/query", (req: Request, res: Response) => {
    const type = req.query.type as string;

    if (type === "logs") {
      clearLogs();
      res.json({ ok: true });
      return;
    }

    res.status(400).json({ error: "type must be logs" });
  });

  // 关闭服务
  app.post("/api/shutdown", (_req: Request, res: Response) => {
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 200);
  });
};
