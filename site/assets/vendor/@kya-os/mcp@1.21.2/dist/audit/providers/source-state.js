import { AUDIT_ERROR_CODES, AuditProtocolError } from '../errors.js';
const DEFAULT_REDELIVERY_WINDOW = 1024;
function publicClaim(claim) {
    return {
        sequence: claim.sequence.toString(),
        ...(claim.previousSourceEventDigest === undefined
            ? {}
            : { previousSourceEventDigest: claim.previousSourceEventDigest }),
    };
}
/**
 * In-process reference source-watermark state. Production AAP-3 needs
 * durability. Memory is bounded by the pending (unreceipted) events plus the
 * redelivery window, however long a gap stays open.
 */
export class MemoryAuditSourceState {
    capabilities = { durability: 'ephemeral', atomicClaim: true };
    states = new Map();
    redeliveryWindow;
    constructor(options = {}) {
        this.redeliveryWindow = options.redeliveryWindow ?? DEFAULT_REDELIVERY_WINDOW;
        if (!Number.isSafeInteger(this.redeliveryWindow) || this.redeliveryWindow < 0) {
            throw new RangeError('Source redelivery window must be a non-negative safe integer');
        }
    }
    async claimEvent(sourceId, eventId) {
        const state = this.state(sourceId);
        const existing = state.claims.get(eventId);
        if (existing !== undefined) {
            if (state.retained.delete(eventId))
                state.retained.add(eventId);
            return publicClaim(existing);
        }
        state.next += 1n;
        const claim = {
            sequence: state.next,
            ...(state.latestDigest === undefined ? {} : { previousSourceEventDigest: state.latestDigest }),
        };
        state.latestDigest = undefined;
        state.claims.set(eventId, claim);
        state.pending.set(claim.sequence, eventId);
        return publicClaim(claim);
    }
    async abandonClaim(sourceId, eventId, sequence) {
        const state = this.state(sourceId);
        const claim = state.claims.get(eventId);
        // An emitted claim may already be in flight, and a later claim has linked
        // past this one; either way the sequence stays a visible pending gap.
        if (claim === undefined || claim.sequence !== BigInt(sequence) ||
            claim.eventDigest !== undefined || claim.sequence !== state.next)
            return;
        state.claims.delete(eventId);
        state.pending.delete(claim.sequence);
        state.next -= 1n;
        state.latestDigest = claim.previousSourceEventDigest;
    }
    async markEmitted(sourceId, eventId, sequence, eventDigest) {
        const state = this.state(sourceId);
        const parsed = BigInt(sequence);
        const claim = state.claims.get(eventId);
        if (claim?.sequence !== parsed)
            throw new RangeError('Unknown source event claim');
        if (claim.eventDigest !== undefined && claim.eventDigest !== eventDigest) {
            // The same conflict the recorder reports for a reused event ID, so a
            // caller sees one error whichever layer catches the divergent content.
            throw new AuditProtocolError(AUDIT_ERROR_CODES.EVENT_ID_CONFLICT, `Source event identity collision: ${eventId}`, { sourceId, eventId });
        }
        claim.eventDigest = eventDigest;
        if (parsed === state.next)
            state.latestDigest = eventDigest;
    }
    async markReceipted(sourceId, sequence) {
        const parsed = BigInt(sequence);
        const state = this.state(sourceId);
        if (parsed < 1n || parsed > state.next)
            throw new RangeError('Unknown source sequence');
        const eventId = state.pending.get(parsed);
        if (eventId === undefined)
            return;
        state.pending.delete(parsed);
        state.retained.add(eventId);
        for (const oldest of state.retained) {
            if (state.retained.size <= this.redeliveryWindow)
                break;
            state.retained.delete(oldest);
            state.claims.delete(oldest);
        }
    }
    async getState(sourceId) {
        const state = this.state(sourceId);
        // Claims take strictly increasing sequences and are only ever removed, so
        // the map's insertion order is already ascending.
        const pending = [...state.pending.keys()];
        return {
            sourceId,
            highestEmitted: state.next.toString(),
            highestReceipted: (pending.length === 0 ? state.next : pending[0] - 1n).toString(),
            pendingSequences: pending.map((value) => value.toString()),
        };
    }
    state(sourceId) {
        const existing = this.states.get(sourceId);
        if (existing !== undefined)
            return existing;
        const created = {
            next: 0n,
            pending: new Map(),
            claims: new Map(),
            retained: new Set(),
        };
        this.states.set(sourceId, created);
        return created;
    }
}
//# sourceMappingURL=source-state.js.map