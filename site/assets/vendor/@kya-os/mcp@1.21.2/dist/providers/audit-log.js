/**
 * Audit Log Provider
 *
 * Platform-agnostic seam for retaining KYA-OS audit records and events.
 *
 * The protocol attaches a detached proof to each tool response; an
 * `AuditLogProvider` is the pluggable sink an operator supplies to *persist*
 * those records as an audit trail. The package ships in-memory and no-op
 * defaults — durable backends (Postgres, object storage, append-only log)
 * are operator-provided, keeping the package storage-agnostic exactly like
 * `CryptoProvider` / `NonceCacheProvider`. Audit records are intended for a
 * durable, append-only store; see `SPEC.md` §12.4 (Proof Retention) for guidance.
 */
/**
 * Build a frozen `audit.v1` record from audit context metadata.
 *
 * Privacy: only the DID/key id, session id, audience, scope, request/response
 * hashes, and verification result are captured — never private keys, nonces,
 * or raw request/response payloads.
 */
export function buildAuditRecord(context) {
    return {
        version: "audit.v1",
        ts: Date.now(),
        session: context.session.sessionId,
        audience: context.session.audience,
        did: context.identity.did,
        kid: context.identity.kid,
        reqHash: context.requestHash,
        resHash: context.responseHash ?? "-",
        verified: context.verified,
        scope: context.scopeId ?? "-",
    };
}
/**
 * Pluggable sink for KYA-OS audit records and events.
 *
 * Implementations persist to whatever store a deployment uses. The package
 * ships {@link MemoryAuditLogProvider} (dev/test) and {@link NoopAuditLogProvider}
 * (the default); production deployments supply a durable, append-only impl.
 */
export class AuditLogProvider {
}
/**
 * In-memory {@link AuditLogProvider} for development and testing. Audit records
 * are deduplicated per session; events are not. Inspect via `records`/`events`.
 */
export class MemoryAuditLogProvider extends AuditLogProvider {
    records = [];
    events = [];
    loggedSessions = new Set();
    async logAuditRecord(context) {
        const sessionId = context.session.sessionId;
        if (this.loggedSessions.has(sessionId))
            return;
        this.loggedSessions.add(sessionId);
        this.records.push(buildAuditRecord(context));
    }
    async logEvent(context) {
        this.events.push(context);
    }
}
/**
 * No-op {@link AuditLogProvider}. The default when no audit sink is configured,
 * so the middleware can always invoke the provider without null checks.
 */
export class NoopAuditLogProvider extends AuditLogProvider {
    async logAuditRecord(_context) {
        // intentionally empty
    }
    async logEvent(_context) {
        // intentionally empty
    }
}
//# sourceMappingURL=audit-log.js.map