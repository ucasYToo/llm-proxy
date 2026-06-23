import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "child_process";
import { readConfig, writeConfig } from "../../config/store";
import { getFeishuRemoteStatus } from "../../remote/feishu/service";
import {
  FEISHU_REMOTE_MCP_SERVER,
  getFeishuRemoteLaunchCommand,
  installFeishuRemoteMcp,
} from "../../remote/feishu/mcp";
import { runFeishuRemoteSidecar } from "../../remote/feishu/sidecar";

export const feishuRemoteCommand = (program: Command) => {
  const remote = program
    .command("feishu-remote")
    .description("管理飞书远程控制 Claude Code channel");

  remote
    .command("install")
    .description("把飞书远控 MCP channel 写入项目 .mcp.json")
    .option("--project <cwd>", "项目目录", process.cwd())
    .option("-p, --port <port>", "本地 proxy 端口", "1998")
    .option("--host <host>", "本地 proxy host", "localhost")
    .action((options: { project: string; port: string; host: string }) => {
      const port = Number(options.port);
      if (!Number.isFinite(port) || port <= 0) {
        console.error(chalk.red(`端口不合法: ${options.port}`));
        process.exit(1);
      }
      const config = readConfig();
      if (!config.feishuRemote) {
        config.feishuRemote = {};
        writeConfig(config);
        readConfig();
      }
      const result = installFeishuRemoteMcp({
        projectCwd: options.project,
        port,
        host: options.host,
      });
      console.log(chalk.green(`已安装 MCP server: ${result.serverName}`));
      console.log(`  文件: ${result.mcpPath}`);
      console.log(`  项目: ${result.projectCwd}`);
      console.log(`  命令: ${result.command} ${result.args.join(" ")}`);
      console.log(chalk.dim("\n首次启动 Claude Code 时需要信任该项目 MCP server。"));
      console.log(chalk.cyan(`\n启动 channel session:\n  ${getFeishuRemoteLaunchCommand()}`));
    });

  remote
    .command("status")
    .description("查看飞书远控本地配置和运行提示")
    .action(() => {
      const status = getFeishuRemoteStatus();
      console.log(chalk.bold("飞书远程控制"));
      console.log(`  enabled: ${status.config.enabled ? "yes" : "no"}`);
      console.log(`  appId: ${status.config.appId ?? "-"}`);
      console.log(`  appSecret: ${status.config.hasAppSecret ? "configured" : "-"}`);
      console.log(`  sidecarSecret: ${status.config.hasSidecarSecret ? "configured" : "-"}`);
      console.log(`  allowed users: ${status.config.allowedUserIds?.length ?? 0}`);
      console.log(`  allowed chats: ${status.config.allowedChatIds?.length ?? 0}`);
      console.log(`  MCP server: ${FEISHU_REMOTE_MCP_SERVER}`);
      console.log(`  launch: ${getFeishuRemoteLaunchCommand()}`);
      console.log(chalk.dim("\n运行态 sidecar 需要通过 Web UI 或服务 API 查看。"));
    });

  remote
    .command("start")
    .description("在项目目录启动带飞书 channel 的 Claude Code")
    .option("--project <cwd>", "项目目录", process.cwd())
    .action((options: { project: string }) => {
      const args = [
        "--dangerously-load-development-channels",
        `server:${FEISHU_REMOTE_MCP_SERVER}`,
      ];
      console.log(chalk.cyan(`启动: claude ${args.join(" ")}`));
      console.log(chalk.dim(`项目: ${options.project}`));
      const child = spawn("claude", args, {
        cwd: options.project,
        stdio: "inherit",
      });
      child.on("exit", (code) => {
        process.exit(code ?? 0);
      });
      child.on("error", (err) => {
        console.error(chalk.red(`启动 Claude Code 失败: ${err.message}`));
        process.exit(1);
      });
    });

  remote
    .command("sidecar")
    .description("Claude Code MCP channel sidecar（通常由 Claude Code 自动启动）")
    .option("-p, --port <port>", "本地 proxy 端口", "1998")
    .option("--host <host>", "本地 proxy host", "localhost")
    .option("--id <id>", "sidecar id")
    .action(async (options: { port: string; host: string; id?: string }) => {
      const port = Number(options.port);
      if (!Number.isFinite(port) || port <= 0) {
        console.error(chalk.red(`端口不合法: ${options.port}`));
        process.exit(1);
      }
      try {
        await runFeishuRemoteSidecar({
          port,
          host: options.host,
          id: options.id,
        });
      } catch (err) {
        console.error(chalk.red(String(err)));
        process.exit(1);
      }
    });
};
