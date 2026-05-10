import * as vscode from 'vscode';

interface PREntry {
    id: string;
    owner: string;
    repo: string;
    number: number;
    url: string;
    addedAt: string;
}

export class PRItem extends vscode.TreeItem {
    constructor(public readonly pr: PREntry) {
        super(`${pr.owner}/${pr.repo}`, vscode.TreeItemCollapsibleState.None);
        this.id = pr.id;
        this.description = `#${pr.number}`;
        this.tooltip = pr.url;
        this.contextValue = 'pr';
        this.iconPath = new vscode.ThemeIcon('git-pull-request');
    }
}

export class PRProvider implements vscode.TreeDataProvider<PRItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<PRItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly STORAGE_KEY = 'pr-browser.prs';

    constructor(private globalState: vscode.Memento) {}

    private getPRs(): PREntry[] {
        return this.globalState.get<PREntry[]>(this.STORAGE_KEY, []);
    }

    private savePRs(prs: PREntry[]): void {
        this.globalState.update(this.STORAGE_KEY, prs);
        this._onDidChangeTreeData.fire();
    }

    addPR(input: string): void {
        const parsed = this.parsePRInput(input.trim());
        if (!parsed) {
            vscode.window.showErrorMessage(
                'Invalid format. Use a GitHub URL (https://github.com/owner/repo/pull/123) or owner/repo#123.'
            );
            return;
        }

        const prs = this.getPRs();
        const id = `${parsed.owner}/${parsed.repo}#${parsed.number}`;

        if (prs.find(p => p.id === id)) {
            vscode.window.showInformationMessage(`PR ${id} is already in your list.`);
            return;
        }

        const entry: PREntry = {
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

    removePR(id: string): void {
        const prs = this.getPRs().filter(p => p.id !== id);
        this.savePRs(prs);
    }

    private parsePRInput(input: string): { owner: string; repo: string; number: number } | null {
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

    getTreeItem(element: PRItem): vscode.TreeItem {
        return element;
    }

    getChildren(): PRItem[] {
        return this.getPRs().map(pr => new PRItem(pr));
    }
}
