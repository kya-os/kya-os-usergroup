/**
 * Shared crypto for the KYA-OS badge worker: RFC 8785 JCS canonicalization,
 * base58btc / base64url codecs, W3C Data Integrity eddsa-jcs-2022 proof
 * verification via WebCrypto, and Bitstring Status List decoding.
 *
 * Zero dependencies. Runs identically on Cloudflare Workers and Node 20+:
 * both expose Ed25519 through crypto.subtle (Workers via the Secure Curves
 * implementation, Node since v20 without flags) and both expose
 * DecompressionStream("gzip").
 *
 * Everything here is fail-closed: malformed input returns { ok: false } (or
 * throws to the caller's catch, which must map to the "unknown"/unverified
 * badge state), never a false positive.
 */

// ── RFC 8785 JCS ────────────────────────────────────────────────────────────

/**
 * Canonicalize a JSON value per RFC 8785. JSON.stringify already emits
 * JCS-conformant string escaping and ES number serialization; JCS adds only
 * the sorted-key requirement (UTF-16 code unit order, which is exactly what
 * Array.prototype.sort does) and the rejection of non-finite numbers.
 */
export function jcsCanonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => jcsCanonicalize(item === undefined ? null : item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    const members = keys.map((key) => `${JSON.stringify(key)}:${jcsCanonicalize(value[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new Error(`JCS: unsupported type ${typeof value}`);
}

// ── codecs ──────────────────────────────────────────────────────────────────

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = new Map([...B58_ALPHABET].map((c, i) => [c, BigInt(i)]));

export function base58btcDecode(text) {
  let n = 0n;
  for (const char of text) {
    const digit = B58_MAP.get(char);
    if (digit === undefined) throw new Error(`base58btc: invalid character "${char}"`);
    n = n * 58n + digit;
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const char of text) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58btcEncode(bytes) {
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);
  let out = "";
  while (n > 0n) {
    out = B58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function base64urlDecode(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function base64urlEncode(bytes) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a did:key / DataIntegrity publicKeyMultibase (z + base58btc, 0xed01 multicodec) to raw Ed25519 key bytes. */
export function ed25519KeyFromMultibase(multibase) {
  if (typeof multibase !== "string" || !multibase.startsWith("z")) {
    throw new Error("publicKeyMultibase must be base58btc (z-prefixed)");
  }
  const decoded = base58btcDecode(multibase.slice(1));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error("publicKeyMultibase is not an ed25519-pub multicodec key");
  }
  return decoded.slice(2);
}

export function ed25519KeyToMultibase(rawKey) {
  const prefixed = new Uint8Array(2 + rawKey.length);
  prefixed[0] = 0xed;
  prefixed[1] = 0x01;
  prefixed.set(rawKey, 2);
  return `z${base58btcEncode(prefixed)}`;
}

// ── eddsa-jcs-2022 ──────────────────────────────────────────────────────────

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

const encoder = new TextEncoder();

/**
 * Compute the eddsa-jcs-2022 hashData for a document + proof options:
 * sha256(JCS(proofConfig)) || sha256(JCS(unsecuredDocument)).
 * The proof config carries the document's @context when present, per the
 * W3C DI eddsa-jcs-2022 cryptosuite.
 */
export async function eddsaJcs2022HashData(unsecuredDocument, proofOptions) {
  const proofConfig = { ...proofOptions };
  delete proofConfig.proofValue;
  if (unsecuredDocument["@context"] !== undefined) proofConfig["@context"] = unsecuredDocument["@context"];
  const proofHash = await sha256(encoder.encode(jcsCanonicalize(proofConfig)));
  const docHash = await sha256(encoder.encode(jcsCanonicalize(unsecuredDocument)));
  const hashData = new Uint8Array(proofHash.length + docHash.length);
  hashData.set(proofHash, 0);
  hashData.set(docHash, proofHash.length);
  return hashData;
}

/**
 * Verify a W3C Data Integrity proof of type DataIntegrityProof /
 * eddsa-jcs-2022 on `document` against a raw Ed25519 public key.
 * Returns { ok: boolean, reason?: string } and never throws on bad input.
 */
export async function verifyEddsaJcs2022(document, publicKeyBytes) {
  try {
    const proof = document?.proof;
    if (!proof || Array.isArray(proof)) return { ok: false, reason: "missing or ambiguous proof" };
    if (proof.type !== "DataIntegrityProof") return { ok: false, reason: `unsupported proof.type ${proof.type}` };
    if (proof.cryptosuite !== "eddsa-jcs-2022") return { ok: false, reason: `unsupported cryptosuite ${proof.cryptosuite}` };
    if (typeof proof.proofValue !== "string" || !proof.proofValue.startsWith("z")) {
      return { ok: false, reason: "proofValue must be base58btc multibase" };
    }
    const signature = base58btcDecode(proof.proofValue.slice(1));
    const unsecured = { ...document };
    delete unsecured.proof;
    const hashData = await eddsaJcs2022HashData(unsecured, proof);
    const key = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, signature, hashData);
    return ok ? { ok: true } : { ok: false, reason: "signature verification failed" };
  } catch (err) {
    return { ok: false, reason: `verification error: ${err.message}` };
  }
}

// ── Bitstring Status List ───────────────────────────────────────────────────

export const MAX_INFLATED_BYTES = 16 * 1024 * 1024; // mirror kya-os-mcp's 16 MiB inflation cap

/**
 * Streaming gunzip with a hard inflation cap: the DecompressionStream is
 * read chunk by chunk and aborted the moment the running total exceeds
 * maxBytes, so a gzip bomb throws without the full payload ever being
 * materialized. Only under-cap output is assembled.
 */
async function gunzipCapped(bytes, maxBytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("status list exceeds inflation cap");
    }
    chunks.push(value);
  }
  const inflated = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    inflated.set(chunk, offset);
    offset += chunk.length;
  }
  return inflated;
}

export async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Decode a Bitstring Status List `encodedList` (multibase base64url "u"
 * prefix + GZIP, inflation capped mid-stream) and read one bit, MSB-first,
 * per W3C Bitstring Status List v1.0. Throws on any malformation - callers
 * fail closed.
 */
export async function bitstringStatusAt(encodedList, index) {
  if (typeof encodedList !== "string" || !encodedList.startsWith("u")) {
    throw new Error("encodedList must be multibase base64url (u-prefixed)");
  }
  const inflated = await gunzipCapped(base64urlDecode(encodedList.slice(1)), MAX_INFLATED_BYTES);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= inflated.length * 8) {
    throw new Error(`statusListIndex ${index} out of range`);
  }
  const byte = inflated[Math.floor(i / 8)];
  return ((byte >> (7 - (i % 8))) & 1) === 1;
}
