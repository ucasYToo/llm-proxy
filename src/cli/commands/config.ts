import { Command } from "commander";
import chalk from "chalk";
import { readConfig, writeConfig, getActiveTarget, getChannels, addChannel, deleteChannel, setChannelActiveTarget } from "../../config/store";
import type { Target, Channel } from "../../config/types";
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

  // 通道管理子命令
  const channel = config.command("channel").description("通道管理");

  channel
    .command("list")
    .description("列出所有通道")
    .action(() => {
      const cfg = readConfig();
      const channels = getChannels();
      if (channels.length === 0) {
        console.log(chalk.yellow("未配置任何通道"));
        return;
      }

      console.log(chalk.bold("\n配置的通道:"));
      channels.forEach((c) => {
        const activeTarget = cfg.targets.find((t) => t.id === c.activeTarget);
        console.log(`  ${c.name} (ID: ${c.id})`);
        console.log(`    活动目标: ${activeTarget ? chalk.green(activeTarget.name) : chalk.yellow("未设置")}`);
        console.log("");
      });
    });

  channel
    .command("add")
    .description("添加新通道")
    .requiredOption("--name <name>", "通道名称")
    .option("--active-target <name>", "活动目标名称")
    .action((options: { name: string; activeTarget?: string }) => {
      const cfg = readConfig();
      let activeTargetId = "";
      if (options.activeTarget) {
        const target = cfg.targets.find((t) => t.name === options.activeTarget);
        if (!target) {
          console.error(chalk.red(`未找到目标: ${options.activeTarget}`));
          process.exit(1);
        }
        activeTargetId = target.id;
      }

      const newChannel: Channel = {
        id: uuidv4(),
        name: options.name,
        activeTarget: activeTargetId,
      };

      addChannel(newChannel);
      console.log(chalk.green(`已添加通道: ${newChannel.name}`));
      console.log(`  ID: ${newChannel.id}`);
    });

  channel
    .command("set-active")
    .description("设置通道的活动目标")
    .requiredOption("--channel <channelId>", "通道 ID")
    .requiredOption("--target <targetName>", "目标名称")
    .action((options: { channel: string; target: string }) => {
      const cfg = readConfig();
      const target = cfg.targets.find((t) => t.name === options.target);
      if (!target) {
        console.error(chalk.red(`未找到目标: ${options.target}`));
        process.exit(1);
      }

      setChannelActiveTarget(options.channel, target.id);
      console.log(chalk.green(`通道 ${options.channel} 的活动目标已设置为: ${target.name}`));
    });

  channel
    .command("delete")
    .description("删除通道")
    .requiredOption("--channel <channelId>", "通道 ID")
    .action((options: { channel: string }) => {
      if (options.channel === "default") {
        console.error(chalk.red("不能删除默认通道"));
        process.exit(1);
      }

      deleteChannel(options.channel);
      console.log(chalk.green(`已删除通道: ${options.channel}`));
    });
};
