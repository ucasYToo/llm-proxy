import { Command } from "commander";
import {
  configureRaw,
  rawStatus,
  claudeCaptureVersion,
} from "../../lib/raw-settings";

export function rawBodiesCommand(program: Command) {
  const raw = program
    .command("raw-bodies")
    .description("管理 Claude Code 本地文件采集");
  for (const action of ["install", "uninstall", "status"])
    raw
      .command(action)
      .option("--timing", "管理可选的本机 OTLP 耗时采集")
      .option("--port <port>", "服务端口", "1998")
      .action(async (options: { timing?: boolean; port: string }) => {
        const port = Number(options.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new Error("端口无效");
        const result =
          action === "status"
            ? rawStatus(port)
            : configureRaw(
                options.timing ? "timing" : "raw",
                action === "install",
                port,
              );
        console.log(
          JSON.stringify(
            action === "status"
              ? {
                  ...result,
                  claudeVersion: await claudeCaptureVersion(),
                  minimumIndexVersion: "2.1.274",
                }
              : result,
            null,
            2,
          ),
        );
      });
}
