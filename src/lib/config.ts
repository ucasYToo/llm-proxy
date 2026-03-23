import fs from "fs";
import path from "path";
import type { Config, Target } from "./types";

const CONFIG_PATH = path.join(process.cwd(), "data", "config.json");

const DEFAULT_CONFIG: Config = {
  activeTarget: "",
  targets: [],
  logCollection: {
    captureOriginalBody: false,
    captureRawStreamEvents: false,
  },
};

export const readConfig = (): Config => {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Config;
    // 与默认值合并，处理旧配置文件中缺失的字段
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      logCollection: {
        ...DEFAULT_CONFIG.logCollection,
        ...(parsed.logCollection ?? {}),
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
};

export const writeConfig = (config: Config): void => {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
};

export const getActiveTarget = (): Target | null => {
  const config = readConfig();
  return config.targets.find((t) => t.id === config.activeTarget) ?? null;
};
