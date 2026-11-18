import fs from "fs";
import { localDir } from "./local-settings";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import pkg from "../../package.json";

export const dataDir = localDir;
export const cliPath = path.resolve(__dirname, "../../bin/cli.js");
export const serviceIdentity = {
  service: pkg.name,
  version: pkg.version,
  instanceId: process.env.CLAUDE_PROXY_INSTANCE_ID || randomUUID(),
};
export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export function serviceUrl(host: string, port: number) {
  const address =
    host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return (
    "http://" +
    (address.includes(":") && !address.startsWith("[")
      ? "[" + address + "]"
      : address) +
    ":" +
    port
  );
}
async function instanceAt(host: string, port: number): Promise<string | null> {
  try {
    const response = await fetch(serviceUrl(host, port) + "/health", {
      signal: AbortSignal.timeout(750),
      redirect: "error",
    });
    const data = await response.json();
    return response.ok &&
      data.status === "ok" &&
      data.service === pkg.name &&
      typeof data.instanceId === "string"
      ? data.instanceId
      : null;
  } catch {
    return null;
  }
}
export const probe = async (host: string, port: number) =>
  !!(await instanceAt(host, port));
export async function ensureBackground(
  host: string,
  port: number,
  verbose: boolean,
  statusbar: boolean,
) {
  if (await probe(host, port)) return false;
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const log = path.join(dataDir, "server.log");
  try {
    if (fs.statSync(log).size > 5 * 1024 * 1024) fs.renameSync(log, log + ".1");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const fd = fs.openSync(log, "a", 0o600);
  const expectedInstance = randomUUID();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_PROXY_INSTANCE_ID: expectedInstance,
    CLAUDE_PROXY_BACKGROUND: "1",
    CLAUDE_PROXY_STATUSBAR: statusbar ? "1" : "0",
  };
  for (const key of Object.keys(env))
    if (
      key === "CLAUDECODE" ||
      key === "CLAUDE_CODE_ENTRYPOINT" ||
      key.startsWith("CLAUDE_PROXY_REMOTE")
    )
      delete env[key];
  const args = [
    "start",
    "--foreground",
    "--no-statusbar",
    "--host",
    host,
    "--port",
    String(port),
  ];
  if (verbose) args.push("--verbose");
  let child;
  try {
    fs.writeSync(
      fd,
      "\n[" + new Date().toISOString() + "] start " + host + ":" + port + "\n",
    );
    child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], ...args],
      {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", fd, fd],
        env,
      },
    );
  } finally {
    fs.closeSync(fd);
  }
  let failure: Error | undefined;
  child.once("error", (err) => {
    failure = err;
  });
  child.unref();
  let deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const actual = await instanceAt(host, port);
    if (actual) return actual === expectedInstance;
    if (failure) throw failure;
    if (child.exitCode !== null || child.signalCode)
      deadline = Math.min(deadline, Date.now() + 1500);
    await sleep(180);
  }
  if (child.exitCode === null) child.kill("SIGTERM");
  throw new Error("后台服务未就绪，请检查端口和启动日志 " + log);
}
