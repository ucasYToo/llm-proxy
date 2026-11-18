import fs from "fs";
import path from "path";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { cliPath, dataDir, serviceIdentity } from "./service-process";
import { atomicJson, preferences, readObject } from "./local-settings";
import pkg from "../../package.json";
import { shellQuote } from "../remote/session";
import { getDb } from "../storage/db";
import { getServerPort, maintenance, setMaintenance } from "../server/state";

const exec = promisify(execFile);
const registry =
  process.env.CLAUDE_PROXY_UPDATE_REGISTRY || pkg.publishConfig.registry;
const cacheFile = path.join(dataDir, "update-check.json");
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
let pending: Promise<void> | undefined;
let phase = "idle",
  lastError = "";
let interval: NodeJS.Timeout | undefined;
let host = "localhost";
export function isNewer(next: string, current: string) {
  if (!stable.test(next) || !stable.test(current)) return false;
  const a = next.split(".").map(BigInt),
    b = current.split(".").map(BigInt);
  return (
    a[0] > b[0] ||
    (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))
  );
}
export async function checkUpdate(force = false) {
  if (pending) return pending;
  if (
    !force &&
    (preferences().updateCheck === false ||
      Date.now() - Number(readObject(cacheFile).checkedAt) < 86400000)
  )
    return;
  pending = (async () => {
    const response = await fetch(
      new URL(
        pkg.name + "/latest",
        registry.endsWith("/") ? registry : registry + "/",
      ),
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error("npm registry HTTP " + response.status);
    const data = await response.json();
    if (typeof data.version !== "string" || !stable.test(data.version))
      throw new Error("registry 没有稳定版本");
    atomicJson(cacheFile, { checkedAt: Date.now(), latest: data.version });
    lastError = "";
  })();
  try {
    await pending;
  } catch (e) {
    lastError = (e as Error).message;
    throw e;
  } finally {
    pending = undefined;
  }
}
const npm = path.join(path.dirname(process.execPath), "npm");
async function installation() {
  if (
    process.platform === "win32" ||
    process.env.CLAUDE_PROXY_BACKGROUND !== "1"
  )
    return null;
  const root = path.resolve(__dirname, "../..");
  if (path.basename(root) !== pkg.name || !fs.existsSync(npm)) return null;
  const prefix = path.dirname(path.dirname(path.dirname(root)));
  if (path.join(prefix, "lib", "node_modules", pkg.name) !== root) return null;
  try {
    const options = { timeout: 4000 };
    const globalRoot = (await exec(npm, ["root", "-g"], options)).stdout.trim();
    const globalPrefix = (
      await exec(npm, ["prefix", "-g"], options)
    ).stdout.trim();
    if (
      fs.realpathSync(globalPrefix) !== prefix ||
      fs.realpathSync(globalRoot) !== path.dirname(root) ||
      fs.lstatSync(root).isSymbolicLink() ||
      fs.realpathSync(path.join(prefix, "bin", "claude-proxy")) !== cliPath
    )
      return null;
    fs.accessSync(globalRoot, fs.constants.W_OK);
    return prefix;
  } catch {
    return null;
  }
}
function manualUpdate(latest: string) {
  const root = path.resolve(__dirname, "../..");
  if (root.split(path.sep).includes("_npx"))
    return (
      "运行 npx --package " + pkg.name + "@" + latest + " claude-proxy start"
    );
  if (fs.existsSync(path.join(root, ".git")))
    return "在此源码目录获取新版本后执行 npm run build，再重新启动服务";
  if (
    root.endsWith(path.join("lib", "node_modules", pkg.name)) &&
    !fs.lstatSync(root).isSymbolicLink()
  )
    return "npm install -g " + pkg.name + "@" + latest + "，然后重新启动服务";
  return "请使用当前安装时的包管理器更新 " + pkg.name + "，然后重新启动服务";
}
export async function updateStatus() {
  const cache = readObject(cacheFile);
  return {
    ...serviceIdentity,
    current: pkg.version,
    latest: cache.latest ?? null,
    checkedAt: cache.checkedAt ?? null,
    available: isNewer(cache.latest ?? "", pkg.version),
    canInstall: !!(await installation()),
    autoCheck: preferences().updateCheck !== false,
    manualUpdate: manualUpdate(cache.latest ?? "latest"),
    phase,
    error: lastError,
  };
}
export function startUpdates(bindHost: string) {
  host = bindHost;
  void checkUpdate().catch(() => {});
  interval = setInterval(() => void checkUpdate().catch(() => {}), 3600000);
  interval.unref();
}
export function stopUpdates() {
  clearInterval(interval);
  interval = undefined;
}
export async function installUpdate(expected: string) {
  if (maintenance()) throw new Error("已有更新正在执行");
  setMaintenance(true);
  let lock: string | undefined;
  let helper: string | undefined;
  let recovery = "";
  try {
    const prefix = await installation();
    if (!prefix) throw new Error("当前安装方式需要手动更新");
    await checkUpdate(true);
    if (
      !isNewer(expected, pkg.version) ||
      readObject(cacheFile).latest !== expected
    )
      throw new Error("版本已变化，请重新检查");
    if (
      getDb()
        .prepare(
          "SELECT 1 FROM remote_threads WHERE status IN ('running','waiting_permission','queued') LIMIT 1",
        )
        .get() ||
      getDb()
        .prepare(
          "SELECT 1 FROM feishu_resume_notices WHERE status IN ('queued','running') LIMIT 1",
        )
        .get()
    )
      throw new Error("远程任务正在执行或排队");
    const lockPath = path.join(prefix, "lib", ".llm-proxy-view-update.lock");
    fs.writeFileSync(lockPath, String(process.pid), {
      flag: "wx",
      mode: 0o600,
    });
    lock = lockPath;
    helper = path.join(dataDir, "restart-" + process.pid + ".cjs");
    fs.copyFileSync(path.join(__dirname, "restart-after-update.js"), helper);
    phase = "installing";
    lastError = "";
    const options = {
      timeout: 300000,
      env: {
        ...process.env,
        PATH:
          path.dirname(process.execPath) +
          path.delimiter +
          (process.env.PATH ?? ""),
      },
    };
    recovery =
      "npm install -g --prefix " +
      shellQuote(prefix) +
      " " +
      pkg.name +
      "@" +
      pkg.version;
    fs.appendFileSync(
      path.join(dataDir, "server.log"),
      "升级前版本 " + pkg.version + "。恢复命令 " + recovery + "\n",
      { mode: 0o600 },
    );
    await exec(
      npm,
      [
        "install",
        "-g",
        "--prefix",
        prefix,
        "--registry",
        registry,
        "--no-fund",
        "--no-audit",
        pkg.name + "@" + expected,
      ],
      options,
    );
    const root = path.dirname(path.dirname(cliPath));
    if (readObject(path.join(root, "package.json")).version !== expected)
      throw new Error("安装版本与请求不符");
    await exec(process.execPath, [cliPath, "--help"], { timeout: 10000 });
    await exec(
      process.execPath,
      [
        "-e",
        "const db=new (require('better-sqlite3'))(':memory:'); db.close()",
      ],
      { cwd: root, timeout: 10000 },
    );
    const backup = path.join(
      dataDir,
      "logs.before-update-" + Date.now() + ".db",
    );
    await getDb().backup(backup);
    const args = [
      "start",
      "--background",
      "--host",
      host,
      "--port",
      String(getServerPort()),
    ];
    if (process.env.CLAUDE_PROXY_VERBOSE === "1") args.push("--verbose");
    if (process.env.CLAUDE_PROXY_STATUSBAR !== "1") args.push("--no-statusbar");
    const fd = fs.openSync(path.join(dataDir, "server.log"), "a", 0o600);
    try {
      const child = spawn(
        process.execPath,
        [helper, String(process.pid), cliPath, lock, recovery, ...args],
        { detached: true, stdio: ["ignore", fd, fd] },
      );
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
    } finally {
      fs.closeSync(fd);
    }
    phase = "restarting";
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 300);
    return { ok: true, version: expected, backup };
  } catch (e) {
    if (lock) fs.rmSync(lock, { force: true });
    if (helper) fs.rmSync(helper, { force: true });
    phase = "failed";
    lastError =
      (e as Error).message.slice(0, 300) +
      (recovery ? "。恢复命令见 server.log" : "");
    setMaintenance(false);
    throw new Error(lastError);
  }
}
