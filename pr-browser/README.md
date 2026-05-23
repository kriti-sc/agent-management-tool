# PR Browser

A VS Code extension for reviewing GitHub pull request comment threads with AI assistance. It shows your PRs in a sidebar tree view, generates short AI-powered titles for each review thread, and opens a dedicated Claude Code session for any thread so you can work through feedback without leaving the editor.

> **Work in progress.** Expect rough edges — see the [Gotchas](#gotchas) section before using.

---

## Features

- **PR tree view** — add any GitHub PR by URL or `owner/repo#123` shorthand; threads load on expand
- **AI-generated thread titles** — `gpt-4o-mini` summarizes each review thread into a 5-word label (falls back to first line of comment body if no OpenAI key is set)
- **Claude Code sessions per thread** — clicking a comment opens a persistent Claude Code session scoped to that thread, with the relevant file pre-loaded for context
- **Session resumption** — re-clicking a thread reopens the same session; if new replies have been added since the last open, a follow-up prompt is sent automatically before the session opens
- **Session reset** — inline button on threads that already have a session; creates a fresh session from scratch
- **Git branch shortcuts** — one-click checkout of a PR's head branch, or create a per-comment working branch (`pr-{number}/{slugified-title}`)
- **Open in browser** — inline button to open any comment thread on GitHub
- **Context engine** _(experimental)_ — when a thread is resolved, Claude Haiku extracts a structured summary and stores it locally; future sessions can draw on past resolutions from similar files or topics

---

## Requirements

- VS Code 1.85 or later
- [Claude Code extension](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) installed — sessions open via the `vscode://anthropic.claude-code/open` URI
- A GitHub personal access token
- _(Optional)_ OpenAI API key for thread title generation
- _(Optional)_ Anthropic API key for the context engine

---

## Setup

### 1. GitHub Token

The extension uses the GitHub GraphQL API, which requires authentication even for public repositories.

**Create a classic PAT (recommended):**
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**
2. Give it a name (e.g. `pr-browser`)
3. No scopes needed for public repos; add `repo` for private repo access
4. Copy the token (starts with `ghp_`)

**Fine-grained PAT alternative:**
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (fine-grained)**
2. Under **Repository permissions**, set **Pull requests** → **Read-only**
3. Copy the token (starts with `github_pat_`)

**Verify before adding:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -X POST https://api.github.com/graphql \
     -d '{"query":"{ viewer { login } }"}'
# Should return: {"data":{"viewer":{"login":"your-username"}}}
```

**Add to the extension:**
1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run **PR Browser: Set GitHub Token**
3. Paste your token — stored in VS Code's secret storage (OS keychain), never written to disk in plaintext

### 2. OpenAI API Key (optional)

Used to generate 5-word titles for each review thread. If omitted, the first line of the comment body is used as the title.

1. Get a key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Run **PR Browser: Set OpenAI API Key** from the command palette

### 3. Anthropic API Key (optional)

Used by the context engine to summarize resolved threads. Can be set via command palette or the `ANTHROPIC_API_KEY` environment variable.

1. Get a key from [console.anthropic.com](https://console.anthropic.com)
2. Run **PR Browser: Set Anthropic API Key** from the command palette, or set `ANTHROPIC_API_KEY` in your shell environment before launching VS Code

---

## How to Use

1. Click the blob icon in the VS Code activity bar to open the PR Browser panel
2. Click **+** (top of the panel) to add a PR — paste a GitHub PR URL or type `owner/repo#123`
3. Click a PR to expand it and load its review comment threads
4. **Open a Claude session:** click any unresolved comment thread — Claude Code opens with the relevant file loaded and an initial analysis of the reviewer's feedback
5. **Re-open a session:** click the same thread again to resume the existing session; new replies since the last open are fed in automatically as a follow-up
6. **Reset a session:** click the restart icon (appears on threads that already have a session) to start fresh
7. **Open on GitHub:** click the external link icon on any thread to view it in the browser
8. **Checkout branches:**
   - Git branch icon on a PR row → checks out the PR's head branch and pulls
   - Git branch icon on a comment row → creates (or switches to) a branch named `pr-{number}/{slugified-title}` for working on that specific comment
9. **Refresh / remove a PR:** hover the PR row to reveal the refresh and delete buttons

### Comment thread icons

| Icon | Meaning |
|------|---------|
| Green filled circle | Thread is resolved |
| Yellow comment bubble | Thread is still open |

---

## Gotchas

**Claude Code must be installed and running.** Sessions open via a `vscode://` URI. If the Claude Code extension is not installed, nothing will happen when you click a comment.

**Clicking a resolved thread does nothing.** Resolved threads are intentionally inert — no session opens, no browser link either (only the inline browser button works). This is by design but can be surprising.

**Follow-up prompts block before opening.** When you re-click a thread that has new replies, the extension sends a follow-up to Claude and waits before opening the session. There is no visible progress indicator — the panel just appears frozen for a few seconds.

**Thread cap at 5 comments.** Only the first 5 comments in a thread are sent to Claude. Threads with more than 5 replies show a warning in the session prompt and are better resolved by reading the full thread on GitHub.

**Session is scoped to the first workspace folder.** Claude Code sessions are started with `cwd` set to `workspaceFolders[0]`. If you have a multi-root workspace, comments from repos in other roots may point Claude at the wrong directory.

**Title generation is async and may lag.** Titles are fetched from OpenAI in the background when a PR is first expanded. You may briefly see raw comment text before the title arrives. Titles are cached in `workspaceState` across restarts.

**Branch checkout blocks on a dirty working tree.** Both branch commands (`Checkout PR Branch` and `Checkout Comment Branch`) refuse to run if `git status --porcelain` returns any output. Commit or stash your changes first.

**`Checkout PR Branch` runs `git pull` automatically.** This is a fast-forward pull on the head branch — it will fail loudly if the remote history has diverged in a non-fast-forward way.

**The context engine is experimental and not yet surfaced in the UI.** Resolved-thread summaries are extracted and stored in VS Code's global storage (`context-store.json`), but there is currently no UI to browse or search them. The data is there for future use.

**Session state is workspace-scoped.** `workspaceState` (Memento) is per-workspace. If you open the same repo from a different directory or with a different workspace file, previously created session IDs will not carry over.

**No automatic refresh.** The extension does not poll GitHub. Click the refresh button on a PR row to re-fetch comment threads after new reviews come in.

---

## Running Locally

```bash
cd pr-browser
npm install
# Press F5 in VS Code to launch the Extension Development Host
```

The extension is not published to the VS Code Marketplace. It must be run from source via the Extension Development Host or packaged manually with `vsce package`.
