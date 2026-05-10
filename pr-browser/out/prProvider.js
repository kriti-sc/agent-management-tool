"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRProvider = exports.CommentItem = exports.PRItem = void 0;
const vscode = require("vscode");
const githubApi_1 = require("./githubApi");
const openaiApi_1 = require("./openaiApi");
class PRItem extends vscode.TreeItem {
    constructor(pr) {
        super(`${pr.owner}/${pr.repo}`, vscode.TreeItemCollapsibleState.Collapsed);
        this.pr = pr;
        this.id = pr.id;
        this.description = `#${pr.number}`;
        this.tooltip = pr.url;
        this.contextValue = 'pr';
        this.iconPath = new vscode.ThemeIcon('git-pull-request');
    }
}
exports.PRItem = PRItem;
class CommentItem extends vscode.TreeItem {
    constructor(comment) {
        super(comment.title, vscode.TreeItemCollapsibleState.None);
        this.comment = comment;
        this.id = comment.id;
        this.description = comment.path
            ? `${comment.path}${comment.line ? `:${comment.line}` : ''}`
            : `@${comment.author}`;
        this.tooltip = new vscode.MarkdownString(`**@${comment.author}**\n\n${comment.body}`);
        this.contextValue = 'comment';
        this.iconPath = comment.isResolved
            ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('comment', new vscode.ThemeColor('list.warningForeground'));
        this.command = {
            command: 'vscode.open',
            title: 'Open in GitHub',
            arguments: [vscode.Uri.parse(comment.url)],
        };
    }
}
exports.CommentItem = CommentItem;
class MessageItem extends vscode.TreeItem {
    constructor(label) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'message';
    }
}
class PRProvider {
    constructor(storage, secrets) {
        this.storage = storage;
        this.secrets = secrets;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.commentCache = new Map();
        this.inFlight = new Map();
    }
    addPR(input) {
        const parsed = this.parsePRInput(input.trim());
        if (!parsed) {
            vscode.window.showErrorMessage('Invalid format. Use a GitHub URL or owner/repo#number.');
            return;
        }
        const id = `${parsed.owner}/${parsed.repo}#${parsed.number}`;
        const prs = this.storage.getPRs();
        if (prs.find(p => p.id === id)) {
            vscode.window.showInformationMessage(`${id} is already in your list.`);
            return;
        }
        const updated = [
            {
                id,
                owner: parsed.owner,
                repo: parsed.repo,
                number: parsed.number,
                url: `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.number}`,
                addedAt: new Date().toISOString(),
            },
            ...prs,
        ];
        this.storage.setPRs(updated).then(() => this._onDidChangeTreeData.fire());
    }
    removePR(id) {
        this.commentCache.delete(id);
        const updated = this.storage.getPRs().filter(p => p.id !== id);
        this.storage.setPRs(updated).then(() => this._onDidChangeTreeData.fire());
    }
    async refreshPR(id) {
        this.commentCache.delete(id);
        this.inFlight.delete(id);
        await Promise.all([
            this.storage.clearCachedComments(id),
            this.storage.clearCachedTitles(id),
        ]);
        this._onDidChangeTreeData.fire();
    }
    parsePRInput(input) {
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
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            return this.storage.getPRs().map(pr => new PRItem(pr));
        }
        if (element instanceof PRItem) {
            return this.loadComments(element.pr);
        }
        return [];
    }
    loadComments(pr) {
        // 1. In-memory (same session, zero cost)
        if (this.commentCache.has(pr.id)) {
            return Promise.resolve(this.commentCache.get(pr.id));
        }
        // 2. Persisted (survived restart, no GitHub call needed)
        const persisted = this.storage.getCachedComments(pr.id);
        if (persisted) {
            const items = persisted.map(c => new CommentItem(c));
            this.commentCache.set(pr.id, items);
            return Promise.resolve(items);
        }
        // 3. Fetch from GitHub
        if (this.inFlight.has(pr.id)) {
            return this.inFlight.get(pr.id);
        }
        const promise = this.fetchComments(pr).finally(() => this.inFlight.delete(pr.id));
        this.inFlight.set(pr.id, promise);
        return promise;
    }
    async fetchComments(pr) {
        const token = await this.secrets.get('pr-browser.githubToken');
        if (!token) {
            vscode.window.showErrorMessage('GitHub token not set. Run "PR Browser: Set GitHub Token" from the command palette.');
            return [new MessageItem('Set GitHub token to load comments')];
        }
        let threads;
        try {
            threads = await (0, githubApi_1.fetchReviewThreads)(pr.owner, pr.repo, pr.number, token);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to fetch comments: ${err.message}`);
            return [new MessageItem('Failed to load comments')];
        }
        if (threads.length === 0) {
            return [new MessageItem('No review comments')];
        }
        const openAIKey = await this.secrets.get('pr-browser.openAIToken');
        console.log(`[pr-browser] OpenAI key present: ${Boolean(openAIKey)}, thread count: ${threads.length}`);
        const newTitles = {};
        const items = await Promise.all(threads.map(async (thread) => {
            const c = thread.firstComment;
            console.log(`[pr-browser] processing thread ${thread.id}`);
            // Use cached title if available — avoids OpenAI call on refresh
            let title = this.storage.getCachedTitle(pr.id, thread.id);
            console.log(`[pr-browser] title cache ${title ? `HIT: "${title}"` : 'MISS'} for thread ${thread.id}`);
            if (title) {
            }
            else {
                title = c.body.split('\n')[0].slice(0, 60) || 'Comment';
                if (openAIKey) {
                    console.log(`[pr-browser] calling OpenAI for thread ${thread.id}`);
                    try {
                        title = await (0, openaiApi_1.generateCommentTitle)(c.body, openAIKey);
                        console.log(`[pr-browser] OpenAI title: "${title}"`);
                    }
                    catch (err) {
                        console.error(`[pr-browser] OpenAI error for thread ${thread.id}: ${err.message}`);
                    }
                }
                else {
                    console.log(`[pr-browser] no OpenAI key — using fallback title for thread ${thread.id}`);
                }
                newTitles[thread.id] = title;
            }
            return new CommentItem({
                id: thread.id,
                title,
                body: c.body,
                author: c.author,
                isResolved: thread.isResolved,
                url: c.url,
                path: c.path,
                line: c.line,
            });
        }));
        if (Object.keys(newTitles).length > 0) {
            await this.storage.setCachedTitles(pr.id, newTitles);
        }
        await this.storage.setCachedComments(pr.id, items.map(i => i.comment));
        this.commentCache.set(pr.id, items);
        return items;
    }
}
exports.PRProvider = PRProvider;
//# sourceMappingURL=prProvider.js.map