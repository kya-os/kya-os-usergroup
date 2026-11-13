/**
 * Unit tests for the conformance program's attestation core:
 * scripts/lib/{jcs,keys,attest,shape}.mjs plus the allocation-ledger rules
 * in scripts/validate-credentials.mjs (against throwaway fixture trees).
 * Cross-implementation parity with the badge worker lives in
 * workers/badge/parity.test.mjs.
 *
 *   node --test scripts/__tests__/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize } from "../lib/jcs.mjs";
import {
  base58btcDecode,
  base58btcEncode,
  decodePrivateKeyMultibase,
  decodePublicKeyMultibase,
  encodePrivateKeyMultibase,
  encodePublicKeyMultibase,
  publicRawFromSeed,
} from "../lib/keys.mjs";
import {
  STATUS_LIST_BYTES,
  TERMS_STATEMENT,
  buildCredential,
  buildStatusListCredential,
  credentialIdFor,
  decodeStatusList,
  encodeStatusList,
  setStatusBit,
  signCredential,
  statusBitAt,
  verifyCredential,
  verifyStatusListAgainstCommittedKey,
} from "../lib/attest.mjs";

function generateKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "jwk" }).d;
  const raw = Buffer.from(seed, "base64url");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { seed: new Uint8Array(raw), publicKeyMultibase: encodePublicKeyMultibase(new Uint8Array(pub)) };
}
import { checkCredentialShape, checkStatusListShape } from "../lib/shape.mjs";
import { validateCredentials } from "../validate-credentials.mjs";

const PIN = "sha256:81d537d4574d3f66d651a03ca41c0b18493b67ea6f3e61aba47d1bda4f3cf49b";

function throwawayKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = (key, field) => new Uint8Array(Buffer.from(key.export({ format: "jwk" })[field], "base64url"));
  return { seed: raw(privateKey, "d"), public: raw(publicKey, "x") };
}

function sampleCredential(overrides = {}) {
  return buildCredential({
    subjectId: "https://example.com/impl",
    implementation: { name: "Fixture", version: "1.2.3", digest: { gitCommit: "a".repeat(40) } },
    level: "L1",
    scope: "subset",
    categories: ["signed-proof"],
    packageVersion: "1.14.0",
    statusIndex: 3,
    validFrom: "2026-01-01T00:00:00Z",
    ...overrides,
  });
}

// ── JCS: RFC 8785 edge vectors against hardcoded expectations ───────────────

test("JCS: ECMAScript number serialization edge vectors", () => {
  assert.equal(canonicalize(1e21), "1e+21");
  assert.equal(canonicalize(0.000001), "0.000001");
  assert.equal(canonicalize(1e-7), "1e-7");
  assert.equal(canonicalize(-0), "0");
  assert.equal(canonicalize(9007199254740991), "9007199254740991");
  assert.equal(canonicalize(333333333.3333333), "333333333.3333333");
  assert.throws(() => canonicalize(Infinity), /non-finite/);
  assert.throws(() => canonicalize(NaN), /non-finite/);
});

test("JCS: key sorting is UTF-16 code unit order, unicode included", () => {
  assert.equal(canonicalize({ "é": 1, e: 2, "€": 3, Z: 4, a: 5 }), '{"Z":4,"a":5,"e":2,"é":1,"€":3}');
  // The classic JCS gotcha: code UNIT order, not code point order. The emoji
  // U+1F600 is the surrogate pair d83d de00, and 0xd83d < 0xfb00 ("ﬀ"), so
  // the higher code POINT sorts first - exactly what RFC 8785 requires.
  assert.equal(canonicalize({ "😀": 1, "ﬀ": 2 }), '{"😀":1,"ﬀ":2}');
});

test("JCS: string escapes match RFC 8785 exactly", () => {
  assert.equal(canonicalize("a\u0000b\"\\\n\t\u001f"), '"a\\u0000b\\"\\\\\\n\\t\\u001f"');
  assert.equal(canonicalize("\b\f\r"), '"\\b\\f\\r"');
  assert.equal(canonicalize({ "key": [null, true, false] }), '{"\\bkey":[null,true,false]}');
});

test("JCS: undefined array items serialize as null; undefined members drop", () => {
  assert.equal(canonicalize([undefined, 1]), "[null,1]");
  assert.equal(canonicalize({ a: undefined, b: 1 }), '{"b":1}');
});

// ── codecs and multikey ─────────────────────────────────────────────────────

test("base58btc: roundtrip incl. leading zeros and empty input", () => {
  for (const bytes of [new Uint8Array(0), new Uint8Array([0, 0, 1, 2, 3]), new Uint8Array([255, 254, 0]), new Uint8Array(32).fill(7)]) {
    assert.deepEqual(base58btcDecode(base58btcEncode(bytes)), bytes);
  }
  assert.equal(base58btcEncode(new Uint8Array([0, 0])), "11");
  assert.throws(() => base58btcDecode("0OIl"), /invalid character/);
});

test("multikey: public and private roundtrip, prefixes enforced", () => {
  const { seed, public: pub } = throwawayKey();
  assert.deepEqual(decodePublicKeyMultibase(encodePublicKeyMultibase(pub)), pub);
  assert.deepEqual(decodePrivateKeyMultibase(encodePrivateKeyMultibase(seed)), seed);
  // A public multikey is not a private one and vice versa.
  assert.throws(() => decodePrivateKeyMultibase(encodePublicKeyMultibase(pub)), /ed25519-priv/);
  assert.throws(() => decodePublicKeyMultibase(encodePrivateKeyMultibase(seed)), /ed25519-pub/);
  assert.deepEqual(publicRawFromSeed(seed), pub);
});

// ── deterministic id ────────────────────────────────────────────────────────

test("deterministic id: pinned vectors and category-order independence via sorting", () => {
  const subset = credentialIdFor({ subjectId: "https://example.com/impl", suiteVersion: "1.0.0", vectorSetHash: PIN, level: "L1", scope: "subset", categories: ["signed-proof"] });
  assert.equal(subset.id, "urn:kya:conf:f21707cf366ba09a5b0418a9e9a89292");
  const full = credentialIdFor({ subjectId: "did:web:example.com", suiteVersion: "1.0.0", vectorSetHash: PIN, level: "L3", scope: "full" });
  assert.equal(full.id, "urn:kya:conf:32cee7a9cdb5b5aae4b58c02e757f468");
  // Absent categories hash as [] - full-scope ids are stable.
  assert.equal(credentialIdFor({ subjectId: "did:web:example.com", suiteVersion: "1.0.0", vectorSetHash: PIN, level: "L3", scope: "full", categories: undefined }).id, full.id);
  // Any input field change changes the id.
  assert.notEqual(credentialIdFor({ subjectId: "https://example.com/impl", suiteVersion: "1.0.0", vectorSetHash: PIN, level: "L2", scope: "subset", categories: ["signed-proof"] }).id, subset.id);
});

// ── sign -> verify roundtrip and tamper rejection ───────────────────────────

test("sign -> verify roundtrip; every tamper class rejects", () => {
  const key = throwawayKey();
  const credential = sampleCredential();
  const signed = signCredential(credential, key.seed, "did:web:builders.kya-os.org#conformance-issuer-1");
  assert.equal(verifyCredential(signed, encodePublicKeyMultibase(key.public)).ok, true);
  // Multibase private key input works identically.
  const signed2 = signCredential(credential, encodePrivateKeyMultibase(key.seed), "did:web:builders.kya-os.org#conformance-issuer-1");
  assert.equal(verifyCredential(signed2, key.public).ok, true);

  const tamperedSubject = structuredClone(signed);
  tamperedSubject.credentialSubject.level = "L3";
  assert.equal(verifyCredential(tamperedSubject, key.public).ok, false);

  const tamperedProof = structuredClone(signed);
  tamperedProof.proof.proofValue = tamperedProof.proof.proofValue.replace(/.$/, (last) => (last === "2" ? "3" : "2"));
  assert.equal(verifyCredential(tamperedProof, key.public).ok, false);

  const wrongKey = throwawayKey();
  assert.equal(verifyCredential(signed, wrongKey.public).ok, false);

  const wrongSuite = structuredClone(signed);
  wrongSuite.proof.cryptosuite = "eddsa-rdfc-2022";
  assert.equal(verifyCredential(wrongSuite, key.public).ok, false);
});

test("buildCredential fails closed on bad inputs", () => {
  assert.throws(() => sampleCredential({ subjectId: "http://insecure.example" }), /https URL or a DID/);
  assert.throws(() => sampleCredential({ scope: "subset", categories: [] }), /subset claim requires/);
  assert.throws(() => sampleCredential({ scope: "full", categories: ["x-y"] }), /full claim must not/);
  assert.throws(() => sampleCredential({ implementation: { name: "x", version: "1", digest: { gitCommit: "short" } } }), /40-hex/);
  assert.throws(() => sampleCredential({ statusIndex: 131072 }), /statusIndex/);
  // Categories are sorted into the credential regardless of input order.
  const built = sampleCredential({ categories: ["signed-proof", "audit-integrity"] });
  assert.deepEqual(built.credentialSubject.categories, ["audit-integrity", "signed-proof"]);
});

// ── status list codec ───────────────────────────────────────────────────────

test("status list: build, set, read, encode/decode roundtrip, MSB-first bits", () => {
  const bytes = new Uint8Array(STATUS_LIST_BYTES);
  setStatusBit(bytes, 3, true);
  assert.equal(bytes[0], 0b00010000); // index 3 is MSB-first bit 3 of byte 0
  setStatusBit(bytes, 131071, true);
  const decoded = decodeStatusList(encodeStatusList(bytes));
  assert.equal(statusBitAt(decoded, 3), true);
  assert.equal(statusBitAt(decoded, 4), false);
  assert.equal(statusBitAt(decoded, 131071), true);
  setStatusBit(bytes, 3, false);
  assert.equal(statusBitAt(bytes, 3), false);
  assert.throws(() => statusBitAt(decoded, 131072), /out of range/);
  assert.throws(() => decodeStatusList(encodeStatusList(new Uint8Array(8))), /exactly 16384 bytes/);
  assert.throws(() => decodeStatusList("not-multibase"), /u-prefixed/);
});

// ── shape checks ────────────────────────────────────────────────────────────

test("credential shape: valid passes; each fail-closed rule fires", () => {
  const key = throwawayKey();
  const signed = signCredential(sampleCredential(), key.seed, "did:web:builders.kya-os.org#conformance-issuer-1");
  assert.deepEqual(checkCredentialShape(signed, "t"), []);

  const withExpiry = { ...signed, validUntil: "2027-01-01T00:00:00Z" };
  assert.ok(checkCredentialShape(withExpiry, "t").some((e) => /validUntil/.test(e)), "validUntil must be a schema violation");

  const wrongIssuer = { ...signed, issuer: "did:web:evil.example" };
  assert.ok(checkCredentialShape(wrongIssuer, "t").some((e) => /issuer/.test(e)));

  const wrongId = { ...signed, id: "urn:kya:conf:" + "0".repeat(32) };
  assert.ok(checkCredentialShape(wrongId, "t").some((e) => /does not recompute/.test(e)), "id must recompute from subject fields");

  const unsortedCats = structuredClone(signed);
  unsortedCats.credentialSubject.categories = ["signed-proof", "audit-integrity"];
  assert.ok(checkCredentialShape(unsortedCats, "t").some((e) => /sorted|recompute/.test(e)));

  const driftedTerms = structuredClone(signed);
  driftedTerms.termsOfUse[0].statement = TERMS_STATEMENT + " ";
  assert.ok(checkCredentialShape(driftedTerms, "t").some((e) => /termsOfUse/.test(e)), "the terms statement is pinned verbatim");

  const extraKey = { ...signed, bonus: 1 };
  assert.ok(checkCredentialShape(extraKey, "t").some((e) => /unexpected property/.test(e)));
});

test("status list shape: valid passes; wrong purpose and issuer fail", () => {
  const key = throwawayKey();
  const unsigned = buildStatusListCredential({ purpose: "revocation", encodedList: encodeStatusList(new Uint8Array(STATUS_LIST_BYTES)), validFrom: "2026-01-01T00:00:00Z" });
  const signed = signCredential(unsigned, key.seed, "did:web:builders.kya-os.org#conformance-status-1");
  assert.deepEqual(checkStatusListShape(signed, "revocation", "t"), []);
  assert.ok(checkStatusListShape(signed, "suspension", "t").length > 0, "a revocation list is not a suspension list");
  const issuerSigned = signCredential(unsigned, key.seed, "did:web:builders.kya-os.org#conformance-issuer-1");
  assert.ok(checkStatusListShape(issuerSigned, "revocation", "t").some((e) => /conformance-status/.test(e)), "a list signed under an issuer fragment fails the shape");
});

// ── allocation ledger rules (fixture trees) ─────────────────────────────────

function fixtureRoot(allocations, { sentinel = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kya-alloc-"));
  mkdirSync(join(root, "registry", "keys"), { recursive: true });
  mkdirSync(join(root, "registry", "credentials", "schema"), { recursive: true });
  writeFileSync(
    join(root, "registry", "keys", "program-keys.json"),
    JSON.stringify(sentinel ? { version: 1, keys: [{ purpose: "issuer", status: "unprovisioned" }] } : { version: 1, keys: [] }) + "\n",
  );
  writeFileSync(join(root, "registry", "credentials", "schema", "attestation-v1.json"), "{}\n");
  writeFileSync(join(root, "registry", "credentials", "allocations.json"), JSON.stringify(allocations, null, 2) + "\n");
  return root;
}

test("allocations: uniqueness, sequential indexes, nextIndex agreement", () => {
  const good = fixtureRoot({ nextIndex: 0, allocations: [] });
  assert.deepEqual(validateCredentials([], good).errors, []);
  rmSync(good, { recursive: true, force: true });

  const alloc = (index, tail) => ({ index, credentialId: `urn:kya:conf:${String(tail).repeat(32).slice(0, 32)}`, slug: "some-slug", allocatedAt: "2026-01-01T00:00:00Z" });
  const cases = [
    [{ nextIndex: 2, allocations: [alloc(0, "a"), alloc(0, "b")] }, /duplicate allocation index/],
    [{ nextIndex: 2, allocations: [alloc(0, "a"), alloc(1, "a")] }, /duplicate allocation for credential/],
    [{ nextIndex: 2, allocations: [alloc(0, "a"), alloc(2, "b")] }, /sequential, no gaps/],
    [{ nextIndex: 5, allocations: [alloc(0, "a")] }, /must equal the allocation count/],
    [{ nextIndex: 1, allocations: [alloc(0, "a")] }, /uncommitted credential/],
    [{ nextIndex: 1, allocations: [alloc(0, "a")] }, /unprovisioned but the allocation ledger is not empty/],
  ];
  for (const [allocations, expected] of cases) {
    const root = fixtureRoot(allocations);
    const { errors } = validateCredentials([], root);
    assert.ok(errors.some((e) => expected.test(e)), `expected ${expected} in:\n  ${errors.join("\n  ")}`);
    rmSync(root, { recursive: true, force: true });
  }
});

test("sentinel: a verified entry without provisioned keys is refused", () => {
  const root = fixtureRoot({ nextIndex: 0, allocations: [] });
  const entries = [{ slug: "x-impl", conformance: { level: "L1", scope: "full", suiteVersion: "1.0.0", status: "verified", attestationUrl: "https://builders.kya-os.org/credentials/deadbeefdeadbeefdeadbeefdeadbeef.json" } }];
  const { errors } = validateCredentials(entries, root);
  assert.ok(errors.some((e) => /nothing renders verified on the sentinel/.test(e)), errors.join("\n"));
  assert.ok(errors.some((e) => /attestationUrl does not point at a committed/.test(e)), errors.join("\n"));
  rmSync(root, { recursive: true, force: true });
});

test("rotation: an existing list verifies against the committed key its proof names, not the current environment key", () => {
  const keyA = generateKeypair();
  const keyB = generateKeypair();
  const programKeys = {
    provisioned: true,
    keys: [
      { id: "conformance-status-1", purpose: "status", publicKeyMultibase: keyA.publicKeyMultibase },
      { id: "conformance-status-2", purpose: "status", publicKeyMultibase: keyB.publicKeyMultibase },
    ],
  };
  const unsigned = buildStatusListCredential({ purpose: "revocation", encodedList: encodeStatusList(new Uint8Array(STATUS_LIST_BYTES)), validFrom: "2026-08-25T00:00:00Z" });
  const oldList = signCredential(unsigned, keyA.seed, "did:web:builders.kya-os.org#conformance-status-1");
  assert.equal(verifyStatusListAgainstCommittedKey(oldList, programKeys).ok, true, "post-rotation, the status-1 list must still verify");
  const foreign = signCredential(unsigned, keyB.seed, "did:web:builders.kya-os.org#conformance-status-9");
  assert.equal(verifyStatusListAgainstCommittedKey(foreign, programKeys).ok, false, "an uncommitted key id must refuse");
  const issuerKeys = { provisioned: true, keys: [{ id: "conformance-status-1", purpose: "issuer", publicKeyMultibase: keyA.publicKeyMultibase }] };
  assert.equal(verifyStatusListAgainstCommittedKey(oldList, issuerKeys).ok, false, "a non-status key must refuse");
});
