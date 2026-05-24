# PR Browser — Design Document

## Overview

PR Browser is a VS Code extension that surfaces GitHub pull request review comment threads in the sidebar and opens a dedicated Claude Code session for each one. The goal is to let a developer work through PR review feedback without context-switching between GitHub and their editor.

---

## High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      VS Code sidebar                         │
│                                                              │
│  PRItem (owner/repo #N)  [🔀 checkout PR branch button]      │
│    └── CommentItem (thread title)  ← click to expand        │
│          ├── file/path.ts  :42                               │
│          ├── Open on GitHub                                  │
│          ├── Open in Claude Code    (unresolved only)        │
│          ├── Checkout Branch                                 │
│          ├── Finalize Branch                                 │
│          └── Reset Session          (if session exists)      │
│    └── CommentItem (resolved)  ← same, no Claude row         │
└──────────────────────────────────────────────────────────────┘
                │ commands
┌───────────────▼──────────────────────────────────────┐
│                    extension.ts                      │
│  (activation, command registration, wiring)          │
└──┬──────────┬──────────┬──────────────┬──────────────┘
   │          │          │              │
   ▼          ▼          ▼              ▼
prProvider  claudeSession  gitUtils  contextEngine
   │             │
   ▼             ▼
githubApi    Claude Agent SDK
openaiApi
   │
   ▼
storage (VS Code workspaceState)
```

**Data flow on first open:**
1. User adds a PR → `prProvider.addPR` parses input, calls `fetchPRBranch`, persists to `workspaceState`
2. User expands the PR → `prProvider.getChildren` triggers `fetchReviewThreads` (GitHub GraphQL)
3. Titles are generated via OpenAI (or fallback) and cached
4. Comment data is persisted to `workspaceState`
5. User expands a comment → detail and action rows are rendered inline
6. User clicks "Open in Claude Code" → `claudeSession.openCommentSession` creates/resumes a Claude Code session

---

## Components

### `prProvider.ts` — tree view

Implements VS Code's `TreeDataProvider`. The tree has four node types:
- `PRItem` — represents a tracked PR; `contextValue = 'pr'`
- `CommentItem` — represents a review thread; `contextValue = 'comment'` or `'commentWithSession'`; collapsible
- `CommentDetailItem` — read-only info row (file path); `contextValue = 'commentDetail'`
- `CommentActionItem` — clickable action row that fires a command on click; `contextValue = 'commentAction'`

Clicking a `CommentItem` expands it to show its children. The children are built on demand by `buildCommentChildren` and never cached — they are cheap to reconstruct from the already-cached `CommentData`.

Comment loading uses a three-tier cache to avoid redundant work:

```
loadComments(pr)
  ├── 1. in-memory Map        — zero cost, same VS Code session
  ├── 2. workspaceState       — survives restarts, no network
  └── 3. GitHub GraphQL API   — only on first expand or explicit refresh
```

An `inFlight` map holds the in-progress promise for each PR, so rapid expand/collapse doesn't fire duplicate API calls.

---

### `githubApi.ts` — GitHub data fetching

All GitHub access goes through the GraphQL API (REST is not used). Three queries:

| Function | Query | Purpose |
|---|---|---|
| `fetchReviewThreads` | `pullRequest.reviewThreads` | All review threads with up to 6 comments each |
| `fetchDiffHunk` | `node(id:) { ... on PullRequestReviewComment }` | Diff hunk for a single comment (separate because `diffHunk` lives on the comment node, not the thread) |
| `fetchPRBranch` | `pullRequest.headRefName` | Head branch name, fetched once when adding a PR |

The thread query fetches `comments(first: 6)`. Receiving exactly 6 signals the thread is longer than 5; the 6th comment is discarded and `threadTooLong` is set. This avoids a separate count query.

---

### `openaiApi.ts` — comment titles

Calls `gpt-4o-mini` with `max_tokens: 20` to produce a ≤5-word label for each thread. The model is given the first 500 characters of the comment body.

OpenAI is used instead of Claude here because the task is purely a short label — latency and cost matter more than reasoning quality at this step. Titles are cached in `workspaceState` keyed by `prId → threadId`, so the API is only called once per thread (not on every refresh).

If no OpenAI key is set, the title falls back to the first line of the comment body, truncated to 60 characters.

---

### `storage.ts` — persistence

Wraps VS Code's `Memento` (`workspaceState`). All data is scoped to the current workspace. Four keys:

| Key | Type | Contents |
|---|---|---|
| `prs` | `PREntry[]` | List of tracked PRs (owner, repo, number, branch) |
| `titleCache` | `{[prId]: {[threadId]: string}}` | OpenAI-generated titles |
| `commentCache` | `{[prId]: CommentData[]}` | Full thread data |
| `sessionIds` | `{[threadId]: {sessionId, commentCount}}` | Claude Code session state |

`commentCount` in `sessionIds` records how many thread comments existed when the session was last opened. This is compared against the live thread length to detect new replies.

---

### `claudeSession.ts` — Claude Code sessions

Each review thread gets its own persistent Claude Code session, identified by the thread's GitHub node ID.

**Creating a session:**
```
query({ prompt, options: { cwd, allowedTools: ['Read'], title } })
  → listen for system/init message → extract session_id
  → persist to storage
  → open vscode://anthropic.claude-code/open?session=<id>
```

The session is created with `allowedTools: ['Read']` — Claude can read files in the workspace but cannot execute commands. This is intentional: the session is for analysis and discussion, not automated edits.

The initial prompt includes the file path with a `(read this file for full context)` hint. Claude fetches the live file content itself rather than having the diff hunk injected. This keeps the prompt smaller and means Claude sees the current state of the file, not the state at review time.

**Resuming a session:**
If a session already exists for the thread:
1. Compare `threadComments.length` against stored `commentCount`
2. If new replies exist, send a follow-up prompt via `query({ resume: sessionId })` and await it
3. Update `commentCount` in storage
4. Open the session via the URI scheme

**Resetting a session:**
`resetCommentSession` calls `storage.clearSessionInfo(threadId)` then calls `openCommentSession`, which sees no existing session and creates a fresh one. Useful when the conversation has gone stale or the thread has changed significantly.

---

### `gitUtils.ts` — branch management

Provides three user-facing workflows that together form the comment branch lifecycle:

**Checkout PR branch** (`checkoutPRBranch`):
- Triggered by the inline `$(git-branch)` button on a `PRItem`
- Branch name is stored on `PREntry.branch`, fetched from GitHub when the PR is added
- Runs `git checkout <branch>` then `git pull`
- Blocks if dirty

**Checkout comment branch** (`checkoutCommentBranch`):
- Triggered by the "Checkout Branch" action row on a `CommentItem`
- Branch name is derived: `pr-{prNumber}/{slugify(title)}`
- Attempts `git checkout -b <branch>`; if the branch already exists, falls back to `git checkout <branch>`
- Blocks if dirty

**Finalize comment branch** (`finalizeCommentBranch`):
- Triggered by the "Finalize Branch" action row on a `CommentItem`
- If the working tree is dirty, runs `git commit -m "Address: <title>"` (staged changes only) before proceeding
- Runs `git checkout <prBranch>` then `git merge <commentBranch>`
- `prBranch` comes from `CommentData.prBranch`, which is propagated from `PREntry.branch` at comment-fetch time

The branch naming convention (`pr-{number}/{slug}`) groups all comment branches for a PR under a common prefix in git log/branch listings, is human-readable, and avoids cross-PR collisions.

---

### `contextEngine.ts` — resolved thread memory

When a thread resolves, `extractContextRecord` calls Claude Haiku to produce a structured summary:

```json
{
  "issueSummary": "one sentence",
  "resolution": "one sentence",
  "tags": ["kebab-case", "labels", ...]
}
```

Records are stored in `globalStorageUri/context-store.json` (not `workspaceState` — this is intentionally cross-workspace).

`ContextStore.findMatching` scores stored records against a new comment without any API call:
- +3 if the file path matches exactly
- +2 per tag that appears as a whole word in the comment body
- +1 per tag where any hyphen-separated part appears in the comment body

This makes past context available to enrich the Claude session prompt for related threads, cheaply.

---

## Feature: adding a PR

1. Command palette → **PR Browser: Add PR**
2. Input accepted as full GitHub URL or `owner/repo#number`
3. `fetchPRBranch` is called immediately to store the head branch alongside the PR entry
4. PR is prepended to the list (newest first) in `workspaceState`
5. Tree view refreshes

---

## Feature: loading review threads

1. User expands a `PRItem`
2. `loadComments` checks in-memory cache, then persisted cache, then calls GitHub
3. GitHub returns up to 100 threads; each thread returns up to 6 comments
4. Titles are resolved: cached title → OpenAI → first-line fallback
5. `CommentItem` is constructed with `hasSession = true` if a Claude session already exists for the thread (controls whether the reset button is shown)
6. Data is written to both in-memory cache and `workspaceState`

---

## Feature: Claude Code session per thread

See `claudeSession.ts` section above. The key invariant: **one session per GitHub thread node ID**, persisted across VS Code restarts. The session is never recreated unless the user explicitly resets it.

---

## Feature: git branching

The full intended workflow:

1. **Add PR** → `fetchPRBranch` stores the head branch name on `PREntry`
2. **Click `$(git-branch)` on PR row** → checkout PR branch + pull (blocks if dirty)
3. **Click "Checkout Branch" on comment** → create/reuse `pr-{N}/{slug}` branch (blocks if dirty)
4. Make code changes to address the comment
5. **Click "Finalize Branch" on comment** → auto-commit if dirty, then merge comment branch into PR branch

See `gitUtils.ts` section above for implementation details.

---

## Credentials and secret storage

All API keys are stored in VS Code's `SecretStorage`, which uses the OS keychain (Keychain on macOS, Credential Manager on Windows, libsecret on Linux). Keys are never written to disk in plaintext.

| Secret key | Used by | Required |
|---|---|---|
| `pr-browser.githubToken` | GitHub GraphQL API | Yes |
| `pr-browser.openAIToken` | Comment title generation | No (falls back to first line) |
| `pr-browser.anthropicToken` | `contextEngine.ts` | No (skipped if absent) |

`contextEngine.ts` also checks `process.env.ANTHROPIC_API_KEY` before the secret store, so it works in development without going through the command palette.
