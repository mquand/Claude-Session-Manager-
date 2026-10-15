"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const issuesViewProvider_1 = require("./issuesViewProvider");
const updater_1 = require("./updater");
function activate(context) {
    const provider = new issuesViewProvider_1.IssuesViewProvider(context.extensionUri, context);
    // Đăng ký cho Activity Bar view
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(issuesViewProvider_1.IssuesViewProvider.viewType, provider));
    // Đăng ký cho Explorer view (khi người dùng bật hiển thị trong Explorer)
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(issuesViewProvider_1.IssuesViewProvider.explorerViewType, provider));
    // Cập nhật context key khi cài đặt showInExplorer thay đổi
    const updateExplorerContext = () => {
        const config = vscode.workspace.getConfiguration('claudeSessionManager');
        const show = config.get('showInExplorer', false);
        vscode.commands.executeCommand('setContext', 'claudeSessionManager.showInExplorer', show);
    };
    updateExplorerContext();
    context.subscriptions.push(vscode.commands.registerCommand('claudeSessionManager.focusView', () => {
        vscode.commands.executeCommand('claudeSessionManager.issuesView.focus');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('claudeSessionManager.openTab', (tab) => {
        vscode.commands.executeCommand('claudeSessionManager.issuesView.focus');
        provider.switchTab(tab);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('claudeSessionManager.statusMenu', async () => {
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
                label: '$(gear) Cài đặt cấu hình',
                description: 'Mở thiết lập Claude Session Manager',
                action: 'settings'
            }
        ];
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Chuyển nhanh tab hoặc thao tác'
        });
        if (!selected)
            return;
        if (selected.action === 'settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'claudeSessionManager');
        }
        else if (selected.tab) {
            vscode.commands.executeCommand('claudeSessionManager.issuesView.focus');
            provider.switchTab(selected.tab);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('claudeSessionManager.toggleExplorerView', async () => {
        const config = vscode.workspace.getConfiguration('claudeSessionManager');
        const current = config.get('showInExplorer', false);
        const next = !current;
        await config.update('showInExplorer', next, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(next
            ? 'Đã bật hiển thị Claude Sessions trong thanh Explorer (File Tree).'
            : 'Đã tắt hiển thị Claude Sessions khỏi thanh Explorer.');
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
        if (e.affectsConfiguration('claudeSessionManager.showInExplorer')) {
            updateExplorerContext();
        }
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