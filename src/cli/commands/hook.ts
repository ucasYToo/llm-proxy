import { Command } from "commander";
import chalk from "chalk";
import {
  installHooks,
  uninstallHooks,
  listManagedHooks,
  MANAGED_HOOK_EVENTS,
  CLAUDE_SETTINGS_PATH,
} from "../../lib/claude-settings";

export const hookCommand = (program: Command) => {
  const hook = program
    .command("hook")
    .description("管理 Claude Code hook（写入 ~/.claude/settings.json）");

  hook
    .command("install")
    .description("把本工具的 HTTP hook 注册到 Claude Code")
    .option("-p, --port <port>", "本地 proxy 端口", "1998")
    .action((options: { port: string }) => {
      const port = Number(options.port);
      if (!Number.isFinite(port) || port <= 0) {
        console.error(chalk.red(`端口不合法: ${options.port}`));
        process.exit(1);
      }
      const { installed } = installHooks(port);
      console.log(chalk.green(`已安装 ${installed.length} 个 hook 到 ${CLAUDE_SETTINGS_PATH}：`));
      installed.forEach((e) => {
        console.log(`  ${e} → http://localhost:${port}/api/hooks/${e}`);
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
        console.log(chalk.green(`已移除 ${uniqueEvents.length} 个 hook 事件配置：`));
        uniqueEvents.forEach((e) => console.log(`  ${e}`));
      }
    });

  hook
    .command("status")
    .description("查看当前已安装的 hook")
    .action(() => {
      const items = listManagedHooks();
      console.log(chalk.bold(`Claude Code settings: ${CLAUDE_SETTINGS_PATH}`));
      if (items.length === 0) {
        console.log(chalk.yellow("\n当前未安装本工具的 hook。运行 `claude-llm-proxy hook install` 来注册。"));
        console.log(chalk.dim(`\n可注册事件：${MANAGED_HOOK_EVENTS.join(", ")}`));
        return;
      }
      console.log(chalk.green(`\n当前已安装 ${items.length} 个 managed hook：`));
      items.forEach((it) => {
        console.log(`  ${it.event} → ${it.url}`);
      });
    });
};
