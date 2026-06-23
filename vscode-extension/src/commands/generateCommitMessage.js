"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCommitMessage = generateCommitMessage;
const vscode = __importStar(require("vscode"));
const client_1 = require("../proxy/client");
const llm_1 = require("../proxy/llm");
const diff_1 = require("../git/diff");
const commitMessage_1 = require("../prompt/commitMessage");
const config_1 = require("../utils/config");
async function generateCommitMessage() {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.SourceControl,
        title: "Generating commit message...",
    }, async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage("No workspace folder open.");
            return;
        }
        let config;
        try {
            config = await (0, client_1.fetchProxyConfig)();
        }
        catch {
            vscode.window.showErrorMessage("Cannot connect to proxy. Is claude-llm-proxy running?");
            return;
        }
        const channelId = (0, config_1.getChannelId)();
        const target = (0, client_1.getActiveTarget)(config, channelId);
        if (!target) {
            vscode.window.showErrorMessage(`No active target for channel "${channelId}".`);
            return;
        }
        const cwd = resolveRepoCwd(workspaceFolder.uri.fsPath);
        const diffResult = (0, diff_1.getGitDiff)(cwd, (0, config_1.getMaxDiffLines)());
        if (!diffResult.diff.trim()) {
            vscode.window.showWarningMessage("No changes detected. Stage some changes first.");
            return;
        }
        const { system, user } = (0, commitMessage_1.buildCommitPrompt)({
            diff: diffResult.diff,
            language: (0, config_1.getCommitLanguage)(),
            conventionalCommits: (0, config_1.useConventionalCommits)(),
            customPrompt: (0, config_1.getCustomPrompt)(),
        });
        let commitMessage;
        try {
            commitMessage = await (0, llm_1.generateWithLLM)({
                system,
                userMessage: user,
                proxyBaseUrl: (0, config_1.getProxyBaseUrl)(),
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to generate: ${msg}`);
            return;
        }
        const repo = getGitRepository(cwd);
        if (repo) {
            repo.inputBox.value = commitMessage;
        }
        else {
            await vscode.env.clipboard.writeText(commitMessage);
            vscode.window.showInformationMessage("Commit message copied to clipboard (Git API not available).");
        }
    });
}
function getGitRepository(cwd) {
    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (!gitExt?.isActive)
        return undefined;
    const api = gitExt.exports.getAPI(1);
    return (api.repositories.find((r) => r.rootUri.fsPath === cwd || cwd.startsWith(r.rootUri.fsPath)) ?? api.repositories[0]);
}
function resolveRepoCwd(workspacePath) {
    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (!gitExt?.isActive)
        return workspacePath;
    const api = gitExt.exports.getAPI(1);
    const repo = api.repositories.find((r) => workspacePath.startsWith(r.rootUri.fsPath));
    return repo?.rootUri.fsPath ?? workspacePath;
}
