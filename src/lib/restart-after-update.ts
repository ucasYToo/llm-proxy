// Copied outside the npm installation before it is replaced. Use built-in modules only.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

async function restart() {
  const [oldPid, cli, lock, recovery, ...args] = process.argv.slice(2);
  const deadline = Date.now() + 30_000;
  try {
    for (;;) {
      try {
        process.kill(Number(oldPid), 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
        throw error;
      }
      if (Date.now() >= deadline) throw new Error("旧服务退出超时");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const child = spawnSync(process.execPath, [cli, ...args], {
      stdio: "inherit",
      timeout: 30000,
    });
    if (child.error || child.status !== 0)
      throw child.error ?? new Error("新版服务启动失败");
  } catch (error) {
    console.error((error as Error).message, "恢复命令:", recovery);
    process.exitCode = 1;
  } finally {
    fs.rmSync(lock, { force: true });
    fs.rmSync(__filename, { force: true });
  }
}
void restart();
