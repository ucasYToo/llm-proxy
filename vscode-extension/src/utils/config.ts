import * as vscode from "vscode";

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("claude-proxy");
}

export function getProxyHost(): string {
  return cfg().get<string>("proxyHost", "localhost");
}

export function getProxyPort(): number {
  return cfg().get<number>("proxyPort", 1998);
}

export function getChannelId(): string {
  return cfg().get<string>("channelId", "default");
}

export function getCommitLanguage(): "zh" | "en" {
  return cfg().get<"zh" | "en">("commitMessage.language", "zh");
}

export function useConventionalCommits(): boolean {
  return cfg().get<boolean>("commitMessage.conventionalCommits", true);
}

export function getMaxDiffLines(): number {
  return cfg().get<number>("commitMessage.maxDiffLines", 500);
}

export function getCustomPrompt(): string {
  return cfg().get<string>("commitMessage.customPrompt", "");
}

export function getProxyBaseUrl(): string {
  const host = getProxyHost();
  const port = getProxyPort();
  const channelId = getChannelId();
  const prefix = channelId === "default" ? "proxy" : `${channelId}/proxy`;
  return `http://${host}:${port}/${prefix}`;
}
