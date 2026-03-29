import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { startServer } from "../../server";

export const startCommand = (program: Command) => {
  program
    .command("start")
    .description("启动代理服务器")
    .option("-p, --port <number>", "监听端口", "1998")
    .option("--host <address>", "绑定地址", "localhost")
    .option("--ui", "启用 Web UI (服务静态构建文件)")
    .action(async (options: { port: string; host: string; ui: boolean }) => {
      const port = parseInt(options.port, 10);
      const host = options.host;
      const ui = options.ui || true;

      const spinner = ora("启动代理服务器...").start();

      try {
        const server = await startServer({ port, host, serveUI: ui });

        spinner.succeed(chalk.green("代理服务器已启动!"));

        console.log("\n服务器信息:");
        console.log(`  地址: ${chalk.cyan(`http://${host}:${port}`)}`);
        if (ui) {
          console.log(`  UI:   ${chalk.cyan(`http://${host}:${port}`)}`);
        }
        console.log(`  代理: ${chalk.cyan(`http://${host}:${port}/proxy/*`)}`);
        console.log(`  API:  ${chalk.cyan(`http://${host}:${port}/api/*`)}`);

        console.log("\n可用端点:");
        console.log(`  GET  /api/query?type=config  - 查询配置`);
        console.log(`  GET  /api/query?type=logs    - 查询日志`);
        console.log(`  POST /api/set                 - 修改配置`);
        console.log(`  ALL  /proxy/*                 - 代理请求`);

        console.log("\n按 Ctrl+C 停止服务器");

        // 处理优雅关闭
        process.on("SIGINT", () => {
          console.log("\n\n正在关闭服务器...");
          server.close(() => {
            console.log(chalk.yellow("服务器已关闭"));
            process.exit(0);
          });
        });
      } catch (error) {
        spinner.fail(chalk.red("启动失败"));
        console.error(error);
        process.exit(1);
      }
    });
};
