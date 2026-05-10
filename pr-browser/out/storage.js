"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Storage = void 0;
const KEYS = {
    PRS: 'prs',
    TITLE_CACHE: 'titleCache',
    COMMENT_CACHE: 'commentCache',
};
class Storage {
    constructor(state) {
        this.state = state;
    }
    // --- PRs ---
    getPRs() {
        return this.state.get(KEYS.PRS, []);
    }
    async setPRs(prs) {
        await this.state.update(KEYS.PRS, prs);
    }
    // --- Comment titles (keyed by prId -> threadId so a single PR's titles can be cleared) ---
    getCachedTitle(prId, threadId) {
        return this.state.get(KEYS.TITLE_CACHE, {})[prId]?.[threadId];
    }
    async setCachedTitles(prId, updates) {
        const outer = this.state.get(KEYS.TITLE_CACHE, {});
        await this.state.update(KEYS.TITLE_CACHE, {
            ...outer,
            [prId]: { ...(outer[prId] ?? {}), ...updates },
        });
    }
    async clearCachedTitles(prId) {
        const outer = this.state.get(KEYS.TITLE_CACHE, {});
        const { [prId]: _, ...rest } = outer;
        await this.state.update(KEYS.TITLE_CACHE, rest);
    }
    // --- Comment data (keyed by PR ID) ---
    getCachedComments(prId) {
        return this.state.get(KEYS.COMMENT_CACHE, {})[prId];
    }
    async setCachedComments(prId, comments) {
        const existing = this.state.get(KEYS.COMMENT_CACHE, {});
        await this.state.update(KEYS.COMMENT_CACHE, { ...existing, [prId]: comments });
    }
    async clearCachedComments(prId) {
        const existing = this.state.get(KEYS.COMMENT_CACHE, {});
        const { [prId]: _, ...rest } = existing;
        await this.state.update(KEYS.COMMENT_CACHE, rest);
    }
}
exports.Storage = Storage;
//# sourceMappingURL=storage.js.map