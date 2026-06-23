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
exports.getProxyHost = getProxyHost;
exports.getProxyPort = getProxyPort;
exports.getChannelId = getChannelId;
exports.getCommitLanguage = getCommitLanguage;
exports.useConventionalCommits = useConventionalCommits;
exports.getMaxDiffLines = getMaxDiffLines;
exports.getCustomPrompt = getCustomPrompt;
exports.getProxyBaseUrl = getProxyBaseUrl;
const vscode = __importStar(require("vscode"));
function cfg() {
    return vscode.workspace.getConfiguration("claude-proxy");
}
function getProxyHost() {
    return cfg().get("proxyHost", "localhost");
}
function getProxyPort() {
    return cfg().get("proxyPort", 1998);
}
function getChannelId() {
    return cfg().get("channelId", "default");
}
function getCommitLanguage() {
    return cfg().get("commitMessage.language", "zh");
}
function useConventionalCommits() {
    return cfg().get("commitMessage.conventionalCommits", true);
}
function getMaxDiffLines() {
    return cfg().get("commitMessage.maxDiffLines", 500);
}
function getCustomPrompt() {
    return cfg().get("commitMessage.customPrompt", "");
}
function getProxyBaseUrl() {
    const host = getProxyHost();
    const port = getProxyPort();
    const channelId = getChannelId();
    const prefix = channelId === "default" ? "proxy" : `${channelId}/proxy`;
    return `http://${host}:${port}/${prefix}`;
}
