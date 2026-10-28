import { CompactSign, compactVerify, importJWK } from 'jose';
import { canonicalizeJsonBytes } from '../utils/canonical-json.js';
import { isSmallOrderEd25519CryptoKey } from '../utils/ed25519-public-key.js';
const encoder = new TextEncoder();
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
export class CryptoProviderAuditHasher {
    crypto;
    constructor(crypto) {
        this.crypto = crypto;
    }
    async sha256(data) {
        const digest = await this.crypto.hash(data);
        if (!DIGEST_PATTERN.test(digest)) {
            throw new TypeError('Audit hasher must return sha256:<lowercase-hex>');
        }
        return digest;
    }
}
/** Strict compact-JWS verifier with payload, algorithm, KID, and DID binding. */
export class CompactJwsAuditSignatureVerifier {
    keys;
    constructor(keys) {
        this.keys = keys;
    }
    async verify(payload, jws, signer) {
        try {
            if (!signer.kid.startsWith(`${signer.did}#`))
                return false;
            const resolved = await this.keys.resolve(signer);
            if (resolved === null)
                return false;
            // Imported here rather than inside compactVerify so the key can be checked:
            // under a small-order Ed25519 key one signature fits every payload.
            const key = isJwk(resolved) ? await importJWK(resolved, signer.alg) : resolved;
            if (await isSmallOrderEd25519CryptoKey(key))
                return false;
            const result = await compactVerify(jws, key, { algorithms: [signer.alg] });
            if (result.protectedHeader.alg !== signer.alg ||
                result.protectedHeader.kid !== signer.kid ||
                result.payload.length !== payload.length)
                return false;
            return result.payload.every((byte, index) => byte === payload[index]);
        }
        catch {
            return false;
        }
    }
}
function isJwk(key) {
    return !(key instanceof Uint8Array) && 'kty' in key;
}
/** Reference JWS signer for local WebCrypto/KMS-compatible CryptoKey handles. */
export class CompactJwsAuditSigner {
    ref;
    privateKey;
    constructor(ref, privateKey) {
        this.ref = ref;
        this.privateKey = privateKey;
    }
    async sign(payload) {
        return new CompactSign(payload)
            .setProtectedHeader({ alg: this.ref.alg, kid: this.ref.kid })
            .sign(this.privateKey);
    }
}
export async function hashAuditValue(hasher, domain, value) {
    if (domain.length === 0 || domain.includes('\0')) {
        throw new TypeError('Audit digest domain must be non-empty and cannot contain NUL');
    }
    const domainBytes = encoder.encode(`${domain}\0`);
    const valueBytes = canonicalizeJsonBytes(value);
    const input = new Uint8Array(domainBytes.length + valueBytes.length);
    input.set(domainBytes);
    input.set(valueBytes, domainBytes.length);
    return hasher.sha256(input);
}
//# sourceMappingURL=crypto.js.map