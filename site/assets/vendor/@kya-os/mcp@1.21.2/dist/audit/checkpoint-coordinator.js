import { AUDIT_ERROR_CODES, AuditProtocolError } from './errors.js';
/**
 * Coordinates post-commit checkpoint publication. A failed publication never
 * rolls back or rewrites the already signed checkpoint.
 */
export class AuditCheckpointCoordinator {
    options;
    observers;
    anchors;
    maxAttempts;
    constructor(options) {
        this.options = options;
        this.observers = options.observers ?? [];
        this.anchors = options.anchors ?? [];
        this.maxAttempts = options.maxPublishAttempts ?? 1;
        if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.INVALID_CONFIGURATION, 'Checkpoint publication attempts must be a positive safe integer');
        }
        const requirements = options.requirements;
        if (requirements !== undefined &&
            (!Number.isSafeInteger(requirements.minimumObservers) ||
                requirements.minimumObservers < 0)) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.INVALID_CONFIGURATION, 'Minimum checkpoint observers must be a non-negative safe integer');
        }
    }
    async createAndPublish(ledger) {
        const checkpoint = await this.options.checkpoints.createCheckpoint(ledger);
        const observations = [];
        const anchors = [];
        const failures = [];
        await Promise.all(this.observers.map(async (provider, providerIndex) => {
            const outcome = await this.publishWithRetry('observer', providerIndex, () => provider.publish(checkpoint));
            if (outcome.ok)
                observations.push(outcome.value);
            else
                failures.push(outcome.failure);
        }));
        await Promise.all(this.anchors.map(async (provider, providerIndex) => {
            const outcome = await this.publishWithRetry('anchor', providerIndex, () => provider.publish(checkpoint), provider.kind);
            if (outcome.ok)
                anchors.push(outcome.value);
            else
                failures.push(outcome.failure);
        }));
        observations.sort((left, right) => left.core.observerId.localeCompare(right.core.observerId));
        anchors.sort((left, right) => left.kind.localeCompare(right.kind) || left.providerId.localeCompare(right.providerId));
        failures.sort((left, right) => left.role.localeCompare(right.role) || left.providerIndex - right.providerIndex);
        const result = { checkpoint, observations, anchors, failures };
        this.assertRequirements(result);
        await this.options.onPublished?.(result);
        return result;
    }
    async publishWithRetry(role, providerIndex, publish, kind) {
        let lastError;
        for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
            try {
                return { ok: true, value: await publish() };
            }
            catch (error) {
                lastError = error;
                if (attempt < this.maxAttempts) {
                    try {
                        await this.options.backoff?.({ role, providerIndex, attempt, error });
                    }
                    catch (backoffError) {
                        return {
                            ok: false,
                            failure: {
                                role,
                                providerIndex,
                                ...(kind === undefined ? {} : { kind }),
                                attempts: attempt,
                                error: new AggregateError([error, backoffError], 'Checkpoint publication backoff failed'),
                            },
                        };
                    }
                }
            }
        }
        return {
            ok: false,
            failure: {
                role,
                providerIndex,
                ...(kind === undefined ? {} : { kind }),
                attempts: this.maxAttempts,
                error: lastError,
            },
        };
    }
    assertRequirements(result) {
        const requirements = this.options.requirements;
        if (requirements === undefined)
            return;
        const missingKinds = [...new Set(requirements.requiredAnchorKinds)].filter((kind) => !result.anchors.some((receipt) => receipt.kind === kind));
        if (result.observations.length < requirements.minimumObservers || missingKinds.length > 0) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_PUBLICATION_FAILED, 'Signed checkpoint did not obtain the required external publication evidence', {
                checkpointDigest: result.checkpoint.checkpointDigest,
                requiredObservers: requirements.minimumObservers,
                publishedObservers: result.observations.length,
                missingAnchorKinds: missingKinds,
                failedProviders: result.failures.map(({ role, providerIndex, kind, attempts }) => ({
                    role,
                    providerIndex,
                    ...(kind === undefined ? {} : { kind }),
                    attempts,
                })),
            });
        }
    }
}
//# sourceMappingURL=checkpoint-coordinator.js.map