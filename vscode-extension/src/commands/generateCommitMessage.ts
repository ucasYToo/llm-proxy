import * as vscode from "vscode";
import { fetchProxyConfig, getActiveTarget } from "../proxy/client";
import { generateWithLLM } from "../proxy/llm";
import { getGitDiff } from "../git/diff";
import { buildCommitPrompt } from "../prompt/commitMessage";
import {
  getChannelId,
  getCommitLanguage,
  getCustomPrompt,
  getMaxDiffLines,
  getProxyBaseUrl,
  useConventionalCommits,
} from "../utils/config";

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
}

export async function generateCommitMessage(): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.SourceControl,
      title: "Generating commit message...",
    },
    async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }

      let config;
      try {
        config = await fetchProxyConfig();
      } catch {
        vscode.window.showErrorMessage(
          "Cannot connect to proxy. Is claude-llm-proxy running?",
        );
        return;
      }

      const channelId = getChannelId();
      const target = getActiveTarget(config, channelId);
      if (!target) {
        vscode.window.showErrorMessage(
          `No active target for channel "${channelId}".`,
        );
        return;
      }

      const cwd = resolveRepoCwd(workspaceFolder.uri.fsPath);
      const diffResult = getGitDiff(cwd, getMaxDiffLines());
      if (!diffResult.diff.trim()) {
        vscode.window.showWarningMessage(
          "No changes detected. Stage some changes first.",
        );
        return;
      }

      const { system, user } = buildCommitPrompt({
        diff: diffResult.diff,
        language: getCommitLanguage(),
        conventionalCommits: useConventionalCommits(),
        customPrompt: getCustomPrompt(),
      });

      let commitMessage: string;
      try {
        commitMessage = await generateWithLLM({
          system,
          userMessage: user,
          proxyBaseUrl: getProxyBaseUrl(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to generate: ${msg}`);
        return;
      }

      const repo = getGitRepository(cwd);
      if (repo) {
        repo.inputBox.value = commitMessage;
      } else {
        await vscode.env.clipboard.writeText(commitMessage);
        vscode.window.showInformationMessage(
          "Commit message copied to clipboard (Git API not available).",
        );
      }
    },
  );
}

function getGitRepository(cwd: string): GitRepository | undefined {
  const gitExt = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!gitExt?.isActive) return undefined;
  const api = gitExt.exports.getAPI(1);
  return (
    api.repositories.find(
      (r) => r.rootUri.fsPath === cwd || cwd.startsWith(r.rootUri.fsPath),
    ) ?? api.repositories[0]
  );
}

function resolveRepoCwd(workspacePath: string): string {
  const gitExt = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!gitExt?.isActive) return workspacePath;
  const api = gitExt.exports.getAPI(1);
  const repo = api.repositories.find((r) =>
    workspacePath.startsWith(r.rootUri.fsPath),
  );
  return repo?.rootUri.fsPath ?? workspacePath;
}
