import * as vscode from 'vscode';
import { IssuesViewProvider } from './issuesViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new IssuesViewProvider(context.extensionUri);

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

  // Lắng nghe cấu hình thay đổi để cập nhật tự động
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeSessionManager')) {
        provider.refresh();
      }
    })
  );
}

export function deactivate() {}
