"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const issuesViewProvider_1 = require("./issuesViewProvider");
function activate(context) {
    const provider = new issuesViewProvider_1.IssuesViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(issuesViewProvider_1.IssuesViewProvider.viewType, provider));
    context.subscriptions.push(vscode.commands.registerCommand('claudeSessionManager.focusView', () => {
        vscode.commands.executeCommand('claudeSessionManager.issuesView.focus');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('claudeSessionManager.refresh', () => {
        provider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('claudeSessionManager.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'claudeSessionManager');
    }));
    // Lắng nghe cấu hình thay đổi để cập nhật tự động
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('claudeSessionManager')) {
            provider.refresh();
        }
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map