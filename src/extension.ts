import * as vscode from 'vscode';
import * as fs from 'fs';
import { IssuesViewProvider } from './issuesViewProvider';
import { ExtensionUpdater } from './updater';
import { SessionScanner } from './scanner';

export function activate(context: vscode.ExtensionContext) {
  const provider = new IssuesViewProvider(context.extensionUri, context);

  // Đăng ký cho tất cả các view container: Activity Bar, Explorer, Source Control (và legacy IDs để phòng ngừa cache cũ)
  const viewTypes = [
    IssuesViewProvider.viewType,
    IssuesViewProvider.explorerViewType,
    'claudeSessionManager.explorerView',
    IssuesViewProvider.scmViewType,
    'claudeSessionManager.scmView'
  ];

  for (const vt of viewTypes) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(vt, provider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );
  }

  // Cập nhật context keys khi cài đặt thay đổi
  const updateContexts = () => {
    const config = vscode.workspace.getConfiguration('claudeSessionManager');
    const showExplorer = config.get<boolean>('showInExplorer', true);
    const showScm = config.get<boolean>('showInSourceControl', true);
    vscode.commands.executeCommand('setContext', 'claudeSessionManager.showInExplorer', showExplorer);
    vscode.commands.executeCommand('setContext', 'claudeSessionManager.showInSourceControl', showScm);
  };
  updateContexts();

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.focusView', () => {
      vscode.commands.executeCommand('claudeSessionManager.issuesView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.openTab', (tab: string) => {
      vscode.commands.executeCommand('claudeSessionManager.issuesView.focus');
      provider.switchTab(tab);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.statusMenu', async () => {
      const items = [
        {
          label: '$(sync) Đang chạy & Cần review',
          description: 'Xem các task đang chạy, chờ duyệt và vừa hoàn thành',
          tab: 'active'
        },
        {
          label: '$(calendar) Hôm nay',
          description: 'Xem toàn bộ task phát sinh trong ngày hôm nay',
          tab: 'today'
        },
        {
          label: '$(list-unordered) Tất cả lịch sử',
          description: 'Xem toàn bộ lịch sử các sessions',
          tab: 'all'
        },
        {
          label: '$(folder-opened) Chọn thư mục lưu trữ Claude (~/.claude/projects)...',
          description: 'Duyệt và chọn thư mục lưu trữ thay vì gõ đường dẫn',
          action: 'browseStorage'
        },
        {
          label: '$(root-folder) Chọn thư mục gốc Workspace (Projects Root)...',
          description: 'Duyệt và chọn thư mục chứa các dự án',
          action: 'browseWorkspace'
        },
        {
          label: '$(gear) Cài đặt cấu hình',
          description: 'Mở thiết lập Claude Session Manager',
          action: 'settings'
        }
      ];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Chuyển nhanh tab hoặc thao tác'
      });

      if (!selected) return;

      if (selected.action === 'settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'claudeSessionManager');
      } else if (selected.action === 'browseStorage') {
        vscode.commands.executeCommand('claudeSessionManager.browseStoragePath');
      } else if (selected.action === 'browseWorkspace') {
        vscode.commands.executeCommand('claudeSessionManager.browseWorkspaceRoot');
      } else if (selected.tab) {
        vscode.commands.executeCommand('claudeSessionManager.issuesView.focus');
        provider.switchTab(selected.tab);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.browseStoragePath', async () => {
      const config = vscode.workspace.getConfiguration('claudeSessionManager');
      const currentPath = config.get<string>('storagePath') || '~/.claude/projects';
      const resolved = SessionScanner.resolveHomePath(currentPath);
      const defaultUri = fs.existsSync(resolved) ? vscode.Uri.file(resolved) : undefined;

      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Chọn thư mục lưu trữ (Select Storage Folder)',
        title: 'Chọn thư mục chứa lịch sử hội thoại Claude (~/.claude/projects)',
        defaultUri
      });

      if (selected && selected[0]) {
        await config.update('storagePath', selected[0].fsPath, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Đã cập nhật thư mục lưu trữ: ${selected[0].fsPath}`);
        provider.setupRealtimeWatchers();
        provider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.browseWorkspaceRoot', async () => {
      const config = vscode.workspace.getConfiguration('claudeSessionManager');
      const currentPath = config.get<string>('workspaceRoot');
      const resolved = currentPath ? SessionScanner.resolveHomePath(currentPath) : undefined;
      const defaultUri = (resolved && fs.existsSync(resolved))
        ? vscode.Uri.file(resolved)
        : (vscode.workspace.workspaceFolders?.[0]?.uri);

      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Chọn thư mục gốc (Select Workspace Root)',
        title: 'Chọn thư mục chứa các repo dự án của bạn',
        defaultUri
      });

      if (selected && selected[0]) {
        await config.update('workspaceRoot', selected[0].fsPath, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Đã cập nhật thư mục gốc dự án: ${selected[0].fsPath}`);
        provider.setupRealtimeWatchers();
        provider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.toggleExplorerView', async () => {
      const config = vscode.workspace.getConfiguration('claudeSessionManager');
      const current = config.get<boolean>('showInExplorer', true);
      const next = !current;
      await config.update('showInExplorer', next, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        next
          ? 'Đã bật hiển thị Claude Sessions trong thanh Explorer (File Tree).'
          : 'Đã tắt hiển thị Claude Sessions khỏi thanh Explorer.'
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionManager.toggleSourceControlView', async () => {
      const config = vscode.workspace.getConfiguration('claudeSessionManager');
      const current = config.get<boolean>('showInSourceControl', true);
      const next = !current;
      await config.update('showInSourceControl', next, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        next
          ? 'Đã bật hiển thị Claude Sessions trong thanh Source Control (Git).'
          : 'Đã tắt hiển thị Claude Sessions khỏi thanh Source Control.'
      );
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
      if (
        e.affectsConfiguration('claudeSessionManager.showInExplorer') ||
        e.affectsConfiguration('claudeSessionManager.showInSourceControl')
      ) {
        updateContexts();
      }
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
