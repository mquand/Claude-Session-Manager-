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
    _view;
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
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                if (this._lastSessions.length > 0) {
                    this._view?.webview.postMessage({ type: 'updateSessions', sessions: this._lastSessions });
                }
                this.refresh();
            }
        });
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'ready': {
                    if (this._lastSessions.length > 0) {
                        this._view?.webview.postMessage({ type: 'updateSessions', sessions: this._lastSessions });
                    }
                    await this.refresh();
                    break;
                }
                case 'refresh': {
                    await this.refresh();
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
    async refresh() {
        const config = vscode.workspace.getConfiguration('claudeSessionManager');
        const customPath = config.get('storagePath');
        const sessions = await scanner_1.SessionScanner.scanSessions(customPath);
        this._lastSessions = sessions;
        const needAcceptCount = sessions.filter(s => s.status === 'need_accept').length;
        const runningCount = sessions.filter(s => s.status === 'running').length;
        if (this._view) {
            if (needAcceptCount > 0) {
                this._view.badge = { value: needAcceptCount, tooltip: `${needAcceptCount} task đang chờ duyệt` };
            }
            else {
                this._view.badge = undefined;
            }
            this._view.webview.postMessage({ type: 'updateSessions', sessions });
        }
        if (needAcceptCount > 0) {
            this._statusBarItem.text = `$(bell-dot) Claude: ${needAcceptCount} Chờ duyệt`;
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this._statusBarItem.tooltip = `Có ${needAcceptCount} task đang chờ bạn phê duyệt. Nhấp để mở.`;
        }
        else if (runningCount > 0) {
            this._statusBarItem.text = `$(sync~spin) Claude: ${runningCount} Đang chạy`;
            this._statusBarItem.backgroundColor = undefined;
            this._statusBarItem.tooltip = `${runningCount} task đang thực thi. Nhấp để mở.`;
        }
        else {
            this._statusBarItem.text = `$(sparkle) Claude: ${sessions.length} Tasks`;
            this._statusBarItem.backgroundColor = undefined;
            this._statusBarItem.tooltip = `Danh sách ${sessions.length} tasks. Nhấp để mở.`;
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
      min-height: 100vh;
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

    .filter-tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 10px;
    }

    .filter-btn {
      flex: 1;
      background: #1a1e26;
      color: #94a3b8;
      border: 1px solid #2d3340;
      border-radius: 4px;
      padding: 5px 4px;
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
    <input type="text" id="searchInput" class="search-input" placeholder="Tìm kiếm nội dung" />
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
    <button id="updateBtn" class="icon-tool-btn" title="Kiểm tra bản cập nhật mới (GitHub)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path>
      </svg>
    </button>
  </div>

  <!-- 3 Tab Lọc: Hôm nay, Đang hoạt động, Tất cả -->
  <div class="filter-tabs">
    <button class="filter-btn active" data-filter="today">Hôm nay</button>
    <button class="filter-btn" data-filter="active">Đang hoạt động</button>
    <button class="filter-btn" data-filter="all">Tất cả</button>
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
    const updateBtn = document.getElementById('updateBtn');
    const filterBtns = document.querySelectorAll('.filter-btn');

    // 2. Khôi phục State
    const savedState = vscode.getState() || {};
    let allSessions = savedState.sessions || [];
    let currentFilter = savedState.currentFilter || 'today';
    let sectionState = savedState.sectionState || {
      need_accept: true,
      running: true,
      done: true
    };

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

    function deleteSession(id, title, encodedPath) {
      const filePath = decodeURIComponent(encodedPath);
      vscode.postMessage({ type: 'deleteSession', id, title, filePath });
    }

    function toggleSection(key) {
      sectionState[key] = !sectionState[key];
      const currentState = vscode.getState() || {};
      currentState.sectionState = sectionState;
      vscode.setState(currentState);
      renderSessions();
    }

    function renderCard(s) {
      const dotClass = 'dot-' + s.status;
      const cardStatusClass = 'status-' + s.status;
      const needAcceptAction = s.status === 'need_accept' 
        ? '<div class="card-actions">' +
          '<button class="btn btn-secondary" onclick="event.stopPropagation(); openSession(\\'' + s.id + '\\')">Xem diff</button>' +
          '<button class="btn" onclick="event.stopPropagation(); approveSession(\\'' + s.id + '\\')">Duyệt & Chạy</button>' +
          '</div>'
        : '';

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

      return '<div class="session-card ' + cardStatusClass + '" onclick="openSession(\\'' + s.id + '\\')">' +
        '<div class="card-header">' +
          '<span class="status-dot ' + dotClass + '"></span>' +
          '<div style="flex: 1; min-width: 0;">' +
            '<div class="meta-row">' +
              '<span class="repo-badge">' + escapeHtml(s.repo) + '</span>' +
              (s.issueId ? '<span class="issue-badge">' + escapeHtml(s.issueId) + '</span>' : '') +
              '<span class="title-text" title="' + escapeHtml(s.title) + '">' + escapeHtml(s.title) + '</span>' +
              '<button class="card-delete-btn" title="Xoá phiên hội thoại" data-id="' + s.id + '" data-title="' + escapeHtml(s.title) + '" data-path="' + encodeURIComponent(s.filePath) + '" onclick="event.stopPropagation(); deleteSession(this.getAttribute(\'data-id\'), this.getAttribute(\'data-title\'), this.getAttribute(\'data-path\'))">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
                '</svg>' +
              '</button>' +
            '</div>' +
            (s.lastUserPrompt ? '<div class="user-prompt">' + escapeHtml(s.lastUserPrompt) + '</div>' : '') +
            needAcceptAction +
            footerMetaRow +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function renderSessions() {
      try {
        const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const filtered = allSessions.filter(s => {
          if (query) {
            const match = (
              (s.title && s.title.toLowerCase().includes(query)) ||
              (s.issueId && s.issueId.toLowerCase().includes(query)) ||
              (s.repo && s.repo.toLowerCase().includes(query)) ||
              (s.branch && s.branch.toLowerCase().includes(query)) ||
              (s.lastUserPrompt && s.lastUserPrompt.toLowerCase().includes(query)) ||
              (s.lastAssistantResponse && s.lastAssistantResponse.toLowerCase().includes(query))
            );
            if (!match) return false;
          }

          if (currentFilter === 'today') {
            return s.updatedAt >= startOfToday.getTime();
          }
          if (currentFilter === 'active') {
            return s.status === 'need_accept' || s.status === 'running';
          }
          if (currentFilter === 'all') {
            return true;
          }
          return true;
        });

        const needAcceptList = filtered.filter(s => s.status === 'need_accept');
        const runningList = filtered.filter(s => s.status === 'running');
        const doneList = filtered.filter(s => s.status === 'done');

        let html = '';

        if (needAcceptList.length > 0) {
          const isOpen = query ? true : sectionState.need_accept;
          html += '<div class="section-header" onclick="toggleSection(\'need_accept\')">' +
            '<span class="chevron ' + (isOpen ? 'open' : 'closed') + '">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
            '</span>' +
            '<span style="color: #f59e0b; font-weight: 700;">CHỜ DUYỆT</span>' +
            '<span class="count-badge">' + needAcceptList.length + '</span>' +
          '</div>' +
          '<div class="section-content ' + (isOpen ? '' : 'collapsed') + '">';
          needAcceptList.forEach(s => html += renderCard(s));
          html += '</div>';
        }

        if (runningList.length > 0) {
          const isOpen = query ? true : sectionState.running;
          html += '<div class="section-header" onclick="toggleSection(\'running\')">' +
            '<span class="chevron ' + (isOpen ? 'open' : 'closed') + '">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
            '</span>' +
            '<span style="color: #3b82f6; font-weight: 700;">ĐANG CHẠY</span>' +
            '<span class="count-badge">' + runningList.length + '</span>' +
          '</div>' +
          '<div class="section-content ' + (isOpen ? '' : 'collapsed') + '">';
          runningList.forEach(s => html += renderCard(s));
          html += '</div>';
        }

        if (doneList.length > 0) {
          const isOpen = query ? true : sectionState.done;
          html += '<div class="section-header" onclick="toggleSection(\'done\')">' +
            '<span class="chevron ' + (isOpen ? 'open' : 'closed') + '">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
            '</span>' +
            '<span style="color: #10b981; font-weight: 700;">ĐÃ HOÀN THÀNH</span>' +
            '<span class="count-badge">' + doneList.length + '</span>' +
          '</div>' +
          '<div class="section-content ' + (isOpen ? '' : 'collapsed') + '">';
          doneList.forEach(s => html += renderCard(s));
          html += '</div>';
        }

        if (filtered.length === 0) {
          if (allSessions.length === 0) {
            html = '<div style="text-align: center; color: #64748b; padding: 24px;">Chưa có phiên làm việc nào được ghi nhận.</div>';
          } else if (currentFilter === 'today') {
            html = '<div style="text-align: center; color: #64748b; padding: 24px;">Hôm nay chưa có phiên mới.<br><span style="font-size: 11.5px; opacity: 0.8; margin-top: 4px; display: inline-block;">Bấm tab <b>"Tất cả"</b> để xem lại các phiên trước đó.</span></div>';
          } else {
            html = '<div style="text-align: center; color: #64748b; padding: 24px;">Không tìm thấy phiên làm việc nào phù hợp.</div>';
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

    if (updateBtn) {
      updateBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'checkForUpdates' });
      });
    }

    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        const state = vscode.getState() || {};
        state.currentFilter = currentFilter;
        vscode.setState(state);
        renderSessions();
      });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'updateSessions') {
        allSessions = message.sessions || [];
        const state = vscode.getState() || {};
        state.sessions = allSessions;
        vscode.setState(state);
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