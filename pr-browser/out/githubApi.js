"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchReviewThreads = fetchReviewThreads;
const GRAPHQL_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 1) {
              nodes {
                id
                body
                author { login }
                path
                line
                url
              }
            }
          }
        }
      }
    }
  }
`;
async function fetchReviewThreads(owner, repo, prNumber, token) {
    const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: GRAPHQL_QUERY,
            variables: { owner, repo, number: prNumber },
        }),
    });
    if (!response.ok) {
        throw new Error(`GitHub API error ${response.status}: ${response.statusText}`);
    }
    const json = await response.json();
    if (json.errors?.length) {
        throw new Error(`GitHub GraphQL: ${json.errors[0].message}`);
    }
    const nodes = json.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    return nodes
        .filter(t => t.comments.nodes.length > 0)
        .map(t => {
        const c = t.comments.nodes[0];
        return {
            id: t.id,
            isResolved: t.isResolved,
            firstComment: {
                id: c.id,
                body: c.body,
                author: c.author?.login ?? 'ghost',
                path: c.path ?? null,
                line: c.line ?? null,
                url: c.url,
            },
        };
    });
}
//# sourceMappingURL=githubApi.js.map