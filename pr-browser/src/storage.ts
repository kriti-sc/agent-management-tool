import * as vscode from 'vscode';

export interface PREntry {
    id: string;
    owner: string;
    repo: string;
    number: number;
    url: string;
    addedAt: string;
}

export interface CommentData {
    id: string;
    firstCommentId: string;
    title: string;
    body: string;
    author: string;
    isResolved: boolean;
    url: string;
    path: string | null;
    line: number | null;
}

const KEYS = {
    PRS: 'prs',
    TITLE_CACHE: 'titleCache',
    COMMENT_CACHE: 'commentCache',
    SESSION_IDS: 'sessionIds',
} as const;

export class Storage {
    constructor(private readonly state: vscode.Memento) {}

    // --- PRs ---

    getPRs(): PREntry[] {
        return this.state.get<PREntry[]>(KEYS.PRS, []);
    }

    async setPRs(prs: PREntry[]): Promise<void> {
        await this.state.update(KEYS.PRS, prs);
    }

    // --- Comment titles (keyed by prId -> threadId so a single PR's titles can be cleared) ---

    getCachedTitle(prId: string, threadId: string): string | undefined {
        return this.state.get<Record<string, Record<string, string>>>(KEYS.TITLE_CACHE, {})[prId]?.[threadId];
    }

    async setCachedTitles(prId: string, updates: Record<string, string>): Promise<void> {
        const outer = this.state.get<Record<string, Record<string, string>>>(KEYS.TITLE_CACHE, {});
        await this.state.update(KEYS.TITLE_CACHE, {
            ...outer,
            [prId]: { ...(outer[prId] ?? {}), ...updates },
        });
    }

    async clearCachedTitles(prId: string): Promise<void> {
        const outer = this.state.get<Record<string, Record<string, string>>>(KEYS.TITLE_CACHE, {});
        const { [prId]: _, ...rest } = outer;
        await this.state.update(KEYS.TITLE_CACHE, rest);
    }

    // --- Comment data (keyed by PR ID) ---

    getCachedComments(prId: string): CommentData[] | undefined {
        return this.state.get<Record<string, CommentData[]>>(KEYS.COMMENT_CACHE, {})[prId];
    }

    async setCachedComments(prId: string, comments: CommentData[]): Promise<void> {
        const existing = this.state.get<Record<string, CommentData[]>>(KEYS.COMMENT_CACHE, {});
        await this.state.update(KEYS.COMMENT_CACHE, { ...existing, [prId]: comments });
    }

    async clearCachedComments(prId: string): Promise<void> {
        const existing = this.state.get<Record<string, CommentData[]>>(KEYS.COMMENT_CACHE, {});
        const { [prId]: _, ...rest } = existing;
        await this.state.update(KEYS.COMMENT_CACHE, rest);
    }

    // --- Claude Code session IDs (keyed by thread ID) ---

    getSessionId(threadId: string): string | undefined {
        return this.state.get<Record<string, string>>(KEYS.SESSION_IDS, {})[threadId];
    }

    async setSessionId(threadId: string, sessionId: string): Promise<void> {
        const existing = this.state.get<Record<string, string>>(KEYS.SESSION_IDS, {});
        await this.state.update(KEYS.SESSION_IDS, { ...existing, [threadId]: sessionId });
    }
}
