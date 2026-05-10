# PR Browser

A VS Code extension to browse pull request review comments, with AI-generated titles for each comment thread.

## Setup

### 1. GitHub Token

The extension fetches PR review comments via the **GitHub GraphQL API**, which always requires authentication — even for public repositories.

**Create a classic PAT (recommended):**
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**
2. Give it a name (e.g. `pr-browser`)
3. For public repos, no scopes are required — a valid authenticated token is enough. Select `repo` only if you need private repo access.
4. Click **Generate token** and copy it (starts with `ghp_`)

**If you prefer a fine-grained PAT:**
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (fine-grained)**
2. Under **Repository permissions**, set **Pull requests** → **Read-only**
3. Copy the token (starts with `github_pat_`)

**Verify your token works** before adding it to the extension:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -X POST https://api.github.com/graphql \
     -d '{"query":"{ viewer { login } }"}'
# Should return: {"data":{"viewer":{"login":"your-username"}}}
```

**Add it to the extension:**
1. Open the VS Code command palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux)
2. Run **PR Browser: Set GitHub Token**
3. Paste your token — it is stored securely in VS Code's secret storage and never written to disk in plaintext

### 2. OpenAI API Key

The extension uses `gpt-4o-mini` to generate a short title for each review comment thread. If the key is not set, it falls back to the first line of the comment body.

**Get an API key:**
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Click **Create new secret key** and copy it

**Add it to the extension:**
1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run **PR Browser: Set OpenAI API Key**
3. Paste your key — stored in the OS keychain, same as the GitHub token

> Title generation is optional. If no OpenAI key is set, comment titles fall back to the first line of the comment body.

## Usage

1. Click the blob icon in the activity bar to open the PR Browser panel
2. Click **+** to add a PR — paste a GitHub URL or use `owner/repo#123` format
3. Click a PR to expand it and load its review comment threads
4. Click any comment to open it in GitHub
5. Right-click a PR for **Refresh Comments** (re-fetches from GitHub) or **Remove Pull Request**

## Comment icons

| Icon | Meaning |
|------|---------|
| Green filled circle | Thread is resolved |
| Yellow comment | Thread is still open |
