"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const prProvider_1 = require("./prProvider");
function activate(context) {
    const prProvider = new prProvider_1.PRProvider(context.workspaceState);
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
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map