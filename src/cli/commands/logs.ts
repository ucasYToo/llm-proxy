import { Command } from "commander";
import chalk from "chalk";
import { queryLogs, clearLogs } from "../../storage/logs";
import { formatTime } from "../../utils/format";

export const logsCommand = (program: Command) => {
  program
    .command("logs")
    .description("查看日志")
    .option("-l, --limit <number>", "限制条数", "20")
    .option("-t, --target <name>", "按目标筛选")
    .option("--json", "JSON 格式输出")
    .action(
      async (options: { limit: string; target?: string; json: boolean }) => {
        const limit = parseInt(options.limit, 10);
        const { target, json } = options;

        // 如果有 target 筛选，需要先查找 targetId
        let targetId: string | undefined;
        if (target) {
          const { readConfig } = await import("../../config/store");
          const cfg = readConfig();
          const t = cfg.targets.find((t) => t.name === target);
          if (t) {
            targetId = t.id;
          }
        }

        const { entries, total } = queryLogs({ limit, targetId });

        if (entries.length === 0) {
          console.log(chalk.yellow("没有日志"));
          return;
        }

        if (json) {
          console.log(JSON.stringify(entries, null, 2));
          return;
        }

        console.log(
          chalk.bold(`\n日志 (共 ${total} 条，显示 ${entries.length} 条):\n`),
        );

        entries.forEach((log) => {
          const status = log.error
            ? chalk.red("错误")
            : log.responseStatus >= 200 && log.responseStatus < 300
              ? chalk.green("成功")
              : chalk.yellow(`${log.responseStatus}`);

          console.log(
            chalk.bold(
              `[${formatTime(log.timestamp)}] ${log.targetName} - ${log.method} ${log.path}`,
            ),
          );
          console.log(`  状态: ${status}`);
          console.log(`  耗时: ${log.durationMs}ms`);

          if (log.tokenUsage) {
            console.log(
              `  Token: ${log.tokenUsage.inputTokens ?? "?"} 输入 / ${log.tokenUsage.outputTokens ?? "?"} 输出`,
            );
          }

          if (log.error) {
            console.log(`  错误: ${chalk.red(log.error)}`);
          }

          console.log("");
        });
      },
    );

  program
    .command("clear-logs")
    .description("清空所有日志")
    .action(async () => {
      clearLogs();
      console.log(chalk.green("日志已清空"));
    });
};
