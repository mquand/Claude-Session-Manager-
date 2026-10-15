"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionScanner = void 0;
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
class SessionScanner {
    static sessionCache = new Map();
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
                    if (entry.isDirectory()) {
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
    static async scanSessions(customPath) {
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
                const projectPath = path.join(defaultClaudeProjects, pDir.name);
                try {
                    const files = fs.readdirSync(projectPath, { withFileTypes: true });
                    for (const file of files) {
                        if (file.isFile() && file.name.endsWith('.jsonl')) {
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
        // Xoá session đã bị xoá
        for (const [cachedId] of this.sessionCache) {
            if (!currentFiles.has(cachedId)) {
                this.sessionCache.delete(cachedId);
            }
        }
        const sortedCandidates = Array.from(currentFiles.values()).sort((a, b) => b.mtimeMs - a.mtimeMs);
        const topCandidates = sortedCandidates.slice(0, 30);
        const sessions = [];
        for (const item of topCandidates) {
            const activeInfo = activeMap.get(item.sessionId);
            const cached = this.sessionCache.get(item.sessionId);
            if (cached && cached.mtimeMs === item.mtimeMs && !activeInfo && cached.session.status === 'done') {
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
            const parsed = await this.fastParseSession(item.filePath, item.sessionId, item.mtimeMs, item.dirPath, activeInfo);
            if (parsed) {
                this.sessionCache.set(item.sessionId, { session: parsed, mtimeMs: item.mtimeMs });
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
            return (tokens / 1_000_000_000).toFixed(1) + 'B';
        if (tokens >= 1_000_000)
            return (tokens / 1_000_000).toFixed(1) + 'M';
        if (tokens >= 1_000)
            return (tokens / 1_000).toFixed(0) + 'K';
        return tokens.toString();
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
    static async fastParseSession(filePath, sessionId, mtimeMs, projectDir, activeInfo) {
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
            let entrypoint = 'claude-vscode';
            let lastTurnHadToolUse = false;
            let totalCostUSD = 0;
            let modelName = 'Opus 5.5';
            let inputTokens = 0;
            let outputTokens = 0;
            let turnCount = 0;
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
                    if (!branch && item.gitBranch && item.gitBranch !== 'HEAD') {
                        branch = item.gitBranch;
                    }
                    if (item.entrypoint) {
                        entrypoint = item.entrypoint;
                    }
                    if (item.cwd) {
                        const base = path.basename(item.cwd);
                        if (base && base !== 'workspace') {
                            repo = base;
                        }
                        else if (!repo && base) {
                            repo = base;
                        }
                    }
                    if (item.type === 'cost-state') {
                        if (item.totalCostUSD)
                            totalCostUSD = item.totalCostUSD;
                        if (item.modelUsage) {
                            for (const [mName, usage] of Object.entries(item.modelUsage)) {
                                modelName = this.formatModelName(mName);
                                inputTokens = (usage.inputTokens || 0) + (usage.cacheReadInputTokens || 0) + (usage.cacheCreationInputTokens || 0);
                                outputTokens = (usage.outputTokens || 0);
                            }
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
                            inputTokens += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
                            outputTokens += (u.output_tokens || 0);
                        }
                        const content = item.message.content;
                        if (Array.isArray(content)) {
                            let hasTool = false;
                            for (const part of content) {
                                if (part.type === 'tool_use') {
                                    hasTool = true;
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
                repo = 'app-backend';
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
            // - Chỉ coi là ĐANG CHẠY khi process OS còn sống VÀ trạng thái là 'running'/'busy'
            // - Coi là CHỜ DUYỆT khi lượt trước đó gọi tool và đang đợi phản hồi
            // - Khi process OS ở trạng thái 'idle' (đã hoàn thành câu trả lời) -> coi là 'done' (Đã xong)
            if (activeInfo) {
                if (lastTurnHadToolUse) {
                    status = 'need_accept';
                    statusMessage = 'chờ duyệt';
                }
                else if (activeInfo.status === 'running' || activeInfo.status === 'busy' || activeInfo.status === 'executing') {
                    status = 'running';
                    statusMessage = 'đang chạy';
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
            // Prompt gần nhất
            const lastUserPrompt = meaningfulLastPrompt ? meaningfulLastPrompt.split('\n')[0] : undefined;
            const source = entrypoint === 'cli' ? 'Terminal' : 'VS Code';
            const inputTokensFormatted = inputTokens > 0 ? this.formatTokens(inputTokens) : '0';
            const outputTokensFormatted = outputTokens > 0 ? this.formatTokens(outputTokens) : '0';
            const costUSD = totalCostUSD > 0 ? `$${totalCostUSD.toFixed(2)}` : undefined;
            const shortId = sessionId.slice(0, 8);
            return {
                id: sessionId,
                issueId,
                title,
                repo,
                branch: branch || 'develop',
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
                shortId
            };
        }
        catch {
            return null;
        }
    }
}
exports.SessionScanner = SessionScanner;
//# sourceMappingURL=scanner.js.map