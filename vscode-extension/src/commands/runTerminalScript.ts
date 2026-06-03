import * as vscode from "vscode";
import * as path from "path";

let extensionUri: vscode.Uri;

export function setExtensionUri(uri: vscode.Uri): void {
  extensionUri = uri;
}

export async function runTerminalScript(): Promise<void> {
  const config = vscode.workspace.getConfiguration("claude-proxy");
  const script = config.get<string>(
    "terminalScript",
    "claude --dangerously-skip-permissions",
  );

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
