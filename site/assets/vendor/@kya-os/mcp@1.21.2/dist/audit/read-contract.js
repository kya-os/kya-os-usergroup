import { z } from 'zod';
import { auditBundleConsistencyProofSchema, auditBundleInclusionProofSchema, decimalStringSchema, digestSchema, signedAuditEntrySchema, } from './schemas.js';
import { MAX_READ_ENTRIES_LIMIT } from './read-service.js';
/**
 * Network wire contract for the operator-facing audit READ/replay API - the
 * request and response envelopes an HTTP or RPC transport carries. Each
 * envelope is schema-tagged (like the producer event and recorder receipt) so
 * versioning and validation are explicit at the boundary. Responses embed the
 * recorder's own signed artifacts, so a client validates the envelope here and
 * then re-verifies the artifacts with {@link AuditArtifactVerifier}.
 */
export const AUDIT_HEAD_REQUEST_SCHEMA_ID = 'https://schema.kya-os.org/v1/protocol/audit/head-request/v1.0.0';
export const AUDIT_HEAD_RESPONSE_SCHEMA_ID = 'https://schema.kya-os.org/v1/protocol/audit/head-response/v1.0.0';
export const AUDIT_LIST_ENTRIES_REQUEST_SCHEMA_ID = 'https://schema.kya-os.org/v1/protocol/audit/list-entries-request/v1.0.0';
export const AUDIT_LIST_ENTRIES_RESPONSE_SCHEMA_ID = 'https://schema.kya-os.org/v1/protocol/audit/list-entries-response/v1.0.0';
export const AUDIT_INCLUSION_PROOF_REQUEST_SCHEMA_ID = 'https://schema.kya-os.org/v1/protocol/audit/inclusion-proof-request/v1.0.0';
export const AUDIT_INCLUSION_PROOF_RESPONSE_SCHEMA_ID = 'https://schema.kya-os.org/v1/protocol/audit/inclusion-proof-response/v1.0.0';
export const AUDIT_CONSISTENCY_PROOF_REQUEST_SCHEMA_ID = 'https://schema.kya-os.org/v1/protocol/audit/consistency-proof-request/v1.0.0';
export const AUDIT_CONSISTENCY_PROOF_RESPONSE_SCHEMA_ID = 'https://schema.kya-os.org/v1/protocol/audit/consistency-proof-response/v1.0.0';
// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------
const ledgerRefSchema = z.object({
    ledgerId: z.string().min(1).max(256),
    ledgerEpochId: z.string().min(1).max(256),
}).strict();
export const auditHeadSchema = z.object({
    ledgerId: z.string().min(1).max(256),
    ledgerEpochId: z.string().min(1).max(256),
    sequence: decimalStringSchema,
    entryDigest: digestSchema,
}).strict();
function deepFreeze(value) {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value))
        return value;
    for (const child of Object.values(value))
        deepFreeze(child);
    return Object.freeze(value);
}
export const auditHeadRequestSchema = z.object({
    schema: z.literal(AUDIT_HEAD_REQUEST_SCHEMA_ID),
    ledger: ledgerRefSchema,
}).strict();
export const auditHeadResponseSchema = z.object({
    schema: z.literal(AUDIT_HEAD_RESPONSE_SCHEMA_ID),
    head: auditHeadSchema.nullable(),
}).strict();
export const auditListEntriesRequestSchema = z.object({
    schema: z.literal(AUDIT_LIST_ENTRIES_REQUEST_SCHEMA_ID),
    ledger: ledgerRefSchema,
    afterSequence: decimalStringSchema.optional(),
    limit: z.number().int().positive().max(MAX_READ_ENTRIES_LIMIT).optional(),
}).strict();
export const auditListEntriesResponseSchema = z.object({
    schema: z.literal(AUDIT_LIST_ENTRIES_RESPONSE_SCHEMA_ID),
    entries: z.array(signedAuditEntrySchema),
    head: auditHeadSchema.nullable(),
    nextAfterSequence: decimalStringSchema.nullable(),
}).strict();
export const auditInclusionProofRequestSchema = z.object({
    schema: z.literal(AUDIT_INCLUSION_PROOF_REQUEST_SCHEMA_ID),
    ledger: ledgerRefSchema,
    sequence: decimalStringSchema,
}).strict();
export const auditInclusionProofResponseSchema = z.object({
    schema: z.literal(AUDIT_INCLUSION_PROOF_RESPONSE_SCHEMA_ID),
    proof: auditBundleInclusionProofSchema,
}).strict();
export const auditConsistencyProofRequestSchema = z.object({
    schema: z.literal(AUDIT_CONSISTENCY_PROOF_REQUEST_SCHEMA_ID),
    ledger: ledgerRefSchema,
    oldTreeSize: decimalStringSchema,
}).strict();
export const auditConsistencyProofResponseSchema = z.object({
    schema: z.literal(AUDIT_CONSISTENCY_PROOF_RESPONSE_SCHEMA_ID),
    proof: auditBundleConsistencyProofSchema,
}).strict();
// ---------------------------------------------------------------------------
// Parsers - validate untrusted wire input, then freeze.
// ---------------------------------------------------------------------------
export function parseAuditHeadRequest(input) {
    return deepFreeze(auditHeadRequestSchema.parse(input));
}
export function parseAuditHeadResponse(input) {
    return deepFreeze(auditHeadResponseSchema.parse(input));
}
export function parseAuditListEntriesRequest(input) {
    return deepFreeze(auditListEntriesRequestSchema.parse(input));
}
export function parseAuditListEntriesResponse(input) {
    return deepFreeze(auditListEntriesResponseSchema.parse(input));
}
export function parseAuditInclusionProofRequest(input) {
    return deepFreeze(auditInclusionProofRequestSchema.parse(input));
}
export function parseAuditInclusionProofResponse(input) {
    return deepFreeze(auditInclusionProofResponseSchema.parse(input));
}
export function parseAuditConsistencyProofRequest(input) {
    return deepFreeze(auditConsistencyProofRequestSchema.parse(input));
}
export function parseAuditConsistencyProofResponse(input) {
    return deepFreeze(auditConsistencyProofResponseSchema.parse(input));
}
// ---------------------------------------------------------------------------
// Serializers - wrap a read-service result in its wire envelope. A transport
// (e.g. an HTTP recorder) calls these to answer a request.
// ---------------------------------------------------------------------------
export function toAuditHeadResponse(head) {
    return { schema: AUDIT_HEAD_RESPONSE_SCHEMA_ID, head };
}
export function toAuditListEntriesResponse(page) {
    return {
        schema: AUDIT_LIST_ENTRIES_RESPONSE_SCHEMA_ID,
        entries: page.entries,
        head: page.head,
        nextAfterSequence: page.nextAfterSequence,
    };
}
export function toAuditInclusionProofResponse(proof) {
    return { schema: AUDIT_INCLUSION_PROOF_RESPONSE_SCHEMA_ID, proof };
}
export function toAuditConsistencyProofResponse(proof) {
    return { schema: AUDIT_CONSISTENCY_PROOF_RESPONSE_SCHEMA_ID, proof };
}
//# sourceMappingURL=read-contract.js.map