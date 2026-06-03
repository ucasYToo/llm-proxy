import * as vscode from "vscode";
import { generateCommitMessage } from "./commands/generateCommitMessage";
import { runTerminalScript, setExtensionUri } from "./commands/runTerminalScript";
import { SessionTreeProvider } from "./sidebar/sessionTreeProvider";

export function activate(context: vscode.ExtensionContext): void {
  setExtensionUri(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "claude-proxy.generateCommitMessage",
      generateCommitMessage,
    ),
    vscode.commands.registerCommand(
      "claude-proxy.runTerminalScript",
      runTerminalScript,
    ),
  );

  const treeProvider = new SessionTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "claude-proxy.sessionStream",
      treeProvider,
    ),
  );
}

export function deactivate(): void {}
