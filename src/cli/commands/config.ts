import { Command } from "commander";
import chalk from "chalk";
import { readConfig, writeConfig, getActiveTarget } from "../../config/store";
import type { Target } from "../../config/types";
import { v4 as uuidv4 } from "uuid";

export const configCommand = (program: Command) => {
  const config = program.command("config").description("配置管理");

  config
    .command("list")
    .description("列出所有目标")
    .action(() => {
      const cfg = readConfig();
      if (cfg.targets.length === 0) {
        console.log(chalk.yellow("未配置任何目标"));
        return;
      }

      console.log(chalk.bold("\n配置的目标:"));
      cfg.targets.forEach((t) => {
        const isActive =
          t.id === cfg.activeTarget ? chalk.green(" [活动]") : "";
        console.log(`  ${t.name}${isActive}`);
        console.log(`    URL: ${t.url}`);
        console.log(`    ID:  ${t.id}`);
        if (Object.keys(t.headers).length > 0) {
          console.log(`    Headers: ${JSON.stringify(t.headers)}`);
        }
        if (Object.keys(t.bodyParams).length > 0) {
          console.log(`    BodyParams: ${JSON.stringify(t.bodyParams)}`);
        }
        console.log("");
      });
    });

  config
    .command("add")
    .description("添加新目标")
    .requiredOption("--name <name>", "目标名称")
    .requiredOption("--url <url>", "目标 URL")
    .option("--headers <json>", "额外的请求头 (JSON)", "{}")
    .option("--body-params <json>", "额外的 Body 参数 (JSON)", "{}")
    .action(
      (options: {
        name: string;
        url: string;
        headers: string;
        bodyParams: string;
      }) => {
        const cfg = readConfig();
        const newTarget: Target = {
          id: uuidv4(),
          name: options.name,
          url: options.url,
          headers: JSON.parse(options.headers),
          bodyParams: JSON.parse(options.bodyParams),
        };

        cfg.targets.push(newTarget);
        if (!cfg.activeTarget) {
          cfg.activeTarget = newTarget.id;
        }
        writeConfig(cfg);

        console.log(chalk.green(`已添加目标: ${newTarget.name}`));
        console.log(`  ID: ${newTarget.id}`);
      },
    );

  config
    .command("set-active")
    .description("设置活动目标")
    .requiredOption("--name <name>", "目标名称")
    .action((options: { name: string }) => {
      const cfg = readConfig();
      const target = cfg.targets.find((t) => t.name === options.name);

      if (!target) {
        console.error(chalk.red(`未找到目标: ${options.name}`));
        process.exit(1);
      }

      cfg.activeTarget = target.id;
      writeConfig(cfg);
      console.log(chalk.green(`活动目标已设置为: ${target.name}`));
    });

  config
    .command("delete")
    .description("删除目标")
    .requiredOption("--name <name>", "目标名称")
    .action((options: { name: string }) => {
      const cfg = readConfig();
      const target = cfg.targets.find((t) => t.name === options.name);

      if (!target) {
        console.error(chalk.red(`未找到目标: ${options.name}`));
        process.exit(1);
      }

      cfg.targets = cfg.targets.filter((t) => t.id !== target.id);
      if (cfg.activeTarget === target.id) {
        cfg.activeTarget = cfg.targets[0]?.id ?? "";
      }
      writeConfig(cfg);
      console.log(chalk.green(`已删除目标: ${target.name}`));
    });

  config
    .command("show")
    .description("显示当前配置")
    .action(() => {
      const cfg = readConfig();
      const active = getActiveTarget();

      console.log(chalk.bold("\n当前配置:"));
      console.log(
        `  活动目标: ${active ? chalk.green(active.name) : chalk.yellow("未设置")}`,
      );
      console.log(`  目标数量: ${cfg.targets.length}`);
      console.log(
        `  采集原始请求体: ${cfg.logCollection.captureOriginalBody ? chalk.green("是") : chalk.red("否")}`,
      );
      console.log(
        `  采集原始流式事件: ${cfg.logCollection.captureRawStreamEvents ? chalk.green("是") : chalk.red("否")}`,
      );
    });
};
