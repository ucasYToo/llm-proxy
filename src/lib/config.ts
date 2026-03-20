import fs from "fs";
import path from "path";
import type { Config, Target } from "./types";

const CONFIG_PATH = path.join(process.cwd(), "data", "config.json");

const DEFAULT_CONFIG: Config = { activeTarget: "", targets: [] };

export function readConfig(): Config {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as Config;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: Config): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function getActiveTarget(): Target | null {
  const config = readConfig();
  return config.targets.find((t) => t.id === config.activeTarget) ?? null;
}
