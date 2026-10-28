function ledgerKey(ledger) {
    return `${ledger.ledgerId}\0${ledger.ledgerEpochId}`;
}
function idempotencyKey(ledgerId, key) {
    return `${ledgerId}\0${key}`;
}
function headsEqual(left, right) {
    if (left === null || right === null)
        return left === right;
    return left.ledgerId === right.ledgerId &&
        left.ledgerEpochId === right.ledgerEpochId &&
        left.sequence === right.sequence &&
        left.entryDigest === right.entryDigest;
}
/** Ephemeral reference journal with the same atomic contract as durable adapters. */
export class MemoryAuditJournal {
    capabilities = {
        durability: 'ephemeral',
        atomicAppend: true,
        orderedRead: true,
    };
    entriesByLedger = new Map();
    entriesByIdempotency = new Map();
    heads = new Map();
    async getHead(ledger) {
        return this.heads.get(ledgerKey(ledger)) ?? null;
    }
    async getByIdempotencyKey(ledgerId, key) {
        return this.entriesByIdempotency.get(idempotencyKey(ledgerId, key)) ?? null;
    }
    async compareAndAppend(input) {
        const idKey = idempotencyKey(input.ledger.ledgerId, input.idempotencyKey);
        const existing = this.entriesByIdempotency.get(idKey);
        if (existing !== undefined) {
            return existing.eventDigest === input.entry.eventDigest
                ? { kind: 'duplicate', entry: existing }
                : { kind: 'idempotency_conflict', existing };
        }
        const key = ledgerKey(input.ledger);
        const actualHead = this.heads.get(key) ?? null;
        if (!headsEqual(input.expectedHead, actualHead)) {
            return { kind: 'head_conflict', actualHead };
        }
        const entries = this.entriesByLedger.get(key) ?? [];
        entries.push(input.entry);
        this.entriesByLedger.set(key, entries);
        this.entriesByIdempotency.set(idKey, input.entry);
        this.heads.set(key, {
            ledgerId: input.ledger.ledgerId,
            ledgerEpochId: input.ledger.ledgerEpochId,
            sequence: input.entry.core.sequence,
            entryDigest: input.entry.entryDigest,
        });
        return { kind: 'appended', entry: input.entry };
    }
    async *readRange(query) {
        const snapshot = await this.snapshot(query);
        const after = query.afterSequence === undefined ? null : BigInt(query.afterSequence);
        let yielded = 0;
        for (const entry of snapshot) {
            if (after !== null && BigInt(entry.core.sequence) <= after)
                continue;
            if (query.limit !== undefined && yielded >= query.limit)
                return;
            yielded += 1;
            yield entry;
        }
    }
    async snapshot(ledger) {
        return [...(this.entriesByLedger.get(ledgerKey(ledger)) ?? [])];
    }
}
//# sourceMappingURL=memory-journal.js.map