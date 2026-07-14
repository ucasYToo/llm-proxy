import { Command } from "commander";
import chalk from "chalk";
import {
  CODEX_HOOK_EVENTS,
  codexHooksPath,
  getCodexHookStatus,
  installCodexHooks,
  relayCodexHook,
  uninstallCodexHooks,
} from "../../lib/codex-hooks";
import {
  getCodexTraceStatus,
  startCodexTraceCapture,
  stopCodexTraceCapture,
  syncCodexTraceIndex,
} from "../../lib/codex-rollout-traces";

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8");
};

export const codexCommand = (program: Command): void => {
  const codex = program.command("codex").description("Codex Dashboard hooks 与对话日志");
  const hook = codex.command("hook").description("管理 Codex command hooks");

  hook
    .command("install")
    .description("把 Codex hooks 接入独立 Dashboard")
    .option("-p, --port <number>", "Dashboard 端口", "1998")
    .action((options: { port: string }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`invalid port: ${options.port}`);
      }
      const result = installCodexHooks(port);
      console.log(chalk.green(`已安装 ${result.installed.length} 个 Codex hooks`));
      console.log(`  配置: ${result.file}`);
      console.log(`  事件: ${result.installed.join(", ")}`);
      console.log(
        chalk.dim(
          "\n首次安装或更新后，请在终端启动 Codex CLI，再运行 /hooks 检查并信任配置；桌面 App 当前没有 /hooks 命令。",
        ),
      );
    });

  const trace = codex
    .command("trace")
    .description("管理 Codex 原始 Rollout Trace（默认关闭，最大 1 GB）");

  trace
    .command("start")
    .description("为下一次 Codex 启动开启原文日志")
    .action(() => {
      const status = startCodexTraceCapture();
      console.log(chalk.green("已开启 Codex 原文日志环境开关"));
      console.log(`  目录: ${status.rootPath}`);
      console.log(chalk.yellow("  请完全退出并重开 Codex；新任务才会开始写入。"));
    });

  trace
    .command("stop")
    .description("关闭原文日志环境开关")
    .action(() => {
      stopCodexTraceCapture();
      console.log(chalk.green("已关闭 Codex 原文日志环境开关"));
      console.log(chalk.yellow("  请完全退出 Codex，当前进程才会停止写入。"));
    });

  trace
    .command("status")
    .description("查看原文日志开关、目录和容量")
    .action(() => {
      const status = syncCodexTraceIndex();
      console.log(
        `Codex 原文日志: ${status.configured ? chalk.green("已配置") : chalk.dim("关闭")}`,
      );
      console.log(`  目录: ${status.rootPath}`);
      console.log(
        `  容量: ${(status.usedBytes / 1024 / 1024).toFixed(1)} MB / ${(status.maxBytes / 1024 / 1024 / 1024).toFixed(0)} GB`,
      );
      console.log(`  bundles: ${status.bundleCount}`);
    });

  hook
    .command("uninstall")
    .description("移除本工具安装的 Codex hooks")
    .action(() => {
      const result = uninstallCodexHooks();
      if (result.removed.length) {
        console.log(chalk.green(`已移除 ${result.removed.length} 个 Codex hook 配置`));
      } else {
        console.log(chalk.yellow("没有发现本工具管理的 Codex hooks。"));
      }
      console.log(`  配置: ${result.file}`);
    });

  hook
    .command("status")
    .description("查看 Codex Dashboard hooks 状态")
    .action(() => {
      const status = getCodexHookStatus();
      console.log(chalk.bold(`Codex hooks: ${status.file}`));
      console.log(
        status.installed
          ? chalk.green(`已完整安装（${status.events.length}/${CODEX_HOOK_EVENTS.length}）`)
          : chalk.yellow(`未完整安装（${status.events.length}/${CODEX_HOOK_EVENTS.length}）`),
      );
      if (status.events.length) console.log(`  事件: ${status.events.join(", ")}`);
    });

  hook
    .command("relay", { hidden: true })
    .description("从 stdin 转发一个 Codex hook payload")
    .option("-p, --port <number>", "Dashboard 端口", "1998")
    .action(async (options: { port: string }) => {
      try {
        const raw = await readStdin();
        const payload = JSON.parse(raw) as Record<string, unknown>;
        await relayCodexHook({ port: Number(options.port), payload });
      } catch {
        // The relay is intentionally silent and fail-open.
      }
    });

  codex
    .command("status")
    .description("查看 Codex Dashboard 接入摘要")
    .action(() => {
      const status = getCodexHookStatus();
      const traceStatus = getCodexTraceStatus();
      console.log(chalk.bold("Codex Dashboard"));
      console.log(`  hooks: ${status.installed ? chalk.green("ready") : chalk.yellow("not installed")}`);
      console.log(`  config: ${codexHooksPath()}`);
      console.log(
        `  raw trace: ${traceStatus.configured ? chalk.green("configured") : chalk.dim("off")}`,
      );
      console.log(`  trace root: ${traceStatus.rootPath}`);
      console.log("  capture: hooks + optional local Rollout Trace (ChatGPT 登录保持不变)");
      console.log("  database: ~/.claude-proxy/codex-logs.db");
    });
};
