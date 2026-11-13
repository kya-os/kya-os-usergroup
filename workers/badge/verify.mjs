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
 * DELIBERATE REDUNDANCY RULE: scripts/lib/{jcs,keys,attest}.mjs implement
 * the same primitives independently for the issuance and site-build side,
 * and neither side may import the other - this worker must stay
 * self-contained for Cloudflare bundling, and the repo's house style is
 * independent implementations cross-proving each other. The two crypto
 * implementations meet only in this directory's tests that README.md
 * ("Independence note") names; a divergence fails the suite, never ships.
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
    if (!Number.isFinite(value)) throw new Error("JCS: non-finite numbers have no canonical form");
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

// ── XMLSCHEMA11-2 dateTimeStamp ─────────────────────────────────────────────

const isDigits = (text) => text.length > 0 && [...text].every((c) => c >= "0" && c <= "9");
const isTwoDigits = (text) => text.length === 2 && isDigits(text);

/** Days in `month` (1 to 12) of a year whose last four digits are
 * `lastFour`: leap years repeat every 400 years, and 400 divides 10000. */
function daysInMonth(lastFour, month) {
  if (month === 2) return lastFour % 400 === 0 || (lastFour % 4 === 0 && lastFour % 100 !== 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Is `value` an [XMLSCHEMA11-2] dateTimeStamp, a dateTime whose timezone is
 * required? VC Data Integrity 1.0, section 2.1, requires proof.created to be
 * one, and lets a processor accept a value written without an offset, read
 * as UTC; this one does not. EdDSA Cryptosuites v1.0, section 3.3.5 step 3,
 * requires an error for a value that is not a valid datetime.
 * Parsed field by field (the scripts side matches a pattern instead, so the
 * two share no shortcut): a year of four or more digits, optionally
 * negative, with no leading zero past four; a month and a day that exist,
 * February 29 only in a leap year; hh:mm:ss with optional fractional
 * seconds, or the end of the day, 24:00:00; and Z or an offset within
 * 14:00 of UTC. worker.mjs builds the program's own timestamp on it.
 */
export function isDateTimeStamp(value) {
  if (typeof value !== "string") return false;
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const t = unsigned.indexOf("T");
  if (t < 0) return false;
  const date = unsigned.slice(0, t).split("-");
  if (date.length !== 3) return false;
  const [year, month, day] = date;
  if (!isDigits(year) || year.length < 4 || (year.length > 4 && year.startsWith("0"))) return false;
  if (!isTwoDigits(month) || !isTwoDigits(day)) return false;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return false;
  if (Number(day) < 1 || Number(day) > daysInMonth(Number(year.slice(-4)), monthNumber)) return false;

  let time = unsigned.slice(t + 1);
  if (time.endsWith("Z")) {
    time = time.slice(0, -1);
  } else {
    const sign = Math.max(time.lastIndexOf("+"), time.lastIndexOf("-"));
    if (sign < 0) return false;
    const offset = time.slice(sign + 1).split(":");
    if (offset.length !== 2 || !offset.every(isTwoDigits)) return false;
    const [hours, minutes] = offset.map(Number);
    if (minutes > 59 || hours * 60 + minutes > 14 * 60) return false;
    time = time.slice(0, sign);
  }
  const [clock, fraction, ...extra] = time.split(".");
  if (extra.length > 0 || (fraction !== undefined && !isDigits(fraction))) return false;
  const fields = clock.split(":");
  if (fields.length !== 3 || !fields.every(isTwoDigits)) return false;
  const [hour, minute, second] = fields.map(Number);
  if (hour === 24) return minute === 0 && second === 0 && (fraction === undefined || Number(fraction) === 0);
  return hour < 24 && minute < 60 && second < 60;
}

// ── eddsa-jcs-2022 ──────────────────────────────────────────────────────────

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

const encoder = new TextEncoder();

/**
 * Compute the eddsa-jcs-2022 hashData for a document + proof options, per
 * VC Data Integrity EdDSA Cryptosuites v1.0, sections 3.3.3 to 3.3.5:
 * sha256(JCS(proofConfig)) || sha256(JCS(unsecuredDocument)), where
 * proofConfig is the proof options exactly as given minus any proofValue.
 * Nothing is copied in from the document: the only @context the
 * configuration carries is the one the signer stored in the proof (3.3.1
 * step 2). A set created that is not an [XMLSCHEMA11-2] dateTimeStamp
 * throws, for the fixture signer and the verifier alike: EdDSA Cryptosuites
 * v1.0 section 3.3.5 step 3 requires the error for an invalid datetime, such
 * as 2023-02-29, and for a valid one with no Z or offset it is this
 * program's choice under VC Data Integrity 1.0 section 2.1.
 */
export async function eddsaJcs2022HashData(unsecuredDocument, proofOptions) {
  const proofConfig = { ...proofOptions };
  delete proofConfig.proofValue;
  if (proofConfig.created !== undefined && !isDateTimeStamp(proofConfig.created)) {
    throw new Error(
      "proof.created must be an XMLSCHEMA11-2 dateTimeStamp: EdDSA Cryptosuites v1.0 section 3.3.5 step 3 makes an invalid datetime an error, " +
        "and refusing a datetime with no Z or offset is this program's choice under VC Data Integrity 1.0 section 2.1",
    );
  }
  const proofHash = await sha256(encoder.encode(jcsCanonicalize(proofConfig)));
  const docHash = await sha256(encoder.encode(jcsCanonicalize(unsecuredDocument)));
  const hashData = new Uint8Array(proofHash.length + docHash.length);
  hashData.set(proofHash, 0);
  hashData.set(docHash, proofHash.length);
  return hashData;
}

/**
 * Section 3.3.2 step 4.1: the document's @context must start with all the
 * values of the proof's @context, in the same order. Either side may be a
 * single context (a list of one); an absent document @context is empty.
 * Values match when their JCS forms match, compared in order, so the first
 * that differs decides; a value with no JCS form throws when the loop
 * reaches it, and the verifier refuses with that canonicalization failure
 * as its reason, as the scripts side does.
 */
function documentContextStartsWithProof(documentContext, proofContext) {
  const listOf = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
  const documentList = listOf(documentContext);
  const proofList = listOf(proofContext);
  if (documentList.length < proofList.length) return false;
  for (let i = 0; i < proofList.length; i++) {
    if (jcsCanonicalize(documentList[i]) !== jcsCanonicalize(proofList[i])) return false;
  }
  return true;
}

/**
 * Verify a W3C Data Integrity proof of type DataIntegrityProof /
 * eddsa-jcs-2022 on `document` against a raw Ed25519 public key, per
 * section 3.3.2: the proof configuration is the stored proof minus its
 * proofValue, and when the proof carries an @context the document's
 * @context must start with it and the document is hashed under the
 * proof's.
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
    // Step 4 runs "if proofOptions.@context exists", read here as the key
    // being present, whatever its value: a stored null, "", false, 0 or {}
    // must prefix the document's @context like any other value. Digital
    // Bazaar's eddsa-jcs-2022 cryptosuite 1.0.0 tests truthiness instead, and
    // skips step 4 for null, "", false and 0; spec-conformance.test.mjs holds
    // both verifiers in this repository to the cases.
    if (proof["@context"] !== undefined) {
      if (!documentContextStartsWithProof(document["@context"], proof["@context"])) {
        return { ok: false, reason: 'the document\'s "@context" does not start with the proof\'s "@context"' };
      }
      unsecured["@context"] = proof["@context"];
    }
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
