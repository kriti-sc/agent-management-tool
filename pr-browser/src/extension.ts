import * as vscode from 'vscode';
import { PRItem, PRProvider } from './prProvider';

export function activate(context: vscode.ExtensionContext) {
    const prProvider = new PRProvider(context.workspaceState);

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
        })
    );
}

export function deactivate() {}
