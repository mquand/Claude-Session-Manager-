"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const issuesViewProvider_1 = require("./issuesViewProvider");
const updater_1 = require("./updater");
function activate(context) {
    const provider = new issuesViewProvider_1.IssuesViewProvider(context.extensionUri, context);
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
    context.subscriptions.push(vscode.commands.registerCommand('claudeSessionManager.checkForUpdates', () => {
        updater_1.ExtensionUpdater.checkForUpdates(context, true);
    }));
    // Lắng nghe cấu hình thay đổi để cập nhật tự động
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('claudeSessionManager')) {
            provider.refresh();
        }
    }));
    // Tự động làm mới khi người dùng mở lại máy (wake from sleep) hoặc focus vào VS Code
    context.subscriptions.push(vscode.window.onDidChangeWindowState(e => {
        if (e.focused) {
            provider.refresh();
        }
    }));
    // Tự động kiểm tra bản cập nhật mới trên GitHub sau 3.5 giây
    setTimeout(() => {
        updater_1.ExtensionUpdater.checkForUpdates(context, false);
    }, 3500);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map