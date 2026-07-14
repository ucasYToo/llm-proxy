import { Command } from "commander";
import { startCommand } from "./commands/start";
import { configCommand } from "./commands/config";
import { logsCommand } from "./commands/logs";
import { hookCommand } from "./commands/hook";
import { channelCommand } from "./commands/channel";
import { codexCommand } from "./commands/codex";
import pkg from "../../package.json";

const program = new Command();

program
  .name("claude-llm-proxy")
  .description("LLM Proxy CLI - 代理转发和日志管理工具")
  .version(pkg.version, "-v, --version");

startCommand(program);
configCommand(program);
logsCommand(program);
hookCommand(program);
channelCommand(program);
codexCommand(program);

program.parse();
