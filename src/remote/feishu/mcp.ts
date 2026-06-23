import fs from "fs";
import path from "path";

export const FEISHU_REMOTE_MCP_SERVER = "claude-proxy-feishu";

export interface McpInstallResult {
  projectCwd: string;
  mcpPath: string;
  serverName: string;
  command: string;
  args: string[];
}

const readJsonObject = (filePath: string): Record<string, unknown> => {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // create a fresh file below
  }
  return {};
};

const findCliEntry = (): string => {
  const candidates = [
    path.resolve(__dirname, "../../../bin/cli.js"),
    path.resolve(__dirname, "../../bin/cli.js"),
    path.resolve(process.cwd(), "bin/cli.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};

export const installFeishuRemoteMcp = (params: {
  projectCwd: string;
  port: number;
  host?: string;
}): McpInstallResult => {
  const projectCwd = path.resolve(params.projectCwd);
  const mcpPath = path.join(projectCwd, ".mcp.json");
  const root = readJsonObject(mcpPath);
  const servers =
    root.mcpServers && typeof root.mcpServers === "object"
      ? (root.mcpServers as Record<string, unknown>)
      : {};
  const command = process.execPath;
  const args = [
    findCliEntry(),
    "feishu-remote",
    "sidecar",
    "--port",
    String(params.port),
  ];
  if (params.host) {
    args.push("--host", params.host);
  }
  servers[FEISHU_REMOTE_MCP_SERVER] = { command, args };
  root.mcpServers = servers;
  fs.writeFileSync(mcpPath, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
  return {
    projectCwd,
    mcpPath,
    serverName: FEISHU_REMOTE_MCP_SERVER,
    command,
    args,
  };
};

export const getFeishuRemoteLaunchCommand = (): string =>
  `claude --dangerously-load-development-channels server:${FEISHU_REMOTE_MCP_SERVER}`;
