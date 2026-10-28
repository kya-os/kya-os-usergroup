import { canonicalizeJsonBytes } from '../../utils/canonical-json.js';
import { hashAuditValue } from '../crypto.js';
import { AUDIT_DIGEST_DOMAINS } from '../integrity.js';
import { AUDIT_ERROR_CODES, AuditProtocolError } from '../errors.js';
function key(ledger) {
    return `${ledger.ledgerId}\0${ledger.ledgerEpochId}`;
}
export class MemoryAuditCheckpointObserver {
    config;
    capability = 'independent-observer';
    observations = new Map();
    publicationTails = new Map();
    constructor(config) {
        this.config = config;
    }
    async publish(checkpoint) {
        const publicationKey = key({
            ledgerId: checkpoint.core.ledgerId,
            ledgerEpochId: checkpoint.core.ledgerEpochId,
        });
        const previous = this.publicationTails.get(publicationKey) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const tail = previous.then(() => gate);
        this.publicationTails.set(publicationKey, tail);
        await previous;
        try {
            return await this.publishSerialized(checkpoint);
        }
        finally {
            release();
            if (this.publicationTails.get(publicationKey) === tail) {
                this.publicationTails.delete(publicationKey);
            }
        }
    }
    async publishSerialized(checkpoint) {
        if (!(await this.config.verifyCheckpoint(checkpoint))) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, 'Observer rejected an invalid checkpoint');
        }
        const ledger = {
            ledgerId: checkpoint.core.ledgerId,
            ledgerEpochId: checkpoint.core.ledgerEpochId,
        };
        const existing = this.observations.get(key(ledger));
        if (existing !== undefined) {
            const previousSize = BigInt(existing.checkpoint.core.treeSize);
            const nextSize = BigInt(checkpoint.core.treeSize);
            if (nextSize < previousSize) {
                throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_ROLLBACK, 'Observed checkpoint tree size moved backwards');
            }
            if (nextSize === previousSize) {
                if (checkpoint.core.rootDigest !== existing.checkpoint.core.rootDigest ||
                    checkpoint.checkpointDigest !== existing.checkpoint.checkpointDigest) {
                    throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_CONFLICT, 'Conflicting checkpoint roots were observed at the same tree size');
                }
                return existing.receipt;
            }
            // Direct-successor linkage is deliberately not required: an observer that
            // missed intermediate publications catches up on any gapped extension,
            // as long as tree consistency with its last observation verifies
            // cryptographically. The consistency proof, not the checkpoint chain
            // link, is the split-view guarantee.
            if (!(await this.config.verifyConsistency(existing.checkpoint, checkpoint))) {
                throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_CONFLICT, 'Checkpoint does not consistently extend the previously observed tree');
            }
        }
        const core = {
            schema: 'https://schema.kya-os.org/v1/protocol/audit/observation/v1.0.0',
            observerId: this.config.observerId,
            observer: this.config.signer.ref,
            ledgerId: checkpoint.core.ledgerId,
            ledgerEpochId: checkpoint.core.ledgerEpochId,
            checkpointDigest: checkpoint.checkpointDigest,
            treeSize: checkpoint.core.treeSize,
            observedAt: this.config.clock.now(),
            previousObservationDigest: existing?.receipt.observationDigest ?? null,
        };
        const observationDigest = await hashAuditValue(this.config.hasher, AUDIT_DIGEST_DOMAINS.observation, core);
        const receipt = Object.freeze({
            core: Object.freeze(core),
            observationDigest,
            jws: await this.config.signer.sign(canonicalizeJsonBytes(core)),
        });
        this.observations.set(key(ledger), { checkpoint, receipt });
        return receipt;
    }
    async latest(ledger) {
        return this.observations.get(key(ledger)) ?? null;
    }
    async verifyObservation(checkpoint, receipt) {
        const observed = await this.latest({
            ledgerId: checkpoint.core.ledgerId,
            ledgerEpochId: checkpoint.core.ledgerEpochId,
        });
        return observed?.checkpoint.checkpointDigest === checkpoint.checkpointDigest &&
            observed.receipt.observationDigest === receipt.observationDigest;
    }
}
//# sourceMappingURL=observer.js.map