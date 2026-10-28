import { canonicalizeJson } from '../../utils/canonical-json.js';
export function auditOutboxItemKey(item) {
    return { sourceId: item.submission.producerEvent.source.sourceId, eventId: item.eventId };
}
function storageKey(key) {
    return `${key.sourceId}\0${key.eventId}`;
}
/** Development-only outbox. Buffered assurance requires a durable adapter. */
export class MemoryAuditOutbox {
    // Typed so the new flag stays optional: a subclass that overrides
    // `capabilities` with the earlier shape still compiles. The flag is declared
    // only while acknowledgement runs this class's own key-aware methods; a
    // subclass that overrides them may expect the bare event ID it was written
    // for, so it receives one unless it declares the flag itself.
    capabilities = {
        durability: 'ephemeral',
        fifoPerSource: true,
        ...(this.markDelivered === MemoryAuditOutbox.prototype.markDelivered &&
            this.markFailed === MemoryAuditOutbox.prototype.markFailed
            ? { keyedBySource: true }
            : {}),
    };
    items = new Map();
    async enqueue(item) {
        const key = storageKey(auditOutboxItemKey(item));
        const existing = this.items.get(key);
        if (existing !== undefined) {
            if (!sameSubmission(existing.submission, item.submission)) {
                throw new Error(`Audit outbox event identity collision: ${item.eventId}`);
            }
            return;
        }
        this.items.set(key, item);
    }
    async *pending(limit = Number.MAX_SAFE_INTEGER) {
        let count = 0;
        for (const item of [...this.items.values()]) {
            if (count >= limit)
                return;
            count += 1;
            yield item;
        }
    }
    async markDelivered(key) {
        const stored = this.storedKey(key);
        if (stored !== undefined)
            this.items.delete(stored);
    }
    async markFailed(key) {
        const stored = this.storedKey(key);
        if (stored === undefined)
            return;
        const item = this.items.get(stored);
        if (item !== undefined)
            this.items.set(stored, { ...item, attempts: item.attempts + 1 });
    }
    /**
     * A bare event ID names an item only while exactly one source has it
     * pending. With several, acknowledging any one of them could drop another
     * source's event, so the caller must pass the item's key instead.
     */
    storedKey(key) {
        if (typeof key !== 'string')
            return storageKey(key);
        const matches = [...this.items].filter(([, item]) => item.eventId === key);
        if (matches.length > 1) {
            throw new Error(`Audit outbox event ID ${key} is pending for several sources; pass its AuditOutboxItemKey`);
        }
        return matches[0]?.[0];
    }
}
function sameSubmission(left, right) {
    if (left.ledgerId !== right.ledgerId ||
        left.expectedLedgerEpochId !== right.expectedLedgerEpochId ||
        canonicalizeJson(left.producerEvent) !== canonicalizeJson(right.producerEvent) ||
        left.encryptedEvidence.length !== right.encryptedEvidence.length)
        return false;
    return left.encryptedEvidence.every((item, index) => {
        const other = right.encryptedEvidence[index];
        if (other === undefined || canonicalizeJson(item.ref) !== canonicalizeJson(other.ref) ||
            item.ciphertext.byteLength !== other.ciphertext.byteLength)
            return false;
        let difference = 0;
        for (let offset = 0; offset < item.ciphertext.byteLength; offset += 1) {
            difference |= item.ciphertext[offset] ^ other.ciphertext[offset];
        }
        return difference === 0;
    });
}
//# sourceMappingURL=outbox.js.map