"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssuesViewProvider = void 0;
const vscode = require("vscode");
const scanner_1 = require("./scanner");
const updater_1 = require("./updater");
class IssuesViewProvider {
    _extensionUri;
    _context;
    static viewType = 'claudeSessionManager.issuesView';
    static explorerViewType = 'claudeSessionManager.explorerView';
    _views = new Set();
    _watchers = [];
    _refreshTimer;
    _debounceTimer;
    _statusBarItem;
    _lastSessions = [];
    constructor(_extensionUri, _context) {
        this._extensionUri = _extensionUri;
        this._context = _context;
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = 'claudeSessionManager.focusView';
        this._statusBarItem.text = '$(sparkle) Claude: Idle';
        this._statusBarItem.tooltip = 'Claude Session & Issue Manager';
        this._statusBarItem.show();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('claudeSessionManager')) {
                this.refresh();
            }
        });
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
                        lang: this.getLanguage()
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
                            lang: this.getLanguage()
                        });
                    }
                    await this.refresh();
                    break;
                }
                case 'refresh': {
                    await this.refresh();
                    break;
                }
                case 'markReviewed': {
                    await this.addReviewedId(data.id);
                    break;
                }
                case 'openSettings': {
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'claudeSessionManager');
                    break;
                }
                case 'checkForUpdates': {
                    if (this._context) {
                        await updater_1.ExtensionUpdater.checkForUpdates(this._context, true);
                    }
                    break;
                }
                case 'openSession': {
                    await this.addReviewedId(data.id);
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
        return this._context?.globalState.get('reviewedSessionIds') || [];
    }
    async addReviewedId(id) {
        if (!id || !this._context)
            return;
        const reviewed = this.getReviewedIds();
        if (!reviewed.includes(id)) {
            reviewed.push(id);
            await this._context.globalState.update('reviewedSessionIds', reviewed);
        }
    }
    async refresh() {
        const config = vscode.workspace.getConfiguration('claudeSessionManager');
        const customPath = config.get('storagePath');
        const sessions = await scanner_1.SessionScanner.scanSessions(customPath);
        this._lastSessions = sessions;
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const needAcceptCount = sessions.filter(s => s.status === 'need_accept').length;
        const runningCount = sessions.filter(s => s.status === 'running').length;
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
                lang
            });
        }
        if (needAcceptCount > 0) {
            this._statusBarItem.text = `$(bell-dot) Claude: ${needAcceptCount} ${lang === 'en' ? 'Waiting' : 'Chờ duyệt'}`;
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this._statusBarItem.tooltip = lang === 'en'
                ? `There are ${needAcceptCount} tasks waiting for your approval. Click to open.`
                : `Có ${needAcceptCount} task đang chờ bạn phê duyệt. Nhấp để mở.`;
        }
        else if (runningCount > 0) {
            this._statusBarItem.text = `$(sync~spin) Claude: ${runningCount} ${lang === 'en' ? 'Running' : 'Đang chạy'}`;
            this._statusBarItem.backgroundColor = undefined;
            this._statusBarItem.tooltip = lang === 'en'
                ? `${runningCount} tasks currently running. Click to open.`
                : `${runningCount} task đang thực thi. Nhấp để mở.`;
        }
        else if (needReviewCount > 0) {
            this._statusBarItem.text = `$(eye) Claude: ${needReviewCount} ${lang === 'en' ? 'Review' : 'Cần review'}`;
            this._statusBarItem.backgroundColor = undefined;
            this._statusBarItem.tooltip = lang === 'en'
                ? `${needReviewCount} tasks finished and need your review. Click to open.`
                : `${needReviewCount} task Claude vừa hoàn thành cần review. Nhấp để mở.`;
        }
        else {
            this._statusBarItem.text = '$(sparkle) Claude: Idle';
            this._statusBarItem.backgroundColor = undefined;
            this._statusBarItem.tooltip = lang === 'en'
                ? 'Claude Session Manager (Idle). Click to open.'
                : 'Claude Session Manager (Sẵn sàng). Nhấp để mở.';
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
      --bg-color: #0f1115;
      --card-bg: #16191f;
      --card-border: #232730;
      --text-main: #f1f5f9;
      --text-muted: #8b9bb4;
      --tag-bg: #1e232d;
      --need-accept: #f59e0b;
      --done: #10b981;
      --running: #3b82f6;
      --need-review: #a855f7;
    }

    body {
      background-color: var(--vscode-sideBar-background, var(--bg-color));
      color: var(--vscode-sideBar-foreground, var(--text-main));
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
      background: rgba(255, 255, 255, 0.12);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.25);
    }

    .search-bar-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }

    .search-input {
      flex: 1;
      background: var(--vscode-input-background, #1a1e26);
      color: var(--vscode-input-foreground, #fff);
      border: 1px solid var(--vscode-input-border, #2d3340);
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
      background: #1a1e26;
      color: #94a3b8;
      border: 1px solid var(--vscode-input-border, #2d3340);
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
      background: #232834;
      color: #ffffff;
      border-color: #3e4657;
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
      gap: 5px;
      margin-bottom: 8px;
      padding: 1px 0;
      overflow-x: auto;
    }

    .ws-pill {
      background: #16191f;
      color: #94a3b8;
      border: 1px solid #232730;
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
    }

    .ws-pill:hover {
      background: #1e232d;
      color: #cbd5e1;
      border-color: #3b4252;
    }

    .ws-pill.active {
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border-color: rgba(59, 130, 246, 0.4);
      font-weight: 600;
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
      background: #1a1e26;
      color: #94a3b8;
      border: 1px solid #2d3340;
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
      background: #232834;
      color: #fff;
    }

    .filter-btn.active {
      background: #2563eb;
      color: #ffffff;
      border-color: #3b82f6;
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
      background: rgba(255, 255, 255, 0.05);
    }

    .section-header .chevron {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.18s ease;
      color: #94a3b8;
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
      color: #cbd5e1;
      background: #232834;
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

    .session-card:hover {
      border-color: #3e4657;
      background: #1c212a;
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-top: 6px;
      flex-shrink: 0;
      display: inline-block;
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

    .review-badge {
      background: rgba(168, 85, 247, 0.2);
      color: #c084fc;
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

    .dot-running {
      background-color: var(--running);
    }

    .meta-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 8px;
      overflow: hidden;
      white-space: nowrap;
    }

    .repo-badge {
      background: #252b38;
      color: #93c5fd;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      font-family: monospace;
      flex-shrink: 0;
    }

    .branch-badge {
      background: #141f30;
      color: #7dd3fc;
      border: 1px solid #1e3a5f;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10.5px;
      font-family: monospace;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .worktree-badge {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 9.5px;
      font-weight: 600;
      text-transform: uppercase;
      flex-shrink: 0;
    }

    .issue-badge {
      background: #1e3a5f;
      color: #60a5fa;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11.5px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .title-text {
      font-weight: 600;
      color: #f1f5f9;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }

    .card-delete-btn {
      background: transparent;
      border: none;
      color: #64748b;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: all 0.15s ease;
      flex-shrink: 0;
      margin-left: 4px;
    }

    .session-card:hover .card-delete-btn {
      opacity: 0.6;
    }

    .card-delete-btn:hover {
      opacity: 1 !important;
      color: #ef4444;
      background: rgba(239, 68, 68, 0.15);
    }

    .user-prompt {
      color: #94a3b8;
      font-size: 12px;
      margin: 8px 0 10px 0;
      line-height: 1.5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Clean Footer với khoảng cách thoáng đãng */
    .footer-meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 11.5px;
      color: #7d8b9f;
      margin-top: 10px;
      line-height: 1.4;
    }

    .footer-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .footer-meta-item.token {
      color: #94a3b8;
    }

    .footer-meta-item.cost {
      color: #34d399;
      font-weight: 600;
    }

    .footer-meta-item.short-id {
      color: #556275;
      font-family: monospace;
      margin-left: auto;
    }

    .card-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 6px;
    }

    .btn {
      background: #2563eb;
      color: #ffffff;
      border: none;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn:hover {
      background: #1d4ed8;
    }

    .btn-secondary {
      background: #2d3340;
    }
    .btn-secondary:hover {
      background: #3e4657;
    }
  </style>
</head>
<body>
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

  <!-- Thanh chọn Workspace / Dự án -->
  <div class="workspace-bar" id="workspaceBar" style="display: none;">
    <button class="ws-pill active" id="wsBtnCurrent">
      <span class="ws-dot"></span>
      <span id="wsCurrentName">app-backend</span>
    </button>
    <button class="ws-pill" id="wsBtnAll">
      <span id="wsAllText">🌐 Tất cả dự án</span>
    </button>
  </div>

  <!-- 4 Tab Lọc: Hôm nay, Đang chạy, Cần review, Tất cả -->
  <div class="filter-tabs">
    <button class="filter-btn active" data-filter="today" id="tabTodayBtn">Hôm nay</button>
    <button class="filter-btn" data-filter="active" id="tabActiveBtn">Đang chạy</button>
    <button class="filter-btn" data-filter="review" id="tabReviewBtn">Cần review</button>
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

    // 2. Khôi phục State an toàn
    const savedState = vscode.getState() || {};
    let allSessions = Array.isArray(savedState.sessions) ? savedState.sessions : [];
    let reviewedIds = new Set(Array.isArray(savedState.reviewedIds) ? savedState.reviewedIds : []);
    let currentFilter = savedState.currentFilter || 'today';
    let currentWorkspace = savedState.currentWorkspace || null;
    let wsMode = savedState.wsMode || 'current';
    let currentLang = savedState.lang || 'vi';
    let sectionState = savedState.sectionState || {
      need_accept: true,
      running: true,
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
        tabReview: "Cần review",
        tabAll: "Tất cả",
        wsAll: "🌐 Tất cả dự án",
        secNeedAccept: "CHỜ DUYỆT",
        secRunning: "ĐANG CHẠY",
        secNeedReview: "VỪA XONG (CẦN REVIEW)",
        secDone: "ĐÃ HOÀN THÀNH",
        btnDiff: "Xem diff",
        btnApprove: "Duyệt & Chạy",
        btnReview: "Xem kết quả",
        btnMarkReviewed: "✓ Đã xem",
        btnDeleteTitle: "Xoá phiên hội thoại",
        noSessionsReviewTitle: "Không có task nào cần review",
        noSessionsReviewDesc: "Các task Claude vừa làm xong sẽ xuất hiện tại đây để bạn kiểm tra.",
        noSessionsActive: "Hiện không có task nào đang chạy hoặc chờ duyệt.",
        noSessionsFound: "Không tìm thấy phiên làm việc nào phù hợp.",
        loading: "Đang tải danh sách sessions..."
      },
      en: {
        searchPlaceholder: "Search content, issue, branch...",
        refreshTitle: "Refresh session list",
        settingsTitle: "Open Settings",
        tabToday: "Today",
        tabActive: "Running",
        tabReview: "Need Review",
        tabAll: "All",
        wsAll: "🌐 All Projects",
        secNeedAccept: "WAITING APPROVAL",
        secRunning: "RUNNING",
        secNeedReview: "FINISHED (NEED REVIEW)",
        secDone: "COMPLETED",
        btnDiff: "View Diff",
        btnApprove: "Approve & Run",
        btnReview: "Review Result",
        btnMarkReviewed: "✓ Reviewed",
        btnDeleteTitle: "Delete conversation session",
        noSessionsReviewTitle: "No sessions need review",
        noSessionsReviewDesc: "Sessions completed by Claude will appear here for your review.",
        noSessionsActive: "No tasks are currently running or waiting for approval.",
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
        wsMode,
        lang: currentLang,
        sectionState
      });
    }

    function updateLanguageUI() {
      if (searchInput) searchInput.placeholder = t('searchPlaceholder');
      if (refreshBtn) refreshBtn.title = t('refreshTitle');
      if (settingsBtn) settingsBtn.title = t('settingsTitle');
      const tabToday = document.getElementById('tabTodayBtn');
      if (tabToday) tabToday.textContent = t('tabToday');
      const tabActive = document.getElementById('tabActiveBtn');
      if (tabActive) tabActive.textContent = t('tabActive');
      const tabAll = document.getElementById('tabAllBtn');
      if (tabAll) tabAll.textContent = t('tabAll');
      if (wsAllText) wsAllText.textContent = t('wsAll');
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

    function toggleSection(key) {
      sectionState[key] = !sectionState[key];
      saveState();
      renderSessions();
    }

    function renderCard(s) {
      const dotClass = 'dot-' + (s.isNeedReview ? 'need_review' : s.status);
      const cardStatusClass = 'status-' + (s.isNeedReview ? 'need_review' : s.status);
      
      let actionButtons = '';
      if (s.status === 'need_accept') {
        actionButtons = '<div class="card-actions">' +
          '<button class="btn btn-secondary" data-action="diff" data-id="' + s.id + '">' + t('btnDiff') + '</button>' +
          '<button class="btn" data-action="approve" data-id="' + s.id + '">' + t('btnApprove') + '</button>' +
          '</div>';
      } else if (s.isNeedReview) {
        actionButtons = '<div class="card-actions">' +
          '<button class="btn btn-review" data-action="review-open" data-id="' + s.id + '">' + t('btnReview') + '</button>' +
          '<button class="btn btn-secondary" data-action="mark-reviewed" data-id="' + s.id + '" title="' + t('btnMarkReviewed') + '">' + t('btnMarkReviewed') + '</button>' +
          '</div>';
      }

      const reviewBadge = s.isNeedReview ? '<span class="review-badge">' + t('tabReview') + '</span>' : '';
      
      const branchBadge = s.branch ? 
        '<span class="branch-badge" title="Git Branch: ' + escapeHtml(s.branch) + '">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="18" cy="6" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>' +
          escapeHtml(s.branch) +
        '</span>' : '';

      const worktreeBadge = s.isWorktree ? '<span class="worktree-badge" title="Git Worktree directory">worktree</span>' : '';

      const footerMetaRow = '<div class="footer-meta-row">' +
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
        '<span class="footer-meta-item short-id">' + escapeHtml(s.shortId) + '</span>' +
      '</div>';

      return '<div class="session-card ' + cardStatusClass + '" data-action="open" data-id="' + s.id + '">' +
        '<div class="card-header">' +
          '<span class="status-dot ' + dotClass + '"></span>' +
          '<div style="flex: 1; min-width: 0;">' +
            '<div class="meta-row">' +
              '<span class="repo-badge">' + escapeHtml(s.repo) + '</span>' +
              branchBadge +
              worktreeBadge +
              (s.issueId ? '<span class="issue-badge">' + escapeHtml(s.issueId) + '</span>' : '') +
              reviewBadge +
              '<span class="title-text" title="' + escapeHtml(s.title) + '">' + escapeHtml(s.title) + '</span>' +
              '<button class="card-delete-btn" title="' + t('btnDeleteTitle') + '" data-action="delete" data-id="' + s.id + '" data-title="' + escapeHtml(s.title) + '" data-path="' + encodeURIComponent(s.filePath || '') + '">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
                '</svg>' +
              '</button>' +
            '</div>' +
            (s.lastUserPrompt ? '<div class="user-prompt">' + escapeHtml(s.lastUserPrompt) + '</div>' : '') +
            actionButtons +
            footerMetaRow +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function renderSessions() {
      try {
        updateLanguageUI();
        const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        // Update workspace bar UI
        if (currentWorkspace && currentWorkspace.name) {
          if (workspaceBar) workspaceBar.style.display = 'flex';
          if (wsCurrentName) wsCurrentName.textContent = currentWorkspace.name;
          if (wsMode === 'current') {
            wsBtnCurrent?.classList.add('active');
            wsBtnAll?.classList.remove('active');
          } else {
            wsBtnAll?.classList.add('active');
            wsBtnCurrent?.classList.remove('active');
          }
        } else {
          if (workspaceBar) workspaceBar.style.display = 'none';
        }

        // Bổ sung cờ isNeedReview: các task hoàn thành trong ngày hôm nay nhưng người dùng CHƯA bấm xem
        const enrichedSessions = allSessions.map(s => {
          const isNeedReview = s.status === 'done' && !reviewedIds.has(s.id) && s.updatedAt >= startOfToday.getTime();
          return {
            ...s,
            isNeedReview
          };
        });

        // Cập nhật số lượng đếm trên tab Cần review
        const totalNeedReview = enrichedSessions.filter(s => s.isNeedReview).length;
        const reviewBtn = document.getElementById('tabReviewBtn');
        if (reviewBtn) {
          reviewBtn.textContent = totalNeedReview > 0 
            ? (t('tabReview') + ' (' + totalNeedReview + ')') 
            : t('tabReview');
        }

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

        // Lọc theo Search Query hoặc Tab lọc
        if (query) {
          // Khi tìm kiếm: tự động tìm kiếm trên TOÀN BỘ lịch sử sessions (không bị giới hạn bởi tab hôm nay)
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
          } else if (currentFilter === 'active') {
            filtered = filtered.filter(s => s.status === 'need_accept' || s.status === 'running' || s.isNeedReview);
          } else if (currentFilter === 'review') {
            filtered = filtered.filter(s => s.isNeedReview);
          }
          // 'all': giữ nguyên toàn bộ sessions
        }

        const needAcceptList = filtered.filter(s => s.status === 'need_accept');
        const runningList = filtered.filter(s => s.status === 'running');
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
          if (currentFilter === 'review') {
            html = '<div style="text-align: center; color: #64748b; padding: 32px 16px;">' +
              '<div style="font-size: 24px; margin-bottom: 8px;">🎉</div>' +
              '<div style="font-weight: 600; color: #94a3b8;">' + t('noSessionsReviewTitle') + '</div>' +
              '<div style="font-size: 11.5px; opacity: 0.7; margin-top: 4px;">' + t('noSessionsReviewDesc') + '</div>' +
              '</div>';
          } else if (currentFilter === 'active') {
            html = '<div style="text-align: center; color: #64748b; padding: 24px;">' + t('noSessionsActive') + '</div>';
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

    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        saveState();
        renderSessions();
      });
    });

    // Event Delegation cho Content Container: xử lý click Card, Delete, Diff, Approve, Toggle Header, Review
    if (contentContainer) {
      contentContainer.addEventListener('click', (e) => {
        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-action');
        const id = actionEl.getAttribute('data-id');

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
            markSessionReviewed(id);
            openSession(id);
          }
          return;
        }

        if (action === 'approve') {
          e.stopPropagation();
          if (id) approveSession(id);
          return;
        }

        if (action === 'review-open') {
          e.stopPropagation();
          if (id) {
            markSessionReviewed(id);
            openSession(id);
          }
          return;
        }

        if (action === 'mark-reviewed') {
          e.stopPropagation();
          if (id) markSessionReviewed(id);
          return;
        }

        if (action === 'open') {
          if (id) {
            markSessionReviewed(id);
            openSession(id);
          }
          return;
        }
      });
    }

    window.addEventListener('message', event => {
      const message = event.data;
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