import * as vscode from 'vscode';
import { PRItem, CommentItem, CommentActionItem, PRProvider } from './prProvider';
import { Storage } from './storage';
import { openCommentSession } from './claudeSession';
import { isDirty, checkoutBranch, createCommentBranch, commitAll, mergeCommentBranch, slugify } from './gitUtils';

export function activate(context: vscode.ExtensionContext) {
    const storage = new Storage(context.workspaceState);
    const prProvider = new PRProvider(storage, context.secrets);

    vscode.window.registerTreeDataProvider('prList', prProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand('pr-browser.addPR', async () => {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter a GitHub PR URL or owner/repo#number',
                placeHolder: 'https://github.com/owner/repo/pull/123  or  owner/repo#123',
            });
            if (input) {
                await prProvider.addPR(input);
            }
        }),

        vscode.commands.registerCommand('pr-browser.removePR', (item: PRItem) => {
            prProvider.removePR(item.pr.id);
        }),

        vscode.commands.registerCommand('pr-browser.refreshPR', async (item: PRItem) => {
            await prProvider.refreshPR(item.pr.id);
        }),

        vscode.commands.registerCommand('pr-browser.openCommentSession', async (item: CommentItem | CommentActionItem) => {
            await openCommentSession(item.comment, storage);
        }),

        vscode.commands.registerCommand('pr-browser.resetCommentSession', async (item: CommentItem | CommentActionItem) => {
            await storage.clearSessionInfo(item.comment.id);
            await openCommentSession(item.comment, storage);
        }),

        vscode.commands.registerCommand('pr-browser.openCommentInBrowser', (item: CommentItem | CommentActionItem) => {
            vscode.env.openExternal(vscode.Uri.parse(item.comment.url));
        }),

        vscode.commands.registerCommand('pr-browser.finalizeCommentBranch', async (item: CommentItem | CommentActionItem) => {
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const commentBranch = `pr-${item.comment.prNumber}/${slugify(item.comment.title)}`;
            const prBranch = item.comment.prBranch;

            if (!prBranch) {
                vscode.window.showErrorMessage('PR branch not available. Try removing and re-adding the PR.');
                return;
            }

            try {
                if (await isDirty(cwd)) {
                    await commitAll(`Address: ${item.comment.title}`, cwd);
                }
                await mergeCommentBranch(commentBranch, prBranch, cwd);
                vscode.window.showInformationMessage(`Merged ${commentBranch} into ${prBranch}.`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Merge failed: ${err.message}`);
            }
        }),

        vscode.commands.registerCommand('pr-browser.checkoutCommentBranch', async (item: CommentItem | CommentActionItem) => {
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const branch = `pr-${item.comment.prNumber}/${slugify(item.comment.title)}`;

            const dirty = await isDirty(cwd);
            if (dirty) {
                vscode.window.showErrorMessage(
                    'You have uncommitted changes. Please commit or stash them before switching to a comment branch.'
                );
                return;
            }

            try {
                await createCommentBranch(branch, cwd);
                vscode.window.showInformationMessage(`Switched to branch: ${branch}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to checkout comment branch: ${err.message}`);
            }
        }),

        vscode.commands.registerCommand('pr-browser.checkoutPRBranch', async (item: PRItem) => {
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const { branch } = item.pr;

            if (!branch) {
                vscode.window.showErrorMessage('Branch name not available for this PR. Try removing and re-adding it.');
                return;
            }

            const dirty = await isDirty(cwd);
            if (dirty) {
                vscode.window.showErrorMessage(
                    'You have uncommitted changes. Please commit or stash them before switching to a PR branch.'
                );
                return;
            }

            try {
                await checkoutBranch(branch, cwd);
                vscode.window.showInformationMessage(`Switched to branch: ${branch}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to checkout branch: ${err.message}`);
            }
        }),

        vscode.commands.registerCommand('pr-browser.setGithubToken', async () => {
            const token = await vscode.window.showInputBox({
                prompt: 'Enter your GitHub Personal Access Token (needs repo scope)',
                password: true,
                placeHolder: 'ghp_...',
            });
            if (token) {
                await context.secrets.store('pr-browser.githubToken', token);
                vscode.window.showInformationMessage('GitHub token saved.');
            }
        }),

        vscode.commands.registerCommand('pr-browser.setOpenAIToken', async () => {
            const key = await vscode.window.showInputBox({
                prompt: 'Enter your OpenAI API Key',
                password: true,
                placeHolder: 'sk-...',
            });
            if (key) {
                await context.secrets.store('pr-browser.openAIToken', key);
                vscode.window.showInformationMessage('OpenAI API key saved.');
            }
        })
    );
}

export function deactivate() {}
