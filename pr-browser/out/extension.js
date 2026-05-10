"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const prProvider_1 = require("./prProvider");
const storage_1 = require("./storage");
function activate(context) {
    const storage = new storage_1.Storage(context.workspaceState);
    const prProvider = new prProvider_1.PRProvider(storage, context.secrets);
    vscode.window.registerTreeDataProvider('prList', prProvider);
    context.subscriptions.push(vscode.commands.registerCommand('pr-browser.addPR', async () => {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter a GitHub PR URL or owner/repo#number',
            placeHolder: 'https://github.com/owner/repo/pull/123  or  owner/repo#123',
        });
        if (input) {
            prProvider.addPR(input);
        }
    }), vscode.commands.registerCommand('pr-browser.removePR', (item) => {
        prProvider.removePR(item.pr.id);
    }), vscode.commands.registerCommand('pr-browser.refreshPR', async (item) => {
        await prProvider.refreshPR(item.pr.id);
    }), vscode.commands.registerCommand('pr-browser.setGithubToken', async () => {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your GitHub Personal Access Token (needs repo scope)',
            password: true,
            placeHolder: 'ghp_...',
        });
        if (token) {
            await context.secrets.store('pr-browser.githubToken', token);
            vscode.window.showInformationMessage('GitHub token saved.');
        }
    }), vscode.commands.registerCommand('pr-browser.setOpenAIToken', async () => {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your OpenAI API Key',
            password: true,
            placeHolder: 'sk-...',
        });
        if (key) {
            await context.secrets.store('pr-browser.openAIToken', key);
            vscode.window.showInformationMessage('OpenAI API key saved.');
        }
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map