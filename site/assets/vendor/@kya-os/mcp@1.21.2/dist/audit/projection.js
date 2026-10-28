import { AUDIT_ERROR_CODES, AuditProtocolError } from './errors.js';
function key(projectionId, ledger) {
    return `${projectionId}\0${ledger.ledgerId}\0${ledger.ledgerEpochId}`;
}
function offsetsEqual(left, right) {
    if (left === null || right === null)
        return left === right;
    return left.sequence === right.sequence && left.entryDigest === right.entryDigest;
}
function project(entry) {
    const event = entry.core.event;
    return Object.freeze({
        ledgerId: entry.core.ledgerId,
        ledgerEpochId: entry.core.ledgerEpochId,
        sequence: entry.core.sequence,
        entryDigest: entry.entryDigest,
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        recordedAt: entry.core.recordedAt,
        outcome: event.outcome,
        ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }),
        ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
        chainStatus: 'chained',
    });
}
/** Ephemeral reference projection. It is disposable and never an integrity authority. */
export class MemoryAuditProjectionProvider {
    capabilities = { durability: 'ephemeral', atomicOffset: true };
    offsets = new Map();
    records = new Map();
    async getOffset(projectionId, ledger) {
        const offset = this.offsets.get(key(projectionId, ledger));
        return offset === undefined ? null : { ...offset };
    }
    async compareAndApply(input) {
        const projectionKey = key(input.projectionId, input.ledger);
        const actualOffset = this.offsets.get(projectionKey) ?? null;
        const existing = this.records.get(projectionKey)?.find((record) => record.sequence === input.entry.core.sequence);
        if (existing !== undefined) {
            return existing.entryDigest === input.entry.entryDigest
                ? { kind: 'duplicate' }
                : { kind: 'conflict', actualOffset };
        }
        if (!offsetsEqual(actualOffset, input.expectedOffset)) {
            return { kind: 'conflict', actualOffset };
        }
        const expectedSequence = actualOffset === null ? 0n : BigInt(actualOffset.sequence) + 1n;
        if (BigInt(input.entry.core.sequence) !== expectedSequence) {
            return { kind: 'conflict', actualOffset };
        }
        const records = this.records.get(projectionKey) ?? [];
        records.push(Object.freeze({ ...input.record }));
        this.records.set(projectionKey, records);
        this.offsets.set(projectionKey, {
            sequence: input.entry.core.sequence,
            entryDigest: input.entry.entryDigest,
        });
        return { kind: 'applied' };
    }
    async reset(projectionId, ledger) {
        const projectionKey = key(projectionId, ledger);
        this.offsets.delete(projectionKey);
        this.records.delete(projectionKey);
    }
    async read(projectionId, ledger) {
        return (this.records.get(key(projectionId, ledger)) ?? []).map((record) => ({ ...record }));
    }
    /** Explicit fault-injection seam for adapter conformance and recovery tests. */
    corruptOffsetForTesting(projectionId, ledger, offset) {
        this.offsets.set(key(projectionId, ledger), { ...offset });
    }
}
/** Deterministically derives query/UI state from the immutable ledger. */
export class AuditProjectionWorker {
    options;
    constructor(options) {
        this.options = options;
        if (!options.projectionId) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.INVALID_CONFIGURATION, 'Projection ID is required');
        }
    }
    async synchronize(ledger) {
        let offset = await this.options.projections.getOffset(this.options.projectionId, ledger);
        let applied = 0;
        let duplicates = 0;
        for await (const entry of this.options.journal.readRange({
            ...ledger,
            ...(offset === null ? {} : { afterSequence: offset.sequence }),
        })) {
            // The offset digest must be the predecessor the journal itself records;
            // otherwise the projection was built from a different (forked) history.
            if (entry.core.previousEntryDigest !== (offset?.entryDigest ?? null)) {
                throw new AuditProtocolError(AUDIT_ERROR_CODES.PROJECTION_CONFLICT, 'Journal entry does not chain from the projection offset', { sequence: entry.core.sequence, expectedOffset: offset });
            }
            const result = await this.options.projections.compareAndApply({
                projectionId: this.options.projectionId,
                ledger,
                expectedOffset: offset,
                entry,
                record: project(entry),
            });
            if (result.kind === 'conflict') {
                throw new AuditProtocolError(AUDIT_ERROR_CODES.PROJECTION_CONFLICT, 'Projection offset conflicted with the ordered ledger', {
                    sequence: entry.core.sequence,
                    expectedOffset: offset,
                    actualOffset: result.actualOffset,
                });
            }
            if (result.kind === 'applied')
                applied += 1;
            else
                duplicates += 1;
            offset = { sequence: entry.core.sequence, entryDigest: entry.entryDigest };
        }
        return { applied, duplicates };
    }
    async rebuild(ledger) {
        await this.options.projections.reset(this.options.projectionId, ledger);
        return this.synchronize(ledger);
    }
    async reconcile(ledger) {
        const [journalHead, projectionHead] = await Promise.all([
            this.options.journal.getHead(ledger),
            this.options.projections.getOffset(this.options.projectionId, ledger),
        ]);
        let status;
        if (journalHead === null && projectionHead === null)
            status = 'empty';
        else if (journalHead !== null && projectionHead === null)
            status = 'pending';
        else if (journalHead === null || projectionHead === null)
            status = 'gap_detected';
        else if (journalHead.sequence === projectionHead.sequence) {
            status = journalHead.entryDigest === projectionHead.entryDigest
                ? 'verified'
                : 'gap_detected';
        }
        else if (BigInt(projectionHead.sequence) < BigInt(journalHead.sequence)) {
            // Behind is only `pending` when the projected prefix is the journal's.
            const journalEntry = await this.entryAt(ledger, projectionHead.sequence);
            status = journalEntry?.entryDigest === projectionHead.entryDigest
                ? 'pending'
                : 'gap_detected';
        }
        else {
            status = 'gap_detected';
        }
        return { status, journalHead, projectionHead };
    }
    async entryAt(ledger, sequence) {
        const value = BigInt(sequence);
        for await (const entry of this.options.journal.readRange({
            ...ledger,
            ...(value > 0n ? { afterSequence: String(value - 1n) } : {}),
            limit: 1,
        })) {
            return entry.core.sequence === sequence ? entry : undefined;
        }
        return undefined;
    }
}
//# sourceMappingURL=projection.js.map