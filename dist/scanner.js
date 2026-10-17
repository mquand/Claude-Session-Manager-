"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionScanner = void 0;
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const child_process = require("child_process");
class SessionScanner {
    static CACHE_VERSION = 6;
    static sessionCache = new Map();
    static deleteSession(sessionId, filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            const projectDir = path.dirname(filePath);
            const subDir = path.join(projectDir, sessionId);
            if (fs.existsSync(subDir)) {
                fs.rmSync(subDir, { recursive: true, force: true });
            }
            this.sessionCache.delete(sessionId);
            return true;
        }
        catch (err) {
            console.error('Lỗi khi xoá session:', err);
            return false;
        }
    }
    static resolveHomePath(p) {
        if (p.startsWith('~/') || p === '~') {
            return path.join(os.homedir(), p.slice(1));
        }
        return p;
    }
    static getWatchedDirectories(customPath) {
        const claudeDir = path.join(os.homedir(), '.claude');
        const defaultClaudeProjects = path.join(claudeDir, 'projects');
        const sessionsDir = path.join(claudeDir, 'sessions');
        const dirs = [
            customPath ? this.resolveHomePath(customPath) : null,
            defaultClaudeProjects,
            sessionsDir
        ].filter((dir) => Boolean(dir && fs.existsSync(dir)));
        const resultDirs = [];
        for (const d of dirs) {
            resultDirs.push(d);
            try {
                const subEntries = fs.readdirSync(d, { withFileTypes: true });
                for (const entry of subEntries) {
                    if (entry.isDirectory() && !entry.name.toLowerCase().includes('observer')) {
                        resultDirs.push(path.join(d, entry.name));
                    }
                }
            }
            catch { }
        }
        return resultDirs;
    }
    // TIÊU CHÍ ĐANG CHẠY: Kiểm tra chính xác xem Process OS của session đó có đang chạy thật sự không
    static getActiveSessionsMap() {
        const activeMap = new Map();
        const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
        if (!fs.existsSync(sessionsDir))
            return activeMap;
        try {
            const files = fs.readdirSync(sessionsDir);
            for (const f of files) {
                if (f.endsWith('.json')) {
                    try {
                        const content = fs.readFileSync(path.join(sessionsDir, f), 'utf8');
                        const data = JSON.parse(content);
                        if (data.sessionId && data.pid) {
                            let isAlive = false;
                            try {
                                process.kill(data.pid, 0);
                                isAlive = true;
                            }
                            catch {
                                isAlive = false;
                            }
                            if (isAlive) {
                                activeMap.set(data.sessionId, {
                                    status: data.status || 'running',
                                    pid: data.pid
                                });
                            }
                        }
                    }
                    catch { }
                }
            }
        }
        catch { }
        return activeMap;
    }
    static getHiddenSessionIds(dbPathHint) {
        const hiddenSet = new Set();
        const candidates = [];
        if (dbPathHint && fs.existsSync(dbPathHint)) {
            candidates.push(dbPathHint);
        }
        const home = os.homedir();
        if (process.platform === 'darwin') {
            candidates.push(path.join(home, 'Library/Application Support/Code/User/globalStorage/state.vscdb'), path.join(home, 'Library/Application Support/Code - Insiders/User/globalStorage/state.vscdb'), path.join(home, 'Library/Application Support/Cursor/User/globalStorage/state.vscdb'), path.join(home, 'Library/Application Support/VSCodium/User/globalStorage/state.vscdb'));
        }
        else if (process.platform === 'win32') {
            const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
            candidates.push(path.join(appData, 'Code/User/globalStorage/state.vscdb'), path.join(appData, 'Code - Insiders/User/globalStorage/state.vscdb'), path.join(appData, 'Cursor/User/globalStorage/state.vscdb'), path.join(appData, 'VSCodium/User/globalStorage/state.vscdb'));
        }
        else {
            candidates.push(path.join(home, '.config/Code/User/globalStorage/state.vscdb'), path.join(home, '.config/Code - Insiders/User/globalStorage/state.vscdb'), path.join(home, '.config/Cursor/User/globalStorage/state.vscdb'), path.join(home, '.config/VSCodium/User/globalStorage/state.vscdb'));
        }
        for (const dbPath of candidates) {
            if (!fs.existsSync(dbPath))
                continue;
            // 1. Thử dùng sqlite3 CLI (nhanh và chính xác 100%, có sẵn trên macOS và hầu hết Linux)
            try {
                const stdout = child_process.execSync(`sqlite3 "${dbPath}" "SELECT value FROM ItemTable WHERE key = 'Anthropic.claude-code';"`, { timeout: 2000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                if (stdout && stdout.trim()) {
                    const parsed = JSON.parse(stdout.trim());
                    if (Array.isArray(parsed.hiddenSessionIds)) {
                        for (const id of parsed.hiddenSessionIds) {
                            if (typeof id === 'string')
                                hiddenSet.add(id);
                        }
                        if (hiddenSet.size > 0)
                            return hiddenSet;
                    }
                }
            }
            catch { }
            // 2. Dự phòng: Đọc trực tiếp file sqlite nếu không có công cụ sqlite3 CLI
            try {
                const buf = fs.readFileSync(dbPath);
                const marker = Buffer.from('hiddenSessionIds');
                let searchStart = 0;
                while (searchStart < buf.length) {
                    const idx = buf.indexOf(marker, searchStart);
                    if (idx === -1)
                        break;
                    // Quét khối dữ liệu xung quanh marker để tìm danh sách UUIDs
                    const chunk = buf.subarray(idx, Math.min(idx + 131072, buf.length)).toString('utf8');
                    const uuidRegex = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi;
                    let m;
                    let foundCount = 0;
                    while ((m = uuidRegex.exec(chunk)) !== null) {
                        hiddenSet.add(m[0]);
                        foundCount++;
                    }
                    if (foundCount > 0) {
                        break;
                    }
                    searchStart = idx + marker.length;
                }
                if (hiddenSet.size > 0)
                    return hiddenSet;
            }
            catch { }
        }
        return hiddenSet;
    }
    static async scanSessions(customPath, options) {
        const defaultClaudeProjects = customPath ? this.resolveHomePath(customPath) : path.join(os.homedir(), '.claude', 'projects');
        if (!fs.existsSync(defaultClaudeProjects)) {
            return [];
        }
        const hiddenSessionIds = options?.hiddenSessionIds ?? this.getHiddenSessionIds(options?.dbPathHint);
        const activeMap = this.getActiveSessionsMap();
        const currentFiles = new Map();
        try {
            const projectDirs = fs.readdirSync(defaultClaudeProjects, { withFileTypes: true });
            for (const pDir of projectDirs) {
                if (!pDir.isDirectory())
                    continue;
                if (pDir.name.toLowerCase().includes('observer'))
                    continue;
                const projectPath = path.join(defaultClaudeProjects, pDir.name);
                try {
                    const files = fs.readdirSync(projectPath, { withFileTypes: true });
                    for (const file of files) {
                        if (file.isFile() && file.name.endsWith('.jsonl') && !file.name.toLowerCase().includes('observer')) {
                            const fullPath = path.join(projectPath, file.name);
                            const sessionId = file.name.replace('.jsonl', '');
                            if (hiddenSessionIds.has(sessionId)) {
                                continue;
                            }
                            const stat = fs.statSync(fullPath);
                            currentFiles.set(sessionId, {
                                filePath: fullPath,
                                sessionId,
                                mtimeMs: stat.mtimeMs,
                                dirPath: projectPath
                            });
                        }
                    }
                }
                catch { }
            }
        }
        catch (err) {
            console.error('Lỗi duyệt projects:', err);
        }
        // Xoá session đã bị xoá, đã bị archive trên giao diện hoặc là observer session rác
        for (const [cachedId, cachedItem] of this.sessionCache) {
            if (!currentFiles.has(cachedId) ||
                hiddenSessionIds.has(cachedId) ||
                (cachedItem.session.repo && cachedItem.session.repo.toLowerCase().includes('observer')) ||
                (cachedItem.session.modelName && cachedItem.session.modelName.toLowerCase().includes('synthetic'))) {
                this.sessionCache.delete(cachedId);
            }
        }
        const sortedCandidates = Array.from(currentFiles.values()).sort((a, b) => b.mtimeMs - a.mtimeMs);
        const topCandidates = sortedCandidates.slice(0, 50);
        const sessions = [];
        for (const item of topCandidates) {
            const activeInfo = activeMap.get(item.sessionId);
            const cached = this.sessionCache.get(item.sessionId);
            if (cached &&
                cached.cacheVersion === this.CACHE_VERSION &&
                cached.mtimeMs === item.mtimeMs &&
                !activeInfo &&
                cached.session.status === 'done' &&
                cached.session.branch &&
                cached.session.branch !== 'develop' &&
                cached.session.totalTokens !== undefined) {
                const diffMinutes = Math.floor((Date.now() - item.mtimeMs) / (60 * 1000));
                if (diffMinutes < 1) {
                    cached.session.statusMessage = 'vừa xong';
                }
                else if (diffMinutes < 60) {
                    cached.session.statusMessage = `${diffMinutes} phút trước`;
                }
                else if (diffMinutes < 1440) {
                    cached.session.statusMessage = `${Math.floor(diffMinutes / 60)} giờ trước`;
                }
                else {
                    cached.session.statusMessage = `${Math.floor(diffMinutes / 1440)} ngày trước`;
                }
                sessions.push(cached.session);
                continue;
            }
            const parsed = await this.fastParseSession(item.filePath, item.sessionId, item.mtimeMs, item.dirPath, activeInfo, options);
            if (parsed) {
                this.sessionCache.set(item.sessionId, { session: parsed, mtimeMs: item.mtimeMs, cacheVersion: this.CACHE_VERSION });
                sessions.push(parsed);
            }
        }
        return sessions.sort((a, b) => {
            const score = (s) => (s.status === 'running' ? 4 :
                s.status === 'need_accept' ? 3 :
                    s.status === 'failed' ? 2 : 1);
            if (score(b) !== score(a)) {
                return score(b) - score(a);
            }
            return b.updatedAt - a.updatedAt;
        });
    }
    static cleanPromptText(text) {
        return text
            .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
            .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
            .replace(/<[^>]+>/g, '')
            .trim();
    }
    static formatTokens(tokens) {
        if (tokens >= 1_000_000_000)
            return (tokens / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
        if (tokens >= 1_000_000)
            return (tokens / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (tokens >= 1_000)
            return (tokens / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
        return tokens.toLocaleString();
    }
    static formatModelName(rawModel) {
        if (!rawModel)
            return 'Opus 5.5';
        if (rawModel.includes('opus'))
            return 'Opus 5.5';
        if (rawModel.includes('sonnet'))
            return 'Sonnet 3.7';
        if (rawModel.includes('haiku'))
            return 'Haiku 3.5';
        if (rawModel.includes('flash'))
            return 'Gemini Flash';
        return rawModel.replace('claude-', '').replace('-5-5', ' 5.5');
    }
    static getGitInfoFromDir(dirPath) {
        try {
            if (!dirPath || !fs.existsSync(dirPath))
                return null;
            const gitPath = path.join(dirPath, '.git');
            if (!fs.existsSync(gitPath))
                return null;
            const stat = fs.statSync(gitPath);
            if (stat.isFile()) {
                // Git Worktree! (.git là file chứa gitdir)
                const content = fs.readFileSync(gitPath, 'utf8');
                const match = content.match(/gitdir:\s*(.*)/i);
                if (match) {
                    const gitDir = match[1].trim();
                    const headPath = path.isAbsolute(gitDir) ? path.join(gitDir, 'HEAD') : path.resolve(dirPath, gitDir, 'HEAD');
                    let branch = '';
                    if (fs.existsSync(headPath)) {
                        const headContent = fs.readFileSync(headPath, 'utf8').trim();
                        branch = headContent.replace(/^ref:\s*refs\/heads\//, '').trim();
                    }
                    const parts = gitDir.split(path.sep);
                    const gitIdx = parts.indexOf('.git');
                    const mainRepo = gitIdx > 0 ? parts[gitIdx - 1] : undefined;
                    return { branch, isWorktree: true, mainRepo };
                }
            }
            else if (stat.isDirectory()) {
                // Regular Git Repo! (.git là thư mục)
                const headPath = path.join(gitPath, 'HEAD');
                if (fs.existsSync(headPath)) {
                    const headContent = fs.readFileSync(headPath, 'utf8').trim();
                    const branch = headContent.replace(/^ref:\s*refs\/heads\//, '').trim();
                    return { branch, isWorktree: false };
                }
            }
        }
        catch { }
        return null;
    }
    static decodeProjectDir(projectDirName, workspaceFolders) {
        if (!workspaceFolders || workspaceFolders.length === 0)
            return null;
        const baseName = path.basename(projectDirName);
        for (const wf of workspaceFolders) {
            const encodedWf = wf.replace(/[\\/]/g, '-');
            if (baseName.startsWith(encodedWf)) {
                const remainder = baseName.slice(encodedWf.length).replace(/^-/, '');
                if (!remainder)
                    return wf;
                const candidate = path.join(wf, remainder);
                if (fs.existsSync(candidate))
                    return candidate;
            }
        }
        return null;
    }
    static getWorktreesFromRepo(repoPath) {
        try {
            const gitPath = path.join(repoPath, '.git');
            if (!fs.existsSync(gitPath))
                return [];
            const stdout = child_process.execSync('git worktree list --porcelain', { cwd: repoPath, encoding: 'utf8', timeout: 3000 });
            const worktrees = [];
            let current = {};
            const pushIfValid = (item) => {
                if (item.path && item.branch && !item.isPrunable && fs.existsSync(item.path)) {
                    worktrees.push({ path: item.path, branch: item.branch, head: item.head });
                }
            };
            for (const line of stdout.split('\n')) {
                const trimmed = line.trim();
                if (trimmed.startsWith('worktree ')) {
                    pushIfValid(current);
                    current = { path: trimmed.replace('worktree ', '').trim() };
                }
                else if (trimmed.startsWith('branch ')) {
                    current.branch = trimmed.replace('branch refs/heads/', '').trim();
                }
                else if (trimmed.startsWith('HEAD ')) {
                    current.head = trimmed.replace('HEAD ', '').trim();
                }
                else if (trimmed.startsWith('prunable')) {
                    current.isPrunable = true;
                }
                else if (trimmed === '') {
                    pushIfValid(current);
                    current = {};
                }
            }
            pushIfValid(current);
            return worktrees;
        }
        catch {
            return [];
        }
    }
    static pruneWorktrees(workspaceFolders) {
        let prunedCount = 0;
        if (!workspaceFolders || workspaceFolders.length === 0)
            return 0;
        for (const wf of workspaceFolders) {
            if (!fs.existsSync(wf))
                continue;
            try {
                const gitDir = path.join(wf, '.git');
                if (fs.existsSync(gitDir)) {
                    child_process.execSync('git worktree prune', { cwd: wf, encoding: 'utf8', timeout: 5000 });
                    prunedCount++;
                }
                const entries = fs.readdirSync(wf, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        const sub = path.join(wf, entry.name);
                        const subGit = path.join(sub, '.git');
                        if (fs.existsSync(subGit) && fs.statSync(subGit).isDirectory()) {
                            child_process.execSync('git worktree prune', { cwd: sub, encoding: 'utf8', timeout: 5000 });
                            prunedCount++;
                        }
                    }
                }
            }
            catch { }
        }
        return prunedCount;
    }
    static discoverWorkspaceWorktrees(workspaceFolders) {
        if (!workspaceFolders || workspaceFolders.length === 0)
            return [];
        const results = [];
        const seenPaths = new Set();
        for (const wf of workspaceFolders) {
            if (!fs.existsSync(wf))
                continue;
            // 1. Kiểm tra chính thư mục wf
            const wfGit = this.getGitInfoFromDir(wf);
            if (wfGit) {
                const repoName = wfGit.mainRepo || path.basename(wf);
                const list = this.getWorktreesFromRepo(wf);
                for (const item of list) {
                    if (!seenPaths.has(item.path) && fs.existsSync(item.path)) {
                        seenPaths.add(item.path);
                        results.push({ path: item.path, branch: item.branch, repo: repoName });
                    }
                }
            }
            // 2. Quét các thư mục con cấp 1 của wf (ví dụ: project-a, project-b, feature-worktree)
            try {
                const entries = fs.readdirSync(wf, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory())
                        continue;
                    if (entry.name.startsWith('.') || entry.name === 'node_modules')
                        continue;
                    const subPath = path.join(wf, entry.name);
                    if (seenPaths.has(subPath))
                        continue;
                    const gitInfo = this.getGitInfoFromDir(subPath);
                    if (gitInfo) {
                        const repoName = gitInfo.mainRepo || (gitInfo.isWorktree ? undefined : entry.name);
                        seenPaths.add(subPath);
                        if (gitInfo.branch) {
                            results.push({ path: subPath, branch: gitInfo.branch, repo: repoName || entry.name });
                        }
                        if (!gitInfo.isWorktree) {
                            const list = this.getWorktreesFromRepo(subPath);
                            for (const item of list) {
                                if (!seenPaths.has(item.path) && fs.existsSync(item.path)) {
                                    seenPaths.add(item.path);
                                    results.push({ path: item.path, branch: item.branch, repo: repoName || entry.name });
                                }
                            }
                        }
                    }
                }
            }
            catch { }
        }
        return results;
    }
    static extractErrorCode(item) {
        if (!item)
            return null;
        // 1. Direct status/code property in error object
        const rawCode = item.status || item.statusCode || item.code ||
            item.error?.status || item.error?.statusCode || item.error?.code ||
            item.message?.error?.status || item.message?.error?.statusCode || item.message?.error?.code;
        if (typeof rawCode === 'number' && rawCode >= 400 && rawCode <= 599) {
            return `Lỗi ${rawCode}`;
        }
        if (typeof rawCode === 'string') {
            const match = rawCode.match(/\b(4\d{2}|5\d{2})\b/);
            if (match) {
                return `Lỗi ${match[1]}`;
            }
        }
        // 2. Stop reason code (ví dụ khi bị chạm ngưỡng max output tokens)
        if (item.message?.stop_reason === 'max_tokens') {
            return 'Hết token';
        }
        // 3. Chuỗi text trong item.error hoặc assistant - CHỈ bắt theo mã code, KHÔNG bắt nội dung câu chữ
        let text = '';
        if (item.type === 'error' || item.isError) {
            text = typeof item.error === 'string'
                ? item.error
                : (item.error?.message || item.message || '');
        }
        else if (item.message?.error) {
            const errObj = item.message.error;
            text = typeof errObj === 'string' ? errObj : (errObj.message || '');
        }
        else if (item.type === 'assistant') {
            const content = item.message?.content;
            if (Array.isArray(content)) {
                for (const part of content) {
                    if (part.type === 'text' && typeof part.text === 'string') {
                        text += part.text + '\n';
                    }
                }
            }
            else if (typeof content === 'string') {
                text = content;
            }
        }
        if (text) {
            const trimmed = text.trim();
            // CHỈ BẮT CODE: "• API Error: 503", "API Error: 429", "HTTP 500", "status: 502", etc.
            const codeMatch = trimmed.match(/(?:•\s*)?API Error:\s*(\d{3})/i) ||
                trimmed.match(/\bHTTP(?:\s*status)?[:\s]+(\d{3})\b/i) ||
                trimmed.match(/\bstatus(?:\s*code)?[:=]\s*(\d{3})\b/i);
            if (codeMatch) {
                return `Lỗi ${codeMatch[1]}`;
            }
        }
        return null;
    }
    static async fastParseSession(filePath, sessionId, mtimeMs, projectDir, activeInfo, options) {
        try {
            let title = '';
            const customTitlePath = path.join(projectDir, sessionId, 'custom-title.json');
            if (fs.existsSync(customTitlePath)) {
                try {
                    const ct = JSON.parse(fs.readFileSync(customTitlePath, 'utf8'));
                    if (ct.customTitle) {
                        title = ct.customTitle;
                    }
                }
                catch { }
            }
            let meaningfulFirstPrompt = '';
            let meaningfulLastPrompt = '';
            let branch = '';
            let repo = '';
            let lastCwd = '';
            let entrypoint = 'claude-vscode';
            let lastTurnHadToolUse = false;
            let lastErrorDetail = '';
            let totalCostUSD = 0;
            let modelName = 'Opus 5.5';
            let hasCostState = false;
            let costStateInputTokens = 0;
            let costStateOutputTokens = 0;
            let assistantInputTokens = 0;
            let assistantOutputTokens = 0;
            let turnCount = 0;
            let isWorktree = false;
            const fileStream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity
            });
            for await (const line of rl) {
                if (!line.trim())
                    continue;
                try {
                    const item = JSON.parse(line);
                    if (!title && item.type === 'ai-title' && item.aiTitle) {
                        title = item.aiTitle;
                    }
                    if (item.gitBranch && item.gitBranch !== 'HEAD') {
                        branch = item.gitBranch;
                    }
                    if (item.entrypoint) {
                        entrypoint = item.entrypoint;
                    }
                    if (item.cwd) {
                        lastCwd = item.cwd;
                        if (options?.workspaceFolders) {
                            for (const wf of options.workspaceFolders) {
                                if (item.cwd === wf || item.cwd.startsWith(wf + path.sep)) {
                                    repo = path.basename(wf);
                                    break;
                                }
                            }
                        }
                        const gitInfo = this.getGitInfoFromDir(item.cwd);
                        if (gitInfo) {
                            if (gitInfo.branch && gitInfo.branch !== 'HEAD') {
                                branch = gitInfo.branch;
                            }
                            if (gitInfo.isWorktree)
                                isWorktree = true;
                            if (gitInfo.mainRepo)
                                repo = gitInfo.mainRepo;
                        }
                        if (!repo) {
                            const base = path.basename(item.cwd);
                            const genericDirs = ['workspace', 'documents', 'projects', 'home', 'users'];
                            if (base && !genericDirs.includes(base.toLowerCase())) {
                                repo = base;
                            }
                        }
                    }
                    if (item.type === 'cost-state') {
                        if (item.totalCostUSD !== undefined)
                            totalCostUSD = item.totalCostUSD;
                        if (item.modelUsage && typeof item.modelUsage === 'object') {
                            hasCostState = true;
                            let sumIn = 0;
                            let sumOut = 0;
                            for (const [mName, usage] of Object.entries(item.modelUsage)) {
                                if (mName)
                                    modelName = this.formatModelName(mName);
                                sumIn += (usage.inputTokens || 0) + (usage.cacheReadInputTokens || 0) + (usage.cacheCreationInputTokens || 0);
                                sumOut += (usage.outputTokens || 0);
                            }
                            costStateInputTokens = sumIn;
                            costStateOutputTokens = sumOut;
                        }
                    }
                    if (item.type === 'user' && item.message?.content) {
                        turnCount++;
                        lastTurnHadToolUse = false;
                        lastErrorDetail = '';
                        const content = item.message.content;
                        let fullText = '';
                        if (Array.isArray(content)) {
                            for (const part of content) {
                                if (part.type === 'text')
                                    fullText += part.text + '\n';
                            }
                        }
                        else if (typeof content === 'string') {
                            fullText = content;
                        }
                        const cleaned = this.cleanPromptText(fullText);
                        if (cleaned) {
                            turnCount++;
                            if (!meaningfulFirstPrompt)
                                meaningfulFirstPrompt = cleaned;
                            meaningfulLastPrompt = cleaned;
                        }
                        lastTurnHadToolUse = false;
                    }
                    else if (item.type === 'last-prompt' && item.lastPrompt) {
                        const cleaned = this.cleanPromptText(item.lastPrompt);
                        if (cleaned) {
                            if (!meaningfulFirstPrompt)
                                meaningfulFirstPrompt = cleaned;
                            meaningfulLastPrompt = cleaned;
                        }
                    }
                    if (item.type === 'assistant' && item.message?.content) {
                        if (item.message.model) {
                            modelName = this.formatModelName(item.message.model);
                        }
                        if (item.message.usage) {
                            const u = item.message.usage;
                            assistantInputTokens += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
                            assistantOutputTokens += (u.output_tokens || 0);
                        }
                        const content = item.message.content;
                        if (Array.isArray(content)) {
                            let hasTool = false;
                            for (const part of content) {
                                if (part.type === 'tool_use') {
                                    hasTool = true;
                                    if (part.input) {
                                        const candidatePath = part.input.path || part.input.file_path || part.input.filePath || part.input.cwd;
                                        if (typeof candidatePath === 'string' && candidatePath) {
                                            if (options?.workspaceFolders) {
                                                for (const wf of options.workspaceFolders) {
                                                    const wfName = path.basename(wf);
                                                    if (candidatePath.includes(wf) || candidatePath.includes(path.sep + wfName + path.sep)) {
                                                        repo = wfName;
                                                        break;
                                                    }
                                                }
                                            }
                                            if (!repo && lastCwd && fs.existsSync(lastCwd)) {
                                                try {
                                                    const entries = fs.readdirSync(lastCwd, { withFileTypes: true });
                                                    for (const entry of entries) {
                                                        if (entry.isDirectory() && !entry.name.startsWith('.')) {
                                                            if (candidatePath.includes(entry.name)) {
                                                                if (fs.existsSync(path.join(lastCwd, entry.name, '.git'))) {
                                                                    repo = entry.name;
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                catch { }
                                            }
                                        }
                                    }
                                }
                            }
                            lastTurnHadToolUse = hasTool;
                        }
                        else {
                            lastTurnHadToolUse = false;
                        }
                    }
                    const detectedErr = SessionScanner.extractErrorCode(item);
                    if (detectedErr) {
                        lastErrorDetail = detectedErr;
                        lastTurnHadToolUse = false;
                    }
                    else if (item.type === 'assistant' && !item.message?.error) {
                        const content = item.message?.content;
                        const hasContent = Array.isArray(content) ? content.length > 0 : !!content;
                        if (hasContent) {
                            lastErrorDetail = '';
                        }
                    }
                }
                catch { }
            }
            if (!repo) {
                const searchContext = (title + ' ' + (meaningfulFirstPrompt || '')).toLowerCase();
                if (options?.workspaceFolders) {
                    for (const wf of options.workspaceFolders) {
                        const name = path.basename(wf);
                        if (searchContext.includes(name.toLowerCase())) {
                            repo = name;
                            break;
                        }
                    }
                }
                if (!repo && lastCwd && fs.existsSync(lastCwd)) {
                    try {
                        const entries = fs.readdirSync(lastCwd, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                                if (fs.existsSync(path.join(lastCwd, entry.name, '.git'))) {
                                    if (searchContext.includes(entry.name.toLowerCase())) {
                                        repo = entry.name;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    catch { }
                }
                if (!repo) {
                    if (options?.defaultRepo) {
                        repo = options.defaultRepo;
                    }
                    else if (options?.workspaceFolders && options.workspaceFolders.length > 0) {
                        repo = path.basename(options.workspaceFolders[0]);
                    }
                    else if (lastCwd) {
                        repo = path.basename(lastCwd);
                    }
                    else {
                        repo = '';
                    }
                }
            }
            // Title tinh gọn: Lấy từ aiTitle hoặc prompt đầu tiên
            if (!title) {
                title = meaningfulFirstPrompt ? meaningfulFirstPrompt.split('\n')[0] : `Session ${sessionId.slice(0, 8)}`;
            }
            // Tách Issue ID (#xxxx, [xxxx], Issue xxxx, POS-xxxx)
            const issueRegex = /#(\d+)|\[(\d{3,6})\]|\b(?:issue|ticket|task|pr|pos|bug)[\s\-_:]*#?(\d{3,6})\b/i;
            const issueMatch = title.match(issueRegex) || (meaningfulFirstPrompt && meaningfulFirstPrompt.match(issueRegex));
            let issueId = undefined;
            if (issueMatch) {
                const issueNum = issueMatch[1] || issueMatch[2] || issueMatch[3];
                if (issueNum) {
                    issueId = `#${issueNum}`;
                    // Lam sach title: Loai bo cac tien to issue trung lap trong tieu de
                    title = title
                        .replace(/[\[\(]?#?\d+[\]\)]?\s*[:\-]?\s*/g, '')
                        .replace(/\b(?:issue|ticket|task|pr|pos|bug)[\s\-_:]*#?\d+\s*[:\-]?\s*/gi, '')
                        .replace(/^[\[\(]\s*[\]\)]\s*/, '')
                        .trim();
                    if (!title) {
                        title = meaningfulFirstPrompt ? meaningfulFirstPrompt.split('\n')[0] : `Session ${sessionId.slice(0, 8)}`;
                    }
                }
            }
            const diffMinutes = Math.floor((Date.now() - mtimeMs) / (60 * 1000));
            let status = 'done';
            let statusMessage = '';
            // TIÊU CHÍ ĐANG CHẠY / CHỜ DUYỆT:
            // 1. Khi process OS đang 'running' / 'busy' / 'executing' -> Claude đang thực sự chạy (kể cả đang chạy tool ở auto mode) -> ĐANG CHẠY
            // 2. Khi process OS KHÔNG running (đang dừng/idle) VÀ lượt cuối gọi tool chưa có kết quả -> Claude đang dừng chờ người dùng phê duyệt -> CHỜ DUYỆT
            // 3. Khi process OS 'idle' và không có tool nào chờ duyệt -> ĐÃ HOÀN THÀNH
            let timeAgo = 'vừa xong';
            if (diffMinutes < 1) {
                timeAgo = 'vừa xong';
            }
            else if (diffMinutes < 60) {
                timeAgo = `${diffMinutes} phút trước`;
            }
            else if (diffMinutes < 1440) {
                timeAgo = `${Math.floor(diffMinutes / 60)} giờ trước`;
            }
            else {
                timeAgo = `${Math.floor(diffMinutes / 1440)} ngày trước`;
            }
            if (activeInfo) {
                if (activeInfo.status === 'running' || activeInfo.status === 'busy' || activeInfo.status === 'executing') {
                    status = 'running';
                    statusMessage = timeAgo;
                }
                else if (lastErrorDetail) {
                    status = 'failed';
                    statusMessage = timeAgo;
                }
                else if (lastTurnHadToolUse) {
                    status = 'need_accept';
                    statusMessage = timeAgo;
                }
                else {
                    status = 'done';
                    statusMessage = timeAgo;
                }
            }
            else {
                if (lastErrorDetail) {
                    status = 'failed';
                    statusMessage = timeAgo;
                }
                else {
                    status = 'done';
                    statusMessage = timeAgo;
                }
            }
            // Nếu lastCwd chưa có, giải mã từ projectDir
            if (!lastCwd) {
                const decoded = this.decodeProjectDir(projectDir, options?.workspaceFolders);
                if (decoded) {
                    lastCwd = decoded;
                    const gitInfo = this.getGitInfoFromDir(decoded);
                    if (gitInfo) {
                        if (gitInfo.branch && (!branch || branch === 'HEAD'))
                            branch = gitInfo.branch;
                        if (gitInfo.isWorktree)
                            isWorktree = true;
                        if (gitInfo.mainRepo)
                            repo = gitInfo.mainRepo;
                    }
                }
            }
            // Nếu branch chưa tìm thấy hoặc là HEAD hoặc chưa xác định isWorktree, kiểm tra thư mục git tương ứng
            if (!branch || branch === 'HEAD' || !isWorktree) {
                const checkDirs = [];
                if (lastCwd) {
                    if (repo && repo !== path.basename(lastCwd)) {
                        checkDirs.push(path.join(lastCwd, repo));
                    }
                    checkDirs.push(lastCwd);
                    const parentCwd = path.dirname(lastCwd);
                    if (repo && repo !== path.basename(parentCwd)) {
                        checkDirs.push(path.join(parentCwd, repo));
                    }
                    checkDirs.push(parentCwd);
                }
                if (options?.workspaceFolders) {
                    for (const wf of options.workspaceFolders) {
                        if (repo && repo !== path.basename(wf)) {
                            checkDirs.push(path.join(wf, repo));
                        }
                        checkDirs.push(wf);
                    }
                }
                const checkedSet = new Set();
                for (const dir of checkDirs) {
                    if (!dir || checkedSet.has(dir) || !fs.existsSync(dir))
                        continue;
                    checkedSet.add(dir);
                    const gitInfo = this.getGitInfoFromDir(dir);
                    if (gitInfo) {
                        if (gitInfo.branch && gitInfo.branch !== 'HEAD' && (!branch || branch === 'HEAD')) {
                            branch = gitInfo.branch;
                        }
                        if (gitInfo.isWorktree)
                            isWorktree = true;
                        if (!repo && gitInfo.mainRepo)
                            repo = gitInfo.mainRepo;
                        if (branch && branch !== 'HEAD' && isWorktree)
                            break;
                    }
                }
            }
            if (branch === 'HEAD') {
                branch = '';
            }
            // Prompt gần nhất
            const lastUserPrompt = meaningfulLastPrompt ? meaningfulLastPrompt.split('\n')[0] : undefined;
            const inputTokens = (hasCostState && (costStateInputTokens > 0 || costStateOutputTokens > 0))
                ? costStateInputTokens
                : assistantInputTokens;
            const outputTokens = (hasCostState && (costStateInputTokens > 0 || costStateOutputTokens > 0))
                ? costStateOutputTokens
                : assistantOutputTokens;
            const totalTokens = inputTokens + outputTokens;
            const source = entrypoint === 'cli' ? 'Terminal' : 'VS Code';
            const inputTokensFormatted = inputTokens > 0 ? this.formatTokens(inputTokens) : '0';
            const outputTokensFormatted = outputTokens > 0 ? this.formatTokens(outputTokens) : '0';
            const costUSD = totalCostUSD > 0 ? `$${totalCostUSD.toFixed(2)}` : undefined;
            const shortId = sessionId.slice(0, 8);
            if ((repo && repo.toLowerCase().includes('observer')) ||
                modelName.toLowerCase().includes('synthetic') ||
                (title && title.toLowerCase().includes('condense the tool payload')) ||
                (meaningfulFirstPrompt && meaningfulFirstPrompt.toLowerCase().includes('condense the tool payload'))) {
                return null;
            }
            return {
                id: sessionId,
                issueId,
                title,
                repo,
                branch: branch || '',
                isWorktree,
                status,
                statusMessage,
                errorDetail: lastErrorDetail || undefined,
                lastUserPrompt,
                lastAssistantResponse: undefined,
                updatedAt: mtimeMs,
                filePath,
                source,
                modelName,
                inputTokensFormatted,
                outputTokensFormatted,
                costUSD,
                turnCount: turnCount || 1,
                shortId,
                cwd: lastCwd || undefined,
                rawInputTokens: inputTokens,
                rawOutputTokens: outputTokens,
                totalTokens: totalTokens
            };
        }
        catch {
            return null;
        }
    }
}
exports.SessionScanner = SessionScanner;
//# sourceMappingURL=scanner.js.map