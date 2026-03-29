import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs-extra";
import { setupApiRoutes } from "./routes";
import { setupProxyRoutes } from "./proxy";

export interface ServerOptions {
  port: number;
  host: string;
  serveUI?: boolean;
}

export const startServer = async (
  options: ServerOptions,
): Promise<ReturnType<Express["listen"]>> => {
  const app = express();

  // 中间件
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.raw({ limit: "50mb", type: "application/octet-stream" }));

  // 日志中间件
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // 设置 API 路由
  setupApiRoutes(app);

  // 设置代理路由
  setupProxyRoutes(app);

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
