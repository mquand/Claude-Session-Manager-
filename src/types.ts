export type SessionStatus = 'need_accept' | 'done' | 'running' | 'failed' | 'question';

export interface ClaudeSession {
  id: string;
  issueId?: string;           // Ví dụ: #101, #204
  title: string;             // Tiêu đề
  repo: string;              // Ví dụ: "web-app", "backend-api"
  branch: string;            // Ví dụ: "main", "feature/login"
  isWorktree?: boolean;      // Đang chạy trên Git Worktree
  status: SessionStatus;
  statusMessage: string;     // Ví dụ: "3 phút trước", "3 ngày trước"
  lastUserPrompt?: string;   // Ví dụ: "> cập nhật giao diện..."
  lastAssistantResponse?: string;
  updatedAt: number;
  filePath?: string;
  errorDetail?: string;

  // Metadata mới theo UI
  source: 'VS Code' | 'Terminal';
  modelName: string;         // Ví dụ: "Opus 5.5", "Sonnet 3.7"
  inputTokensFormatted: string;  // Ví dụ: "1.5B", "63.2M"
  outputTokensFormatted: string; // Ví dụ: "2.4M ra", "308K ra"
  costUSD?: string;          // Ví dụ: "$425.02", "$1.71"
  turnCount: number;         // Ví dụ: 1049, 185
  shortId: string;           // 8 ký tự cuối hoặc đầu: "3fde811b"
  cwd?: string;
  rawInputTokens?: number;
  rawOutputTokens?: number;
  totalTokens?: number;
  subSessions?: ClaudeSession[];
  isNeedReview?: boolean;
}

export interface ScanOptions {
  workspaceFolders?: string[];
  defaultRepo?: string;
  hiddenSessionIds?: Set<string>;
  dbPathHint?: string;
}
