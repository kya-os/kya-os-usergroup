/**
 * Memory-based provider implementations
 *
 * Simple in-memory implementations for development and testing.
 */
import { StorageProvider, NonceCacheProvider, IdentityProvider, } from './base.js';
import { generateDidKeyFromBase64, didKeyFragment } from '../utils/did-helpers.js';
/** Writes between amortised expired-entry sweeps (bounds memory without a timer). */
const SWEEP_EVERY = 1000;
/** Longest a cache goes between sweeps while written to, so low traffic also frees memory. */
const SWEEP_INTERVAL_MS = 60_000;
export class MemoryStorageProvider extends StorageProvider {
    store = new Map();
    async get(key) {
        return this.store.get(key) ?? null;
    }
    async set(key, value) {
        this.store.set(key, value);
    }
    async delete(key) {
        this.store.delete(key);
    }
    async exists(key) {
        return this.store.has(key);
    }
    async list(prefix) {
        const keys = Array.from(this.store.keys());
        if (prefix) {
            return keys.filter((k) => k.startsWith(prefix));
        }
        return keys;
    }
}
/**
 * In-memory replay store, and the default one for `withKyaOs` and
 * `SessionManager`. Single process only. Expired entries are swept as the
 * cache is written to (every {@link SWEEP_EVERY} writes, or after
 * {@link SWEEP_INTERVAL_MS}), so a long-running server stays bounded by its
 * live nonces without anyone scheduling {@link cleanup}.
 */
export class MemoryNonceCacheProvider extends NonceCacheProvider {
    nonces = new Map();
    writesSinceSweep = 0;
    lastSweepAt = Date.now();
    /** Atomic within this cache instance: no await separates the read and write. */
    async consume(nonce, ttlSeconds, agentDid) {
        if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
            throw new RangeError('Nonce TTL must be a positive finite number');
        }
        const key = this.key(nonce, agentDid);
        const now = Date.now();
        const expiry = this.nonces.get(key);
        if (expiry !== undefined && expiry > now)
            return false;
        this.nonces.set(key, now + ttlSeconds * 1000);
        this.sweepIfDue(now);
        return true;
    }
    key(nonce, agentDid) {
        return JSON.stringify([agentDid ?? null, nonce]);
    }
    async has(nonce, agentDid) {
        const key = this.key(nonce, agentDid);
        const expiry = this.nonces.get(key);
        if (!expiry)
            return false;
        if (Date.now() >= expiry) {
            this.nonces.delete(key);
            return false;
        }
        return true;
    }
    async add(nonce, ttlSeconds, agentDid) {
        const key = this.key(nonce, agentDid);
        const now = Date.now();
        this.nonces.set(key, now + ttlSeconds * 1000);
        this.sweepIfDue(now);
    }
    async cleanup() {
        this.evictExpired(Date.now());
    }
    /**
     * Amortised eviction: every admitted nonce is a write, so sweeping on writes
     * keeps the map bounded by live entries. The count trigger bounds a busy
     * cache; the interval trigger releases a quiet one's dead entries too.
     */
    sweepIfDue(now) {
        if (++this.writesSinceSweep < SWEEP_EVERY && now - this.lastSweepAt < SWEEP_INTERVAL_MS) {
            return;
        }
        this.writesSinceSweep = 0;
        this.lastSweepAt = now;
        this.evictExpired(now);
    }
    evictExpired(now) {
        for (const [nonce, expiry] of this.nonces) {
            if (now >= expiry) {
                this.nonces.delete(nonce);
            }
        }
    }
    async destroy() {
        this.nonces.clear();
    }
}
export class MemoryIdentityProvider extends IdentityProvider {
    identity;
    cryptoProvider;
    constructor(cryptoProvider) {
        super();
        this.cryptoProvider = cryptoProvider;
    }
    async getIdentity() {
        if (!this.identity) {
            this.identity = await this.generateIdentity();
        }
        return this.identity;
    }
    async saveIdentity(identity) {
        this.identity = identity;
    }
    async rotateKeys() {
        this.identity = await this.generateIdentity();
        return this.identity;
    }
    async deleteIdentity() {
        this.identity = undefined;
    }
    async generateIdentity() {
        if (!this.cryptoProvider) {
            throw new Error('Crypto provider required for identity generation');
        }
        const keyPair = await this.cryptoProvider.generateKeyPair();
        const did = this.generateDIDFromPublicKey(keyPair.publicKey);
        return {
            did,
            kid: `${did}#${didKeyFragment(did)}`,
            privateKey: keyPair.privateKey,
            publicKey: keyPair.publicKey,
            createdAt: new Date().toISOString(),
            type: 'development',
        };
    }
    generateDIDFromPublicKey(publicKey) {
        return generateDidKeyFromBase64(publicKey);
    }
}
//# sourceMappingURL=memory.js.map