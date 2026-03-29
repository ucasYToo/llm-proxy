import { Command } from "commander";
import { startCommand } from "./commands/start";
import { configCommand } from "./commands/config";
import { logsCommand } from "./commands/logs";

const program = new Command();

program
  .name("claude-proxy")
  .description("LLM Proxy CLI - 代理转发和日志管理工具")
  .version("1.0.0");

startCommand(program);
configCommand(program);
logsCommand(program);

program.parse();
