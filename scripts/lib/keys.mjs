/**
 * Ed25519 key handling for the conformance program's signing tools:
 * base58btc codec, Multikey encode/parse for public (0xed01) and private
 * (0x8026) keys, node:crypto KeyObject construction from raw key bytes via
 * the fixed SPKI/PKCS8 DER prefixes, and the registry/keys/program-keys.json
 * reader with fail-closed sentinel detection.
 *
 * DELIBERATE REDUNDANCY RULE: workers/badge/verify.mjs carries its own
 * base58btc and multikey code and neither file may import the other - the
 * worker must stay self-contained for Cloudflare bundling, and the repo's
 * house style is independent implementations cross-proving each other
 * (parity tests live in workers/badge/parity.test.mjs). This module also
 * deliberately uses a different base58 algorithm (byte-array long division
 * instead of BigInt) so the two cannot share a bug.
 */
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// ── base58btc ────────────────────────────────────────────────────────────────

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58btcEncode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((digit) => B58_ALPHABET[digit]).join("");
}

export function base58btcDecode(text) {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  const bytes = [];
  for (let i = zeros; i < text.length; i++) {
    let carry = B58_ALPHABET.indexOf(text[i]);
    if (carry < 0) throw new Error(`base58btc: invalid character ${JSON.stringify(text[i])}`);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}

// ── Multikey ────────────────────────────────────────────────────────────────

const ED25519_PUB_PREFIX = [0xed, 0x01]; // multicodec ed25519-pub (0xed), varint
const ED25519_PRIV_PREFIX = [0x80, 0x26]; // multicodec ed25519-priv (0x1300), varint

function encodeMultikey(prefix, raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== 32) throw new Error("multikey: raw ed25519 key must be 32 bytes");
  return `z${base58btcEncode(Uint8Array.from([...prefix, ...raw]))}`;
}

function decodeMultikey(prefix, multibase, what) {
  if (typeof multibase !== "string" || !multibase.startsWith("z")) {
    throw new Error(`multikey: ${what} must be base58btc multibase (z-prefixed)`);
  }
  const decoded = base58btcDecode(multibase.slice(1));
  if (decoded.length !== 34 || decoded[0] !== prefix[0] || decoded[1] !== prefix[1]) {
    throw new Error(`multikey: not an ${what} multicodec key`);
  }
  return decoded.slice(2);
}

export const encodePublicKeyMultibase = (raw) => encodeMultikey(ED25519_PUB_PREFIX, raw);
export const decodePublicKeyMultibase = (multibase) => decodeMultikey(ED25519_PUB_PREFIX, multibase, "ed25519-pub");
export const encodePrivateKeyMultibase = (raw) => encodeMultikey(ED25519_PRIV_PREFIX, raw);
export const decodePrivateKeyMultibase = (multibase) => decodeMultikey(ED25519_PRIV_PREFIX, multibase, "ed25519-priv");

// ── KeyObjects from raw key bytes ───────────────────────────────────────────
// node:crypto has no "raw" import for signing keys; the clean zero-dep route
// is the fixed DER prefixes for Ed25519 (RFC 8410): SPKI for the 32 public
// bytes, PKCS8 for the 32 private seed bytes.

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function publicKeyObject(raw) {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

export function privateKeyObject(seed) {
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
}

/** The raw public key bytes for a raw private seed (base64url jwk x). */
export function publicRawFromSeed(seed) {
  const jwk = createPublicKey(privateKeyObject(seed)).export({ format: "jwk" });
  return new Uint8Array(Buffer.from(jwk.x, "base64url"));
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ── registry/keys/program-keys.json ─────────────────────────────────────────

export const KEY_PURPOSES = ["issuer", "status", "log"];
const KEY_ENTRY_KEYS = ["id", "purpose", "publicKeyMultibase", "createdAt"];
const SENTINEL_KEYS = ["purpose", "status"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read and structurally validate the program key file. Fail-closed contract:
 * `provisioned` is true ONLY when the file parses, every entry is a complete
 * public key record, and at least one issuer and one status key exist. The
 * committed pre-ceremony sentinel ({purpose, status: "unprovisioned"}) - and
 * any malformation at all - reports provisioned: false, and consumers must
 * then refuse to sign, verify, or render anything as verified.
 * @returns {{ provisioned: boolean, keys: object[], errors: string[] }}
 */
export function readProgramKeys(path) {
  const rel = "registry/keys/program-keys.json";
  if (!existsSync(path)) return { provisioned: false, keys: [], errors: [`${rel}: file is missing`] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { provisioned: false, keys: [], errors: [`${rel}: invalid JSON (${err.message})`] };
  }
  const errors = [];
  const fail = (message) => errors.push(`${rel}: ${message}`);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { provisioned: false, keys: [], errors: [`${rel}: must be a JSON object`] };
  }
  for (const key of Object.keys(parsed)) {
    if (key !== "version" && key !== "keys") fail(`unexpected property "${key}" (allowed: version, keys)`);
  }
  if (parsed.version !== 1) fail('"version" must be 1');
  if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) {
    fail('"keys" must be a non-empty array');
    return { provisioned: false, keys: [], errors };
  }

  const sentinel = parsed.keys.some((entry) => entry?.status === "unprovisioned");
  if (sentinel) {
    // The pre-ceremony sentinel must be EXACTLY one bare marker entry - a
    // file mixing real keys with a sentinel is malformed, not half-usable.
    if (parsed.keys.length !== 1) fail("a sentinel key file must contain exactly the one unprovisioned marker");
    const entry = parsed.keys[0] ?? {};
    for (const key of Object.keys(entry)) {
      if (!SENTINEL_KEYS.includes(key)) fail(`unexpected sentinel property "${key}" (allowed: ${SENTINEL_KEYS.join(", ")})`);
    }
    if (entry.purpose !== "issuer" || entry.status !== "unprovisioned") {
      fail('the sentinel entry must be exactly {"purpose": "issuer", "status": "unprovisioned"}');
    }
    return { provisioned: false, keys: [], errors };
  }

  const ids = new Set();
  parsed.keys.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail(`keys[${index}] must be an object`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!KEY_ENTRY_KEYS.includes(key)) fail(`unexpected keys[${index}] property "${key}" (allowed: ${KEY_ENTRY_KEYS.join(", ")})`);
    }
    if (!KEY_PURPOSES.includes(entry.purpose)) fail(`keys[${index}].purpose must be one of ${KEY_PURPOSES.join(", ")}`);
    const idRe = new RegExp(`^conformance-${entry.purpose}-[1-9][0-9]*$`);
    if (typeof entry.id !== "string" || !idRe.test(entry.id)) {
      fail(`keys[${index}].id must match conformance-<purpose>-<n> (got ${JSON.stringify(entry.id)})`);
    } else if (ids.has(entry.id)) {
      fail(`duplicate key id "${entry.id}"`);
    } else {
      ids.add(entry.id);
    }
    try {
      decodePublicKeyMultibase(entry.publicKeyMultibase);
    } catch (err) {
      fail(`keys[${index}].publicKeyMultibase: ${err.message}`);
    }
    if (typeof entry.createdAt !== "string" || !DATE_RE.test(entry.createdAt)) {
      fail(`keys[${index}].createdAt must be a YYYY-MM-DD date`);
    }
  });
  for (const purpose of ["issuer", "status"]) {
    if (!parsed.keys.some((entry) => entry?.purpose === purpose)) {
      fail(`a provisioned key file must carry at least one "${purpose}" key`);
    }
  }
  if (errors.length > 0) return { provisioned: false, keys: [], errors };
  return { provisioned: true, keys: parsed.keys, errors };
}
