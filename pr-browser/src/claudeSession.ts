import * as vscode from 'vscode';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CommentData, Storage } from './storage';
import { fetchDiffHunk } from './githubApi';

async function buildInitialPrompt(comment: CommentData, secrets: vscode.SecretStorage): Promise<string> {
    const lines: string[] = [
        `I'm reviewing a pull request. Analyse this code review comment for me.`,
        ``,
    ];

    if (comment.path) {
        lines.push(`**File:** \`${comment.path}${comment.line ? `:${comment.line}` : ''}\` (read this file for full context)`);
        lines.push(``);
    }

    const token = await secrets.get('pr-browser.githubToken');
    if (token) {
        try {
            const diffHunk = await fetchDiffHunk(comment.firstCommentId, token);
            if (diffHunk) {
                const hunkLines = diffHunk.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).slice(0, 5);
                if (hunkLines.length > 0) {
                    lines.push(`**Diff:**`);
                    lines.push('```diff');
                    lines.push(hunkLines.join('\n'));
                    lines.push('```');
                    lines.push(``);
                }
            }
        } catch (err: any) {
            console.warn(`[pr-browser] could not fetch diff hunk: ${err.message}`);
        }
    }

    if (comment.threadComments.length <= 1) {
        lines.push(`**Reviewer says:**`);
        lines.push(comment.body);
        lines.push(``);
        lines.push(`Please:`);
        lines.push(`1. Explain what the reviewer is pointing out`);
        lines.push(`2. Describe the implications if this is not addressed`);
        lines.push(`3. Give your opinion on whether the reviewer is correct`);
    } else {
        const reviewerUsername = comment.threadComments[0].author;
        lines.push(`**Review thread:**`);
        lines.push(``);
        for (const c of comment.threadComments) {
            const label = c.author === reviewerUsername ? 'Reviewer' : `@${c.author}`;
            lines.push(`${label}: ${c.body}`);
            lines.push(``);
        }
        if (comment.threadTooLong) {
            lines.push(`⚠️ This thread has more than 5 comments. Consider resolving it offline.`);
            lines.push(``);
        }
        lines.push(`Please:`);
        lines.push(`1. Explain what the reviewer is pointing out`);
        lines.push(`2. Describe the implications if this is not addressed`);
        lines.push(`3. Give your opinion on whether the reviewer is correct, taking the full thread into account`);
    }

    return lines.join('\n');
}

function buildFollowUpPrompt(comment: CommentData, newComments: { author: string; body: string }[]): string {
    const reviewerUsername = comment.threadComments[0].author;
    const lines: string[] = [
        `New replies have been added to this review thread since we last discussed it.`,
        ``,
        `**New discussion:**`,
        ``,
    ];

    for (const c of newComments) {
        const label = c.author === reviewerUsername ? 'Reviewer' : `@${c.author}`;
        lines.push(`${label}: ${c.body}`);
        lines.push(``);
    }

    lines.push(`Please summarize what was discussed in these new replies and suggest the best next steps.`);

    return lines.join('\n');
}

export async function openCommentSession(
    comment: CommentData,
    storage: Storage,
    secrets: vscode.SecretStorage
): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const sessionInfo = storage.getSessionInfo(comment.id);

    // Existing session — check for new replies
    if (sessionInfo) {
        const { sessionId, commentCount } = sessionInfo;
        const newComments = comment.threadComments.slice(commentCount);

        if (newComments.length > 0) {
            console.log(`[pr-browser] ${newComments.length} new reply(s) in thread ${comment.id}, sending follow-up`);
            const followUpPrompt = buildFollowUpPrompt(comment, newComments);

            // Fire follow-up in background, open session straight away
            (async () => {
                try {
                    for await (const _ of query({ prompt: followUpPrompt, options: { resume: sessionId, cwd } })) {}
                } catch (err: any) {
                    console.error(`[pr-browser] follow-up error: ${err.message}`);
                }
            })();

            await storage.setSessionInfo(comment.id, sessionId, comment.threadComments.length);
        } else {
            console.log(`[pr-browser] no new replies, reopening session ${sessionId}`);
        }

        await vscode.env.openExternal(
            vscode.Uri.parse(`vscode://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}`)
        );
        return;
    }

    // No session yet — create one
    console.log(`[pr-browser] creating new Claude Code session for thread ${comment.id}`);
    const prompt = await buildInitialPrompt(comment, secrets);

    let resolveSessionId!: (id: string) => void;
    let rejectSessionId!: (err: Error) => void;
    const sessionIdPromise = new Promise<string>((resolve, reject) => {
        resolveSessionId = resolve;
        rejectSessionId = reject;
    });

    (async () => {
        try {
            for await (const msg of query({ prompt, options: { cwd, allowedTools: ['Read'] } })) {
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

    await storage.setSessionInfo(comment.id, sessionId, comment.threadComments.length);
    await vscode.env.openExternal(
        vscode.Uri.parse(`vscode://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}`)
    );
}
