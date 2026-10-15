import * as vscode from 'vscode';
import { IssuesViewProvider } from './issuesViewProvider';
import { ExtensionUpdater } from './updater';

export function activate(context: vscode.ExtensionContext) {
  const provider = new IssuesViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      IssuesViewProvider.viewType,
      provider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.focusView', () => {
      vscode.commands.executeCommand('claudeSessionManager.issuesView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.refresh', () => {
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'claudeSessionManager');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.checkForUpdates', () => {
      ExtensionUpdater.checkForUpdates(context, true);
    })
  );

  // Lắng nghe cấu hình thay đổi để cập nhật tự động
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeSessionManager')) {
        provider.refresh();
      }
    })
  );

  // Tự động làm mới khi người dùng mở lại máy (wake from sleep) hoặc focus vào VS Code
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(e => {
      if (e.focused) {
        provider.refresh();
      }
    })
  );

  // Tự động kiểm tra bản cập nhật mới trên GitHub sau 3.5 giây
  setTimeout(() => {
    ExtensionUpdater.checkForUpdates(context, false);
  }, 3500);
}

export function deactivate() {}
