import { canonicalizeJson } from '../utils/canonical-json.js';
import { assertAuditCapabilities } from './assurance.js';
import { AuditProtocolError, AUDIT_ERROR_CODES } from './errors.js';
import { collectAuditEvidenceRefs, digestAuditEvent } from './integrity.js';
import { auditOutboxItemKey } from './providers/outbox.js';
import { parseAuditProducerEvent } from './schemas.js';
/** Producer-side service: creates frozen events and applies declared delivery semantics. */
export class AuditTrailService {
    configuration;
    sourceState;
    sourceConstructionTail = Promise.resolve();
    get auditProfile() {
        return this.configuration.capabilities?.profile ?? 'AAP-0';
    }
    get capabilities() {
        return this.configuration.capabilities;
    }
    constructor(configuration) {
        if (configuration.delivery === 'buffered' &&
            configuration.outbox?.capabilities.durability !== 'durable') {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.INVALID_CONFIGURATION, 'Buffered audit delivery requires a durable outbox provider');
        }
        if (configuration.capabilities !== undefined) {
            if (configuration.capabilities.delivery !== configuration.delivery) {
                throw new AuditProtocolError(AUDIT_ERROR_CODES.INVALID_CONFIGURATION, 'Advertised audit delivery does not match the trail delivery mode');
            }
            assertAuditCapabilities(configuration.capabilities);
            if (configuration.capabilities.sourceHighWater &&
                configuration.sourceState.capabilities.durability !== 'durable') {
                throw new AuditProtocolError(AUDIT_ERROR_CODES.INVALID_CONFIGURATION, 'Advertised source high-water support requires durable source state');
            }
        }
        this.configuration = Object.freeze({ ...configuration });
        this.sourceState = configuration.sourceState;
    }
    /**
     * A direct-mode retry is idempotent only when it rebuilds the identical frozen
     * event: callers retrying with a stable `eventId` must also pin `occurredAt`,
     * otherwise the recorder correctly rejects the divergent content as an
     * event-identity conflict. Buffered redelivery is always byte-stable.
     */
    async record(input, options = {}) {
        const eventId = input.eventId ?? this.nextEventId();
        const encryptedEvidence = options.encryptedEvidence ?? [];
        const buffered = this.configuration.delivery === 'buffered';
        const { event, submission } = await this.withSourceConstruction(async () => {
            const builtEvent = await this.buildAndLinkEvent(input, eventId, encryptedEvidence);
            const frozenSubmission = Object.freeze({
                ledgerId: this.configuration.ledgerId,
                // Buffered submissions are never epoch-pinned: a durable outbox item may
                // be redelivered after an epoch rollover, where logical-ledger
                // idempotency (not epoch pinning) carries the retry guarantee.
                ...(buffered || this.configuration.expectedLedgerEpochId === undefined
                    ? {}
                    : { expectedLedgerEpochId: this.configuration.expectedLedgerEpochId }),
                producerEvent: builtEvent,
                encryptedEvidence: Object.freeze([...encryptedEvidence]),
            });
            if (buffered) {
                // Enqueued inside the source-construction lock so items commit to the
                // outbox in claimed source-sequence order for FIFO providers.
                await this.configuration.outbox.enqueue(Object.freeze({
                    eventId: builtEvent.eventId,
                    submission: frozenSubmission,
                    enqueuedAt: this.configuration.clock.now(),
                    attempts: 0,
                }));
            }
            return { event: builtEvent, submission: frozenSubmission };
        });
        if (buffered)
            return { status: 'pending', event };
        let entry;
        try {
            entry = await this.submitAndValidate(submission);
        }
        catch (error) {
            this.configuration.onDeliveryFailure?.(error, event);
            if (this.configuration.delivery === 'required')
                throw error;
            return { status: 'failed', event, error };
        }
        try {
            await this.sourceState.markReceipted(this.configuration.sourceId, event.source.sourceSequence, entry.entryDigest);
        }
        catch (error) {
            // The recorder commit is authoritative and must not be reported as
            // failed: doing so encourages a caller to emit a new event identity.
            this.configuration.onSourceStateFailure?.(error, event);
        }
        return { status: 'recorded', event, entry };
    }
    async flush(limit) {
        if (this.configuration.delivery !== 'buffered')
            return { delivered: 0, failed: 0 };
        let delivered = 0;
        let failed = 0;
        const outbox = this.configuration.outbox;
        const blockedSources = new Set();
        for await (const item of outbox.pending(limit)) {
            const sourceId = item.submission.producerEvent.source.sourceId;
            if (blockedSources.has(sourceId))
                continue;
            // An adapter that predates AuditOutboxItemKey matches items by event ID
            // alone, so it is handed the bare ID it was written for.
            const key = outbox.capabilities.keyedBySource === true
                ? auditOutboxItemKey(item)
                : item.eventId;
            let entry;
            try {
                entry = await this.submitAndValidate(item.submission);
            }
            catch (error) {
                await outbox.markFailed(key, error);
                this.configuration.onDeliveryFailure?.(error, item.submission.producerEvent);
                blockedSources.add(sourceId);
                failed += 1;
                continue;
            }
            // The recorder commit is authoritative from here on: later bookkeeping
            // failures must never be reported as a delivery failure.
            delivered += 1;
            try {
                await this.sourceState.markReceipted(sourceId, item.submission.producerEvent.source.sourceSequence, entry.entryDigest);
            }
            catch (error) {
                this.configuration.onSourceStateFailure?.(error, item.submission.producerEvent);
            }
            try {
                await outbox.markDelivered(key);
            }
            catch (error) {
                this.configuration.onAcknowledgementFailure?.(error, item.submission.producerEvent);
            }
        }
        return { delivered, failed };
    }
    async getSourceState() {
        return this.sourceState.getState(this.configuration.sourceId);
    }
    /** Emits the producer's declared high-water mark as an ordinary chained event. */
    async recordSourceHighWater(input = {}) {
        const state = await this.getSourceState();
        return this.record({
            ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
            eventType: 'audit.source_high_water',
            action: { category: 'audit.source_high_water' },
            outcome: 'succeeded',
            evidence: [],
            details: {
                family: 'administration',
                phase: 'source_high_water',
                sourceSequence: state.highestEmitted,
            },
        });
    }
    async withSourceConstruction(operation) {
        const previous = this.sourceConstructionTail;
        let release;
        this.sourceConstructionTail = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
        }
    }
    async buildAndLinkEvent(input, eventId, encryptedEvidence) {
        const sourceId = this.configuration.sourceId;
        const occurredAt = input.occurredAt ?? this.configuration.clock.now();
        // Everything the source claim does not decide is validated first, so locally
        // rejected input never burns a source sequence or breaks predecessor linkage.
        const provisional = this.buildEvent(input, eventId, occurredAt, { sequence: '0' });
        canonicalizeJson(provisional);
        this.assertEvidenceIsReferenced(provisional, encryptedEvidence);
        const claim = await this.sourceState.claimEvent(sourceId, eventId);
        try {
            const event = this.buildEvent(input, eventId, occurredAt, claim);
            const eventDigest = await digestAuditEvent(this.configuration.hasher, event);
            await this.sourceState.markEmitted(sourceId, eventId, claim.sequence, eventDigest);
            return event;
        }
        catch (error) {
            // The build failure is what the caller must see; a claim that cannot be
            // released stays visible as a pending source gap.
            await this.sourceState.abandonClaim?.(sourceId, eventId, claim.sequence)
                .catch(() => undefined);
            throw error;
        }
    }
    buildEvent(input, eventId, occurredAt, sourceClaim) {
        return parseAuditProducerEvent({
            ...input,
            schema: 'https://schema.kya-os.org/v1/protocol/audit/event/v1.0.0',
            eventId,
            eventVersion: '1.0.0',
            binding: this.configuration.binding,
            occurredAt,
            tenantRef: this.configuration.tenantRef,
            source: {
                producer: this.configuration.producer,
                sourceId: this.configuration.sourceId,
                sourceSequence: sourceClaim.sequence,
                ...(sourceClaim.previousSourceEventDigest === undefined
                    ? {}
                    : { previousSourceEventDigest: sourceClaim.previousSourceEventDigest }),
            },
            privacy: input.privacy ?? this.configuration.privacy,
        });
    }
    nextEventId() {
        if (this.configuration.eventIdFactory !== undefined) {
            return this.configuration.eventIdFactory();
        }
        // Random rather than clock/counter based: trails sharing an outbox or a
        // recorder must never mint the same default event ID.
        return `audit_${crypto.randomUUID()}`;
    }
    assertEvidenceIsReferenced(event, encryptedEvidence) {
        const refs = new Map(collectAuditEvidenceRefs(event).map((ref) => [ref.objectId, ref]));
        const submittedIds = new Set();
        for (const item of encryptedEvidence) {
            const referenced = refs.get(item.ref.objectId);
            if (submittedIds.has(item.ref.objectId) || referenced === undefined ||
                canonicalizeJson(referenced) !== canonicalizeJson(item.ref)) {
                throw new AuditProtocolError(AUDIT_ERROR_CODES.EVIDENCE_FAILURE, 'Encrypted evidence must exactly match one unique reference in the frozen event', { objectId: item.ref.objectId });
            }
            submittedIds.add(item.ref.objectId);
        }
    }
    async submitAndValidate(submission) {
        const entry = await this.configuration.recorder.submit(submission);
        const eventDigest = await digestAuditEvent(this.configuration.hasher, submission.producerEvent);
        // The binding is content-scoped: an entry from an earlier retained epoch is a
        // legitimate logical-ledger duplicate. Epoch placement of new appends is the
        // recorder's envelope guarantee, and epoch claims are recorder-signed and
        // independently verifiable against checkpoints and mirrors.
        if (entry.core.ledgerId !== submission.ledgerId ||
            entry.eventDigest !== eventDigest ||
            entry.core.eventDigest !== eventDigest ||
            canonicalizeJson(entry.core.event) !== canonicalizeJson(submission.producerEvent)) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.JOURNAL_FAILURE, 'Recorder response does not bind the submitted frozen producer event');
        }
        return entry;
    }
}
export function createAuditTrail(configuration) {
    return new AuditTrailService(configuration);
}
//# sourceMappingURL=service.js.map