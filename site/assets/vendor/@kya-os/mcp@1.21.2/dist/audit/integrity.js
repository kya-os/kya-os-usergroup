import { hashAuditValue } from './crypto.js';
function partyEvidence(party) {
    return party?.kind === 'evidence_ref' ? [party.ref] : [];
}
export function collectAuditEvidenceRefs(event) {
    const detailsEvidence = event.details.family === 'delegation'
        ? event.details.statusEvidence ?? []
        : event.details.family === 'ledger' && event.details.targetEvidenceRef !== undefined
            ? [event.details.targetEvidenceRef]
            : [];
    return [
        ...partyEvidence(event.tenantRef),
        ...partyEvidence(event.source.producer),
        ...partyEvidence(event.session?.ref),
        ...partyEvidence(event.actor),
        ...partyEvidence(event.responsibleParty),
        ...partyEvidence(event.resource),
        ...(event.proof === undefined ? [] : [event.proof]),
        ...event.evidence,
        ...(event.action.detailRef === undefined ? [] : [event.action.detailRef]),
        ...(event.reason?.detailRef === undefined ? [] : [event.reason.detailRef]),
        ...(event.authorization?.statusEvidence ?? []),
        ...detailsEvidence,
    ];
}
export const AUDIT_DIGEST_DOMAINS = Object.freeze({
    event: 'org.kya-os.audit.event.v1',
    entry: 'org.kya-os.audit.entry.v1',
    evidenceManifest: 'org.kya-os.audit.evidence-manifest.v1',
    idempotency: 'org.kya-os.audit.idempotency.v1',
    checkpoint: 'org.kya-os.audit.checkpoint.v1',
    observation: 'org.kya-os.audit.observation.v1',
    bundleManifest: 'org.kya-os.audit.bundle-manifest.v1',
    bundleComponent: 'org.kya-os.audit.bundle-component.v1',
});
export function collectAuditEvidenceManifest(event) {
    return {
        refs: collectAuditEvidenceRefs(event),
    };
}
export function buildAuditRecorderReceiptCore(core, entryDigest) {
    return {
        schema: 'https://schema.kya-os.org/v1/protocol/audit/receipt/v1.0.0',
        ledgerId: core.ledgerId,
        ledgerEpochId: core.ledgerEpochId,
        sequence: core.sequence,
        eventId: core.event.eventId,
        entryDigest,
        previousEntryDigest: core.previousEntryDigest,
        recordedAt: core.recordedAt,
        recorder: core.recorder,
        integritySuite: 'KYA-AUDIT-JCS-SHA256-JWS-2026',
    };
}
export async function digestAuditEvent(hasher, event) {
    return hashAuditValue(hasher, AUDIT_DIGEST_DOMAINS.event, event);
}
export async function digestAuditEntry(hasher, entry) {
    return hashAuditValue(hasher, AUDIT_DIGEST_DOMAINS.entry, entry);
}
export async function digestAuditEvidenceManifest(hasher, event) {
    return hashAuditValue(hasher, AUDIT_DIGEST_DOMAINS.evidenceManifest, collectAuditEvidenceManifest(event));
}
//# sourceMappingURL=integrity.js.map