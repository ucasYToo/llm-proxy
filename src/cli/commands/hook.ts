import { Command } from "commander";
import chalk from "chalk";
import { hookKey } from "../../lib/local-settings";
import { ensureBackground, probe } from "../../lib/service-process";
import {
  installHooks,
  uninstallHooks,
  listManagedHooks,
  getManagedHookStatus,
  MANAGED_HOOK_EVENTS,
  CLAUDE_SETTINGS_PATH,
} from "../../lib/claude-settings";

export const hookCommand = (program: Command) => {
  const hook = program
    .command("hook")
    .description("管理 Claude Code hook（写入 ~/.claude/settings.json）");

  hook
    .command("forward <event>")
    .option("-p, --port <port>", "本机端口", "1998")
    .option("--auto-start", "SessionStart 时确保服务运行")
    .action(
      async (event: string, options: { port: string; autoStart?: boolean }) => {
        try {
          const port = Number(options.port);
          if (
            !["SessionStart", "Stop", "StopFailure"].includes(event) ||
            !Number.isInteger(port) ||
            port < 1 ||
            port > 65535
          )
            return;
          let body = "";
          process.stdin.setEncoding("utf8");
          for await (const chunk of process.stdin) {
            body += chunk;
            if (body.length > 4 * 1024 * 1024) throw new Error("Hook 输入过大");
          }
          if (JSON.parse(body).hook_event_name !== event) return;
          if (event === "SessionStart" && options.autoStart)
            await ensureBackground("localhost", port, false, false);
          else if (!(await probe("localhost", port))) return;
          const response = await fetch(
            "http://localhost:" + port + "/api/hooks/" + event,
            {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(3000),
              headers: {
                "Content-Type": "application/json",
                "X-Claude-Proxy-Hook": hookKey(),
                "X-Claude-Proxy-Remote-Turn":
                  process.env.CLAUDE_PROXY_REMOTE_MESSAGE_ID ?? "",
              },
              body,
            },
          );
          if (!response.ok) throw new Error("HTTP " + response.status);
        } catch (error) {
          console.error("Claude hook 转发失败:", (error as Error).message);
        }
      },
    );

  hook
    .command("install")
    .description("把本工具的 hook 注册到 Claude Code")
    .option("-p, --port <port>", "本地 proxy 端口", "1998")
    .action((options: { port: string }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        console.error(chalk.red(`端口不合法: ${options.port}`));
        process.exit(1);
      }
      const { installed } = installHooks(port);
      console.log(
        chalk.green(
          `已安装 ${installed.length} 个 hook 到 ${CLAUDE_SETTINGS_PATH}：`,
        ),
      );
      listManagedHooks().forEach((item) => {
        console.log(`  ${item.event} → ${item.command ?? item.url}`);
      });
      console.log(chalk.dim("\n下次启动 Claude Code 会自动加载这些 hook。"));
    });

  hook
    .command("uninstall")
    .description("移除本工具注册的所有 hook")
    .action(() => {
      const { removed } = uninstallHooks();
      if (removed.length === 0) {
        console.log(chalk.yellow("未发现由本工具管理的 hook，无需清理。"));
      } else {
        const uniqueEvents = [...new Set(removed)];
        console.log(
          chalk.green(`已移除 ${uniqueEvents.length} 个 hook 事件配置：`),
        );
        uniqueEvents.forEach((e) => console.log(`  ${e}`));
      }
    });

  hook
    .command("status")
    .description("查看当前已安装的 hook")
    .option("-p, --port <port>", "本机端口", "1998")
    .action((options: { port: string }) => {
      const items = listManagedHooks();
      console.log(chalk.bold(`Claude Code settings: ${CLAUDE_SETTINGS_PATH}`));
      if (items.length === 0) {
        console.log(
          chalk.yellow(
            "\n当前未安装本工具的 hook。运行 `claude-proxy hook install` 来注册。",
          ),
        );
        console.log(
          chalk.dim(`\n可注册事件：${MANAGED_HOOK_EVENTS.join(", ")}`),
        );
        return;
      }
      console.log(
        getManagedHookStatus(Number(options.port)).installed
          ? "Hooks 已就绪"
          : "需要修复，请运行 claude-proxy hook install --port " + options.port,
      );
      console.log(
        chalk.green(`\n当前已安装 ${items.length} 个 managed hook：`),
      );
      items.forEach((it) => {
        console.log(`  ${it.event} → ${it.command ?? it.url}`);
      });
    });
};
