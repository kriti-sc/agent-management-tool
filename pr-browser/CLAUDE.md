# PR Browser — Claude Context

A VS Code extension that displays GitHub PR review comment threads and opens a Claude Code session for each one.

## Source layout

| File | Role |
|------|------|
| `extension.ts` | Activation, command registration, wiring |
| `prProvider.ts` | `TreeDataProvider` — renders PRs and comment threads |
| `githubApi.ts` | GitHub GraphQL: fetch review threads, diff hunks, PR branch |
| `openaiApi.ts` | OpenAI `gpt-4o-mini`: generate 5-word thread titles |
| `storage.ts` | Wrapper over VS Code `workspaceState` (Memento) |
| `claudeSession.ts` | Claude Agent SDK: create/resume/reset sessions per thread |
| `gitUtils.ts` | Git helpers: dirty-check, branch checkout, branch creation |
| `contextEngine.ts` | Claude Haiku: extract & store resolved-thread summaries |

## Key design decisions

**Storage is `workspaceState` (Memento), not files.** VS Code's Memento is the idiomatic persistence layer for extensions and doesn't require managing file paths or permissions.

**Three-tier comment cache in `PRProvider.loadComments`:** in-memory map → persisted `workspaceState` → GitHub API. The first two tiers avoid network calls on expand and across restarts.

**Title generation uses OpenAI, not Claude.** `gpt-4o-mini` is cheap and fast for a 5-word label. Titles are cached in `workspaceState` to avoid repeat API calls on refresh.

**One Claude Code session per thread, persisted by thread ID.** `storage.ts` maps each `threadId → { sessionId, commentCount }`. The comment count is used to detect new replies since the last session open.

**Session resumption flow (`claudeSession.ts`):** if a session exists and has new replies, a follow-up `query()` call is awaited (updating `commentCount`) before the session is opened via `vscode://anthropic.claude-code/open?session=`. If no new replies, the session is just reopened.

**Session reset command.** `pr-browser.resetCommentSession` clears stored session info and creates a fresh session. The inline button only appears when `contextValue == 'commentWithSession'` — set when `CommentItem` is constructed with `hasSession = true`. This avoids showing a reset button on threads that have never been opened.

**Initial prompt tells Claude to read the file; no diff hunk injection.** The prompt includes `(read this file for full context)` next to the file path. The session is created with `allowedTools: ['Read']` and `title: comment.title`. Diff hunk fetching was removed to reduce prompt size — Claude reads the live file instead.

**Thread length cap at 5.** The GraphQL query fetches `comments(first: 6)`. If 6 are returned, `threadTooLong = true` and only the first 5 are kept. Claude's prompt shows a warning to resolve long threads offline.

**Prompt differs for single vs. multi-comment threads.** Single comment: just the reviewer's text. Multi-comment: full thread with speakers labeled as "Reviewer" (first author) vs. `@username` (everyone else).

**Resolved comments are inert.** `CommentItem` only attaches the `openCommentSession` command when `!comment.isResolved`. Clicking a resolved thread does nothing.

**`inFlight` map prevents duplicate fetches.** While a GitHub API call is in-flight for a PR, subsequent `getChildren` calls for the same PR reuse the same promise.

**Git branching flow (`gitUtils.ts`).** Two commands let the user jump to the relevant branch from the tree view:
- `pr-browser.checkoutPRBranch` (on `PRItem`) — checks out the PR's head branch and pulls. Branch name is fetched via `fetchPRBranch` when the PR is added and stored on `PREntry.branch`.
- `pr-browser.checkoutCommentBranch` (on `CommentItem`) — creates (or checks out) a branch named `pr-{prNumber}/{slugified-title}` for working on a specific comment.
Both commands block if the working tree is dirty (`git status --porcelain`) and show an error message.

**Open Comment in Browser button.** `pr-browser.openCommentInBrowser` opens `comment.url` in the default browser. It appears as an inline icon on both `comment` and `commentWithSession` context values.

**`contextEngine.ts` uses tag-overlap scoring, not an API call, for matching.** `ContextStore.findMatching` scores past records by tag overlap with the comment body plus a file-path bonus. No API call needed at match time — only at extraction time (Claude Haiku, called once when a thread resolves).

## Credentials

All secrets are stored in VS Code's `SecretStorage` (OS keychain):
- `pr-browser.githubToken` — GitHub PAT (classic or fine-grained, needs `repo` scope for private repos)
- `pr-browser.openAIToken` — OpenAI key for title generation (optional; falls back to first line of body)
- `pr-browser.anthropicToken` — Anthropic key for `contextEngine.ts` (optional; skipped if absent); also read from `ANTHROPIC_API_KEY` env var

## Running locally

```bash
cd pr-browser
npm install
# Press F5 in VS Code to launch the Extension Development Host
```
