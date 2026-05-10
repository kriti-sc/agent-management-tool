export interface ReviewThread {
    id: string;
    isResolved: boolean;
    firstComment: {
        id: string;
        body: string;
        author: string;
        path: string | null;
        line: number | null;
        url: string;
    };
    comments: { author: string; body: string }[];
    threadTooLong: boolean;
}

const GRAPHQL_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 6) {
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

const DIFF_HUNK_QUERY = `
  query($nodeId: ID!) {
    node(id: $nodeId) {
      ... on PullRequestReviewComment {
        diffHunk
      }
    }
  }
`;

export async function fetchReviewThreads(
    owner: string,
    repo: string,
    prNumber: number,
    token: string
): Promise<ReviewThread[]> {
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

    const json = await response.json() as {
        data?: { repository?: { pullRequest?: { reviewThreads: { nodes: any[] } } } };
        errors?: { message: string }[];
    };

    if (json.errors?.length) {
        throw new Error(`GitHub GraphQL: ${json.errors[0].message}`);
    }

    const nodes: any[] = json.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];

    return nodes
        .filter(t => t.comments.nodes.length > 0)
        .map(t => {
            const allNodes = t.comments.nodes as any[];
            const c = allNodes[0];
            const threadTooLong = allNodes.length === 6;
            const comments = allNodes.slice(0, 5).map((n: any) => ({
                author: (n.author?.login as string) ?? 'ghost',
                body: n.body as string,
            }));
            return {
                id: t.id as string,
                isResolved: t.isResolved as boolean,
                firstComment: {
                    id: c.id as string,
                    body: c.body as string,
                    author: (c.author?.login as string) ?? 'ghost',
                    path: (c.path as string | null) ?? null,
                    line: (c.line as number | null) ?? null,
                    url: c.url as string,
                },
                comments,
                threadTooLong,
            };
        });
}

export async function fetchDiffHunk(commentNodeId: string, token: string): Promise<string | null> {
    const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: DIFF_HUNK_QUERY,
            variables: { nodeId: commentNodeId },
        }),
    });

    if (!response.ok) {
        throw new Error(`GitHub API error ${response.status}: ${response.statusText}`);
    }

    const json = await response.json() as {
        data?: { node?: { diffHunk?: string } };
        errors?: { message: string }[];
    };

    if (json.errors?.length) {
        throw new Error(`GitHub GraphQL: ${json.errors[0].message}`);
    }

    return json.data?.node?.diffHunk ?? null;
}
