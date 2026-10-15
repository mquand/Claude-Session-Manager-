"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionScanner = void 0;
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
class SessionScanner {
    static CACHE_VERSION = 3;
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
    static async scanSessions(customPath, options) {
        const defaultClaudeProjects = customPath ? this.resolveHomePath(customPath) : path.join(os.homedir(), '.claude', 'projects');
        if (!fs.existsSync(defaultClaudeProjects)) {
            return [];
        }
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
        // Xoá session đã bị xoá hoặc là observer session rác
        for (const [cachedId, cachedItem] of this.sessionCache) {
            if (!currentFiles.has(cachedId) ||
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
            const score = (s) => (s.status === 'running' ? 3 : s.status === 'need_accept' ? 2 : 1);
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
            // Tách Issue ID (#xxxx)
            const issueMatch = title.match(/#(\d+)/) || (meaningfulFirstPrompt && meaningfulFirstPrompt.match(/#(\d+)/));
            let issueId = undefined;
            if (issueMatch) {
                issueId = issueMatch[0];
                // Làm sạch title: Nếu trong title bị dính lặp lại "#5433" thì bỏ đi cho gọn
                title = title.replace(/#\d+\s*/g, '').trim();
            }
            const diffMinutes = Math.floor((Date.now() - mtimeMs) / (60 * 1000));
            let status = 'done';
            let statusMessage = '';
            // TIÊU CHÍ ĐANG CHẠY / CHỜ DUYỆT:
            // 1. Khi process OS đang 'running' / 'busy' / 'executing' -> Claude đang thực sự chạy (kể cả đang chạy tool ở auto mode) -> ĐANG CHẠY
            // 2. Khi process OS KHÔNG running (đang dừng/idle) VÀ lượt cuối gọi tool chưa có kết quả -> Claude đang dừng chờ người dùng phê duyệt -> CHỜ DUYỆT
            // 3. Khi process OS 'idle' và không có tool nào chờ duyệt -> ĐÃ HOÀN THÀNH
            if (activeInfo) {
                if (activeInfo.status === 'running' || activeInfo.status === 'busy' || activeInfo.status === 'executing') {
                    status = 'running';
                    statusMessage = 'đang chạy';
                }
                else if (lastTurnHadToolUse) {
                    status = 'need_accept';
                    statusMessage = 'chờ duyệt';
                }
                else {
                    status = 'done';
                    if (diffMinutes < 1) {
                        statusMessage = 'vừa xong';
                    }
                    else if (diffMinutes < 60) {
                        statusMessage = `${diffMinutes} phút trước`;
                    }
                    else if (diffMinutes < 1440) {
                        statusMessage = `${Math.floor(diffMinutes / 60)} giờ trước`;
                    }
                    else {
                        statusMessage = `${Math.floor(diffMinutes / 1440)} ngày trước`;
                    }
                }
            }
            else {
                status = 'done';
                if (diffMinutes < 1) {
                    statusMessage = 'vừa xong';
                }
                else if (diffMinutes < 60) {
                    statusMessage = `${diffMinutes} phút trước`;
                }
                else if (diffMinutes < 1440) {
                    statusMessage = `${Math.floor(diffMinutes / 60)} giờ trước`;
                }
                else {
                    statusMessage = `${Math.floor(diffMinutes / 1440)} ngày trước`;
                }
            }
            // Nếu branch chưa tìm thấy hoặc là HEAD, kiểm tra thư mục git tương ứng
            if (!branch || branch === 'HEAD') {
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
                    if (gitInfo && gitInfo.branch && gitInfo.branch !== 'HEAD') {
                        branch = gitInfo.branch;
                        if (gitInfo.isWorktree)
                            isWorktree = true;
                        if (!repo && gitInfo.mainRepo)
                            repo = gitInfo.mainRepo;
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