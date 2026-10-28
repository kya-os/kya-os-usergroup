import { canonicalizeJsonBytes } from '../utils/canonical-json.js';
import { hashAuditValue } from './crypto.js';
import { AUDIT_DIGEST_DOMAINS } from './integrity.js';
import { AUDIT_ERROR_CODES, AuditProtocolError } from './errors.js';
import { Rfc9162MerkleTree } from './merkle.js';
import { parseAuditCheckpointCore } from './schemas.js';
const CHECKPOINT_SCHEMA = 'https://schema.kya-os.org/v1/protocol/audit/checkpoint/v1.0.0';
const CHECKPOINT_SUITE = 'KYA-AUDIT-RFC9162-SHA256-JWS-2026';
function ledgerKey(ledger) {
    return `${ledger.ledgerId}\0${ledger.ledgerEpochId}`;
}
function checkpointKey(ledger, treeSize) {
    return `${ledgerKey(ledger)}\0${treeSize}`;
}
function parseDecimal(value, label) {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, `${label} must be a canonical non-negative decimal string`);
    }
    return BigInt(value);
}
function toSafeNumber(value, label) {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, `${label} exceeds this implementation's safe in-memory proof range`);
    }
    return Number(value);
}
function deepFreeze(value) {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value))
        return value;
    for (const child of Object.values(value))
        deepFreeze(child);
    return Object.freeze(value);
}
/** Ephemeral reference store; durable adapters must preserve the same CAS semantics. */
export class MemoryAuditCheckpointStore {
    checkpoints = new Map();
    latest = new Map();
    async getLatest(ledger) {
        return this.latest.get(ledgerKey(ledger)) ?? null;
    }
    async getByTreeSize(ledger, treeSize) {
        return this.checkpoints.get(checkpointKey(ledger, treeSize)) ?? null;
    }
    async putIfAbsent(checkpoint) {
        const ledger = checkpoint.core;
        const key = checkpointKey(ledger, checkpoint.core.treeSize);
        const existing = this.checkpoints.get(key);
        if (existing !== undefined) {
            return existing.checkpointDigest === checkpoint.checkpointDigest
                ? { kind: 'existing', checkpoint: existing }
                : { kind: 'conflict', checkpoint: existing };
        }
        const frozen = deepFreeze(checkpoint);
        this.checkpoints.set(key, frozen);
        const current = this.latest.get(ledgerKey(ledger));
        if (current === undefined ||
            BigInt(current.core.treeSize) < BigInt(checkpoint.core.treeSize)) {
            this.latest.set(ledgerKey(ledger), frozen);
        }
        return { kind: 'inserted', checkpoint: frozen };
    }
}
/** Creates append-only RFC 9162 checkpoints from a stable journal high-water mark. */
export class AuditCheckpointBuilder {
    options;
    tree;
    clock;
    ledgerTails = new Map();
    /** Per ledger, stored checkpoints whose lifecycle hook has not completed, oldest first. */
    failedHooks = new Map();
    constructor(options) {
        this.options = options;
        this.tree = new Rfc9162MerkleTree(options.hasher);
        this.clock = options.clock ?? Date;
    }
    async createCheckpoint(ledger) {
        // Serialized per ledger so concurrent calls chain to each other in tree-size
        // order instead of both chaining to the same predecessor. The lifecycle hook
        // runs outside the lock because it typically appends to the same journal.
        const { checkpoint, inserted } = await this.serialized(ledger, () => this.storeCheckpoint(ledger));
        const hook = this.options.onCheckpointCreated;
        if (hook === undefined)
            return checkpoint;
        // A stored checkpoint is never inserted again, so a hook that failed would
        // otherwise be lost. Failed hooks run again first, in order, on the next
        // call, whether or not the ledger has grown since.
        const key = ledgerKey(ledger);
        const due = this.failedHooks.get(key) ?? [];
        this.failedHooks.delete(key);
        if (inserted)
            due.push(checkpoint);
        for (let index = 0; index < due.length; index += 1) {
            try {
                await hook(due[index]);
            }
            catch (error) {
                this.failedHooks.set(key, [...due.slice(index), ...(this.failedHooks.get(key) ?? [])]);
                throw error;
            }
        }
        return checkpoint;
    }
    async serialized(ledger, operation) {
        const key = ledgerKey(ledger);
        const previous = this.ledgerTails.get(key) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const tail = previous.then(() => gate);
        this.ledgerTails.set(key, tail);
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
            if (this.ledgerTails.get(key) === tail)
                this.ledgerTails.delete(key);
        }
    }
    async storeCheckpoint(ledger) {
        const entries = await this.snapshotAtHead(ledger);
        if (entries.length === 0) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, 'Cannot checkpoint an empty audit epoch');
        }
        const treeSize = String(entries.length);
        const previous = await this.options.store.getLatest(ledger);
        if (previous !== null) {
            await this.assertExtends(previous, entries);
            if (previous.core.treeSize === treeSize)
                return { checkpoint: previous, inserted: false };
        }
        const result = await this.options.store.putIfAbsent(await this.signCheckpoint(ledger, entries, previous));
        if (result.kind === 'conflict') {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_CONFLICT, 'A different checkpoint already exists at this tree size', { treeSize });
        }
        return { checkpoint: result.checkpoint, inserted: result.kind === 'inserted' };
    }
    /**
     * A journal that has grown since the latest checkpoint must still hold that
     * checkpoint's exact tree as its prefix. Otherwise the history was rewritten
     * or restored, and chaining a new checkpoint to it would sign a split view.
     */
    async assertExtends(previous, entries) {
        const previousSize = parseDecimal(previous.core.treeSize, 'Previous tree size');
        if (previousSize > BigInt(entries.length)) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_ROLLBACK, 'Journal tree size is behind the latest signed checkpoint');
        }
        const prefix = entries.slice(0, Number(previousSize));
        const prefixRoot = await this.tree.root(prefix.map((entry) => entry.entryDigest));
        if (previous.core.rootDigest !== prefixRoot ||
            previous.core.headEntryDigest !== prefix[prefix.length - 1]?.entryDigest) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_CONFLICT, 'Journal content forked at or below the latest checkpointed tree size', { treeSize: previous.core.treeSize });
        }
    }
    async signCheckpoint(ledger, entries, previous) {
        const treeSize = String(entries.length);
        const first = entries[0];
        const last = entries[entries.length - 1];
        const core = parseAuditCheckpointCore({
            schema: CHECKPOINT_SCHEMA,
            checkpointId: `checkpoint:${ledger.ledgerId}:${ledger.ledgerEpochId}:${treeSize}`,
            ...ledger,
            treeSize,
            firstSequence: first.core.sequence,
            lastSequence: last.core.sequence,
            rootDigest: await this.tree.root(entries.map((entry) => entry.entryDigest)),
            headEntryDigest: last.entryDigest,
            previousCheckpointDigest: previous?.checkpointDigest ?? null,
            createdAt: this.clock.now(),
            issuer: this.options.signer.ref,
            integritySuite: CHECKPOINT_SUITE,
        });
        const checkpointDigest = await hashAuditValue(this.options.hasher, AUDIT_DIGEST_DOMAINS.checkpoint, core);
        return deepFreeze({
            core,
            checkpointDigest,
            jws: await this.options.signer.sign(canonicalizeJsonBytes(core)),
        });
    }
    async inclusionProof(ledger, sequence, checkpoint) {
        this.assertCheckpointLedger(ledger, checkpoint);
        const entries = await this.entriesForCheckpoint(ledger, checkpoint);
        const index = entries.findIndex((entry) => entry.core.sequence === sequence);
        if (index < 0) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, 'Sequence is not included in the checkpoint', { sequence, treeSize: checkpoint.core.treeSize });
        }
        return deepFreeze({
            leafIndex: String(index),
            treeSize: checkpoint.core.treeSize,
            auditPath: await this.tree.inclusionProof(entries.map((entry) => entry.entryDigest), index),
        });
    }
    async consistencyProof(ledger, oldTreeSize, checkpoint) {
        this.assertCheckpointLedger(ledger, checkpoint);
        const entries = await this.entriesForCheckpoint(ledger, checkpoint);
        const oldSize = toSafeNumber(parseDecimal(oldTreeSize, 'Old tree size'), 'Old tree size');
        return deepFreeze({
            oldTreeSize,
            newTreeSize: checkpoint.core.treeSize,
            auditPath: await this.tree.consistencyProof(entries.map((entry) => entry.entryDigest), oldSize),
        });
    }
    async rootForRange(ledger, treeSize) {
        const size = toSafeNumber(parseDecimal(treeSize, 'Tree size'), 'Tree size');
        if (size === 0)
            return this.tree.root([]);
        const entries = await this.readEntries(ledger, size);
        if (entries.length !== size) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, 'Journal does not contain the requested tree range', { treeSize });
        }
        return this.tree.root(entries.map((entry) => entry.entryDigest));
    }
    async verifyInclusion(entryDigest, checkpoint, proof) {
        if (proof.treeSize !== checkpoint.core.treeSize)
            return false;
        return this.tree.verifyInclusion({
            leaf: entryDigest,
            leafIndex: toSafeNumber(parseDecimal(proof.leafIndex, 'Leaf index'), 'Leaf index'),
            treeSize: toSafeNumber(parseDecimal(proof.treeSize, 'Tree size'), 'Tree size'),
            root: checkpoint.core.rootDigest,
            auditPath: proof.auditPath,
        });
    }
    async verifyConsistency(input) {
        if (input.proof.oldTreeSize !== input.oldTreeSize ||
            input.proof.newTreeSize !== input.checkpoint.core.treeSize)
            return false;
        return this.tree.verifyConsistency({
            oldSize: toSafeNumber(parseDecimal(input.oldTreeSize, 'Old tree size'), 'Old tree size'),
            newSize: toSafeNumber(parseDecimal(input.checkpoint.core.treeSize, 'New tree size'), 'New tree size'),
            oldRoot: input.oldRoot,
            newRoot: input.checkpoint.core.rootDigest,
            auditPath: input.proof.auditPath,
        });
    }
    async snapshotAtHead(ledger) {
        const head = await this.options.journal.getHead(ledger);
        if (head === null)
            return [];
        const expectedCount = toSafeNumber(parseDecimal(head.sequence, 'Journal head sequence') + 1n, 'Journal tree size');
        const entries = await this.readEntries(ledger, expectedCount);
        const last = entries[entries.length - 1];
        if (entries.length !== expectedCount || last?.entryDigest !== head.entryDigest) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.JOURNAL_FAILURE, 'Journal could not provide a stable range through its reported head');
        }
        return entries;
    }
    async entriesForCheckpoint(ledger, checkpoint) {
        const size = toSafeNumber(parseDecimal(checkpoint.core.treeSize, 'Checkpoint tree size'), 'Checkpoint tree size');
        const entries = await this.readEntries(ledger, size);
        if (entries.length !== size || entries[entries.length - 1]?.entryDigest !==
            checkpoint.core.headEntryDigest) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.CHECKPOINT_INVALID, 'Journal range does not match the signed checkpoint head');
        }
        return entries;
    }
    async readEntries(ledger, limit) {
        const result = [];
        for await (const entry of this.options.journal.readRange({ ...ledger, limit })) {
            if (BigInt(entry.core.sequence) !== BigInt(result.length)) {
                throw new AuditProtocolError(AUDIT_ERROR_CODES.JOURNAL_FAILURE, 'Audit journal range is not contiguous from sequence zero');
            }
            result.push(entry);
        }
        return result;
    }
    assertCheckpointLedger(ledger, checkpoint) {
        if (checkpoint.core.ledgerId !== ledger.ledgerId ||
            checkpoint.core.ledgerEpochId !== ledger.ledgerEpochId) {
            throw new AuditProtocolError(AUDIT_ERROR_CODES.LEDGER_MISMATCH, 'Checkpoint belongs to a different ledger or epoch');
        }
    }
}
//# sourceMappingURL=checkpoint.js.map