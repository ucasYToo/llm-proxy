import express, { Express, Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs-extra";
import { setupApiRoutes } from "./routes";
import { setupRemoteRoutes } from "./remote-routes";
import { setupProxyRoutes } from "./proxy";
import { onLogChange } from "../storage/logs";
import { broadcast } from "./sse";
import { initCostCapture } from "../cost/capture";
import * as caffeinate from "../system/caffeinate";
import { setServerPort } from "./state";
import { onRemoteEvent } from "../remote/service";
import { startFeishuRemoteBridge, stopFeishuRemoteBridge } from "../remote/feishu";

let cleanupRegistered = false;

const registerCleanupOnce = (): void => {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const stopAll = () => {
    caffeinate.stop();
    stopFeishuRemoteBridge();
  };
  process.on("exit", stopAll);
  process.on("SIGINT", () => {
    stopAll();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopAll();
    process.exit(0);
  });
};

export interface ServerOptions {
  port: number;
  host: string;
  serveUI?: boolean;
  verbose?: boolean;
}

export const startServer = async (
  options: ServerOptions,
): Promise<ReturnType<Express["listen"]>> => {
  const app = express();
  const verbose = Boolean(options.verbose || process.env.CLAUDE_PROXY_VERBOSE === "1");

  // 中间件
  app.use((req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      next();
      return;
    }
    const fetchSite = req.headers["sec-fetch-site"];
    if (fetchSite === "cross-site") {
      res.status(403).json({ error: "cross-site requests are not allowed" });
      return;
    }
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (typeof origin === "string" && typeof host === "string") {
      try {
        if (new URL(origin).host !== host) {
          res.status(403).json({ error: "cross-origin requests are not allowed" });
          return;
        }
      } catch {
        res.status(403).json({ error: "invalid origin" });
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "50mb" }));
  app.use(express.raw({ limit: "50mb", type: "application/octet-stream" }));

  // 默认只打印异常请求；排查时用 --verbose 打开完整访问日志。
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      if (!verbose && res.statusCode < 400) return;
      const duration = Date.now() - start;
      const message = `${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
      if (res.statusCode >= 500) {
        console.error(message);
      } else if (res.statusCode >= 400) {
        console.warn(message);
      } else {
        console.log(message);
      }
    });
    next();
  });

  // 记录实际端口，供路由层和 UI 读取
  setServerPort(options.port);

  // 设置 API 路由
  setupApiRoutes(app);
  setupRemoteRoutes(app);

  // 设置代理路由
  setupProxyRoutes(app);

  // 把日志变更通过 SSE 推送到前端
  onLogChange((entry, kind) => {
    broadcast("log", { kind, entry });
  });

  onRemoteEvent((kind, data) => {
    broadcast("remote", { kind, data });
  });

  // 初始化成本捕获（监听日志完成事件写入 cost_records）
  initCostCapture();

  // 启动飞书远程桥（如果已配置）
  startFeishuRemoteBridge();

  // 确保进程退出时清理 caffeinate 子进程
  registerCleanupOnce();

  // 健康检查
  app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // 服务 UI (如果启用)
  if (options.serveUI) {
    const uiDist = path.join(__dirname, "..", "..", "ui-dist");
    if (await fs.pathExists(uiDist)) {
      app.use(express.static(uiDist));
      // 所有非 API 请求都返回 index.html (支持 React Router)
      app.use((req: Request, res: Response) => {
        res.sendFile(path.join(uiDist, "index.html"));
      });
    } else {
      console.warn("UI dist not found at ui/dist, skipping UI serve");
    }
  }

  // 处理 404 (必须在所有路由之后)
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not Found" });
  });

  // 启动服务器
  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, options.host, (err?: Error) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(server);
    });
  });
};
