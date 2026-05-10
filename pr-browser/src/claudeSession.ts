import * as vscode from 'vscode';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CommentData, Storage } from './storage';
import { fetchDiffHunk } from './githubApi';

async function buildPrompt(comment: CommentData, secrets: vscode.SecretStorage): Promise<string> {
    const lines: string[] = [
        `I'm reviewing a pull request. Analyse this code review comment for me.`,
        ``,
    ];

    if (comment.path) {
        lines.push(`**File:** \`${comment.path}${comment.line ? `:${comment.line}` : ''}\``);
        lines.push(``);
    }

    const token = await secrets.get('pr-browser.githubToken');
    if (token) {
        try {
            const diffHunk = await fetchDiffHunk(comment.firstCommentId, token);
            if (diffHunk) {
                lines.push(`**Code:**`);
                lines.push('```diff');
                lines.push(diffHunk);
                lines.push('```');
                lines.push(``);
            }
        } catch (err: any) {
            console.warn(`[pr-browser] could not fetch diff hunk: ${err.message}`);
        }
    }

    lines.push(`**Reviewer says:**`);
    lines.push(comment.body);
    lines.push(``);
    lines.push(`Please:`);
    lines.push(`1. Explain what the reviewer is pointing out`);
    lines.push(`2. Describe the implications if this is not addressed`);
    lines.push(`3. Give your opinion on whether the reviewer is correct`);

    return lines.join('\n');
}

export async function openCommentSession(
    comment: CommentData,
    storage: Storage,
    secrets: vscode.SecretStorage
): Promise<void> {
    const existingSessionId = storage.getSessionId(comment.id);
    if (existingSessionId) {
        console.log(`[pr-browser] reopening existing session ${existingSessionId}`);
        await vscode.env.openExternal(
            vscode.Uri.parse(`vscode://anthropic.claude-code/open?session=${existingSessionId}`)
        );
        return;
    }

    console.log(`[pr-browser] creating new Claude Code session for thread ${comment.id}`);
    const prompt = await buildPrompt(comment, secrets);
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    let resolveSessionId!: (id: string) => void;
    let rejectSessionId!: (err: Error) => void;
    const sessionIdPromise = new Promise<string>((resolve, reject) => {
        resolveSessionId = resolve;
        rejectSessionId = reject;
    });

    (async () => {
        try {
            for await (const msg of query({ prompt, options: { cwd } })) {
                if (msg.type === 'system' && msg.subtype === 'init') {
                    console.log(`[pr-browser] session created: ${msg.session_id}`);
                    resolveSessionId(msg.session_id);
                }
            }
        } catch (err: any) {
            console.error(`[pr-browser] session error: ${err.message}`);
            rejectSessionId(err);
        }
    })();

    let sessionId: string;
    try {
        sessionId = await Promise.race([
            sessionIdPromise,
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Timed out waiting for session ID')), 15000)
            ),
        ]);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to create Claude Code session: ${err.message}`);
        return;
    }

    await storage.setSessionId(comment.id, sessionId);
    await vscode.env.openExternal(
        vscode.Uri.parse(`vscode://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}`)
    );
}
