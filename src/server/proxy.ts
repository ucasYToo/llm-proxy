import { Express, Request, Response } from "express";
import { proxyRequest } from "../core/proxy";

export const setupProxyRoutes = (app: Express) => {
  // 代理路由 - 匹配 /proxy/* 的所有请求
  app.all("/proxy/*", async (req: Request, res: Response) => {
    try {
      // 提取路径部分
      const proxyPath = req.path.replace(/^\/proxy/, "");
      const pathParts = proxyPath.split("/").filter(Boolean);

      // 提取请求头
      const headers: Record<string, string> = {};
      Object.keys(req.headers).forEach((key) => {
        const value = req.headers[key];
        if (value && typeof value === "string") {
          headers[key.toLowerCase()] = value;
        } else if (Array.isArray(value)) {
          headers[key.toLowerCase()] = value.join(", ");
        }
      });

      // 构建代理请求
      const proxyReq = {
        method: req.method,
        path: pathParts,
        search: req.url.includes("?")
          ? req.url.substring(req.url.indexOf("?"))
          : "",
        headers,
        body: req.body,
        contentType: req.headers["content-type"] || "",
      };

      const result = await proxyRequest(proxyReq);

      // 设置响应头
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
    } catch (error) {
      console.error("Proxy error:", error);
      res.status(502).json({
        error: "Bad Gateway",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
