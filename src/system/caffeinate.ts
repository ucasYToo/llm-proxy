import { spawn, ChildProcess } from "child_process";

/**
 * 托管 macOS 的 caffeinate 子进程，让系统在锁屏时也不进入睡眠。
 * - 进程引用保存在内存，服务重启不恢复（避免"忘记关"的反直觉）
 * - 服务退出前必须调用 stop()，否则 caffeinate 会成为孤儿继续保活
 */

let proc: ChildProcess | null = null;

export const isSupported = (): boolean => process.platform === "darwin";

export const isActive = (): boolean => proc !== null && !proc.killed;

export const start = (): { ok: boolean; reason?: string } => {
  if (!isSupported()) {
    return { ok: false, reason: "caffeinate 仅在 macOS 可用" };
  }
  if (isActive()) {
    return { ok: true };
  }

  try {
    const child = spawn("caffeinate", ["-s", "-i"], {
      stdio: "ignore",
      detached: false,
    });

    child.on("error", () => {
      proc = null;
    });
    child.on("exit", () => {
      // 进程意外退出（被外部 kill、系统重启 caffeinate 等），清理引用
      if (proc === child) proc = null;
    });

    proc = child;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
};

export const stop = (): void => {
  if (!proc) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }
  proc = null;
};
