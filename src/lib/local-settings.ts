import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID, randomBytes } from "crypto";

export const claudeConfigDir = path.resolve(
  process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.HOME || os.homedir(), ".claude"),
);
export const settingsPath = path.join(claudeConfigDir, "settings.json");
export const localDir = path.join(
  process.env.HOME || os.homedir(),
  ".claude-proxy",
);
export function readObject(file: string): Record<string, any> {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("预期 JSON 对象: " + file);
    return data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}
export function atomicJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
export function mutateJson<T>(
  file: string,
  mutate: (value: Record<string, any>) => T,
): T {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = file + ".claude-proxy.lock";
  const until = Date.now() + 2500;
  while (true) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() >= until)
        throw new Error("设置正被修改。如所有写入进程已退出，请清理 " + lock);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    const settings = readObject(file);
    const result = mutate(settings);
    atomicJson(file, settings);
    return result;
  } finally {
    fs.rmdirSync(lock);
  }
}
export const preferencesPath = path.join(localDir, "service-settings.json");
export const preferences = () => readObject(preferencesPath);
export function hookKey(): string {
  const current = preferences().hookKey;
  if (typeof current === "string" && current.length === 64) return current;
  return mutateJson(
    preferencesPath,
    (p) => (p.hookKey ||= randomBytes(32).toString("hex")),
  );
}
