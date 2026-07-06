import fs from "fs";
import path from "path";
import { readConfig, writeConfig } from "../config/store";
import type { RemoteBridgeConfig } from "../interfaces";

export const REMOTE_MCP_SERVER_NAME = "claude-proxy-remote";

interface McpConfig {
  mcpServers?: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
  [key: string]: unknown;
}

export interface InstallRemoteMcpResult {
  file: string;
  serverName: string;
  token: string;
  remoteBridge: RemoteBridgeConfig;
}

const readJson = (file: string): McpConfig => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as McpConfig;
  } catch {
    return {};
  }
};

const writeJson = (file: string, data: McpConfig): void => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
};

export const remoteChannelBinPath = (): string =>
  path.resolve(__dirname, "../../bin/channel.js");

export const ensureRemoteBridgeEnabled = (
  defaultCwd?: string | null,
): RemoteBridgeConfig => {
  const config = readConfig();
  config.remoteBridge = {
    ...(config.remoteBridge ?? {}),
    enabled: true,
    web: { ...(config.remoteBridge?.web ?? {}), enabled: true },
    defaultCwd: config.remoteBridge?.defaultCwd ?? defaultCwd ?? undefined,
    claudeCommand: config.remoteBridge?.claudeCommand || "claude",
    permissionMode: config.remoteBridge?.permissionMode ?? "default",
    feishu: {
      ...(config.remoteBridge?.feishu ?? {}),
      ingress: config.remoteBridge?.feishu?.ingress ?? "longConnection",
    },
  };
  writeConfig(config);
  return config.remoteBridge;
};

export const installRemoteMcpConfig = (
  cwd: string,
  port: number,
): InstallRemoteMcpResult => {
  const projectDir = path.resolve(cwd);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`cwd does not exist or is not a directory: ${projectDir}`);
  }

  const remoteBridge = ensureRemoteBridgeEnabled(projectDir);
  const token = remoteBridge.authToken;
  if (!token) throw new Error("remoteBridge.authToken is missing");

  const file = path.join(projectDir, ".mcp.json");
  const cfg = readJson(file);
  cfg.mcpServers = cfg.mcpServers ?? {};
  cfg.mcpServers[REMOTE_MCP_SERVER_NAME] = {
    command: "node",
    args: [remoteChannelBinPath()],
    env: {
      CLAUDE_PROXY_REMOTE_PORT: String(port),
      CLAUDE_PROXY_REMOTE_TOKEN: token,
    },
  };
  writeJson(file, cfg);

  return {
    file,
    serverName: REMOTE_MCP_SERVER_NAME,
    token,
    remoteBridge,
  };
};
