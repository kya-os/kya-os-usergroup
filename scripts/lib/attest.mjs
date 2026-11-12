/**
 * The conformance program's attestation core: the canonical credential and
 * status-list builders, W3C Data Integrity eddsa-jcs-2022 signing and
 * verification over node:crypto (synchronous, so the site build can verify
 * inline), the deterministic credential id, and the Bitstring Status List
 * codec (gzip + base64url multibase, MSB-first bits, 16 KiB lists).
 *
 * DELIBERATE REDUNDANCY RULE: workers/badge/verify.mjs implements the same
 * cryptosuite independently and neither file may import the other - the
 * worker must stay self-contained for Cloudflare bundling, and the repo's
 * house style is independent implementations cross-proving each other.
 * workers/badge/parity.test.mjs proves a credential signed here verifies
 * there, a status list built here reads there, and tampering fails both.
 *
 * Signing and verification follow VC Data Integrity EdDSA Cryptosuites v1.0,
 * section 3.3 (eddsa-jcs-2022): the signer stores the document's @context in
 * the proof (3.3.1 step 2) and signs sha256(JCS(proof without proofValue)) ||
 * sha256(JCS(unsecured document)); the verifier takes the proof
 * configuration from the stored proof alone and, when that proof carries an
 * @context, requires the document's @context to start with it and hashes
 * the document under the proof's (3.3.2 step 4). Both refuse a proof whose
 * created is not an [XMLSCHEMA11-2] dateTimeStamp (datetime.mjs, the rule
 * the shape check applies too): an invalid datetime, such as 2023-02-29, is
 * an error under EdDSA Cryptosuites v1.0 section 3.3.5 step 3, and refusing
 * a valid one with no Z or offset, which VC Data Integrity 1.0 section 2.1
 * lets a processor accept, is this program's choice under that section.
 */
import { createHash, sign as edSign, verify as edVerify } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { ORIGIN, SUITE } from "../../site/lib/constants.mjs";
import { isDateTimeStamp } from "./datetime.mjs";
import { canonicalize } from "./jcs.mjs";
import {
  base58btcDecode,
  base58btcEncode,
  decodePrivateKeyMultibase,
  decodePublicKeyMultibase,
  privateKeyObject,
  publicKeyObject,
} from "./keys.mjs";

// ── program identity and canonical URLs ─────────────────────────────────────

export const ISSUER_DID = `did:web:${new URL(ORIGIN).host}`;
export const CREDENTIALS_BASE = `${ORIGIN}/credentials`;
export const SCHEMA_URL = `${CREDENTIALS_BASE}/schema/attestation-v1.json`;
export const CREDENTIAL_TYPE = "KyaOsConformanceAttestation";
export const STATUS_PURPOSES = ["revocation", "suspension"];
export const STATUS_LIST_URLS = {
  revocation: `${CREDENTIALS_BASE}/status/revocation-1.json`,
  suspension: `${CREDENTIALS_BASE}/status/suspension-1.json`,
};
// The program's one JSON-LD context: every credential and status list
// carries exactly this @context, and so does its proof (scripts/lib/shape.mjs
// holds them to it). The badge worker keeps its own copy, pinned equal by
// workers/badge/parity.test.mjs.
export const PROGRAM_CONTEXT = Object.freeze(["https://www.w3.org/ns/credentials/v2"]);
// W3C Bitstring Status List minimum uncompressed size: 16 KiB = 131072 bits.
export const STATUS_LIST_BYTES = 16384;
export const STATUS_LIST_BITS = STATUS_LIST_BYTES * 8;
// Mirror of the worker's gzip inflation cap (fail closed on bombs).
export const MAX_INFLATED_BYTES = 16 * 1024 * 1024;

// The credential's terms of use: test-result-only semantics and the no-expiry
// rationale. Pinned verbatim by the shape check so no copy can drift.
export const TERMS_STATEMENT =
  "This credential asserts a test result: the named implementation, at the pinned code digest, " +
  "passed the named conformance suite at the pinned suite version and vector-set hash. " +
  "It deliberately carries no validUntil - currency is judged against the published suite manifest, " +
  "so supersession of the suite, not the passage of time, is what dates it. " +
  "It is not an endorsement, audit, warranty, or DIF certification.";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest();

// ── deterministic credential id ─────────────────────────────────────────────

/**
 * The deterministic credential id: urn:kya:conf:<first 32 hex of SHA-256 over
 * "kya-conf-id-v1" NUL subjectId NUL suiteVersion NUL vectorSetHash NUL level
 * NUL scope NUL hex(sha256(JCS(categories or [])))>. Same claim inputs, same
 * id - so re-running an issuance can never mint a second credential for the
 * same result, and anyone can recompute the id from the credential's fields.
 */
export function credentialIdFor({ subjectId, suiteVersion, vectorSetHash, level, scope, categories }) {
  const categoriesHash = sha256(Buffer.from(canonicalize(categories ?? []), "utf8")).toString("hex");
  const preimage = ["kya-conf-id-v1", subjectId, suiteVersion, vectorSetHash, level, scope, categoriesHash].join("\0");
  const id32 = sha256(Buffer.from(preimage, "utf8")).toString("hex").slice(0, 32);
  return { id: `urn:kya:conf:${id32}`, id32 };
}

// ── credential builder ──────────────────────────────────────────────────────

const LEVELS = ["L1", "L2", "L3"];
const GIT_COMMIT_RE = /^[0-9a-f]{40}$/;

export function isSubjectId(value) {
  if (typeof value !== "string") return false;
  if (/^did:[a-z0-9]+:.+/.test(value)) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Build the unsigned KyaOsConformanceAttestation credential. Throws on any
 * invalid input - issuance fails closed rather than signing a malformed
 * claim. Categories are sorted so the deterministic id and the credential
 * bytes agree for any input order.
 */
export function buildCredential({ subjectId, implementation, level, scope, categories, packageVersion, statusIndex, validFrom }) {
  if (!isSubjectId(subjectId)) throw new Error(`subjectId must be an https URL or a DID (got ${JSON.stringify(subjectId)})`);
  if (!LEVELS.includes(level)) throw new Error(`level must be one of ${LEVELS.join(", ")}`);
  if (scope !== "full" && scope !== "subset") throw new Error('scope must be "full" or "subset"');
  if (scope === "subset" && (!Array.isArray(categories) || categories.length === 0)) {
    throw new Error("a subset claim requires its categories - a subset never renders as a bare level");
  }
  if (scope === "full" && categories !== undefined) throw new Error("a full claim must not carry categories");
  if (typeof implementation?.name !== "string" || implementation.name.length === 0) throw new Error("implementation.name is required");
  if (typeof implementation?.version !== "string" || implementation.version.length === 0) throw new Error("implementation.version is required");
  if (!GIT_COMMIT_RE.test(implementation?.digest?.gitCommit ?? "")) {
    throw new Error("implementation.digest.gitCommit must be a 40-hex commit SHA");
  }
  if (!Number.isInteger(statusIndex) || statusIndex < 0 || statusIndex >= STATUS_LIST_BITS) {
    throw new Error(`statusIndex must be an integer in [0, ${STATUS_LIST_BITS})`);
  }
  const sortedCategories = scope === "subset" ? [...categories].sort() : undefined;
  const { id } = credentialIdFor({
    subjectId,
    suiteVersion: SUITE.version,
    vectorSetHash: SUITE.vectorSetHash,
    level,
    scope,
    categories: sortedCategories,
  });
  return {
    "@context": [...PROGRAM_CONTEXT],
    id,
    type: ["VerifiableCredential", CREDENTIAL_TYPE],
    issuer: ISSUER_DID,
    validFrom,
    credentialSchema: { id: SCHEMA_URL, type: "JsonSchema" },
    credentialSubject: {
      id: subjectId,
      implementation: {
        name: implementation.name,
        version: implementation.version,
        ...(implementation.repo !== undefined ? { repo: implementation.repo } : {}),
        digest: { gitCommit: implementation.digest.gitCommit },
      },
      level,
      scope,
      ...(sortedCategories !== undefined ? { categories: sortedCategories } : {}),
      suite: {
        package: "@kya-os/mcp",
        packageVersion,
        suiteVersion: SUITE.version,
        vectorSetHash: SUITE.vectorSetHash,
        vectorCount: SUITE.vectors,
      },
    },
    credentialStatus: STATUS_PURPOSES.map((statusPurpose) => ({
      type: "BitstringStatusListEntry",
      statusPurpose,
      statusListIndex: String(statusIndex),
      statusListCredential: STATUS_LIST_URLS[statusPurpose],
    })),
    termsOfUse: [{ type: "KyaOsConformanceTerms", statement: TERMS_STATEMENT }],
  };
}

// ── eddsa-jcs-2022 sign / verify ────────────────────────────────────────────

/**
 * The cryptosuite's hashData (sections 3.3.3 to 3.3.5): sha256(JCS(proof
 * configuration)) || sha256(JCS(unsecured document)), the configuration
 * being `proof` exactly as given minus its proofValue. Nothing is added to
 * it: the @context it hashes is the one the proof itself carries. A set
 * created that is not an [XMLSCHEMA11-2] dateTimeStamp throws, so it can be
 * neither signed nor verified: EdDSA Cryptosuites v1.0 section 3.3.5 step 3
 * requires the error for an invalid datetime, such as 2023-02-29, and for a
 * valid one with no Z or offset it is this program's choice under VC Data
 * Integrity 1.0 section 2.1.
 */
export function signingInput(unsecuredDocument, proof) {
  const config = { ...proof };
  delete config.proofValue;
  if (config.created !== undefined && !isDateTimeStamp(config.created)) {
    throw new Error(
      "proof.created must be an XMLSCHEMA11-2 dateTimeStamp: EdDSA Cryptosuites v1.0 section 3.3.5 step 3 makes an invalid datetime an error, " +
        "and refusing a datetime with no Z or offset is this program's choice under VC Data Integrity 1.0 section 2.1",
    );
  }
  const proofHash = sha256(Buffer.from(canonicalize(config), "utf8"));
  const docHash = sha256(Buffer.from(canonicalize(unsecuredDocument), "utf8"));
  return Buffer.concat([proofHash, docHash]);
}

/**
 * Section 3.3.2 step 4.1: does the document's @context start with every
 * value of the proof's, in the same order? A single context counts as a list
 * of one and a missing one as an empty list. Values compare by their JCS
 * form, in order, so the first that differs decides; a value with no JCS
 * form throws when the walk reaches it, and the verifier refuses with that
 * canonicalization failure as its reason, as the badge worker does.
 */
function contextStartsWith(documentContext, proofContext) {
  const asList = (context) => (context === undefined ? [] : [context].flat());
  const documentList = asList(documentContext);
  const prefix = asList(proofContext);
  return prefix.length <= documentList.length && prefix.every((value, i) => canonicalize(documentList[i]) === canonicalize(value));
}

/**
 * Verify an EXISTING status list against the committed status key its own
 * proof names - not against whichever key the current environment holds.
 * This is what keeps the documented rotation path working: after a rotation
 * the environment signs NEW lists with status-2 while the committed list on
 * disk still carries a valid status-1 proof, and both must verify against
 * registry/keys/program-keys.json (which retains rotated-out keys exactly
 * for this). Fails closed on an unknown, non-status, or mismatched key.
 */
export function verifyStatusListAgainstCommittedKey(list, programKeys) {
  const vm = list?.proof?.verificationMethod;
  if (typeof vm !== "string" || !vm.includes("#")) return { ok: false, reason: "proof.verificationMethod missing or malformed" };
  const fragment = vm.slice(vm.indexOf("#") + 1);
  const key = (programKeys?.keys ?? []).find((candidate) => candidate.id === fragment);
  if (key === undefined) return { ok: false, reason: `proof names uncommitted key "${fragment}"` };
  if (key.purpose !== "status") return { ok: false, reason: `proof names a "${key.purpose}" key - status lists are signed by status keys only` };
  return verifyCredential(list, key.publicKeyMultibase);
}

/**
 * Attach an eddsa-jcs-2022 DataIntegrityProof to `document` (section 3.3.1),
 * signed with an Ed25519 private key given as a z-multibase Multikey string
 * or 32 raw seed bytes. The proof carries its own copy of the document's
 * @context whenever the document has the key, whatever its value (step 2),
 * so a verifier can rebuild what was signed from the stored proof alone.
 * `created` defaults to the document's validFrom so committed artifacts stay
 * a pure function of their inputs.
 */
export function signCredential(document, privateKeyMultibaseOrSeed, verificationMethod, { created, proofPurpose = "assertionMethod" } = {}) {
  const seed =
    typeof privateKeyMultibaseOrSeed === "string" ? decodePrivateKeyMultibase(privateKeyMultibaseOrSeed) : privateKeyMultibaseOrSeed;
  const proof = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: created ?? document.validFrom,
    verificationMethod,
    proofPurpose,
    ...(document["@context"] !== undefined ? { "@context": structuredClone(document["@context"]) } : {}),
  };
  const signature = edSign(null, signingInput(document, proof), privateKeyObject(seed));
  return { ...document, proof: { ...proof, proofValue: `z${base58btcEncode(new Uint8Array(signature))}` } };
}

/**
 * Verify a DataIntegrityProof / eddsa-jcs-2022 proof on `document` against
 * an Ed25519 public key (z-multibase Multikey string or 32 raw bytes), per
 * section 3.3.2: the configuration is the stored proof minus its proofValue,
 * and a proof that carries an @context requires the document's @context to
 * start with it, the document then being hashed under the proof's.
 * Returns { ok, reason? } and never throws on malformed input - callers fail
 * closed. workers/badge/verify.mjs implements the same section independently.
 */
export function verifyCredential(document, publicKeyMultibaseOrRaw) {
  try {
    const raw = typeof publicKeyMultibaseOrRaw === "string" ? decodePublicKeyMultibase(publicKeyMultibaseOrRaw) : publicKeyMultibaseOrRaw;
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
    // Step 4 runs "if proofOptions.@context exists", read as the key being
    // present, whatever its value: a stored null, "", false, 0 or {} must
    // prefix the document's @context like any other value. Digital Bazaar's
    // eddsa-jcs-2022 cryptosuite 1.0.0 tests truthiness instead, and skips
    // step 4 for null, "", false and 0;
    // workers/badge/spec-conformance.test.mjs holds both verifiers here to
    // the cases.
    if (proof["@context"] !== undefined) {
      if (!contextStartsWith(document["@context"], proof["@context"])) {
        return { ok: false, reason: 'the document\'s "@context" does not start with the proof\'s "@context"' };
      }
      unsecured["@context"] = proof["@context"];
    }
    const ok = edVerify(null, signingInput(unsecured, proof), publicKeyObject(raw), signature);
    return ok ? { ok: true } : { ok: false, reason: "signature verification failed" };
  } catch (err) {
    return { ok: false, reason: `verification error: ${err.message}` };
  }
}

// ── Bitstring Status List codec ─────────────────────────────────────────────

export function encodeStatusList(bytes) {
  return `u${Buffer.from(gzipSync(bytes)).toString("base64url")}`;
}

/** Decode an encodedList (u-prefixed base64url + gzip) with the inflation
 * cap enforced by zlib itself; enforces the program's exact list size. */
export function decodeStatusList(encodedList) {
  if (typeof encodedList !== "string" || !encodedList.startsWith("u")) {
    throw new Error("encodedList must be multibase base64url (u-prefixed)");
  }
  const inflated = gunzipSync(Buffer.from(encodedList.slice(1), "base64url"), { maxOutputLength: MAX_INFLATED_BYTES });
  if (inflated.length !== STATUS_LIST_BYTES) {
    throw new Error(`status list must inflate to exactly ${STATUS_LIST_BYTES} bytes (got ${inflated.length})`);
  }
  return new Uint8Array(inflated);
}

export function statusBitAt(bytes, index) {
  if (!Number.isInteger(index) || index < 0 || index >= bytes.length * 8) {
    throw new Error(`statusListIndex ${index} out of range`);
  }
  return ((bytes[index >> 3] >> (7 - (index & 7))) & 1) === 1;
}

export function setStatusBit(bytes, index, value) {
  if (!Number.isInteger(index) || index < 0 || index >= bytes.length * 8) {
    throw new Error(`statusListIndex ${index} out of range`);
  }
  if (value) bytes[index >> 3] |= 0x80 >> (index & 7);
  else bytes[index >> 3] &= ~(0x80 >> (index & 7));
}

/** The unsigned BitstringStatusListCredential for one purpose, exactly the
 * shape the badge worker already reads. */
export function buildStatusListCredential({ purpose, encodedList, validFrom }) {
  if (!STATUS_PURPOSES.includes(purpose)) throw new Error(`statusPurpose must be one of ${STATUS_PURPOSES.join(", ")}`);
  const id = STATUS_LIST_URLS[purpose];
  return {
    "@context": [...PROGRAM_CONTEXT],
    id,
    type: ["VerifiableCredential", "BitstringStatusListCredential"],
    issuer: ISSUER_DID,
    validFrom,
    credentialSubject: { id: `${id}#list`, type: "BitstringStatusList", statusPurpose: purpose, encodedList },
  };
}
