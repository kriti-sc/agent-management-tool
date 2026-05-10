"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRProvider = exports.PRItem = void 0;
const vscode = require("vscode");
class PRItem extends vscode.TreeItem {
    constructor(pr) {
        super(`${pr.owner}/${pr.repo}`, vscode.TreeItemCollapsibleState.None);
        this.pr = pr;
        this.id = pr.id;
        this.description = `#${pr.number}`;
        this.tooltip = pr.url;
        this.contextValue = 'pr';
        this.iconPath = new vscode.ThemeIcon('git-pull-request');
    }
}
exports.PRItem = PRItem;
class PRProvider {
    constructor(globalState) {
        this.globalState = globalState;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.STORAGE_KEY = 'pr-browser.prs';
    }
    getPRs() {
        return this.globalState.get(this.STORAGE_KEY, []);
    }
    savePRs(prs) {
        this.globalState.update(this.STORAGE_KEY, prs);
        this._onDidChangeTreeData.fire();
    }
    addPR(input) {
        const parsed = this.parsePRInput(input.trim());
        if (!parsed) {
            vscode.window.showErrorMessage('Invalid format. Use a GitHub URL (https://github.com/owner/repo/pull/123) or owner/repo#123.');
            return;
        }
        const prs = this.getPRs();
        const id = `${parsed.owner}/${parsed.repo}#${parsed.number}`;
        if (prs.find(p => p.id === id)) {
            vscode.window.showInformationMessage(`PR ${id} is already in your list.`);
            return;
        }
        const entry = {
            id,
            owner: parsed.owner,
            repo: parsed.repo,
            number: parsed.number,
            url: `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.number}`,
            addedAt: new Date().toISOString(),
        };
        this.savePRs([entry, ...prs]);
        vscode.window.showInformationMessage(`Added ${id}`);
    }
    removePR(id) {
        const prs = this.getPRs().filter(p => p.id !== id);
        this.savePRs(prs);
    }
    parsePRInput(input) {
        // GitHub URL: https://github.com/owner/repo/pull/123
        const urlMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (urlMatch) {
            return { owner: urlMatch[1], repo: urlMatch[2], number: parseInt(urlMatch[3]) };
        }
        // Short form: owner/repo#123
        const shortMatch = input.match(/^([^/]+)\/([^#]+)#(\d+)$/);
        if (shortMatch) {
            return { owner: shortMatch[1], repo: shortMatch[2], number: parseInt(shortMatch[3]) };
        }
        return null;
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        return this.getPRs().map(pr => new PRItem(pr));
    }
}
exports.PRProvider = PRProvider;
//# sourceMappingURL=prProvider.js.map