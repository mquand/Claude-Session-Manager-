import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { ClaudeSession, SessionStatus } from './types';

export class SessionScanner {
  private static sessionCache = new Map<string, { session: ClaudeSession; mtimeMs: number }>();

  public static deleteSession(sessionId: string, filePath: string): boolean {
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
    } catch (err) {
      console.error('Lỗi khi xoá session:', err);
      return false;
    }
  }

  public static resolveHomePath(p: string): string {
    if (p.startsWith('~/') || p === '~') {
      return path.join(os.homedir(), p.slice(1));
    }
    return p;
  }

  public static getWatchedDirectories(customPath?: string): string[] {
    const claudeDir = path.join(os.homedir(), '.claude');
    const defaultClaudeProjects = path.join(claudeDir, 'projects');
    const sessionsDir = path.join(claudeDir, 'sessions');

    const dirs = [
      customPath ? this.resolveHomePath(customPath) : null,
      defaultClaudeProjects,
      sessionsDir
    ].filter((dir): dir is string => Boolean(dir && fs.existsSync(dir)));

    const resultDirs: string[] = [];
    for (const d of dirs) {
      resultDirs.push(d);
      try {
        const subEntries = fs.readdirSync(d, { withFileTypes: true });
        for (const entry of subEntries) {
          if (entry.isDirectory() && !entry.name.toLowerCase().includes('observer')) {
            resultDirs.push(path.join(d, entry.name));
          }
        }
      } catch {}
    }
    return resultDirs;
  }

  // TIÊU CHÍ ĐANG CHẠY: Kiểm tra chính xác xem Process OS của session đó có đang chạy thật sự không
  public static getActiveSessionsMap(): Map<string, { status: string; pid: number }> {
    const activeMap = new Map<string, { status: string; pid: number }>();
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
    if (!fs.existsSync(sessionsDir)) return activeMap;

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
              } catch {
                isAlive = false;
              }

              if (isAlive) {
                activeMap.set(data.sessionId, {
                  status: data.status || 'running',
                  pid: data.pid
                });
              }
            }
          } catch {}
        }
      }
    } catch {}

    return activeMap;
  }

  public static async scanSessions(customPath?: string): Promise<ClaudeSession[]> {
    const defaultClaudeProjects = customPath ? this.resolveHomePath(customPath) : path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(defaultClaudeProjects)) {
      return [];
    }

    const activeMap = this.getActiveSessionsMap();
    const currentFiles = new Map<string, { filePath: string; sessionId: string; mtimeMs: number; dirPath: string }>();

    try {
      const projectDirs = fs.readdirSync(defaultClaudeProjects, { withFileTypes: true });
      for (const pDir of projectDirs) {
        if (!pDir.isDirectory()) continue;
        if (pDir.name.toLowerCase().includes('observer')) continue;
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
        } catch {}
      }
    } catch (err) {
      console.error('Lỗi duyệt projects:', err);
    }

    // Xoá session đã bị xoá hoặc là observer session rác
    for (const [cachedId, cachedItem] of this.sessionCache) {
      if (
        !currentFiles.has(cachedId) ||
        (cachedItem.session.repo && cachedItem.session.repo.toLowerCase().includes('observer')) ||
        (cachedItem.session.modelName && cachedItem.session.modelName.toLowerCase().includes('synthetic'))
      ) {
        this.sessionCache.delete(cachedId);
      }
    }

    const sortedCandidates = Array.from(currentFiles.values()).sort((a, b) => b.mtimeMs - a.mtimeMs);
    const topCandidates = sortedCandidates.slice(0, 30);

    const sessions: ClaudeSession[] = [];

    for (const item of topCandidates) {
      const activeInfo = activeMap.get(item.sessionId);
      const cached = this.sessionCache.get(item.sessionId);

      if (cached && cached.mtimeMs === item.mtimeMs && !activeInfo && cached.session.status === 'done') {
        const diffMinutes = Math.floor((Date.now() - item.mtimeMs) / (60 * 1000));
        if (diffMinutes < 1) {
          cached.session.statusMessage = 'vừa xong';
        } else if (diffMinutes < 60) {
          cached.session.statusMessage = `${diffMinutes} phút trước`;
        } else if (diffMinutes < 1440) {
          cached.session.statusMessage = `${Math.floor(diffMinutes / 60)} giờ trước`;
        } else {
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
      const score = (s: ClaudeSession) => (s.status === 'running' ? 3 : s.status === 'need_accept' ? 2 : 1);
      if (score(b) !== score(a)) {
        return score(b) - score(a);
      }
      return b.updatedAt - a.updatedAt;
    });
  }

  private static cleanPromptText(text: string): string {
    return text
      .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  private static formatTokens(tokens: number): string {
    if (tokens >= 1_000_000_000) return (tokens / 1_000_000_000).toFixed(1) + 'B';
    if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(1) + 'M';
    if (tokens >= 1_000) return (tokens / 1_000).toFixed(0) + 'K';
    return tokens.toString();
  }

  private static formatModelName(rawModel: string): string {
    if (!rawModel) return 'Opus 5.5';
    if (rawModel.includes('opus')) return 'Opus 5.5';
    if (rawModel.includes('sonnet')) return 'Sonnet 3.7';
    if (rawModel.includes('haiku')) return 'Haiku 3.5';
    if (rawModel.includes('flash')) return 'Gemini Flash';
    return rawModel.replace('claude-', '').replace('-5-5', ' 5.5');
  }

  private static async fastParseSession(
    filePath: string,
    sessionId: string,
    mtimeMs: number,
    projectDir: string,
    activeInfo?: { status: string; pid: number }
  ): Promise<ClaudeSession | null> {
    try {
      let title = '';
      const customTitlePath = path.join(projectDir, sessionId, 'custom-title.json');
      if (fs.existsSync(customTitlePath)) {
        try {
          const ct = JSON.parse(fs.readFileSync(customTitlePath, 'utf8'));
          if (ct.customTitle) {
            title = ct.customTitle;
          }
        } catch {}
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
        if (!line.trim()) continue;
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
            } else if (!repo && base) {
              repo = base;
            }
          }

          if (item.type === 'cost-state') {
            if (item.totalCostUSD) totalCostUSD = item.totalCostUSD;
            if (item.modelUsage) {
              for (const [mName, usage] of Object.entries<any>(item.modelUsage)) {
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
                if (part.type === 'text') fullText += part.text + '\n';
              }
            } else if (typeof content === 'string') {
              fullText = content;
            }

            const cleaned = this.cleanPromptText(fullText);
            if (cleaned) {
              turnCount++;
              if (!meaningfulFirstPrompt) meaningfulFirstPrompt = cleaned;
              meaningfulLastPrompt = cleaned;
            }
            lastTurnHadToolUse = false;
          } else if (item.type === 'last-prompt' && item.lastPrompt) {
            const cleaned = this.cleanPromptText(item.lastPrompt);
            if (cleaned) {
              if (!meaningfulFirstPrompt) meaningfulFirstPrompt = cleaned;
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
            } else {
              lastTurnHadToolUse = false;
            }
          }
        } catch {}
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
      let issueId: string | undefined = undefined;

      if (issueMatch) {
        issueId = issueMatch[0];
        // Làm sạch title: Nếu trong title bị dính lặp lại "#5433" thì bỏ đi cho gọn
        title = title.replace(/#\d+\s*/g, '').trim();
      }

      const diffMinutes = Math.floor((Date.now() - mtimeMs) / (60 * 1000));
      
      let status: SessionStatus = 'done';
      let statusMessage = '';

      // TIÊU CHÍ ĐANG CHẠY / CHỜ DUYỆT:
      // 1. Khi process OS đang 'running' / 'busy' / 'executing' -> Claude đang thực sự chạy (kể cả đang chạy tool ở auto mode) -> ĐANG CHẠY
      // 2. Khi process OS KHÔNG running (đang dừng/idle) VÀ lượt cuối gọi tool chưa có kết quả -> Claude đang dừng chờ người dùng phê duyệt -> CHỜ DUYỆT
      // 3. Khi process OS 'idle' và không có tool nào chờ duyệt -> ĐÃ HOÀN THÀNH
      if (activeInfo) {
        if (activeInfo.status === 'running' || activeInfo.status === 'busy' || activeInfo.status === 'executing') {
          status = 'running';
          statusMessage = 'đang chạy';
        } else if (lastTurnHadToolUse) {
          status = 'need_accept';
          statusMessage = 'chờ duyệt';
        } else {
          status = 'done';
          if (diffMinutes < 1) {
            statusMessage = 'vừa xong';
          } else if (diffMinutes < 60) {
            statusMessage = `${diffMinutes} phút trước`;
          } else if (diffMinutes < 1440) {
            statusMessage = `${Math.floor(diffMinutes / 60)} giờ trước`;
          } else {
            statusMessage = `${Math.floor(diffMinutes / 1440)} ngày trước`;
          }
        }
      } else {
        status = 'done';
        if (diffMinutes < 1) {
          statusMessage = 'vừa xong';
        } else if (diffMinutes < 60) {
          statusMessage = `${diffMinutes} phút trước`;
        } else if (diffMinutes < 1440) {
          statusMessage = `${Math.floor(diffMinutes / 60)} giờ trước`;
        } else {
          statusMessage = `${Math.floor(diffMinutes / 1440)} ngày trước`;
        }
      }

      // Prompt gần nhất
      const lastUserPrompt = meaningfulLastPrompt ? meaningfulLastPrompt.split('\n')[0] : undefined;

      const source: 'VS Code' | 'Terminal' = entrypoint === 'cli' ? 'Terminal' : 'VS Code';
      const inputTokensFormatted = inputTokens > 0 ? this.formatTokens(inputTokens) : '0';
      const outputTokensFormatted = outputTokens > 0 ? this.formatTokens(outputTokens) : '0';
      const costUSD = totalCostUSD > 0 ? `$${totalCostUSD.toFixed(2)}` : undefined;
      const shortId = sessionId.slice(0, 8);

      if (
        repo.toLowerCase().includes('observer') ||
        modelName.toLowerCase().includes('synthetic') ||
        (title && title.toLowerCase().includes('condense the tool payload')) ||
        (meaningfulFirstPrompt && meaningfulFirstPrompt.toLowerCase().includes('condense the tool payload'))
      ) {
        return null;
      }

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
    } catch {
      return null;
    }
  }
}
