import { Express, Request, Response } from "express";
import { proxyRequest } from "../core/proxy";
import type { ProxyResponse } from "../core/proxy";
import { getChannelActiveTarget, getChannels } from "../config/store";

/** 从 Express 请求中提取规范化的请求头 */
const extractHeaders = (req: Request): Record<string, string> => {
  const headers: Record<string, string> = {};
  Object.keys(req.headers).forEach((key) => {
    const value = req.headers[key];
    if (value && typeof value === "string") {
      headers[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      headers[key.toLowerCase()] = value.join(", ");
    }
  });
  return headers;
};

/** 将代理结果写入 Express 响应 */
const sendProxyResult = (res: Response, result: ProxyResponse): void => {
  Object.entries(result.headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.status(result.status);
  if (result.isStream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(result.body as string);
    res.end();
  } else {
    res.json(result.body);
  }
};

/** 执行通道代理请求的核心逻辑 */
const handleChannelProxy = async (
  req: Request,
  res: Response,
  channelId: string,
  pathPrefix: RegExp,
): Promise<void> => {
  const target = getChannelActiveTarget(channelId);
  if (!target) {
    res.status(400).json({
      error: "Bad Request",
      detail: `No active target configured for channel '${channelId}'`,
    });
    return;
  }

  const proxyPath = req.path.replace(pathPrefix, "");
  const pathParts = proxyPath.split("/").filter(Boolean);

  const result = await proxyRequest({
    method: req.method,
    path: pathParts,
    search: req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "",
    headers: extractHeaders(req),
    body: req.body,
    contentType: req.headers["content-type"] || "",
    channelId,
    targetId: target.id,
  });

  sendProxyResult(res, result);
};

export const setupProxyRoutes = (app: Express) => {
  // 代理路由 - 匹配 /:channelId/proxy/* 的所有请求
  app.all("/:channelId/proxy/*", async (req: Request, res: Response) => {
    try {
      const channelId = req.params.channelId;

      // 验证通道是否存在
      const channels = getChannels();
      if (!channels.find((c) => c.id === channelId)) {
        res.status(400).json({
          error: "Bad Request",
          detail: `Channel '${channelId}' not found`,
        });
        return;
      }

      await handleChannelProxy(req, res, channelId, /^\/[^/]+\/proxy/);
    } catch (error) {
      console.error("Proxy error:", error);
      res.status(502).json({
        error: "Bad Gateway",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 向后兼容：匹配 /proxy/* 的所有请求，使用默认通道
  app.all("/proxy/*", async (req: Request, res: Response) => {
    try {
      await handleChannelProxy(req, res, "default", /^\/proxy/);
    } catch (error) {
      console.error("Proxy error:", error);
      res.status(502).json({
        error: "Bad Gateway",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
