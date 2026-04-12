import { Command } from "commander";
import { startCommand } from "./commands/start";
import { configCommand } from "./commands/config";
import { logsCommand } from "./commands/logs";
import pkg from "../../package.json";

const program = new Command();

program
  .name("claude-proxy")
  .description("LLM Proxy CLI - 代理转发和日志管理工具")
  .version(pkg.version, "-v, --version");

startCommand(program);
configCommand(program);
logsCommand(program);

program.parse();
