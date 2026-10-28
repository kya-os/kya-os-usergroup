import { generateKeyPair } from 'jose';
import { WebCryptoProvider } from '../providers/web-crypto.js';
import { CompactJwsAuditSignatureVerifier, CompactJwsAuditSigner, CryptoProviderAuditHasher, } from './crypto.js';
import { AUDIT_EVENT_SCHEMA_ID } from './schemas.js';
import { AuditRecorderService } from './recorder-service.js';
import { AuditCheckpointBuilder, MemoryAuditCheckpointStore } from './checkpoint.js';
import { AuditArtifactVerifier } from './verifier.js';
import { MemoryAuditJournal } from './providers/memory-journal.js';
import { LocalAuditReadService, } from './read-service.js';
const DEFAULT_LEDGER_ID = 'kya:reference:audit:primary';
const DEFAULT_LEDGER_EPOCH_ID = 'epoch_1';
const REFERENCE_BINDING = 'urn:kya-os:audit-binding:mcp:2025-11-25';
const REFERENCE_PRODUCER_DID = 'did:key:zReferenceProducer';
const REFERENCE_SOURCE_ID = 'reference-recorder';
const REFERENCE_TENANT_AUTHORITY = 'reference-tenant';
const REFERENCE_TENANT_REF = {
    kind: 'keyed_commitment',
    value: `sha256:${'a'.repeat(64)}`,
    keyId: 'reference-tenant-key',
};
/** A minimal, valid tool-call event, so callers can produce history without hand-building the envelope. */
export function sampleAuditEvent(sequence, overrides = {}) {
    return {
        schema: AUDIT_EVENT_SCHEMA_ID,
        eventId: `evt_${sequence}`,
        eventType: 'tool.call.completed',
        eventVersion: '1.0.0',
        binding: REFERENCE_BINDING,
        occurredAt: 1_750_000_000_000 + sequence,
        tenantRef: REFERENCE_TENANT_REF,
        source: {
            producer: { kind: 'pairwise_did', did: REFERENCE_PRODUCER_DID },
            sourceId: REFERENCE_SOURCE_ID,
            sourceSequence: String(sequence),
        },
        action: { category: 'tool.call', name: 'orders.create' },
        outcome: 'succeeded',
        evidence: [],
        details: { family: 'tool', phase: 'completed', attempt: '1' },
        privacy: { classification: 'internal', retentionClass: 'audit-365d' },
        ...overrides,
    };
}
/** Compose an in-memory reference recorder with a freshly generated Ed25519 signing key. */
export async function createInMemoryReferenceRecorder(options = {}) {
    const ledger = {
        ledgerId: options.ledgerId ?? DEFAULT_LEDGER_ID,
        ledgerEpochId: options.ledgerEpochId ?? DEFAULT_LEDGER_EPOCH_ID,
    };
    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: false });
    const signerRef = {
        did: 'did:key:zReferenceRecorder',
        kid: 'did:key:zReferenceRecorder#0',
        alg: 'EdDSA',
    };
    const keyResolver = {
        async resolve(candidate) {
            return candidate.kid === signerRef.kid ? publicKey : null;
        },
    };
    const hasher = new CryptoProviderAuditHasher(new WebCryptoProvider());
    const signer = new CompactJwsAuditSigner(signerRef, privateKey);
    const journal = new MemoryAuditJournal();
    const clock = options.clock ?? { now: () => Date.now() };
    const recorder = new AuditRecorderService({
        ledgerId: ledger.ledgerId,
        ledgerEpochId: ledger.ledgerEpochId,
        tenantRef: REFERENCE_TENANT_REF,
        binding: REFERENCE_BINDING,
        sourceId: REFERENCE_SOURCE_ID,
        journal,
        signer,
        hasher,
        clock,
    });
    const checkpointStore = new MemoryAuditCheckpointStore();
    const checkpointBuilder = new AuditCheckpointBuilder({
        journal,
        store: checkpointStore,
        signer,
        hasher,
        clock,
    });
    const read = new LocalAuditReadService({
        journal,
        checkpoints: { builder: checkpointBuilder, store: checkpointStore },
    });
    const verifier = new AuditArtifactVerifier({
        hasher,
        signatures: new CompactJwsAuditSignatureVerifier(keyResolver),
    });
    const verificationPolicy = {
        policyId: 'policy:reference-recorder',
        trustedLedgerEpochs: [{
                ledgerId: ledger.ledgerId,
                ledgerEpochId: ledger.ledgerEpochId,
                recorderKeys: [{ signer: signerRef }],
            }],
        trustedObservers: [],
        authorizedExporters: [],
        acceptedIntegritySuites: [
            'KYA-AUDIT-JCS-SHA256-JWS-2026',
            'KYA-AUDIT-RFC9162-SHA256-JWS-2026',
        ],
        acceptedAlgorithms: ['EdDSA'],
        keyRevocationMode: 'as_observed',
    };
    return {
        ledger,
        signerRef,
        read,
        checkpoints: { builder: checkpointBuilder, store: checkpointStore },
        verifier,
        verificationPolicy,
        async submit(event) {
            return recorder.submitAuthenticated({
                ledgerId: ledger.ledgerId,
                producerEvent: event,
                encryptedEvidence: [],
            }, {
                producerAuthority: REFERENCE_PRODUCER_DID,
                tenantAuthority: REFERENCE_TENANT_AUTHORITY,
                tenantRef: REFERENCE_TENANT_REF,
            });
        },
        async checkpoint() {
            return checkpointBuilder.createCheckpoint(ledger);
        },
    };
}
//# sourceMappingURL=reference-recorder.js.map