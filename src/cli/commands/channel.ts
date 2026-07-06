import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { readConfig } from "../../config/store";
import { listRemoteInstances } from "../../remote/service";
import {
  installRemoteMcpConfig,
  REMOTE_MCP_SERVER_NAME,
} from "../../remote/mcp-config";

interface McpConfig {
  mcpServers?: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
  [key: string]: unknown;
}

const readJson = (file: string): McpConfig => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as McpConfig;
  } catch {
    return {};
  }
};

const claudeVersion = (): string | null => {
  try {
    return execSync("claude --version", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
};

export const channelCommand = (program: Command) => {
  const channel = program
    .command("channel")
    .description("管理 Claude Code remote bridge MCP channel");

  channel
    .command("install")
    .description("写入 .mcp.json，注册 claude-proxy-remote MCP channel")
    .option("--scope <scope>", "安装范围（当前仅支持 project）", "project")
    .option("-p, --port <port>", "本地 proxy 端口", "1998")
    .action((options: { scope: string; port: string }) => {
      if (options.scope !== "project") {
        console.error(chalk.red("当前只支持 --scope project"));
        process.exit(1);
      }
      const port = Number(options.port);
      if (!Number.isFinite(port) || port <= 0) {
        console.error(chalk.red(`端口不合法: ${options.port}`));
        process.exit(1);
      }
      const { file, serverName } = installRemoteMcpConfig(process.cwd(), port);
      console.log(chalk.green(`已写入 ${serverName} 到 ${file}`));
      console.log("");
      console.log("启动 Claude Code 时启用 channel：");
      console.log(
        chalk.cyan(
          `  claude --dangerously-load-development-channels server:${serverName}`,
        ),
      );
      console.log(chalk.dim("research preview 期间自定义 channel 需要 development flag。"));
    });

  channel
    .command("status")
    .description("检查 MCP 配置、Claude Code 版本和 channel 心跳")
    .action(() => {
      const file = path.join(process.cwd(), ".mcp.json");
      const cfg = readJson(file);
      const server = cfg.mcpServers?.[REMOTE_MCP_SERVER_NAME];
      console.log(chalk.bold("Remote bridge"));
      console.log(`  enabled: ${readConfig().remoteBridge?.enabled ? chalk.green("yes") : chalk.yellow("no")}`);
      console.log(`  token:   ${readConfig().remoteBridge?.authToken ? chalk.green("configured") : chalk.red("missing")}`);
      console.log("");
      console.log(chalk.bold("MCP"));
      if (server) {
        console.log(`  ${file}`);
        console.log(`  command: ${server.command} ${(server.args ?? []).join(" ")}`);
      } else {
        console.log(chalk.yellow(`  ${REMOTE_MCP_SERVER_NAME} 未写入 ${file}`));
      }
      console.log("");
      console.log(chalk.bold("Claude Code"));
      console.log(`  version: ${claudeVersion() ?? chalk.yellow("not found")}`);
      console.log("");
      console.log(chalk.bold("Online channel instances"));
      const instances = listRemoteInstances({ includeStale: false, limit: 20 });
      if (instances.length === 0) {
        console.log(chalk.yellow("  none"));
      } else {
        for (const it of instances) {
          console.log(`  ${it.id} cwd=${it.cwd ?? "-"} lastSeen=${it.lastSeenAt}`);
        }
      }
    });
};
