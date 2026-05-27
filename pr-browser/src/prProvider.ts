import * as vscode from 'vscode';
import { fetchReviewThreads, fetchPRBranch } from './githubApi';
import { generateCommentTitle } from './openaiApi';
import { Storage, PREntry, CommentData } from './storage';

export class PRItem extends vscode.TreeItem {
    constructor(public readonly pr: PREntry) {
        super(`${pr.owner}/${pr.repo}`, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = pr.id;
        this.description = `#${pr.number}`;
        this.tooltip = pr.url;
        this.contextValue = 'pr';
        this.iconPath = new vscode.ThemeIcon('git-pull-request');
    }
}

export class CommentItem extends vscode.TreeItem {
    constructor(public readonly comment: CommentData, public readonly hasSession = false) {
        super(comment.title, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = comment.id;
        this.description = comment.path
            ? `${comment.path}${comment.line ? `:${comment.line}` : ''}`
            : `@${comment.author}`;
        this.contextValue = hasSession ? 'commentWithSession' : 'comment';

        this.iconPath = comment.isResolved
            ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('comment', new vscode.ThemeColor('list.warningForeground'));
    }
}

class CommentDetailItem extends vscode.TreeItem {
    constructor(label: string, icon?: string, description?: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        if (icon) { this.iconPath = new vscode.ThemeIcon(icon); }
        this.description = description;
        this.contextValue = 'commentDetail';
    }
}

export class CommentActionItem extends vscode.TreeItem {
    constructor(
        label: string,
        icon: string,
        commandId: string,
        public readonly comment: CommentData,
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = 'commentAction';
        this.command = { command: commandId, title: label, arguments: [this] };
    }
}

class MessageItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'message';
    }
}

type TreeNode = PRItem | CommentItem | CommentDetailItem | CommentActionItem | MessageItem;

export class PRProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private commentCache = new Map<string, CommentItem[]>();
    private inFlight = new Map<string, Promise<TreeNode[]>>();

    constructor(
        private readonly storage: Storage,
        private readonly secrets: vscode.SecretStorage
    ) {}

    async addPR(input: string): Promise<void> {
        const parsed = this.parsePRInput(input.trim());
        if (!parsed) {
            vscode.window.showErrorMessage(
                'Invalid format. Use a GitHub URL or owner/repo#number.'
            );
            return;
        }

        const id = `${parsed.owner}/${parsed.repo}#${parsed.number}`;
        const prs = this.storage.getPRs();

        if (prs.find(p => p.id === id)) {
            vscode.window.showInformationMessage(`${id} is already in your list.`);
            return;
        }

        let branch = '';
        const token = await this.secrets.get('pr-browser.githubToken');
        if (token) {
            try {
                branch = await fetchPRBranch(parsed.owner, parsed.repo, parsed.number, token);
            } catch (err: any) {
                console.warn(`[pr-browser] could not fetch branch name: ${err.message}`);
            }
        }

        const updated = [
            {
                id,
                owner: parsed.owner,
                repo: parsed.repo,
                number: parsed.number,
                url: `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.number}`,
                addedAt: new Date().toISOString(),
                branch,
            },
            ...prs,
        ];
        await this.storage.setPRs(updated);
        this._onDidChangeTreeData.fire();
    }

    removePR(id: string): void {
        this.commentCache.delete(id);
        const updated = this.storage.getPRs().filter(p => p.id !== id);
        this.storage.setPRs(updated).then(() => this._onDidChangeTreeData.fire());
    }

    async refreshPR(id: string): Promise<void> {
        this.commentCache.delete(id);
        this.inFlight.delete(id);
        await this.storage.clearCachedComments(id);
        this._onDidChangeTreeData.fire();
    }

    private parsePRInput(input: string): { owner: string; repo: string; number: number } | null {
        const urlMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (urlMatch) {
            return { owner: urlMatch[1], repo: urlMatch[2], number: parseInt(urlMatch[3]) };
        }
        const shortMatch = input.match(/^([^/]+)\/([^#]+)#(\d+)$/);
        if (shortMatch) {
            return { owner: shortMatch[1], repo: shortMatch[2], number: parseInt(shortMatch[3]) };
        }
        return null;
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        if (!element) {
            return this.storage.getPRs().map(pr => new PRItem(pr));
        }
        if (element instanceof PRItem) {
            return this.loadComments(element.pr);
        }
        if (element instanceof CommentItem) {
            return this.buildCommentChildren(element);
        }
        return [];
    }

    private buildCommentChildren(item: CommentItem): TreeNode[] {
        const c = item.comment;
        const children: TreeNode[] = [];

        if (c.path) {
            children.push(new CommentDetailItem(c.path, 'file-code', c.line ? `:${c.line}` : undefined));
        }

        children.push(new CommentActionItem('Open on GitHub', 'link-external', 'pr-browser.openCommentInBrowser', c));
        if (!c.isResolved || item.hasSession) {
            children.push(new CommentActionItem('Open in Claude Code', 'hubot', 'pr-browser.openCommentSession', c));
        }
        children.push(new CommentActionItem('Checkout Branch', 'git-branch', 'pr-browser.checkoutCommentBranch', c));
        children.push(new CommentActionItem('Finalize Branch', 'git-merge', 'pr-browser.finalizeCommentBranch', c));
        if (item.hasSession) {
            children.push(new CommentActionItem('Reset Session', 'debug-restart', 'pr-browser.resetCommentSession', c));
        }

        return children;
    }

    private loadComments(pr: PREntry): Promise<TreeNode[]> {
        // 1. In-memory (same session, zero cost)
        if (this.commentCache.has(pr.id)) {
            return Promise.resolve(this.commentCache.get(pr.id)!);
        }
        // 2. Persisted (survived restart, no GitHub call needed)
        const persisted = this.storage.getCachedComments(pr.id);
        if (persisted) {
            const items = persisted.map(c => new CommentItem(
                { ...c, prNumber: c.prNumber ?? pr.number, prBranch: c.prBranch || pr.branch },
                !!this.storage.getSessionInfo(c.id)
            ));
            this.commentCache.set(pr.id, items);
            return Promise.resolve(items);
        }
        // 3. Fetch from GitHub
        if (this.inFlight.has(pr.id)) {
            return this.inFlight.get(pr.id)!;
        }
        const promise = this.fetchComments(pr).finally(() => this.inFlight.delete(pr.id));
        this.inFlight.set(pr.id, promise);
        return promise;
    }

    private async fetchComments(pr: PREntry): Promise<TreeNode[]> {
        const token = await this.secrets.get('pr-browser.githubToken');
        if (!token) {
            vscode.window.showErrorMessage(
                'GitHub token not set. Run "PR Browser: Set GitHub Token" from the command palette.'
            );
            return [new MessageItem('Set GitHub token to load comments')];
        }

        let threads;
        try {
            threads = await fetchReviewThreads(pr.owner, pr.repo, pr.number, token);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to fetch comments: ${err.message}`);
            return [new MessageItem('Failed to load comments')];
        }

        if (threads.length === 0) {
            return [new MessageItem('No review comments')];
        }

        const openAIKey = await this.secrets.get('pr-browser.openAIToken');
        console.log(`[pr-browser] OpenAI key present: ${Boolean(openAIKey)}, thread count: ${threads.length}`);
        const newTitles: Record<string, string> = {};

        const items = await Promise.all(
            threads.map(async thread => {
                const c = thread.firstComment;
                console.log(`[pr-browser] processing thread ${thread.id}`);

                // Use cached title if available — avoids OpenAI call on refresh
                let title = this.storage.getCachedTitle(pr.id, thread.id);
                console.log(`[pr-browser] title cache ${title ? `HIT: "${title}"` : 'MISS'} for thread ${thread.id}`);

                if (title) {
                } else {
                    title = c.body.split('\n')[0].slice(0, 60) || 'Comment';
                    if (openAIKey) {
                        console.log(`[pr-browser] calling OpenAI for thread ${thread.id}`);
                        try {
                            title = await generateCommentTitle(c.body, openAIKey);
                            console.log(`[pr-browser] OpenAI title: "${title}"`);
                        } catch (err: any) {
                            console.error(`[pr-browser] OpenAI error for thread ${thread.id}: ${err.message}`);
                        }
                    } else {
                        console.log(`[pr-browser] no OpenAI key — using fallback title for thread ${thread.id}`);
                    }
                    newTitles[thread.id] = title;
                }

                const commentData: CommentData = {
                    id: thread.id,
                    firstCommentId: c.id,
                    title,
                    body: c.body,
                    author: c.author,
                    isResolved: thread.isResolved,
                    url: c.url,
                    path: c.path,
                    line: c.line,
                    threadComments: thread.comments,
                    threadTooLong: thread.threadTooLong,
                    prNumber: pr.number,
                    prBranch: pr.branch,
                };
                return new CommentItem(commentData, !!this.storage.getSessionInfo(thread.id));
            })
        );

        if (Object.keys(newTitles).length > 0) {
            await this.storage.setCachedTitles(pr.id, newTitles);
        }

        await this.storage.setCachedComments(pr.id, items.map(i => i.comment));
        this.commentCache.set(pr.id, items);
        return items;
    }
}
