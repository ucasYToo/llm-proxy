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
exports.setExtensionUri = setExtensionUri;
exports.runTerminalScript = runTerminalScript;
const vscode = __importStar(require("vscode"));
let extensionUri;
function setExtensionUri(uri) {
    extensionUri = uri;
}
async function runTerminalScript() {
    const config = vscode.workspace.getConfiguration("claude-proxy");
    const script = config.get("terminalScript", "claude --dangerously-skip-permissions");
    const iconPath = extensionUri
        ? {
            light: vscode.Uri.joinPath(extensionUri, "resources", "icons", "terminal-light.svg"),
            dark: vscode.Uri.joinPath(extensionUri, "resources", "icons", "terminal-dark.svg"),
        }
        : undefined;
    const terminal = vscode.window.createTerminal({
        name: "Claude Proxy",
        location: vscode.TerminalLocation.Editor,
        iconPath,
    });
    terminal.sendText(script);
}
