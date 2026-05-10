import * as vscode from 'vscode';
import { PRItem, CommentItem, PRProvider } from './prProvider';
import { Storage } from './storage';
import { openCommentSession } from './claudeSession';

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
                prProvider.addPR(input);
            }
        }),

        vscode.commands.registerCommand('pr-browser.removePR', (item: PRItem) => {
            prProvider.removePR(item.pr.id);
        }),

        vscode.commands.registerCommand('pr-browser.refreshPR', async (item: PRItem) => {
            await prProvider.refreshPR(item.pr.id);
        }),

        vscode.commands.registerCommand('pr-browser.openCommentSession', async (item: CommentItem) => {
            await openCommentSession(item.comment, storage, context.secrets);
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
