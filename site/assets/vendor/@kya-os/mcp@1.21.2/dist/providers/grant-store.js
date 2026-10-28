/**
 * GrantStore — the provider seam for an approved authorization grant.
 *
 * Where {@link ResumeTokenStore} holds a *pending* authorization challenge
 * (token → {agentDid, scopes}, awaiting approval), a GrantStore holds the
 * *approved* result one lifecycle step later: a durable grant bound to the
 * agent DID, optionally bound to a session for a no-paste retry.
 *
 * Layering this seam makes explicit:
 *   - the durable authority is the grant, anchored to the **agent DID** (and,
 *     when known, the user DID) — portable across sessions and instances;
 *   - the **session** binding is a transport convenience for wallet-less
 *     clients, and is confused-deputy-safe: a grant bound to one session is
 *     never returned to another;
 *   - the store is pluggable. The in-memory implementation here is the
 *     dev/reference impl; production injects Redis, a Durable Object, or a
 *     database behind the same interface (mirroring {@link NonceCacheProvider}).
 *
 * A grant is the convenience cache of authority, not the authority's proof:
 * possession is still proven per request by the agent's detached-JWS signature
 * over the request (holder-of-key). Storing a grant never substitutes for that.
 */
/**
 * Store for approved authorization grants. Implementations bind a grant,
 * resolve active grants by agent DID or by session, and soft-revoke.
 */
export class GrantStore {
}
/**
 * In-memory {@link GrantStore} — the dev/reference implementation.
 *
 * NOT for production: grants are lost on restart and do not scale past a single
 * process. Inject a Redis / Durable Object / database-backed store instead. A
 * runtime warning is emitted when this is used as a session manager's store
 * (see SessionManager), matching the NonceCacheProvider precedent.
 */
export class MemoryGrantStore extends GrantStore {
    grants = new Map();
    now;
    constructor(options = {}) {
        super();
        this.now = options.now ?? (() => Date.now());
    }
    async bind(grant) {
        this.grants.set(grant.id, structuredClone(grant));
    }
    async getByAgent(agentDid, requiredScopes) {
        return this.activeGrants().filter((g) => g.agentDid === agentDid && this.coversScopes(g, requiredScopes));
    }
    async getBySession(sessionId, requiredScopes) {
        return this.activeGrants().filter((g) => g.sessionId === sessionId && this.coversScopes(g, requiredScopes));
    }
    async getById(id) {
        const grant = this.grants.get(id);
        return grant ? structuredClone(grant) : undefined;
    }
    async revoke(id, reason) {
        const grant = this.grants.get(id);
        if (!grant)
            return;
        grant.status = 'revoked';
        if (reason !== undefined)
            grant.revocationReason = reason;
    }
    async cleanup() {
        const now = this.now();
        for (const [id, grant] of this.grants) {
            if (grant.expiresAt !== undefined && grant.expiresAt <= now) {
                this.grants.delete(id);
            }
        }
    }
    /** Active = explicitly active and not past expiry. */
    activeGrants() {
        const now = this.now();
        const out = [];
        for (const grant of this.grants.values()) {
            if (grant.status !== 'active')
                continue;
            if (grant.expiresAt !== undefined && grant.expiresAt <= now)
                continue;
            out.push(structuredClone(grant));
        }
        return out;
    }
    coversScopes(grant, requiredScopes) {
        if (!requiredScopes || requiredScopes.length === 0)
            return true;
        return requiredScopes.every((s) => grant.scopes.includes(s));
    }
}
//# sourceMappingURL=grant-store.js.map