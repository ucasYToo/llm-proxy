import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import { startServer } from "../../server";

export const startCommand = (program: Command) => {
  program
    .command("start")
    .description("启动代理服务器")
    .option("-p, --port <number>", "监听端口", "1998")
    .option("--host <address>", "绑定地址", "localhost")
    .option("--ui", "启用 Web UI (服务静态构建文件)")
    .option("--no-statusbar", "禁用 macOS 状态栏应用")
    .option("--verbose", "输出详细端点信息和请求访问日志")
    .action(async (options: { port: string; host: string; ui: boolean; statusbar: boolean; verbose?: boolean }) => {
      const port = parseInt(options.port, 10);
      const host = options.host;
      const ui = options.ui || true;
      const verbose = Boolean(options.verbose || process.env.CLAUDE_PROXY_VERBOSE === "1");
      const baseUrl = `http://${host}:${port}`;
      if (verbose) {
        process.env.CLAUDE_PROXY_VERBOSE = "1";
      }

      const spinner = ora("启动代理服务器...").start();

      try {
        const server = await startServer({ port, host, serveUI: ui, verbose });
        const statusbarState =
          options.statusbar && process.platform === "darwin"
            ? launchStatusBarApp(port)
            : options.statusbar
              ? "unsupported"
              : "disabled";

        spinner.succeed(chalk.green("代理服务器已启动!"));

        console.log(`  地址: ${chalk.cyan(baseUrl)}`);
        if (ui) {
          console.log(`  UI:   ${chalk.cyan(baseUrl)}`);
        }
        console.log(`  代理: ${chalk.cyan(`${baseUrl}/proxy/*`)}`);
        if (statusbarState === "started") {
          console.log(`  状态栏: ${chalk.green("已启动")}`);
        } else if (verbose && statusbarState === "missing") {
          console.log(chalk.dim("  状态栏: 未找到可执行文件，已跳过"));
        }
        console.log(
          chalk.dim(
            `  日志: ${verbose ? "详细请求日志已启用" : "仅显示 4xx/5xx（--verbose 查看全部请求）"}`,
          ),
        );

        if (verbose) {
          console.log("\n可用端点:");
          console.log(`  GET  /api/query?type=config  - 查询配置`);
          console.log(`  GET  /api/query?type=logs    - 查询日志`);
          console.log(`  POST /api/set                 - 修改配置`);
          console.log(`  ALL  /proxy/*                 - 代理请求`);
        }

        console.log(chalk.dim("\n按 Ctrl+C 停止服务器"));

        // 处理优雅关闭
        process.on("SIGINT", () => {
          console.log("\n\n正在关闭服务器...");
          server.close(() => {
            console.log(chalk.yellow("服务器已关闭"));
            process.exit(0);
          });
        });
      } catch (error) {
        spinner.fail(chalk.red("启动失败"));
        console.error(error);
        process.exit(1);
      }
    });
};

function launchStatusBarApp(port: number): "started" | "missing" {
  // 先关闭已存在的 statusbar 进程，避免多实例
  try {
    execSync("killall StatusBarApp 2>/dev/null", { stdio: "ignore" });
  } catch {
    // 忽略错误（没有进程在跑时会返回非零）
  }

  const candidates = [
    // 发布包内提交的预编译二进制
    path.resolve(__dirname, "../../../app/macos-status-bar/bin/StatusBarApp"),
    // 本地 swift 构建产物（开发态回退）
    path.resolve(__dirname, "../../../app/macos-status-bar/.build/release/StatusBarApp"),
  ];

  const appPath = candidates.find((p) => fs.existsSync(p));
  if (!appPath) return "missing";

  const child = spawn(appPath, ["--port", String(port)], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return "started";
}
