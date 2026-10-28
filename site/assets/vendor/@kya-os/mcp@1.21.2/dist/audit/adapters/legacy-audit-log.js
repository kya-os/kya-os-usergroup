import { AuditLogProvider } from '../../providers/audit-log.js';
/**
 * 1.x compatibility bridge. It captures legacy calls in the new ledger but can
 * claim only legacy/capture coverage because the old shape lacks lifecycle data.
 */
export class LegacyAuditSinkAdapter extends AuditLogProvider {
    trail;
    options;
    capability = 'legacy-capture';
    constructor(trail, options = {}) {
        super();
        this.trail = trail;
        this.options = options;
    }
    async logAuditRecord(context) {
        const verified = context.verified === 'yes';
        await this.trail.record({
            eventType: verified ? 'proof.verified' : 'proof.rejected',
            actor: { kind: this.options.identityKind ?? 'public_did', did: context.identity.did },
            resource: { kind: this.options.resourceKind ?? 'public_did', did: context.session.audience },
            action: { category: 'legacy.audit-record' },
            outcome: verified ? 'succeeded' : 'failed',
            ...(verified ? {} : { reason: { code: 'LEGACY_VERIFICATION_FAILED' } }),
            ...(context.scopeId === undefined ? {} : {
                authorization: {
                    source: 'policy',
                    decision: verified ? 'allowed' : 'denied',
                    scopeId: context.scopeId,
                },
            }),
            evidence: [],
            details: {
                family: 'proof',
                phase: verified ? 'verified' : 'rejected',
                verificationCode: verified ? 'LEGACY_VERIFIED_CLAIM' : 'LEGACY_REJECTED_CLAIM',
            },
        });
    }
    async logEvent(context) {
        const input = {
            eventType: 'configuration.changed',
            actor: { kind: this.options.identityKind ?? 'public_did', did: context.identity.did },
            resource: { kind: this.options.resourceKind ?? 'public_did', did: context.session.audience },
            action: { category: 'legacy.event' },
            outcome: 'unknown',
            reason: { code: 'LEGACY_EVENT_CAPTURE' },
            evidence: [],
            details: {
                family: 'key',
                phase: 'configuration_changed',
            },
        };
        await this.trail.record(input);
    }
}
//# sourceMappingURL=legacy-audit-log.js.map