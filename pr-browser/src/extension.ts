import * as vscode from 'vscode';
import { PRItem, CommentItem, PRProvider } from './prProvider';
import { Storage } from './storage';
import { openCommentSession } from './claudeSession';
import { isDirty, checkoutBranch, createCommentBranch, slugify } from './gitUtils';

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

        vscode.commands.registerCommand('pr-browser.openCommentSession', async (item: CommentItem) => {
            await openCommentSession(item.comment, storage);
        }),

        vscode.commands.registerCommand('pr-browser.resetCommentSession', async (item: CommentItem) => {
            await storage.clearSessionInfo(item.comment.id);
            await openCommentSession(item.comment, storage);
        }),

        vscode.commands.registerCommand('pr-browser.checkoutCommentBranch', async (item: CommentItem) => {
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
