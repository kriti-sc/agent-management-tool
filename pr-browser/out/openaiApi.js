"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCommentTitle = generateCommentTitle;
const openai_1 = require("openai");
async function generateCommentTitle(body, apiKey) {
    console.log(`[pr-browser] openaiApi: sending request, body length=${body.length}`);
    const client = new openai_1.default({ apiKey });
    const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 20,
        messages: [
            {
                role: 'user',
                content: `Write a title of 5 words or fewer summarizing this PR review comment. Reply with the title only:\n\n${body.slice(0, 500)}`,
            },
        ],
    });
    const title = response.choices[0]?.message?.content?.trim() ?? body.slice(0, 60);
    console.log(`[pr-browser] openaiApi: received title="${title}"`);
    return title;
}
//# sourceMappingURL=openaiApi.js.map