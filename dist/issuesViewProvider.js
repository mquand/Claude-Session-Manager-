"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IssuesViewProvider = void 0;
const vscode = require("vscode");
const scanner_1 = require("./scanner");
class IssuesViewProvider {
    _extensionUri;
    static viewType = 'claudeSessionManager.issuesView';
    _view;
    _watchers = [];
    _refreshTimer;
    _debounceTimer;
    _statusBarItem;
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
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
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'refresh': {
                    await this.refresh();
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
      padding: 8px;
      font-size: 12.5px;
      box-sizing: border-box;
    }

    .search-input {
      width: 100%;
      background: var(--vscode-input-background, #1a1e26);
      color: var(--vscode-input-foreground, #fff);
      border: 1px solid var(--vscode-input-border, #2d3340);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 12px;
      outline: none;
      margin-bottom: 8px;
      box-sizing: border-box;
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
      padding: 5px 8px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s ease;
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

    .section-title {
      font-weight: 700;
      font-size: 10.5px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 14px 0 6px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .count-badge {
      font-size: 10.5px;
      font-weight: normal;
      color: #cbd5e1;
    }

    .session-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 9px 11px;
      margin-bottom: 7px;
      cursor: pointer;
      transition: all 0.15s ease;
      border-left: 3.5px solid var(--card-border);
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
      gap: 8px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-top: 4px;
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
      gap: 6px;
      font-size: 12px;
      margin-bottom: 3px;
      overflow: hidden;
      white-space: nowrap;
    }

    .repo-badge {
      background: #252b38;
      color: #93c5fd;
      padding: 1.5px 5px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      font-family: monospace;
      flex-shrink: 0;
    }

    .issue-badge {
      background: #1e3a5f;
      color: #60a5fa;
      padding: 1.5px 5px;
      border-radius: 3px;
      font-size: 11px;
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

    .user-prompt {
      color: #94a3b8;
      font-size: 11px;
      margin: 3px 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .assistant-response {
      background: rgba(0, 0, 0, 0.25);
      border-radius: 4px;
      padding: 5px 8px;
      margin-top: 5px;
      font-size: 11.5px;
      color: #cbd5e1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border-left: 2px solid #3b82f6;
    }

    /* Clean Footer - Không rườm rà icon rác */
    .footer-meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      font-size: 11px;
      color: #7d8b9f;
      margin-top: 6px;
      line-height: 1;
    }

    .footer-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 3px;
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
  <input type="text" id="searchInput" class="search-input" placeholder="Tìm kiếm Issue (#xxxx), nội dung..." />

  <!-- 2 Tab Tối Giản -->
  <div class="filter-tabs">
    <button class="filter-btn active" data-filter="today">Hôm nay</button>
    <button class="filter-btn" data-filter="active">Đang hoạt động / Chờ duyệt</button>
  </div>

  <div id="contentContainer">
    <div style="text-align: center; color: #64748b; padding: 20px;">Đang tải danh sách sessions...</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let allSessions = [];
    let currentFilter = 'today';

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'updateSessions') {
        allSessions = message.sessions;
        renderSessions();
      }
    });

    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', () => {
      renderSessions();
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        renderSessions();
      });
    });

    function renderSessions() {
      const query = searchInput.value.toLowerCase().trim();
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
        return true;
      });

      const needAcceptList = filtered.filter(s => s.status === 'need_accept');
      const runningList = filtered.filter(s => s.status === 'running');
      const doneList = filtered.filter(s => s.status === 'done');

      let html = '';

      if (needAcceptList.length > 0) {
        html += '<div class="section-title" style="color: #f59e0b;">CHỜ DUYỆT <span class="count-badge">' + needAcceptList.length + '</span></div>';
        needAcceptList.forEach(s => html += renderCard(s));
      }

      if (runningList.length > 0) {
        html += '<div class="section-title" style="color: #3b82f6;">ĐANG CHẠY <span class="count-badge">' + runningList.length + '</span></div>';
        runningList.forEach(s => html += renderCard(s));
      }

      if (doneList.length > 0) {
        html += '<div class="section-title" style="color: #10b981;">ĐÃ HOÀN THÀNH <span class="count-badge">' + doneList.length + '</span></div>';
        doneList.forEach(s => html += renderCard(s));
      }

      if (filtered.length === 0) {
        html = '<div style="text-align: center; color: #64748b; padding: 24px;">Không tìm thấy session nào.</div>';
      }

      document.getElementById('contentContainer').innerHTML = html;
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

      // Footer clean, bỏ các emoji dư thừa, căn chỉnh gọn gàng chuyên nghiệp
      const footerMetaRow = '<div class="footer-meta-row">' +
        '<span class="footer-meta-item">' + escapeHtml(s.statusMessage) + '</span>' +
        '<span>•</span>' +
        '<span class="footer-meta-item">' + escapeHtml(s.source) + '</span>' +
        '<span>•</span>' +
        '<span class="footer-meta-item">' + escapeHtml(s.modelName) + '</span>' +
        '<span>•</span>' +
        '<span class="footer-meta-item">' + escapeHtml(s.inputTokensFormatted) + ' · ' + escapeHtml(s.outputTokensFormatted) + '</span>' +
        (s.costUSD ? '<span>•</span><span class="footer-meta-item cost">' + escapeHtml(s.costUSD) + '</span>' : '') +
        '<span>•</span>' +
        '<span class="footer-meta-item">' + s.turnCount + ' turns</span>' +
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
            '</div>' +
            (s.lastUserPrompt ? '<div class="user-prompt">' + escapeHtml(s.lastUserPrompt) + '</div>' : '') +
            needAcceptAction +
            footerMetaRow +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function escapeHtml(text) {
      if (!text) return '';
      return text
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
  </script>
</body>
</html>`;
    }
}
exports.IssuesViewProvider = IssuesViewProvider;
//# sourceMappingURL=issuesViewProvider.js.map