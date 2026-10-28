import { AUDIT_ERROR_CODES, AuditProtocolError } from './errors.js';
export const DEFAULT_READ_ENTRIES_LIMIT = 100;
export const MAX_READ_ENTRIES_LIMIT = 1000;
function clampLimit(limit) {
    if (limit === undefined || !Number.isFinite(limit))
        return DEFAULT_READ_ENTRIES_LIMIT;
    return Math.max(1, Math.min(MAX_READ_ENTRIES_LIMIT, Math.trunc(limit)));
}
function ledgerOf(ref) {
    return { ledgerId: ref.ledgerId, ledgerEpochId: ref.ledgerEpochId };
}
function requireDecimal(value, label) {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, `${label} must be a canonical non-negative decimal string`, { [label]: value });
    }
    return BigInt(value);
}
/**
 * Reference read service backed by an {@link AuditJournalProvider} and, when
 * proofs are needed, an {@link AuditCheckpointReadAccess}.
 *
 * Reads ride the journal's ordered `readRange`, so paging cost is independent of
 * ledger size. Each page is bounded by the head read before it, which decides
 * whether a further page exists.
 */
export class LocalAuditReadService {
    journal;
    checkpoints;
    constructor(deps) {
        this.journal = deps.journal;
        this.checkpoints = deps.checkpoints;
    }
    getHead(ledger) {
        return this.journal.getHead(ledgerOf(ledger));
    }
    async listEntries(query) {
        const limit = clampLimit(query.limit);
        const ledger = ledgerOf(query);
        // The head is read first and bounds the page, so the echoed head and the
        // cursor describe the same snapshot even while appends continue.
        const head = await this.journal.getHead(ledger);
        if (head === null)
            return { entries: [], head, nextAfterSequence: null };
        const headSequence = BigInt(head.sequence);
        const entries = [];
        for await (const entry of this.journal.readRange({
            ...ledger,
            ...(query.afterSequence === undefined ? {} : { afterSequence: query.afterSequence }),
            limit,
        })) {
            if (BigInt(entry.core.sequence) > headSequence)
                break;
            entries.push(entry);
        }
        const last = entries[entries.length - 1];
        const nextAfterSequence = last === undefined || last.core.sequence === head.sequence
            ? null
            : last.core.sequence;
        return { entries, head, nextAfterSequence };
    }
    async getLatestCheckpoint(ledger) {
        return this.requireCheckpoints().store.getLatest(ledgerOf(ledger));
    }
    async getInclusionProof(query) {
        const checkpoints = this.requireCheckpoints();
        const ledger = ledgerOf(query);
        const checkpoint = await this.requireLatestCheckpoint(checkpoints, ledger);
        const entry = await this.entryAtSequence(ledger, query.sequence);
        const proof = await checkpoints.builder.inclusionProof(ledger, query.sequence, checkpoint);
        return Object.freeze({
            ledgerId: ledger.ledgerId,
            ledgerEpochId: ledger.ledgerEpochId,
            sequence: query.sequence,
            entryDigest: entry.entryDigest,
            checkpointDigest: checkpoint.checkpointDigest,
            proof,
        });
    }
    async getConsistencyProof(query) {
        const checkpoints = this.requireCheckpoints();
        const ledger = ledgerOf(query);
        const newCheckpoint = await this.requireLatestCheckpoint(checkpoints, ledger);
        const oldCheckpoint = await checkpoints.store.getByTreeSize(ledger, query.oldTreeSize);
        if (oldCheckpoint === null) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, 'No signed checkpoint exists at the requested old tree size', { oldTreeSize: query.oldTreeSize });
        }
        const proof = await checkpoints.builder.consistencyProof(ledger, query.oldTreeSize, newCheckpoint);
        return Object.freeze({
            ledgerId: ledger.ledgerId,
            ledgerEpochId: ledger.ledgerEpochId,
            oldCheckpointDigest: oldCheckpoint.checkpointDigest,
            newCheckpointDigest: newCheckpoint.checkpointDigest,
            proof,
        });
    }
    requireCheckpoints() {
        if (this.checkpoints === undefined) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.INVALID_CONFIGURATION, 'This read service was built without checkpoint access; proofs are unavailable');
        }
        return this.checkpoints;
    }
    async requireLatestCheckpoint(checkpoints, ledger) {
        const checkpoint = await checkpoints.store.getLatest(ledger);
        if (checkpoint === null) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, 'No signed checkpoint exists for this ledger yet', { ledgerId: ledger.ledgerId });
        }
        return checkpoint;
    }
    async entryAtSequence(ledger, sequence) {
        const value = requireDecimal(sequence, 'sequence');
        // `readRange` is exclusive on afterSequence, so start one below the target.
        const afterSequence = value > 0n ? String(value - 1n) : undefined;
        for await (const entry of this.journal.readRange({
            ...ledger,
            ...(afterSequence === undefined ? {} : { afterSequence }),
            limit: 1,
        })) {
            if (entry.core.sequence === sequence)
                return entry;
            break;
        }
        throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, 'No entry exists at the requested sequence', { sequence });
    }
}
/** One-call composition helper mirroring {@link createLocalAuditRecorder}. */
export function createLocalAuditReadService(deps) {
    return new LocalAuditReadService(deps);
}
//# sourceMappingURL=read-service.js.map