import * as vscode from "vscode";
export declare class SessionTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem;
    getChildren(): vscode.TreeItem[];
}
