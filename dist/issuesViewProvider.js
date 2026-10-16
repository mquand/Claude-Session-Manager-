"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssuesViewProvider = void 0;
const vscode = require("vscode");
const fs = require("fs");
const scanner_1 = require("./scanner");
const updater_1 = require("./updater");
class IssuesViewProvider {
    _extensionUri;
    _context;
    static viewType = 'claudeSessionManager.issuesView';
    static explorerViewType = 'claudeSessionManager.sessionExplorer';
    static scmViewType = 'claudeSessionManager.sessionScm';
    _views = new Set();
    _watchers = [];
    _refreshTimer;
    _debounceTimer;
    _statusBarItem;
    _lastSessions = [];
    _currentWorktreeFilter = '';
    constructor(_extensionUri, _context) {
        this._extensionUri = _extensionUri;
        this._context = _context;
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = 'claudeSessionManager.statusMenu';
        this._statusBarItem.text = '$(sparkle) Claude: Idle';
        this._statusBarItem.tooltip = 'Claude Session & Issue Manager';
        this._statusBarItem.show();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('claudeSessionManager')) {
                this.refresh();
            }
        });
    }
    switchTab(tab) {
        for (const view of this._views) {
            view.webview.postMessage({
                type: 'switchTab',
                tab
            });
        }
    }
    getLanguage() {
        const config = vscode.workspace.getConfiguration('claudeSessionManager');
        const setting = config.get('language') || 'auto';
        if (setting === 'vi' || setting === 'en') {
            return setting;
        }
        const envLang = vscode.env.language || '';
        return envLang.toLowerCase().startsWith('vi') ? 'vi' : 'en';
    }
    getCurrentWorkspace() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0)
            return undefined;
        return {
            name: folders[0].name,
            folderPath: folders[0].uri.fsPath
        };
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._views.add(webviewView);
        // Luôn đảm bảo tên hiển thị thống nhất là "Claude Sessions", không bị tiền tố "Explorer: "
        webviewView.title = 'Claude Sessions';
        webviewView.onDidDispose(() => {
            this._views.delete(webviewView);
        });
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                if (this._lastSessions.length > 0) {
                    webviewView.webview.postMessage({
                        type: 'updateSessions',
                        sessions: this._lastSessions,
                        reviewedIds: this.getReviewedIds(),
                        currentWorkspace: this.getCurrentWorkspace(),
                        lang: this.getLanguage(),
                        worktreeFilter: this._currentWorktreeFilter,
                        hasWorktrees: this.checkHasWorktrees()
                    });
                }
                this.refresh();
            }
        });
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'ready': {
                    if (this._lastSessions.length > 0) {
                        webviewView.webview.postMessage({
                            type: 'updateSessions',
                            sessions: this._lastSessions,
                            reviewedIds: this.getReviewedIds(),
                            currentWorkspace: this.getCurrentWorkspace(),
                            lang: this.getLanguage(),
                            worktreeFilter: this._currentWorktreeFilter,
                            hasWorktrees: this.checkHasWorktrees()
                        });
                    }
                    await this.refresh();
                    break;
                }
                case 'openWorktreePicker': {
                    await this.showWorktreeQuickPick();
                    break;
                }
                case 'clearWorktreeFilter': {
                    this._currentWorktreeFilter = '';
                    for (const view of this._views) {
                        view.webview.postMessage({
                            type: 'setWorktreeFilter',
                            branch: ''
                        });
                    }
                    break;
                }
                case 'setWorktreeFromCard': {
                    this._currentWorktreeFilter = data.branch || '';
                    for (const view of this._views) {
                        view.webview.postMessage({
                            type: 'setWorktreeFilter',
                            branch: this._currentWorktreeFilter
                        });
                    }
                    break;
                }
                case 'refresh': {
                    await this.refresh();
                    break;
                }
                case 'markReviewed': {
                    await this.addReviewedId(data.id);
                    await this.refresh();
                    break;
                }
                case 'unmarkReviewed': {
                    await this.removeReviewedId(data.id);
                    await this.refresh();
                    break;
                }
                case 'openSettings': {
                    const lang = this.getLanguage();
                    const items = [
                        {
                            label: lang === 'en' ? '$(gear) Open Extension Settings' : '$(gear) Mở trang Cài đặt cấu hình',
                            description: 'workbench.action.openSettings',
                            action: 'settings'
                        },
                        {
                            label: lang === 'en' ? '$(folder-opened) Select Claude Storage Directory...' : '$(folder-opened) Chọn thư mục lưu trữ Claude (~/.claude/projects)...',
                            description: lang === 'en' ? 'Browse folder instead of pasting path' : 'Chọn thư mục trực quan từ máy',
                            action: 'browseStorage'
                        },
                        {
                            label: lang === 'en' ? '$(root-folder) Select Workspace Root Directory...' : '$(root-folder) Chọn thư mục gốc Workspace (Projects Root)...',
                            description: lang === 'en' ? 'Browse root directory containing repos' : 'Chọn thư mục chứa các repo dự án',
                            action: 'browseWorkspace'
                        },
                        {
                            label: lang === 'en' ? '$(cloud-download) Check for Updates' : '$(cloud-download) Kiểm tra bản cập nhật mới',
                            description: 'GitHub Releases',
                            action: 'update'
                        }
                    ];
                    const pick = await vscode.window.showQuickPick(items, {
                        placeHolder: lang === 'en' ? 'Select setting or configuration action...' : 'Chọn thao tác cài đặt...'
                    });
                    if (!pick)
                        break;
                    if (pick.action === 'settings') {
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'claudeSessionManager');
                    }
                    else if (pick.action === 'browseStorage') {
                        await vscode.commands.executeCommand('claudeSessionManager.browseStoragePath');
                    }
                    else if (pick.action === 'browseWorkspace') {
                        await vscode.commands.executeCommand('claudeSessionManager.browseWorkspaceRoot');
                    }
                    else if (pick.action === 'update') {
                        if (this._context)
                            await updater_1.ExtensionUpdater.checkForUpdates(this._context, true);
                    }
                    break;
                }
                case 'checkForUpdates': {
                    if (this._context) {
                        await updater_1.ExtensionUpdater.checkForUpdates(this._context, true);
                    }
                    break;
                }
                case 'openSession': {
                    try {
                        await vscode.commands.executeCommand('claude-vscode.primaryEditor.open', data.id);
                    }
                    catch {
                        try {
                            await vscode.commands.executeCommand('claude-vscode.editor.open', data.id);
                        }
                        catch {
                            await vscode.commands.executeCommand('claude-vscode.editor.openLast');
                        }
                    }
                    break;
                }
                case 'approve': {
                    try {
                        await vscode.commands.executeCommand('claude-vscode.primaryEditor.open', data.id);
                    }
                    catch {
                        await vscode.commands.executeCommand('claude-vscode.editor.openLast');
                    }
                    break;
                }
                case 'deleteSession': {
                    const sessionTitle = data.title ? `"${data.title}"` : 'phiên hội thoại này';
                    const choice = await vscode.window.showWarningMessage(`Bạn có chắc chắn muốn xoá ${sessionTitle}? Dữ liệu hội thoại sẽ bị xoá vĩnh viễn khỏi máy.`, { modal: true }, 'Xoá vĩnh viễn');
                    if (choice === 'Xoá vĩnh viễn') {
                        const success = scanner_1.SessionScanner.deleteSession(data.id, data.filePath);
                        if (success) {
                            vscode.window.showInformationMessage('Đã xoá phiên hội thoại thành công.');
                            await this.refresh();
                        }
                        else {
                            vscode.window.showErrorMessage('Không thể xoá file hội thoại. Vui lòng kiểm tra quyền truy cập.');
                        }
                    }
                    break;
                }
            }
        });
        this.setupRealtimeWatchers();
        this.refresh();
    }
    async showWorktreeQuickPick() {
        const lang = this.getLanguage();
        const worktreeMap = new Map();
        // 1. Quét các Git Worktree thực tế từ workspace (kể cả khi chưa chạy session nào)
        const wsFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
        const discovered = scanner_1.SessionScanner.discoverWorkspaceWorktrees(wsFolders);
        for (const wt of discovered) {
            if (wt.branch) {
                worktreeMap.set(wt.branch, {
                    branch: wt.branch,
                    cwd: wt.path,
                    repo: wt.repo,
                    count: 0,
                    lastTime: 0
                });
            }
        }
        // 2. Cập nhật số session từ các phiên đã quét được
        for (const s of this._lastSessions) {
            if (s.branch) {
                const key = s.branch;
                const existing = worktreeMap.get(key);
                if (existing) {
                    existing.count++;
                    if (s.updatedAt > existing.lastTime) {
                        existing.lastTime = s.updatedAt;
                        if (s.cwd)
                            existing.cwd = s.cwd;
                    }
                }
                else {
                    worktreeMap.set(key, {
                        branch: s.branch,
                        cwd: s.cwd,
                        repo: s.repo,
                        count: 1,
                        lastTime: s.updatedAt
                    });
                }
            }
        }
        const items = [
            {
                label: lang === 'en' ? '$(list-unordered) All worktrees / branches' : '$(list-unordered) Tất cả worktree / nhánh',
                description: lang === 'en' ? 'Show all sessions' : 'Hiển thị tất cả sessions',
                branch: ''
            }
        ];
        const sorted = Array.from(worktreeMap.values()).sort((a, b) => {
            // Ưu tiên các worktree có session trước, sau đó đến thời gian
            if ((b.count > 0 ? 1 : 0) !== (a.count > 0 ? 1 : 0)) {
                return b.count - a.count;
            }
            return b.lastTime - a.lastTime;
        });
        for (const item of sorted) {
            const exists = item.cwd ? fs.existsSync(item.cwd) : false;
            // Chỉ lấy những git worktree thực tế vẫn còn tồn tại trên hệ thống
            if (!exists) {
                continue;
            }
            const isCurrent = item.branch === this._currentWorktreeFilter;
            const checkMark = isCurrent ? '✓ ' : '';
            const countDesc = item.count > 0
                ? `${item.count} session${item.count > 1 ? 's' : ''}`
                : (lang === 'en' ? '$(circle-outline) No sessions yet (Ready)' : '$(circle-outline) Chưa có session (Sẵn sàng)');
            items.push({
                label: `$(git-branch) ${checkMark}${item.branch}`,
                description: `${countDesc}${item.repo ? ' • ' + item.repo : ''}`,
                detail: item.cwd ? (lang === 'en' ? `Directory: ${item.cwd}` : `Thư mục: ${item.cwd}`) : undefined,
                branch: item.branch
            });
        }
        // Tùy chọn Dọn dẹp Git Worktree (git worktree prune)
        items.push({
            label: lang === 'en' ? '$(trash) Prune deleted worktrees (git worktree prune)' : '$(trash) Dọn dẹp metadata worktree đã xoá (git worktree prune)',
            description: lang === 'en' ? 'Clean up Git tracking references for deleted folders' : 'Dọn dẹp vết lưu trữ Git của các thư mục worktree đã xoá',
            action: 'prune'
        });
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: lang === 'en' ? 'Select Git Worktree / Branch to filter sessions...' : 'Chọn Git Worktree / Nhánh để lọc các phiên hội thoại...'
        });
        if (selected !== undefined) {
            if (selected.action === 'prune') {
                const count = scanner_1.SessionScanner.pruneWorktrees(wsFolders);
                vscode.window.showInformationMessage(lang === 'en'
                    ? `Cleaned up deleted worktrees metadata in Git (${count} repositories checked).`
                    : `Đã dọn dẹp các metadata worktree đã xoá khỏi Git (${count} repository).`);
                await this.refresh();
                return;
            }
            this._currentWorktreeFilter = selected.branch || '';
            for (const view of this._views) {
                view.webview.postMessage({
                    type: 'setWorktreeFilter',
                    branch: this._currentWorktreeFilter
                });
            }
        }
    }
    checkHasWorktrees() {
        const wsFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
        const discovered = scanner_1.SessionScanner.discoverWorkspaceWorktrees(wsFolders);
        return discovered.length > 0 || this._lastSessions.some(s => !!s.branch && (!s.cwd || fs.existsSync(s.cwd)));
    }
    setupRealtimeWatchers() {
        this._watchers.forEach(w => w.dispose());
        this._watchers = [];
        const config = vscode.workspace.getConfiguration('claudeSessionManager');
        const customPath = config.get('storagePath');
        const dirs = scanner_1.SessionScanner.getWatchedDirectories(customPath);
        for (const dir of dirs) {
            const pattern = new vscode.RelativePattern(dir, '**/*.jsonl');
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            const triggerDebouncedRefresh = () => {
                if (this._debounceTimer) {
                    clearTimeout(this._debounceTimer);
                }
                this._debounceTimer = setTimeout(() => {
                    this.refresh();
                }, 300);
            };
            watcher.onDidChange(triggerDebouncedRefresh);
            watcher.onDidCreate(triggerDebouncedRefresh);
            watcher.onDidDelete(triggerDebouncedRefresh);
            this._watchers.push(watcher);
        }
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
        }
        const intervalSec = config.get('autoRefreshInterval') || 10;
        this._refreshTimer = setInterval(() => {
            this.refresh();
        }, intervalSec * 1000);
    }
    getReviewedIds() {
        return this._context?.globalState.get('reviewedSessionIds_v2') || [];
    }
    async addReviewedId(id) {
        if (!id || !this._context)
            return;
        const reviewed = this.getReviewedIds();
        if (!reviewed.includes(id)) {
            reviewed.push(id);
            await this._context.globalState.update('reviewedSessionIds_v2', reviewed);
        }
    }
    async removeReviewedId(id) {
        if (!id || !this._context)
            return;
        const reviewed = this.getReviewedIds().filter(x => x !== id);
        await this._context.globalState.update('reviewedSessionIds_v2', reviewed);
    }
    async refresh() {
        const config = vscode.workspace.getConfiguration('claudeSessionManager');
        const customPath = config.get('storagePath');
        const workspaceRoot = config.get('workspaceRoot');
        const defaultRepo = config.get('defaultRepo');
        const wsFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
        if (workspaceRoot) {
            const resolved = scanner_1.SessionScanner.resolveHomePath(workspaceRoot);
            if (fs.existsSync(resolved) && !wsFolders.includes(resolved)) {
                wsFolders.push(resolved);
            }
        }
        const sessions = await scanner_1.SessionScanner.scanSessions(customPath, {
            workspaceFolders: wsFolders,
            defaultRepo: defaultRepo || undefined
        });
        this._lastSessions = sessions;
        if (this._currentWorktreeFilter) {
            const hasBranchInSessions = sessions.some(s => s.branch === this._currentWorktreeFilter && (!s.cwd || fs.existsSync(s.cwd)));
            const discovered = scanner_1.SessionScanner.discoverWorkspaceWorktrees(wsFolders);
            const hasBranchInWorktrees = discovered.some(w => w.branch === this._currentWorktreeFilter);
            if (!hasBranchInSessions && !hasBranchInWorktrees) {
                this._currentWorktreeFilter = '';
            }
        }
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const needAcceptCount = sessions.filter(s => s.status === 'need_accept').length;
        const runningCount = sessions.filter(s => s.status === 'running').length;
        const failedCount = sessions.filter(s => s.status === 'failed' && s.updatedAt >= startOfToday.getTime()).length;
        const needReviewCount = sessions.filter(s => s.status === 'done' && !this.getReviewedIds().includes(s.id) && s.updatedAt >= startOfToday.getTime()).length;
        const lang = this.getLanguage();
        const currentWorkspace = this.getCurrentWorkspace();
        for (const view of this._views) {
            if (needAcceptCount > 0) {
                view.badge = {
                    value: needAcceptCount,
                    tooltip: lang === 'en' ? `${needAcceptCount} tasks waiting approval` : `${needAcceptCount} task đang chờ duyệt`
                };
            }
            else if (failedCount > 0) {
                view.badge = {
                    value: failedCount,
                    tooltip: lang === 'en' ? `${failedCount} tasks limited or failed` : `${failedCount} task bị limit hoặc lỗi`
                };
            }
            else if (needReviewCount > 0) {
                view.badge = {
                    value: needReviewCount,
                    tooltip: lang === 'en' ? `${needReviewCount} tasks need review` : `${needReviewCount} task cần review`
                };
            }
            else {
                view.badge = undefined;
            }
            view.webview.postMessage({
                type: 'updateSessions',
                sessions,
                reviewedIds: this.getReviewedIds(),
                currentWorkspace,
                lang,
                worktreeFilter: this._currentWorktreeFilter,
                hasWorktrees: this.checkHasWorktrees()
            });
        }
        const todayCount = sessions.filter(s => s.updatedAt >= startOfToday.getTime()).length;
        const activeTotalCount = needAcceptCount + runningCount + failedCount + needReviewCount;
        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;
        md.supportThemeIcons = true;
        if (lang === 'en') {
            md.appendMarkdown(`### $(sparkle) **Claude Session & Issue Tracker**\n\n`);
            if (needAcceptCount > 0) {
                md.appendMarkdown(`$(bell-dot) **${needAcceptCount} tasks waiting approval**\n\n`);
            }
            else if (runningCount > 0) {
                md.appendMarkdown(`$(sync~spin) **${runningCount} tasks running**\n\n`);
            }
            else if (failedCount > 0) {
                md.appendMarkdown(`$(error) **${failedCount} tasks limited or failed**\n\n`);
            }
            else if (needReviewCount > 0) {
                md.appendMarkdown(`$(eye) **${needReviewCount} tasks need review**\n\n`);
            }
            else {
                md.appendMarkdown(`$(check) **Idle (Ready)**\n\n`);
            }
            md.appendMarkdown(`---\n\n`);
            md.appendMarkdown(`**Quick switch tab:**\n\n`);
            md.appendMarkdown(`* [$(calendar) **Today** (${todayCount})](command:claudeSessionManager.openTab?%22today%22)\n`);
            md.appendMarkdown(`* [$(list-unordered) **All Sessions** (${sessions.length})](command:claudeSessionManager.openTab?%22all%22)\n\n`);
            md.appendMarkdown(`---\n\n`);
            md.appendMarkdown(`[$(gear) Settings](command:claudeSessionManager.openSettings) &nbsp;|&nbsp; [$(refresh) Refresh](command:claudeSessionManager.refresh)`);
        }
        else {
            md.appendMarkdown(`### $(sparkle) **Claude Session & Issue Tracker**\n\n`);
            if (needAcceptCount > 0) {
                md.appendMarkdown(`$(bell-dot) **${needAcceptCount} task đang chờ bạn phê duyệt**\n\n`);
            }
            else if (runningCount > 0) {
                md.appendMarkdown(`$(sync~spin) **${runningCount} task đang thực thi**\n\n`);
            }
            else if (failedCount > 0) {
                md.appendMarkdown(`$(error) **${failedCount} task bị limit hoặc lỗi**\n\n`);
            }
            else if (needReviewCount > 0) {
                md.appendMarkdown(`$(eye) **${needReviewCount} task vừa xong cần review**\n\n`);
            }
            else {
                md.appendMarkdown(`$(check) **Sẵn sàng (Idle)**\n\n`);
            }
            md.appendMarkdown(`---\n\n`);
            md.appendMarkdown(`**Chuyển nhanh đến tab:**\n\n`);
            md.appendMarkdown(`* [$(calendar) **Hôm nay** (${todayCount})](command:claudeSessionManager.openTab?%22today%22)\n`);
            md.appendMarkdown(`* [$(list-unordered) **Tất cả các ngày** (${sessions.length})](command:claudeSessionManager.openTab?%22all%22)\n\n`);
            md.appendMarkdown(`---\n\n`);
            md.appendMarkdown(`[$(gear) Cài đặt](command:claudeSessionManager.openSettings) &nbsp;|&nbsp; [$(refresh) Làm mới](command:claudeSessionManager.refresh)`);
        }
        this._statusBarItem.tooltip = md;
        if (needAcceptCount > 0) {
            this._statusBarItem.text = `$(bell-dot) Claude: ${needAcceptCount} ${lang === 'en' ? 'Waiting' : 'Chờ duyệt'}`;
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else if (runningCount > 0) {
            this._statusBarItem.text = `$(sync~spin) Claude: ${runningCount} ${lang === 'en' ? 'Running' : 'Đang chạy'}`;
            this._statusBarItem.backgroundColor = undefined;
        }
        else if (failedCount > 0) {
            this._statusBarItem.text = `$(error) Claude: ${failedCount} ${lang === 'en' ? 'Limited' : 'Bị limit'}`;
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        else if (needReviewCount > 0) {
            this._statusBarItem.text = `$(eye) Claude: ${needReviewCount} ${lang === 'en' ? 'Review' : 'Cần review'}`;
            this._statusBarItem.backgroundColor = undefined;
        }
        else {
            this._statusBarItem.text = '$(sparkle) Claude: Idle';
            this._statusBarItem.backgroundColor = undefined;
        }
    }
    _getHtmlForWebview(_webview) {
        return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Issue Manager</title>
  <style>
    :root {
      --bg-color: var(--vscode-sideBar-background, #0f1115);
      --card-bg: var(--vscode-editorWidget-background, #16191f);
      --card-border: var(--vscode-widget-border, #232730);
      --card-hover-bg: var(--vscode-list-hoverBackground, #1c212a);
      --card-hover-border: var(--vscode-focusBorder, #3e4657);
      --text-main: var(--vscode-foreground, #f1f5f9);
      --text-muted: var(--vscode-descriptionForeground, #8b9bb4);
      --input-bg: var(--vscode-input-background, #1a1e26);
      --input-fg: var(--vscode-input-foreground, #ffffff);
      --input-border: var(--vscode-input-border, #2d3340);
      --btn-bg: var(--vscode-button-background, #2563eb);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1d4ed8);
      --btn-sec-bg: var(--vscode-button-secondaryBackground, #2d3340);
      --btn-sec-fg: var(--vscode-button-secondaryForeground, #ffffff);
      --btn-sec-hover: var(--vscode-button-secondaryHoverBackground, #3e4657);
      --pill-bg: #16191f;
      --pill-fg: #94a3b8;
      --pill-border: #232730;
      --pill-hover-bg: #1e232d;
      --pill-hover-fg: #cbd5e1;
      --token-badge-bg: rgba(30, 35, 45, 0.7);
      --token-badge-border: rgba(255, 255, 255, 0.08);
      --token-badge-num: #38bdf8;
      --repo-badge-bg: #252b38;
      --repo-badge-fg: #93c5fd;
      --issue-badge-bg: #1e3a5f;
      --issue-badge-fg: #60a5fa;
      --branch-name-fg: #7dd3fc;
      --count-badge-bg: #232834;
      --count-badge-fg: #cbd5e1;
      --short-id-fg: #556275;
      --need-accept: #f59e0b;
      --done: #10b981;
      --running: #3b82f6;
      --need-review: #a855f7;
      --failed: #ef4444;
    }

    body.vscode-light {
      --bg-color: var(--vscode-sideBar-background, #f8fafc);
      --card-bg: var(--vscode-editor-background, #ffffff);
      --card-border: var(--vscode-widget-border, #e2e8f0);
      --card-hover-bg: var(--vscode-list-hoverBackground, #f1f5f9);
      --card-hover-border: var(--vscode-focusBorder, #94a3b8);
      --text-main: var(--vscode-foreground, #0f172a);
      --text-muted: var(--vscode-descriptionForeground, #64748b);
      --input-bg: var(--vscode-input-background, #ffffff);
      --input-fg: var(--vscode-input-foreground, #0f172a);
      --input-border: var(--vscode-input-border, #cbd5e1);
      --btn-bg: var(--vscode-button-background, #2563eb);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1d4ed8);
      --btn-sec-bg: var(--vscode-button-secondaryBackground, #e2e8f0);
      --btn-sec-fg: var(--vscode-button-secondaryForeground, #1e293b);
      --btn-sec-hover: var(--vscode-button-secondaryHoverBackground, #cbd5e1);
      --pill-bg: #f1f5f9;
      --pill-fg: #475569;
      --pill-border: #cbd5e1;
      --pill-hover-bg: #e2e8f0;
      --pill-hover-fg: #0f172a;
      --token-badge-bg: rgba(0, 0, 0, 0.05);
      --token-badge-border: rgba(0, 0, 0, 0.1);
      --token-badge-num: #0284c7;
      --repo-badge-bg: #e0f2fe;
      --repo-badge-fg: #0369a1;
      --issue-badge-bg: #dbeafe;
      --issue-badge-fg: #1d4ed8;
      --branch-name-fg: #0284c7;
      --count-badge-bg: #e2e8f0;
      --count-badge-fg: #334155;
      --short-id-fg: #94a3b8;
      --need-accept: #d97706;
      --done: #059669;
      --running: #2563eb;
      --need-review: #9333ea;
      --failed: #dc2626;
    }

    body.vscode-high-contrast {
      --card-border: var(--vscode-contrastBorder, #ffffff);
      --card-hover-border: var(--vscode-focusBorder, #f38518);
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 10px 10px 36px 10px;
      font-size: 12.5px;
      box-sizing: border-box;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 100%;
    }

    ::-webkit-scrollbar {
      width: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(128, 128, 128, 0.25);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(128, 128, 128, 0.45);
    }

    .search-bar-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }

    .search-input {
      flex: 1;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 12px;
      outline: none;
      box-sizing: border-box;
      height: 28px;
    }

    .search-input:focus {
      border-color: #3b82f6;
    }

    .icon-tool-btn {
      background: var(--input-bg);
      color: var(--text-muted);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: all 0.15s ease;
      padding: 0;
    }

    .icon-tool-btn:hover {
      background: var(--pill-hover-bg);
      color: var(--text-main);
      border-color: var(--card-hover-border);
    }

    .icon-tool-btn:active {
      transform: scale(0.92);
    }

    .spin {
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      100% { transform: rotate(360deg); }
    }

    .workspace-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      padding: 1px 0;
    }

    .ws-pills-wrap {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      overflow-x: auto;
      min-width: 0;
    }

    .sub-filter-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 8px;
      padding: 0 1px;
      min-height: 24px;
    }

    .worktree-filter-wrap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex-shrink: 1;
    }

    .worktree-filter-label {
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 500;
      user-select: none;
      flex-shrink: 0;
    }

    #wsWorktreeLabel {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: inline-block;
      vertical-align: middle;
    }

    .ws-tokens-badge {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      background: var(--token-badge-bg);
      border: 1px solid var(--token-badge-border);
      border-radius: 12px;
      padding: 2px 8px;
      white-space: nowrap;
      user-select: none;
      flex-shrink: 0;
      cursor: default;
    }

    .ws-tokens-label {
      color: var(--text-muted);
      font-size: 10.5px;
      font-weight: 500;
    }

    .ws-tokens-num {
      color: var(--token-badge-num);
      font-weight: 600;
      font-family: monospace;
      font-size: 11px;
    }

    .ws-pill {
      background: var(--pill-bg);
      color: var(--pill-fg);
      border: 1px solid var(--pill-border);
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
      white-space: nowrap;
      user-select: none;
      flex-shrink: 0;
    }

    .ws-pill:hover {
      background: var(--pill-hover-bg);
      color: var(--pill-hover-fg);
      border-color: var(--card-hover-border);
    }

    .ws-pill.active {
      background: rgba(59, 130, 246, 0.15);
      color: #3b82f6;
      border-color: rgba(59, 130, 246, 0.4);
      font-weight: 600;
    }

    .ws-pill-worktree {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .ws-pill-worktree.active {
      background: rgba(16, 185, 129, 0.18);
      color: #10b981;
      border-color: rgba(16, 185, 129, 0.45);
      font-weight: 600;
    }

    body.vscode-light .ws-pill-worktree.active {
      background: rgba(16, 185, 129, 0.12);
      color: #059669;
      border-color: rgba(16, 185, 129, 0.35);
    }

    .ws-worktree-clear {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      font-size: 8.5px;
      line-height: 1;
      margin-left: 2px;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .ws-worktree-clear:hover {
      background: rgba(239, 68, 68, 0.85);
      color: #ffffff;
    }

    body.vscode-light .ws-worktree-clear {
      background: rgba(0, 0, 0, 0.1);
    }

    body.vscode-light .ws-worktree-clear:hover {
      background: #ef4444;
      color: #ffffff;
    }

    .ws-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #3b82f6;
      display: inline-block;
    }

    .filter-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 10px;
    }

    .filter-btn {
      flex: 1;
      background: var(--input-bg);
      color: var(--text-muted);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 5px 2px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .filter-btn:hover {
      background: var(--pill-hover-bg);
      color: var(--text-main);
    }

    .filter-btn.active {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border-color: var(--btn-bg);
      font-weight: 600;
    }

    .section-header {
      font-weight: 700;
      font-size: 11px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 14px 0 8px 0;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      padding: 4px 6px;
      border-radius: 4px;
      transition: background 0.15s ease;
    }

    .section-header:hover {
      background: var(--pill-hover-bg);
    }

    .section-header .chevron {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.18s ease;
      color: var(--text-muted);
    }

    .section-header .chevron.open {
      transform: rotate(0deg);
    }

    .section-header .chevron.closed {
      transform: rotate(-90deg);
    }

    .section-content {
      transition: all 0.2s ease;
    }

    .section-content.collapsed {
      display: none;
    }

    .count-badge {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--count-badge-fg);
      background: var(--count-badge-bg);
      padding: 1px 6px;
      border-radius: 10px;
      margin-left: auto;
    }

    .session-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 14px;
      cursor: pointer;
      transition: all 0.15s ease;
      border-left: 4px solid var(--card-border);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    .session-card.status-need_accept {
      border-left-color: var(--need-accept);
    }

    .session-card.status-done {
      border-left-color: var(--done);
    }

    .session-card.status-need_review {
      border-left-color: var(--need-review);
    }

    .session-card.status-running {
      border-left-color: var(--running);
    }

    .session-card.status-failed {
      border-left-color: var(--failed);
    }

    .session-card:hover {
      border-color: var(--card-hover-border);
      background: var(--card-hover-bg);
    }

    .status-dot {
      width: 7.5px;
      height: 7.5px;
      border-radius: 50%;
      flex-shrink: 0;
      display: inline-block;
      margin-right: 2px;
    }

    .dot-need_accept {
      background-color: var(--need-accept);
    }

    .dot-done {
      background-color: var(--done);
    }

    .dot-need_review {
      background-color: var(--need-review);
    }

    .dot-failed {
      background-color: var(--failed);
    }

    .review-badge {
      background: rgba(168, 85, 247, 0.18);
      color: #9333ea;
      border: 1px solid rgba(168, 85, 247, 0.35);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      margin-left: 6px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    body.vscode-dark .review-badge {
      color: #c084fc;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.85); }
    }
    .pulse-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: currentColor;
      display: inline-block;
      animation: pulse-dot 1.2s infinite ease-in-out;
      margin-right: 2px;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1.5px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .badge-need-accept {
      background: rgba(245, 158, 11, 0.18);
      color: #d97706;
      border: 1px solid rgba(245, 158, 11, 0.35);
    }
    body.vscode-dark .badge-need-accept {
      color: #fbbf24;
    }
    .badge-running {
      background: rgba(59, 130, 246, 0.18);
      color: #2563eb;
      border: 1px solid rgba(59, 130, 246, 0.35);
    }
    body.vscode-dark .badge-running {
      color: #60a5fa;
    }
    .badge-need-review {
      background: rgba(168, 85, 247, 0.18);
      color: #9333ea;
      border: 1px solid rgba(168, 85, 247, 0.35);
    }
    body.vscode-dark .badge-need-review {
      color: #c084fc;
    }
    .badge-done {
      background: rgba(16, 185, 129, 0.12);
      color: #059669;
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    body.vscode-dark .badge-done {
      color: #34d399;
    }
    .badge-failed {
      background: rgba(239, 68, 68, 0.18);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.35);
    }
    body.vscode-dark .badge-failed {
      color: #f87171;
    }

    .btn-review {
      background: #7c3aed;
      color: #ffffff;
      border: none;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-review:hover {
      background: #6d28d9;
    }
    .btn-failed {
      background: #dc2626;
      color: #ffffff;
      border: none;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-failed:hover {
      background: #b91c1c;
    }

    .dot-running {
      background-color: var(--running);
    }


    .card-title-row {
      display: flex;
      align-items: flex-start;
      margin-bottom: 5px;
    }

    .repo-badge {
      background: var(--repo-badge-bg);
      color: var(--repo-badge-fg);
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      font-family: monospace;
      flex-shrink: 0;
    }

    .branch-info {
      color: var(--text-muted);
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
      cursor: pointer;
      border-radius: 3px;
      padding: 1px 3px;
      transition: background 0.15s ease, opacity 0.15s ease;
    }

    .branch-info:hover {
      background: var(--pill-hover-bg);
      opacity: 0.9;
    }

    .branch-name {
      color: var(--branch-name-fg);
      font-family: monospace;
      font-weight: 600;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: inline-block;
      vertical-align: bottom;
    }

    .worktree-badge {
      background: rgba(245, 158, 11, 0.15);
      color: #d97706;
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 9.5px;
      font-weight: 600;
      text-transform: uppercase;
      flex-shrink: 0;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .worktree-badge:hover {
      background: rgba(245, 158, 11, 0.25);
      border-color: rgba(245, 158, 11, 0.5);
    }

    .issue-badge {
      background: var(--issue-badge-bg);
      color: var(--issue-badge-fg);
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11.5px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .title-text {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-main);
      line-height: 1.45;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
      width: 100%;
    }

    .title-issue {
      color: var(--issue-badge-fg, #60a5fa);
      font-weight: 700;
      margin-right: 3px;
    }

    .card-top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }

    .card-badges-wrap {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }

    .card-top-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      margin-left: auto;
    }

    .card-action-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--text-main);
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      height: 24px;
      box-sizing: border-box;
      transition: all 0.15s ease;
      white-space: nowrap;
      user-select: none;
      line-height: 1;
    }

    .card-action-btn:hover {
      background: var(--pill-hover-bg);
      border-color: var(--card-hover-border);
    }

    .card-action-btn svg {
      flex-shrink: 0;
    }

    .card-action-btn.btn-retry {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.16);
      color: var(--text-main);
    }

    .card-action-btn.btn-retry:hover {
      background: rgba(59, 130, 246, 0.12);
      border-color: rgba(59, 130, 246, 0.45);
      color: #93c5fd;
    }

    body.vscode-light .card-action-btn.btn-retry {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #334155;
    }

    body.vscode-light .card-action-btn.btn-retry:hover {
      background: #eff6ff;
      border-color: #93c5fd;
      color: #1d4ed8;
    }

    .card-action-btn.btn-review {
      background: rgba(168, 85, 247, 0.15);
      border-color: rgba(168, 85, 247, 0.35);
      color: #c084fc;
    }

    .card-action-btn.btn-review:hover {
      background: rgba(168, 85, 247, 0.25);
      border-color: rgba(168, 85, 247, 0.5);
    }

    .card-action-btn.btn-approve {
      background: #2563eb;
      border-color: #1d4ed8;
      color: #ffffff;
    }

    .card-action-btn.btn-approve:hover {
      background: #1d4ed8;
    }

    .card-delete-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: var(--text-muted);
      border-radius: 6px;
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
      opacity: 0.75;
      transition: all 0.15s ease;
      box-sizing: border-box;
    }

    .card-delete-btn:hover {
      opacity: 1;
      background: rgba(239, 68, 68, 0.18);
      border-color: rgba(239, 68, 68, 0.5);
      color: #ef4444;
    }

    body.vscode-light .card-delete-btn {
      background: rgba(0, 0, 0, 0.03);
      border-color: rgba(0, 0, 0, 0.1);
      color: #64748b;
    }

    body.vscode-light .card-delete-btn:hover {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.45);
      color: #dc2626;
    }

    .user-prompt {
      color: var(--text-muted);
      font-size: 11.5px;
      margin: 4px 0 8px 0;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Clean Footer với 2 hàng cân đối, thoáng đãng */
    .footer-meta-row {
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 11.5px;
      color: var(--text-muted);
      margin-top: 10px;
      line-height: 1.4;
    }

    .footer-stats-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .footer-bottom-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .footer-bottom-left {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }

    .footer-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .footer-meta-item.token {
      color: var(--text-muted);
    }

    .footer-meta-item.cost {
      color: #059669;
      font-weight: 600;
    }

    body.vscode-dark .footer-meta-item.cost {
      color: #34d399;
    }

    .footer-meta-item.short-id {
      color: var(--short-id-fg);
      font-family: monospace;
      margin-left: auto;
      flex-shrink: 0;
    }

    .card-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 6px;
    }

    .btn {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn:hover {
      background: var(--btn-hover);
    }

    .btn-secondary {
      background: var(--btn-sec-bg);
      color: var(--btn-sec-fg);
    }
    .btn-secondary:hover {
      background: var(--btn-sec-hover);
    }
  </style>
</head>
<body>
  <!-- Row 1 (Top): Phạm vi dự án (Chỉ gồm Tất cả dự án & Workspace) -->
  <div class="workspace-bar" id="workspaceBar">
    <div class="ws-pills-wrap">
      <button class="ws-pill" id="wsBtnAll">
        <span id="wsAllText">Tất cả dự án</span>
      </button>
      <button class="ws-pill active" id="wsBtnCurrent" style="display: none;">
        <span class="ws-dot"></span>
        <span id="wsCurrentName"></span>
      </button>
    </div>
  </div>

  <!-- Row 2: Thanh tìm kiếm + Nút Refresh + Nút Cài đặt -->
  <div class="search-bar-row">
    <input type="text" id="searchInput" class="search-input" placeholder="Tìm kiếm nội dung, issue, branch..." />
    <button id="refreshBtn" class="icon-tool-btn" title="Làm mới danh sách (Refresh)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
      </svg>
    </button>
    <button id="settingsBtn" class="icon-tool-btn" title="Cài đặt cấu hình (Settings)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0-.33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
    </button>
  </div>

  <!-- Row 3: Bộ lọc Git Worktree & Thống kê Token hôm nay (cùng một dòng) -->
  <div class="sub-filter-row" id="subFilterRow">
    <div class="worktree-filter-wrap" id="worktreeFilterRow" style="display: none;">
      <span class="worktree-filter-label" id="worktreeFilterLabel">Worktree:</span>
      <button class="ws-pill ws-pill-worktree" id="wsBtnWorktree" title="Lọc theo Git Worktree (Click để chọn trong Popup)">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="3" x2="6" y2="15"></line>
          <circle cx="18" cy="6" r="3"></circle>
          <circle cx="18" cy="6" r="3"></circle>
          <path d="M18 9a9 9 0 0 1-9 9"></path>
        </svg>
        <span id="wsWorktreeLabel">Tất cả ▾</span>
        <span id="wsWorktreeClear" class="ws-worktree-clear" style="display: none;" title="Bỏ lọc worktree">✕</span>
      </button>
    </div>
    <div class="ws-tokens-badge" id="wsTokensBadge" title="Tổng số token Claude đã dùng hôm nay">
      <span class="ws-tokens-label">tokens:</span>
      <span class="ws-tokens-num" id="wsTokensNum">0</span>
    </div>
  </div>

  <!-- 2 Tab Lọc: Hôm nay & Tất cả -->
  <div class="filter-tabs">
    <button class="filter-btn active" data-filter="today" id="tabTodayBtn">Hôm nay</button>
    <button class="filter-btn" data-filter="all" id="tabAllBtn">Tất cả</button>
  </div>

  <div id="contentContainer">
    <div style="text-align: center; color: #64748b; padding: 20px;">Đang tải danh sách sessions...</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // 1. Khai báo DOM Elements ở đầu script
    const searchInput = document.getElementById('searchInput');
    const contentContainer = document.getElementById('contentContainer');
    const refreshBtn = document.getElementById('refreshBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const filterBtns = document.querySelectorAll('.filter-btn');
    const workspaceBar = document.getElementById('workspaceBar');
    const wsBtnCurrent = document.getElementById('wsBtnCurrent');
    const wsBtnAll = document.getElementById('wsBtnAll');
    const wsCurrentName = document.getElementById('wsCurrentName');
    const wsAllText = document.getElementById('wsAllText');
    const worktreeFilterRow = document.getElementById('worktreeFilterRow');
    const worktreeFilterLabel = document.getElementById('worktreeFilterLabel');
    const wsBtnWorktree = document.getElementById('wsBtnWorktree');
    const wsWorktreeLabel = document.getElementById('wsWorktreeLabel');
    const wsWorktreeClear = document.getElementById('wsWorktreeClear');
    const wsTokensBadge = document.getElementById('wsTokensBadge');
    const wsTokensNum = document.getElementById('wsTokensNum');

    // 2. Khôi phục State an toàn
    const savedState = vscode.getState() || {};
    let allSessions = Array.isArray(savedState.sessions) ? savedState.sessions : [];
    let reviewedIds = new Set(Array.isArray(savedState.reviewedIds) ? savedState.reviewedIds : []);
    let currentFilter = (savedState.currentFilter === 'all') ? 'all' : 'today';
    let currentWorkspace = savedState.currentWorkspace || null;
    let currentWorktree = savedState.currentWorktree || null;
    let hasWorkspaceWorktrees = savedState.hasWorkspaceWorktrees || false;
    let wsMode = savedState.wsMode || 'current';
    let currentLang = savedState.lang || 'vi';
    let sectionState = savedState.sectionState || {
      need_accept: true,
      running: true,
      failed: true,
      need_review: true,
      done: true
    };

    // Dictionary i18n
    const I18N = {
      vi: {
        searchPlaceholder: "Tìm kiếm nội dung, issue, branch...",
        refreshTitle: "Làm mới danh sách (Refresh)",
        settingsTitle: "Cài đặt cấu hình (Settings)",
        tabToday: "Hôm nay",
        tabActive: "Đang chạy",
        tabAll: "Tất cả",
        tabReview: "Cần review",
        wsAll: "Tất cả dự án",
        secNeedAccept: "CHỜ DUYỆT",
        secRunning: "ĐANG CHẠY",
        secFailed: "BỊ LIMIT / LỖI",
        secNeedReview: "VỪA XONG (CẦN REVIEW)",
        secDone: "ĐÃ HOÀN THÀNH",
        btnDiff: "Xem diff",
        btnApprove: "Duyệt",
        btnReview: "Xem kết quả",
        btnMarkReviewed: "Đã xem",
        btnRetry: "Mở thử lại",
        btnReviewAgain: "Review lại",
        btnDelete: "Xoá",
        btnDeleteTitle: "Xoá phiên hội thoại",
        noSessionsActive: "Hiện không có task nào đang chạy hoặc cần review.",
        noSessionsToday: "Không có task nào phát sinh trong ngày hôm nay.",
        noSessionsFound: "Không tìm thấy phiên làm việc nào phù hợp.",
        loading: "Đang tải danh sách sessions..."
      },
      en: {
        searchPlaceholder: "Search content, issue, branch...",
        refreshTitle: "Refresh session list",
        settingsTitle: "Open Settings",
        tabToday: "Today",
        tabActive: "Running",
        tabAll: "All",
        tabReview: "Review",
        wsAll: "All Projects",
        secNeedAccept: "WAITING APPROVAL",
        secRunning: "RUNNING",
        secFailed: "LIMITED / FAILED",
        secNeedReview: "FINISHED (NEED REVIEW)",
        secDone: "COMPLETED",
        btnDiff: "View Diff",
        btnApprove: "Approve",
        btnReview: "Review Result",
        btnMarkReviewed: "Reviewed",
        btnRetry: "Retry",
        btnReviewAgain: "Review again",
        btnDelete: "Delete",
        btnDeleteTitle: "Delete conversation session",
        noSessionsActive: "No tasks are currently running or waiting for review.",
        noSessionsToday: "No sessions recorded for today.",
        noSessionsFound: "No matching sessions found.",
        loading: "Loading sessions..."
      }
    };

    function t(key) {
      const dict = I18N[currentLang] || I18N['vi'];
      return dict[key] || key;
    }

    function saveState() {
      vscode.setState({
        sessions: allSessions,
        reviewedIds: Array.from(reviewedIds),
        currentFilter,
        currentWorkspace,
        currentWorktree,
        wsMode,
        lang: currentLang,
        sectionState,
        hasWorkspaceWorktrees
      });
    }

    function updateLanguageUI() {
      if (searchInput) searchInput.placeholder = t('searchPlaceholder');
      if (refreshBtn) refreshBtn.title = t('refreshTitle');
      if (settingsBtn) settingsBtn.title = t('settingsTitle');
      const tabToday = document.getElementById('tabTodayBtn');
      if (tabToday) tabToday.textContent = t('tabToday');
      const tabAll = document.getElementById('tabAllBtn');
      if (tabAll) tabAll.textContent = t('tabAll');
      if (wsAllText) wsAllText.textContent = t('wsAll');
      if (worktreeFilterLabel) worktreeFilterLabel.textContent = (currentLang === 'en' ? 'Worktree:' : 'Worktree:');
    }

    // 3. Khôi phục tab lọc đang chọn
    filterBtns.forEach(btn => {
      if (btn.getAttribute('data-filter') === currentFilter) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // 4. Các hàm tiện ích
    function escapeHtml(text) {
      if (!text) return '';
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function openSession(id) {
      vscode.postMessage({ type: 'openSession', id });
    }

    function approveSession(id) {
      vscode.postMessage({ type: 'approve', id });
    }

    function deleteSession(id, title, filePath) {
      vscode.postMessage({ type: 'deleteSession', id, title, filePath });
    }

    function markSessionReviewed(id) {
      if (!id) return;
      reviewedIds.add(id);
      saveState();
      vscode.postMessage({ type: 'markReviewed', id });
      renderSessions();
    }

    function unmarkSessionReviewed(id) {
      if (!id) return;
      reviewedIds.delete(id);
      saveState();
      vscode.postMessage({ type: 'unmarkReviewed', id });
      renderSessions();
    }

    function toggleSection(key) {
      sectionState[key] = !sectionState[key];
      saveState();
      renderSessions();
    }

    function renderCard(s) {
      try {
        const dotClass = 'dot-' + (s.isNeedReview ? 'need_review' : s.status);
      const cardStatusClass = 'status-' + (s.isNeedReview ? 'need_review' : s.status);
      
      let actionButtons = '';
      if (s.status === 'need_accept') {
        actionButtons =
          '<button class="card-action-btn" data-action="diff" data-id="' + s.id + '" title="' + t('btnDiff') + '">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>' +
            '<span>' + t('btnDiff') + '</span>' +
          '</button>' +
          '<button class="card-action-btn btn-approve" data-action="approve" data-id="' + s.id + '" title="' + t('btnApprove') + '">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>' +
            '<span>' + t('btnApprove') + '</span>' +
          '</button>';
      } else if (s.isNeedReview) {
        actionButtons =
          '<button class="card-action-btn btn-review" data-action="open" data-id="' + s.id + '" title="' + t('btnReview') + '">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>' +
            '<span>' + t('btnReview') + '</span>' +
          '</button>' +
          '<button class="card-action-btn" data-action="mark-reviewed" data-id="' + s.id + '" title="' + t('btnMarkReviewed') + '">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
            '<span>' + t('btnMarkReviewed') + '</span>' +
          '</button>';
      } else if (s.status === 'failed') {
        actionButtons =
          '<button class="card-action-btn btn-retry" data-action="open" data-id="' + s.id + '" title="' + t('btnRetry') + '">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>' +
            '<span>' + t('btnRetry') + '</span>' +
          '</button>';
      } else if (s.status === 'done') {
        actionButtons =
          '<button class="card-action-btn" data-action="unmark-reviewed" data-id="' + s.id + '" title="' + t('btnReviewAgain') + '">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>' +
            '<span>' + t('btnReviewAgain') + '</span>' +
          '</button>';
      }

      let statusBadge = '';
      if (s.status === 'need_accept') {
        statusBadge = '<span class="status-badge badge-need-accept">' + (currentLang === 'en' ? 'Need Approval' : 'Chờ duyệt') + '</span>';
      } else if (s.status === 'running') {
        statusBadge = '<span class="status-badge badge-running"><span class="pulse-dot"></span> ' + (currentLang === 'en' ? 'Running' : 'Đang chạy') + '</span>';
      } else if (s.status === 'failed') {
        const errLabel = s.errorDetail || (currentLang === 'en' ? 'Limit / Error' : 'Bị limit / Lỗi');
        statusBadge = '<span class="status-badge badge-failed">' + escapeHtml(errLabel) + '</span>';
      } else if (s.isNeedReview) {
        statusBadge = '<span class="status-badge badge-need-review">' + (currentLang === 'en' ? 'Need Review' : 'Cần review') + '</span>';
      } else if (s.status === 'done') {
        statusBadge = '<span class="status-badge badge-done">' + (currentLang === 'en' ? 'Done' : 'Đã xong') + '</span>';
      }
      
      const branchFooterItem = s.branch ? (
        '<span class="footer-meta-item branch-info" data-action="filter-worktree" data-branch="' + escapeHtml(s.branch) + '" title="' + (currentLang === 'en' ? 'Click to filter worktree: ' : 'Click để lọc theo worktree: ') + escapeHtml(s.branch) + '">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="18" cy="6" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>' +
          'branch: <span class="branch-name">' + escapeHtml(s.branch) + '</span>' +
        '</span>' +
        (s.isWorktree ? '<span class="worktree-badge" data-action="filter-worktree" data-branch="' + escapeHtml(s.branch) + '" title="' + (currentLang === 'en' ? 'Git Worktree: ' : 'Git Worktree: ') + escapeHtml(s.branch) + '">worktree</span>' : '')
      ) : '';

      const footerMetaRow = '<div class="footer-meta-row">' +
        '<div class="footer-stats-row">' +
          '<span class="footer-meta-item">' + escapeHtml(s.statusMessage) + '</span>' +
          '<span style="opacity: 0.35;">•</span>' +
          '<span class="footer-meta-item">' + escapeHtml(s.modelName) + '</span>' +
          '<span style="opacity: 0.35;">•</span>' +
          '<span class="footer-meta-item token">in: ' + escapeHtml(s.inputTokensFormatted) + '</span>' +
          '<span style="opacity: 0.35;">•</span>' +
          '<span class="footer-meta-item token">out: ' + escapeHtml(s.outputTokensFormatted) + '</span>' +
          (s.costUSD ? '<span style="opacity: 0.35;">•</span><span class="footer-meta-item cost">' + escapeHtml(s.costUSD) + '</span>' : '') +
          '<span style="opacity: 0.35;">•</span>' +
          '<span class="footer-meta-item" title="Số lượt trao đổi hội thoại">' + (s.turnCount || 0) + ' turns</span>' +
        '</div>' +
        '<div class="footer-bottom-row">' +
          '<div class="footer-bottom-left">' + branchFooterItem + '</div>' +
          '<span class="footer-meta-item short-id">' + escapeHtml(s.shortId) + '</span>' +
        '</div>' +
      '</div>';

      let cleanTitle = (s.title || '').trim();
      let issueTag = '';
      if (s.issueId) {
        const normId = s.issueId.startsWith('#') ? s.issueId : ('#' + s.issueId);
        if (cleanTitle.startsWith('[' + normId + ']')) {
          cleanTitle = cleanTitle.substring(normId.length + 2).trim();
        } else if (cleanTitle.startsWith('(' + normId + ')')) {
          cleanTitle = cleanTitle.substring(normId.length + 2).trim();
        } else if (cleanTitle.startsWith(normId)) {
          cleanTitle = cleanTitle.substring(normId.length).trim();
        }
        if (cleanTitle.startsWith(':') || cleanTitle.startsWith('-')) {
          cleanTitle = cleanTitle.substring(1).trim();
        }
        if (cleanTitle.startsWith('[]') || cleanTitle.startsWith('()')) {
          cleanTitle = cleanTitle.substring(2).trim();
        }
        if (!cleanTitle) {
          cleanTitle = s.title || normId;
        }
        issueTag = '[' + normId + ']';
      }

      const plainTitle = issueTag ? (issueTag + ' ' + cleanTitle) : cleanTitle;
      const titleHtml = issueTag 
        ? '<span class="title-issue">' + escapeHtml(issueTag) + '</span> ' + escapeHtml(cleanTitle)
        : escapeHtml(cleanTitle);

      return '<div class="session-card ' + cardStatusClass + '" data-action="open" data-id="' + s.id + '">' +
        '<div class="card-top-row">' +
          '<div class="card-badges-wrap">' +
            '<span class="status-dot ' + dotClass + '"></span>' +
            '<span class="repo-badge">' + escapeHtml(s.repo) + '</span>' +
            statusBadge +
          '</div>' +
          '<div class="card-top-actions">' +
            actionButtons +
            '<button class="card-delete-btn" title="' + t('btnDelete') + '" data-action="delete" data-id="' + s.id + '" data-title="' + escapeHtml(plainTitle) + '" data-path="' + encodeURIComponent(s.filePath || '') + '">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
              '</svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="card-title-row">' +
          '<span class="title-text" title="' + escapeHtml(plainTitle) + '">' + titleHtml + '</span>' +
        '</div>' +
        (s.lastUserPrompt ? '<div class="user-prompt">&gt; ' + escapeHtml(s.lastUserPrompt.replace(/^>\s*/, '')) + '</div>' : '') +
        footerMetaRow +
      '</div>';
      } catch (err) {
        console.error('Error rendering card for session:', s, err);
        return '';
      }
    }

    function renderSessions() {
      try {
        updateLanguageUI();
        const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        // Update workspace bar UI & token count
        if (workspaceBar) {
          workspaceBar.style.display = 'flex';
          if (currentWorkspace && currentWorkspace.name) {
            if (wsBtnCurrent) {
              wsBtnCurrent.style.display = 'inline-flex';
              if (wsCurrentName) wsCurrentName.textContent = currentWorkspace.name;
            }
            if (wsMode === 'current') {
              wsBtnCurrent?.classList.add('active');
              wsBtnAll?.classList.remove('active');
            } else {
              wsBtnAll?.classList.add('active');
              wsBtnCurrent?.classList.remove('active');
            }
          } else {
            if (wsBtnCurrent) wsBtnCurrent.style.display = 'none';
            wsBtnAll?.classList.add('active');
          }
        }

        // Cập nhật dòng bộ lọc Worktree (tách dòng riêng)
        const hasAnyWorktree = allSessions.some(s => !!s.branch) || !!hasWorkspaceWorktrees || !!currentWorktree;
        if (worktreeFilterRow) {
          if (hasAnyWorktree) {
            worktreeFilterRow.style.display = 'inline-flex';
            if (currentWorktree) {
              wsBtnWorktree?.classList.add('active');
              if (wsWorktreeLabel) wsWorktreeLabel.textContent = currentWorktree;
              if (wsWorktreeClear) wsWorktreeClear.style.display = 'inline-flex';
            } else {
              wsBtnWorktree?.classList.remove('active');
              if (wsWorktreeLabel) wsWorktreeLabel.textContent = (currentLang === 'en' ? 'All ▾' : 'Tất cả ▾');
              if (wsWorktreeClear) wsWorktreeClear.style.display = 'none';
            }
          } else {
            worktreeFilterRow.style.display = 'none';
          }
        }

        // Tính tổng token đã dùng hôm nay theo phạm vi lọc
        const todaySessions = allSessions.filter(s => s.updatedAt >= startOfToday.getTime());
        let tokenSessions = (wsMode === 'current' && currentWorkspace && currentWorkspace.name)
          ? todaySessions.filter(s => {
              if (!s.repo) return true;
              const targetRepo = currentWorkspace.name.toLowerCase();
              return s.repo.toLowerCase() === targetRepo || (s.cwd && s.cwd.toLowerCase().includes(targetRepo));
            })
          : todaySessions;

        if (currentWorktree) {
          const targetWt = currentWorktree.toLowerCase();
          tokenSessions = tokenSessions.filter(s => {
            return (s.branch && s.branch.toLowerCase() === targetWt) || (s.cwd && s.cwd.toLowerCase().includes(targetWt));
          });
        }

        let todayTotalTokens = 0;
        let todayInTokens = 0;
        let todayOutTokens = 0;
        tokenSessions.forEach(s => {
          todayTotalTokens += (s.totalTokens || 0);
          todayInTokens += (s.rawInputTokens || 0);
          todayOutTokens += (s.rawOutputTokens || 0);
        });

        function formatTokensSimple(n) {
          if (!n || n <= 0) return '0';
          if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
          if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
          if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
          return n.toString();
        }

        if (wsTokensNum) {
          wsTokensNum.textContent = formatTokensSimple(todayTotalTokens);
        }
        if (wsTokensBadge) {
          let scopeLabel = (wsMode === 'current' && currentWorkspace && currentWorkspace.name) ? currentWorkspace.name : (t('wsAll') || 'Tất cả dự án');
          if (currentWorktree) {
            scopeLabel += ' • ' + currentWorktree;
          }
          const inFormatted = formatTokensSimple(todayInTokens);
          const outFormatted = formatTokensSimple(todayOutTokens);
          const numFormatted = todayTotalTokens.toLocaleString();
          wsTokensBadge.title = (currentLang === 'en')
            ? ('Today tokens (' + scopeLabel + '): ' + numFormatted + ' (in: ' + inFormatted + ', out: ' + outFormatted + ')')
            : ('Tổng token hôm nay (' + scopeLabel + '): ' + numFormatted + ' (in: ' + inFormatted + ', out: ' + outFormatted + ')');
        }

        // Bổ sung cờ isNeedReview: các task hoàn thành trong ngày hôm nay nhưng người dùng CHƯA bấm xem
        const enrichedSessions = allSessions.map(s => {
          const isNeedReview = s.status === 'done' && !reviewedIds.has(s.id) && s.updatedAt >= startOfToday.getTime();
          return {
            ...s,
            isNeedReview
          };
        });
        let filtered = enrichedSessions;

        // Lọc theo Workspace (nếu người dùng chọn tab Dự án này và đang mở 1 workspace)
        if (wsMode === 'current' && currentWorkspace && currentWorkspace.name) {
          const targetRepo = currentWorkspace.name.toLowerCase();
          filtered = filtered.filter(s => {
            if (!s.repo) return true;
            const sRepo = s.repo.toLowerCase();
            return sRepo === targetRepo || (s.cwd && s.cwd.toLowerCase().includes(targetRepo));
          });
        }

        // Lọc theo Git Worktree / Nhánh (nếu người dùng chọn 1 worktree cụ thể)
        if (currentWorktree) {
          const targetWt = currentWorktree.toLowerCase();
          filtered = filtered.filter(s => {
            return (s.branch && s.branch.toLowerCase() === targetWt) || (s.cwd && s.cwd.toLowerCase().includes(targetWt));
          });
        }

        // Lọc theo Search Query hoặc Tab lọc
        if (query) {
          // Khi tìm kiếm: tự động tìm kiếm trên TOÀN BỘ lịch sử sessions (không bị giới hạn bởi tab)
          filtered = filtered.filter(s => {
            return (
              (s.title && s.title.toLowerCase().includes(query)) ||
              (s.issueId && s.issueId.toLowerCase().includes(query)) ||
              (s.repo && s.repo.toLowerCase().includes(query)) ||
              (s.branch && s.branch.toLowerCase().includes(query)) ||
              (s.lastUserPrompt && s.lastUserPrompt.toLowerCase().includes(query))
            );
          });
        } else {
          // Khi không tìm kiếm: áp dụng tab lọc đang chọn
          if (currentFilter === 'today') {
            filtered = filtered.filter(s => s.updatedAt >= startOfToday.getTime());
          }
          // 'all': giữ nguyên toàn bộ sessions
        }

        const needAcceptList = filtered.filter(s => s.status === 'need_accept');
        const runningList = filtered.filter(s => s.status === 'running');
        const failedList = filtered.filter(s => s.status === 'failed');
        const needReviewList = filtered.filter(s => s.isNeedReview);
        const doneList = filtered.filter(s => s.status === 'done' && !s.isNeedReview);

        let html = '';

        if (needAcceptList.length > 0) {
          const isOpen = query ? true : sectionState.need_accept;
          html += '<div class="section-header" data-action="toggle-section" data-section="need_accept">' +
            '<span class="chevron ' + (isOpen ? 'open' : 'closed') + '">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
            '</span>' +
            '<span style="color: #f59e0b; font-weight: 700;">' + t('secNeedAccept') + '</span>' +
            '<span class="count-badge">' + needAcceptList.length + '</span>' +
          '</div>' +
          '<div class="section-content ' + (isOpen ? '' : 'collapsed') + '">';
          needAcceptList.forEach(s => html += renderCard(s));
          html += '</div>';
        }

        if (runningList.length > 0) {
          const isOpen = query ? true : sectionState.running;
          html += '<div class="section-header" data-action="toggle-section" data-section="running">' +
            '<span class="chevron ' + (isOpen ? 'open' : 'closed') + '">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
            '</span>' +
            '<span style="color: #3b82f6; font-weight: 700;">' + t('secRunning') + '</span>' +
            '<span class="count-badge">' + runningList.length + '</span>' +
          '</div>' +
          '<div class="section-content ' + (isOpen ? '' : 'collapsed') + '">';
          runningList.forEach(s => html += renderCard(s));
          html += '</div>';
        }

        if (failedList.length > 0) {
          const isOpen = query ? true : (sectionState.failed !== false);
          html += '<div class="section-header" data-action="toggle-section" data-section="failed">' +
            '<span class="chevron ' + (isOpen ? 'open' : 'closed') + '">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
            '</span>' +
            '<span style="color: #ef4444; font-weight: 700;">' + t('secFailed') + '</span>' +
            '<span class="count-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171;">' + failedList.length + '</span>' +
          '</div>' +
          '<div class="section-content ' + (isOpen ? '' : 'collapsed') + '">';
          failedList.forEach(s => html += renderCard(s));
          html += '</div>';
        }

        if (needReviewList.length > 0) {
          const isOpen = query ? true : sectionState.need_review;
          html += '<div class="section-header" data-action="toggle-section" data-section="need_review">' +
            '<span class="chevron ' + (isOpen ? 'open' : 'closed') + '">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
            '</span>' +
            '<span style="color: #c084fc; font-weight: 700;">' + t('secNeedReview') + '</span>' +
            '<span class="count-badge" style="background: rgba(168, 85, 247, 0.25); color: #e9d5ff;">' + needReviewList.length + '</span>' +
          '</div>' +
          '<div class="section-content ' + (isOpen ? '' : 'collapsed') + '">';
          needReviewList.forEach(s => html += renderCard(s));
          html += '</div>';
        }

        if (doneList.length > 0) {
          const isOpen = query ? true : sectionState.done;
          html += '<div class="section-header" data-action="toggle-section" data-section="done">' +
            '<span class="chevron ' + (isOpen ? 'open' : 'closed') + '">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
            '</span>' +
            '<span style="color: #10b981; font-weight: 700;">' + t('secDone') + '</span>' +
            '<span class="count-badge">' + doneList.length + '</span>' +
          '</div>' +
          '<div class="section-content ' + (isOpen ? '' : 'collapsed') + '">';
          doneList.forEach(s => html += renderCard(s));
          html += '</div>';
        }

        if (filtered.length === 0) {
          if (currentWorktree) {
            html = '<div style="text-align: center; color: var(--text-muted); padding: 30px 16px; font-size: 12px; line-height: 1.6;">' +
              '<div style="margin-bottom: 8px; color: var(--text-muted);">' +
                '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="18" cy="6" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>' +
              '</div>' +
              '<div style="font-weight: 600; color: var(--text-main); margin-bottom: 4px;">' + (currentLang === 'en' ? 'Worktree: ' : 'Git Worktree: ') + escapeHtml(currentWorktree) + '</div>' +
              '<div>' + (currentLang === 'en' ? 'No Claude sessions recorded for this worktree yet.' : 'Chưa có phiên làm việc Claude nào trong worktree này.') + '</div>' +
              '<div style="margin-top: 8px; font-size: 11px; opacity: 0.8;">' + (currentLang === 'en' ? 'Run <code>claude</code> in this folder to start a new task.' : 'Mở terminal tại thư mục worktree này và gõ <code>claude</code> để bắt đầu task mới!') + '</div>' +
              '</div>';
          } else if (currentFilter === 'today') {
            html = '<div style="text-align: center; color: #64748b; padding: 24px;">' + t('noSessionsToday') + '</div>';
          } else {
            html = '<div style="text-align: center; color: #64748b; padding: 24px;">' + t('noSessionsFound') + '</div>';
          }
        }

        if (contentContainer) {
          contentContainer.innerHTML = html;
        }
      } catch (err) {
        console.error('Lỗi khi renderSessions:', err);
      }
    }

    // 5. Gắn sự kiện (Event Listeners)
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderSessions();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        const svg = refreshBtn.querySelector('svg');
        if (svg) svg.classList.add('spin');
        vscode.postMessage({ type: 'refresh' });
        setTimeout(() => {
          if (svg) svg.classList.remove('spin');
        }, 600);
      });
    }

    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'openSettings' });
      });
    }

    if (wsBtnCurrent) {
      wsBtnCurrent.addEventListener('click', () => {
        wsMode = 'current';
        saveState();
        renderSessions();
      });
    }

    if (wsBtnAll) {
      wsBtnAll.addEventListener('click', () => {
        wsMode = 'all';
        saveState();
        renderSessions();
      });
    }

    if (wsBtnWorktree) {
      wsBtnWorktree.addEventListener('click', (e) => {
        if (e.target.closest('#wsWorktreeClear')) {
          e.stopPropagation();
          currentWorktree = null;
          saveState();
          renderSessions();
          vscode.postMessage({ type: 'clearWorktreeFilter' });
          return;
        }
        vscode.postMessage({ type: 'openWorktreePicker' });
      });
    }

    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        saveState();
        renderSessions();
      });
    });

    // Event Delegation cho Content Container: xử lý click Card, Delete, Diff, Approve, Toggle Header, Review, Filter Worktree
    if (contentContainer) {
      contentContainer.addEventListener('click', (e) => {
        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-action');
        const id = actionEl.getAttribute('data-id');

        if (action === 'filter-worktree') {
          e.stopPropagation();
          const branch = actionEl.getAttribute('data-branch');
          if (branch) {
            currentWorktree = branch;
            saveState();
            renderSessions();
            vscode.postMessage({ type: 'setWorktreeFromCard', branch });
          }
          return;
        }

        if (action === 'toggle-section') {
          const section = actionEl.getAttribute('data-section');
          if (section) toggleSection(section);
          return;
        }

        if (action === 'delete') {
          e.stopPropagation();
          const title = actionEl.getAttribute('data-title') || '';
          const rawPath = actionEl.getAttribute('data-path') || '';
          const filePath = decodeURIComponent(rawPath);
          deleteSession(id, title, filePath);
          return;
        }

        if (action === 'diff') {
          e.stopPropagation();
          if (id) {
            openSession(id);
          }
          return;
        }

        if (action === 'approve') {
          e.stopPropagation();
          if (id) approveSession(id);
          return;
        }

        if (action === 'mark-reviewed') {
          e.stopPropagation();
          if (id) markSessionReviewed(id);
          return;
        }

        if (action === 'unmark-reviewed') {
          e.stopPropagation();
          if (id) unmarkSessionReviewed(id);
          return;
        }

        if (action === 'open') {
          if (id) {
            openSession(id);
          }
          return;
        }
      });
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'switchTab' && message.tab) {
        currentFilter = message.tab;
        filterBtns.forEach(btn => {
          if (btn.getAttribute('data-filter') === currentFilter) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
        saveState();
        renderSessions();
        return;
      }
      if (message.type === 'setWorktreeFilter') {
        currentWorktree = message.branch || null;
        saveState();
        renderSessions();
        return;
      }
      if (message.type === 'updateSessions') {
        allSessions = Array.isArray(message.sessions) ? message.sessions : [];
        if (Array.isArray(message.reviewedIds)) {
          message.reviewedIds.forEach(id => reviewedIds.add(id));
        }
        if (message.currentWorkspace !== undefined) {
          currentWorkspace = message.currentWorkspace;
        }
        if (message.lang) {
          currentLang = message.lang;
        }
        if (message.worktreeFilter !== undefined) {
          currentWorktree = message.worktreeFilter || null;
        }
        if (message.hasWorktrees !== undefined) {
          hasWorkspaceWorktrees = !!message.hasWorktrees;
        }
        saveState();
        renderSessions();
      }
    });

    // 6. Khởi động render
    if (allSessions && allSessions.length > 0) {
      renderSessions();
    }

    // Thông báo cho extension biết Webview đã sẵn sàng
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }
}
exports.IssuesViewProvider = IssuesViewProvider;
//# sourceMappingURL=issuesViewProvider.js.map