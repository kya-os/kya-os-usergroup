/**
 * The eddsa-jcs-2022 cryptosuite (VC Data Integrity EdDSA Cryptosuites v1.0,
 * section 3.3) on both implementations: the scripts side
 * (scripts/lib/attest.mjs) and the badge worker (verify.mjs), with the
 * worker's test fixture signer (fixtures/mint.mjs createProof) standing in
 * for the signing half the worker deliberately lacks. Like parity.test.mjs,
 * this file imports both sides, which never import each other. It holds the
 * cryptosuite layer alone: the checks each full verifier adds after it
 * (scripts/lib/shape.mjs for verify-credential.mjs, worker.mjs for the
 * badge) are outside this file.
 *
 *   - Appendix B.3: both signers reproduce the specification's vector byte
 *     for byte, the proof storing the document's @context (3.3.1 step 2),
 *     and both verifiers accept it
 *   - section 3.3.1 step 2: both signers store their own copy of a present
 *     @context, whatever its value, and both verifiers accept the result
 *   - section 3.3.2: both verifiers reach each case's expected verdict, and
 *     give the same reason for a refusal; where the text leaves room for
 *     another reading, the case records the program's
 *   - proof.created, to sign and to verify: an [XMLSCHEMA11-2]
 *     dateTimeStamp, with the same reason on both sides for any other
 *     value: an error for an invalid datetime, as EdDSA Cryptosuites v1.0
 *     section 3.3.5 step 3 requires, and for a valid one with no Z or
 *     offset, by this program's choice under VC Data Integrity 1.0 section
 *     2.1; where Digital Bazaar's data-integrity 2.5.0 reaches another
 *     verdict, the case says why
 *   - every committed credential and status list carries its @context in
 *     its proof and verifies on both sides against the pinned key it names,
 *     and neither side accepts it with that @context stripped
 *
 *   node --test workers/badge/spec-conformance.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, sign as edSign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  base58btcDecode as workerB58Decode,
  ed25519KeyFromMultibase,
  eddsaJcs2022HashData,
  jcsCanonicalize,
  verifyEddsaJcs2022,
} from "./verify.mjs";
import { createProof, keyFromMultikeyPair, withoutProofContext } from "./fixtures/mint.mjs";
import * as B3 from "./fixtures/vc-di-eddsa-b3.mjs";
import { PINNED_ISSUER_KEYS, PINNED_STATUS_KEYS, PROVISIONED } from "./generated-keys.mjs";
import { canonicalize } from "../../scripts/lib/jcs.mjs";
import { base58btcEncode } from "../../scripts/lib/keys.mjs";
import { signCredential, signingInput, verifyCredential } from "../../scripts/lib/attest.mjs";

// VC Data Integrity EdDSA Cryptosuites v1.0, Appendix B.3 (the published key
// pair, so nothing here could ever be trusted).
const B3_KEY = keyFromMultikeyPair(B3.KEY_PAIR);
const B3_WORKER_KEY = ed25519KeyFromMultibase(B3.KEY_PAIR.publicKeyMultibase);
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest();

/** The two signers under test, each over the B.3 key and proof options. */
const SIGNERS = {
  "scripts/lib/attest.mjs signCredential": async (document, created = B3.PROOF_OPTIONS.created) =>
    signCredential(document, B3.KEY_PAIR.secretKeyMultibase, B3.PROOF_OPTIONS.verificationMethod, { created }),
  "fixtures/mint.mjs createProof": (document, created = B3.PROOF_OPTIONS.created) =>
    createProof(document, B3_KEY.privateKey, { ...B3.PROOF_OPTIONS, created }),
};

/** Both verifiers' answers on one document, against the B.3 key. */
async function verifyOnBothSides(document) {
  return {
    scripts: verifyCredential(document, B3.KEY_PAIR.publicKeyMultibase),
    worker: await verifyEddsaJcs2022(document, B3_WORKER_KEY),
  };
}

function withoutContext(document) {
  const copy = structuredClone(document);
  delete copy["@context"];
  return copy;
}

/** A section 3.3 signature computed by hand, outside both cryptosuite
 * implementations (only the JCS and base58btc codecs parity.test.mjs pins):
 * sha256(JCS(configuration)) || sha256(JCS(document)) under the B.3 key. */
function signedByHand(document, configuration) {
  const hashData = Buffer.concat([sha256(canonicalize(configuration)), sha256(canonicalize(document))]);
  const proofValue = `z${base58btcEncode(new Uint8Array(edSign(null, hashData, B3_KEY.privateKey)))}`;
  return { ...structuredClone(document), proof: { ...structuredClone(configuration), proofValue } };
}

// ── Appendix B.3 and section 3.3.1 ──────────────────────────────────────────

test("both signers reproduce the specification's eddsa-jcs-2022 vector byte for byte, and both verifiers accept it", async () => {
  // The vector's own chain: canonical forms, hashData, signature.
  for (const jcs of [canonicalize, jcsCanonicalize]) {
    assert.equal(jcs(B3.UNSECURED_DOCUMENT), B3.CANONICAL_DOCUMENT);
    assert.equal(jcs(B3.PROOF_CONFIGURATION), B3.CANONICAL_PROOF_CONFIGURATION);
  }
  assert.equal(signingInput(B3.UNSECURED_DOCUMENT, B3.PROOF_CONFIGURATION).toString("hex"), B3.HASH_DATA_HEX);
  assert.equal(Buffer.from(await eddsaJcs2022HashData(B3.UNSECURED_DOCUMENT, B3.PROOF_CONFIGURATION)).toString("hex"), B3.HASH_DATA_HEX);
  assert.equal(Buffer.from(workerB58Decode(B3.PROOF_VALUE.slice(1))).toString("hex"), B3.SIGNATURE_HEX);

  // Section 3.3.1: each signer stores the document's @context in the proof
  // (step 2) and signs exactly that proof - Example 39, key order included.
  const example39 = JSON.stringify(B3.SIGNED_DOCUMENT);
  const bare = withoutContext(B3.UNSECURED_DOCUMENT);
  const bareByHand = JSON.stringify(signedByHand(bare, B3.PROOF_OPTIONS));
  for (const [signer, sign] of Object.entries(SIGNERS)) {
    assert.equal(JSON.stringify(await sign(B3.UNSECURED_DOCUMENT)), example39, `${signer} must reproduce Example 39`);
    // Step 2 applies only when the document has an @context.
    assert.equal(JSON.stringify(await sign(bare)), bareByHand, `${signer}: a document without @context gets a proof without one`);
  }

  const results = await verifyOnBothSides(B3.SIGNED_DOCUMENT);
  assert.deepEqual([results.scripts.ok, results.worker.ok], [true, true]);
});

test("section 3.3.1 step 2 on both signers: the proof stores its own copy of a present @context, whatever its value, and both verifiers accept the result", async () => {
  const failures = [];
  for (const [signer, sign] of Object.entries(SIGNERS)) {
    // "If unsecuredDocument.@context is present" is read as the key being
    // present, so a null, "", false, 0 or {} @context is stored like any
    // other.
    for (const context of [null, "", false, 0, {}, B3.UNSECURED_DOCUMENT["@context"]]) {
      const signed = await sign({ ...structuredClone(B3.UNSECURED_DOCUMENT), "@context": structuredClone(context) });
      const stored = "@context" in signed.proof && jcsCanonicalize(signed.proof["@context"]) === jcsCanonicalize(context);
      const { scripts, worker } = await verifyOnBothSides(signed);
      if (!stored || !scripts.ok || !worker.ok) {
        failures.push(`${signer}, @context ${JSON.stringify(context)}: stored ${stored}, scripts ${scripts.ok}, worker ${worker.ok}`);
      }
    }
    // Its own copy: changing the signed document's @context afterwards
    // leaves the proof's as it was signed.
    const signed = await sign(structuredClone(B3.UNSECURED_DOCUMENT));
    signed["@context"].push("https://example.org/appended/v1");
    if (canonicalize(signed.proof["@context"]) !== canonicalize(B3.UNSECURED_DOCUMENT["@context"])) {
      failures.push(`${signer}: the proof's @context aliases the document's`);
    }
  }
  assert.deepEqual(failures, []);
});

// ── section 3.3.2 ───────────────────────────────────────────────────────────

// Where the specification's text leaves room for another reading and
// another implementation takes it, a case records the program's reading.
const KEY_PRESENT =
  'the program\'s reading: "If proofOptions.@context exists" holds when the key is present, whatever its value; ' +
  "Digital Bazaar's eddsa-jcs-2022 cryptosuite 1.0.0 tests truthiness instead, skips step 4, and verifies this case";
const JCS_CONTENT =
  "the program's reading: step 4.1 compares values by their JCS content; " +
  "Digital Bazaar's eddsa-jcs-2022 cryptosuite 1.0.0 compares them by identity and refuses this case";

test("section 3.3.2 on both verifiers: each case reaches its expected verdict, and both give the same reason for a refusal", async () => {
  const variant = (mutate) => {
    const document = structuredClone(B3.SIGNED_DOCUMENT);
    mutate(document);
    return document;
  };
  const [V2] = B3.UNSECURED_DOCUMENT["@context"];
  const withContexts = (documentContext, proofContext) =>
    signedByHand({ ...B3.UNSECURED_DOCUMENT, "@context": documentContext }, { ...B3.PROOF_OPTIONS, "@context": proofContext });
  const stringContext = withContexts(V2, V2);
  const embeddedContext = [V2, { alumniOf: "https://schema.org/alumniOf" }];
  const reorderedEmbedded = [V2, { alumniOf: "https://schema.org/alumniOf", name: "https://schema.org/name" }];
  // A proof @context that is present but falsy, signed over the document as
  // is: a verifier that tests truthiness skips step 4 and accepts it.
  const falsyProofContext = (value, document = B3.UNSECURED_DOCUMENT) => signedByHand(document, { ...B3.PROOF_OPTIONS, "@context": value });
  // A value with no JCS form, as 1e999 in served JSON parses (Infinity), in
  // the document's @context, the proof's, or both. Both sides walk the prefix
  // in order and refuse with the canonicalization failure when the walk
  // reaches it, unless a value before it already differs.
  const NO_JCS_FORM = "JCS: non-finite numbers have no canonical form";
  // One @context nesting the other as a single value, signed over the
  // document under the proof's @context: step 4.1 compares V2 with [V2] and
  // refuses, where a verifier that flattened nested lists would find the
  // prefix and verify.
  const underProofContext = (documentContext, proofContext) => ({ ...withContexts(proofContext, proofContext), "@context": documentContext });
  const nonFinite = (where) =>
    variant((d) => {
      if (where !== "proof") d["@context"][1] = Infinity;
      if (where !== "document") d.proof["@context"][1] = Infinity;
    });
  const cases = [
    { name: "Example 39 as published", document: B3.SIGNED_DOCUMENT, verified: true },
    { name: "a document @context that extends the proof's (step 4.2 hashes the proof's)", document: variant((d) => d["@context"].push("https://w3id.org/security/data-integrity/v2")), verified: true },
    { name: "a document @context in another order", document: variant((d) => d["@context"].reverse()), reason: "does not start with" },
    { name: "a document @context shorter than the proof's", document: variant((d) => d["@context"].pop()), reason: "does not start with" },
    { name: "a document @context that differs after its first value", document: variant((d) => d["@context"].splice(1, 1, "https://example.com/other/v1")), reason: "does not start with" },
    { name: "a document with no @context", document: variant((d) => delete d["@context"]), reason: "does not start with" },
    { name: "a document with no @context, under a single-string proof @context", document: withoutContext(stringContext), reason: "does not start with" },
    { name: "a document with no @context, under a proof @context of [null] (absent is not null)", document: signedByHand(withoutContext(B3.UNSECURED_DOCUMENT), { ...B3.PROOF_OPTIONS, "@context": [null] }), reason: "does not start with" },
    { name: "a stored proof that dropped the @context it was signed over", document: variant((d) => delete d.proof["@context"]), reason: "signature verification failed" },
    { name: "a proof without @context, signed over a configuration without it", document: signedByHand(B3.UNSECURED_DOCUMENT, B3.PROOF_OPTIONS), verified: true },
    { name: "a document and a proof without @context", document: signedByHand(withoutContext(B3.UNSECURED_DOCUMENT), B3.PROOF_OPTIONS), verified: true },
    { name: "a single-string @context, carried by the proof", document: stringContext, verified: true },
    { name: "a document @context list that starts with the proof's single string", document: { ...stringContext, "@context": B3.UNSECURED_DOCUMENT["@context"] }, verified: true },
    { name: "a proof @context of null, the document hashed as is", document: falsyProofContext(null), reason: "does not start with", reading: KEY_PRESENT },
    { name: 'a proof @context of "", the document hashed as is', document: falsyProofContext(""), reason: "does not start with", reading: KEY_PRESENT },
    { name: "a proof @context of false, the document hashed as is", document: falsyProofContext(false), reason: "does not start with", reading: KEY_PRESENT },
    { name: "a proof @context of 0, the document hashed as is", document: falsyProofContext(0), reason: "does not start with", reading: KEY_PRESENT },
    { name: "a proof @context of null over a document without one", document: falsyProofContext(null, withoutContext(B3.UNSECURED_DOCUMENT)), reason: "does not start with", reading: KEY_PRESENT },
    { name: "a proof @context of {}, the document hashed as is", document: falsyProofContext({}), reason: "does not start with" },
    { name: "a value with no JCS form (1e999) at the same place in the document's @context and the proof's", document: nonFinite("both"), reason: NO_JCS_FORM },
    { name: "a value with no JCS form in the document's @context, within the proof's prefix", document: nonFinite("document"), reason: NO_JCS_FORM },
    { name: "a value with no JCS form in the proof's @context", document: nonFinite("proof"), reason: NO_JCS_FORM },
    {
      name: "a document @context that differs before a value with no JCS form (the first value that differs decides)",
      document: variant((d) => d["@context"].splice(0, 2, "https://example.com/other/v1", Infinity)),
      reason: "does not start with",
    },
    { name: "an embedded context object, carried by the proof", document: withContexts(embeddedContext, embeddedContext), verified: true, reading: JCS_CONTENT },
    {
      name: "an embedded context object, carried by the proof with its keys in another order",
      document: withContexts(reorderedEmbedded, [V2, { name: "https://schema.org/name", alumniOf: "https://schema.org/alumniOf" }]),
      verified: true,
      reading: JCS_CONTENT,
    },
    { name: "a nested list value, carried by the proof", document: withContexts([V2, [V2]], [V2, [V2]]), verified: true, reading: JCS_CONTENT },
    { name: "a proof @context that nests the document's as one value ([[V2]] over [V2])", document: underProofContext([V2], [[V2]]), reason: "does not start with" },
    { name: "a document @context that nests the proof's as one value ([[V2]] under [V2])", document: underProofContext([[V2]], [V2]), reason: "does not start with" },
  ];
  const disagreements = [];
  for (const { name, document, verified = false, reason, reading } of cases) {
    const results = await verifyOnBothSides(document);
    for (const [side, result] of Object.entries(results)) {
      if (result.ok !== verified || (reason !== undefined && !String(result.reason).includes(reason))) {
        disagreements.push(`${side}: ${name}${reading ? ` [${reading}]` : ""} -> ${result.ok ? "verified" : `refused (${result.reason})`}`);
      }
    }
    if (!verified && results.scripts.reason !== results.worker.reason) {
      disagreements.push(`${name}: the two sides refuse for different reasons (scripts: ${results.scripts.reason}; worker: ${results.worker.reason})`);
    }
  }
  assert.deepEqual(disagreements, [], "every case must reach its expected verdict on both sides, and a refusal the same reason on both");
});

// ── proof.created ───────────────────────────────────────────────────────────

// Where Digital Bazaar's data-integrity 2.5.0 reaches another verdict on
// created, a case records why. It checks created only once the signature
// verifies (lib/DataIntegrityProof.js, lines 305 to 311), with util.isW3cDate
// (lib/util.js, lines 28 to 34): XMLDateTimeRegExp.test, a pattern with no
// anchors, an optional timezone, and a day from 01 to 31 in every month.
const NO_OFFSET =
  "the program's reading: created is the dateTimeStamp VC Data Integrity 1.0 section 2.1 requires, its timezone included; " +
  "that section lets a processor accept a value written without an offset, and Digital Bazaar's data-integrity 2.5.0, " +
  "whose pattern makes the timezone optional, does and verifies this case";
const DAY_OF_MONTH =
  "the program's reading: a valid XMLSCHEMA11-2 datetime names a day its month has; " +
  "Digital Bazaar's data-integrity 2.5.0 takes any day from 01 to 31 in any month and verifies this case";
const SUBSTRING =
  "the program's reading: the whole value must be a datetime; Digital Bazaar's data-integrity 2.5.0 tests its pattern " +
  "unanchored, with the timezone optional, so it accepts any value whose string form contains a datetime, and verifies this case";
// Each refusal gives the rule and where each part of it comes from: an
// invalid datetime is an error under EdDSA Cryptosuites v1.0 section 3.3.5
// step 3; a valid datetime with no Z or offset, which VC Data Integrity 1.0
// section 2.1 lets a processor accept, this program refuses by choice.
const CREATED_REFUSAL = new RegExp(
  "proof\\.created must be an XMLSCHEMA11-2 dateTimeStamp: EdDSA Cryptosuites v1\\.0 section 3\\.3\\.5 step 3 makes an invalid datetime an error, " +
    "and refusing a datetime with no Z or offset is this program's choice under VC Data Integrity 1\\.0 section 2\\.1$",
);

test("proof.created in both cryptosuite implementations, to sign or to verify: a dateTimeStamp, an invalid datetime an error (EdDSA Cryptosuites v1.0 section 3.3.5 step 3), and one with no Z or offset refused by this program's choice (VC Data Integrity 1.0 section 2.1)", async () => {
  const valid = [
    undefined, // absent: step 3 applies only when created is set
    "2023-02-24T23:36:38Z",
    "2023-02-24T23:36:38.123456Z",
    "2023-02-24T23:36:38+14:00",
    "2023-02-24T23:36:38-13:59",
    "2024-02-29T00:00:00Z", // a leap year
    "2000-02-29T00:00:00Z", // divisible by 400
    "10000-02-29T00:00:00Z", // divisible by 400: the last four digits decide
    "-0004-02-29T00:00:00Z", // a leap year before year zero
    "2023-12-31T24:00:00Z", // the end of the day
    "2023-12-31T24:00:00.000Z",
    "12023-02-24T23:36:38Z", // a five-digit year
    "-0044-03-15T12:00:00Z", // a negative year
    "0000-01-01T00:00:00Z", // XMLSCHEMA11-2 has a year zero
  ];
  // The last day of every month of 2023, and the day after it: a 32nd, or a
  // day its month lacks.
  const monthEnds = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((days, i) => `2023-${String(i + 1).padStart(2, "0")}-${days}T00:00:00Z`);
  const dayAfter = (stamp) => stamp.replace(/-(\d\d)T/, (_, day) => `-${Number(day) + 1}T`);
  const pastMonthEnds = monthEnds.map(dayAfter).map((stamp) => [stamp, stamp.includes("-32T") ? undefined : DAY_OF_MONTH]);
  // Each value both sides refuse, with the reason when Digital Bazaar
  // accepts it.
  const invalid = [
    ["not-a-date"],
    [5],
    [null],
    [true],
    [""],
    [["2023-02-24T23:36:38Z"], SUBSTRING],
    ["2023-02-24T23:36:38", NO_OFFSET],
    ["2023-02-24"],
    ["2023-02-24 23:36:38Z"],
    ["2023-02-24t23:36:38z"],
    ["2023-02-24T23:36:38z", SUBSTRING],
    [" 2023-02-24T23:36:38Z", SUBSTRING],
    ["2023-02-24T23:36:38Z ", SUBSTRING],
    ["2023-02-29T00:00:00Z", DAY_OF_MONTH], // not a leap year
    ["1900-02-29T00:00:00Z", DAY_OF_MONTH], // divisible by 100, not by 400
    ["20001-02-29T00:00:00Z", DAY_OF_MONTH], // not a leap year, though its first four digits are
    ["100000000000000000001-02-29T00:00:00Z", DAY_OF_MONTH], // not a leap year, though as one number it reads 1e20, which 400 divides
    ["2023-04-31T00:00:00Z", DAY_OF_MONTH],
    ["2023-13-01T00:00:00Z"],
    ["2023-00-01T00:00:00Z"],
    ["2023-01-00T00:00:00Z"],
    ["2023-2-24T23:36:38Z"],
    ["2023-02-4T23:36:38Z"],
    ["2023-002-24T23:36:38Z"],
    ["2023-02-024T23:36:38Z"],
    ["2023-02-24-01T23:36:38Z"],
    ["2023-02-24T25:00:00Z"],
    ["2023-02-24T24:00:01Z"],
    ["2023-02-24T24:01:00Z"],
    ["2023-02-24T24:00:00.5Z", SUBSTRING],
    ["2023-02-24T23:60:00Z"],
    ["2023-02-24T23:36:60Z"], // XMLSCHEMA11-2 has no leap second
    ["2023-02-24T23:36Z"],
    ["2023-02-24T23:36:38:00Z", SUBSTRING],
    ["2023-02-24T3:36:38Z"],
    ["2023-02-24T023:36:38Z"],
    ["2023-02-24T23:36:38.Z", SUBSTRING],
    ["2023-02-24T23:36:38.xZ", SUBSTRING],
    ["2023-02-24T23:36:38.1.2Z", SUBSTRING],
    ["2023-02-24T23:36:38+14:01", SUBSTRING],
    ["2023-02-24T23:36:38+13:60", SUBSTRING],
    ["2023-02-24T23:36:38+1400", SUBSTRING],
    ["2023-02-24T23:36:38+5:00", SUBSTRING],
    ["2023-02-24T23:36:38+001:00", SUBSTRING],
    ["2023-02-24T23:36:38+01:00:00", SUBSTRING],
    ["2023-02-24T23:36:38Z+01:00", SUBSTRING],
    ["02023-02-24T23:36:38Z", SUBSTRING], // a leading zero before a five-digit year
    ["123-02-24T23:36:38Z"],
    ["+2023-02-24T23:36:38Z", SUBSTRING],
  ];
  const disagreements = [];
  const table = [...valid, ...monthEnds]
    .map((created) => ({ created, verified: true }))
    .concat([...invalid, ...pastMonthEnds].map(([created, reading]) => ({ created, verified: false, reading })));
  for (const { created, verified, reading } of table) {
    const value = `created ${JSON.stringify(created)}${reading ? ` [${reading}]` : ""}`;
    const document = signedByHand(B3.UNSECURED_DOCUMENT, { ...B3.PROOF_CONFIGURATION, created });
    const verdicts = await verifyOnBothSides(document);
    for (const [side, result] of Object.entries(verdicts)) {
      if (result.ok !== verified || (!verified && !CREATED_REFUSAL.test(result.reason))) {
        disagreements.push(`verify, ${side}: ${value} -> ${result.ok ? "verified" : `refused (${result.reason})`}`);
      }
    }
    if (!verified && verdicts.scripts.reason !== verdicts.worker.reason) {
      disagreements.push(`verify: ${value}: the two sides refuse for different reasons (scripts: ${verdicts.scripts.reason}; worker: ${verdicts.worker.reason})`);
    }
    // The scripts signer reads a missing created as the document's
    // validFrom, so only a value that is set reaches the check there.
    if (created === undefined || created === null) continue;
    const refusals = new Set();
    for (const [signer, sign] of Object.entries(SIGNERS)) {
      const outcome = await sign(B3.UNSECURED_DOCUMENT, created).catch((err) => err);
      const refused = outcome instanceof Error;
      if (refused === verified || (refused && !CREATED_REFUSAL.test(outcome.message))) {
        disagreements.push(`sign, ${signer}: ${value} -> ${refused ? `refused (${outcome.message})` : "signed"}`);
      }
      if (refused) refusals.add(outcome.message);
    }
    if (refusals.size > 1) disagreements.push(`sign: ${value}: the two signers refuse for different reasons (${[...refusals].join("; ")})`);
  }
  assert.deepEqual(disagreements, [], "both cryptosuite implementations must hold created to the dateTimeStamp rule, signing and verifying, and refuse with the same reason");
});

// ── the committed credentials and status lists ──────────────────────────────

test("every committed credential and status list carries its @context in the proof and verifies on both sides, and neither side accepts it stripped", async (t) => {
  if (!PROVISIONED) {
    t.skip("program keys are unprovisioned - nothing signed is committed");
    return;
  }
  const dir = new URL("../../registry/credentials/", import.meta.url);
  const read = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  const committed = [
    ...readdirSync(dir)
      .filter((name) => /^[0-9a-f]{32}\.json$/.test(name))
      .map((name) => ({ name, document: read(name), pinned: PINNED_ISSUER_KEYS })),
    ...readdirSync(new URL("status/", dir)).map((name) => ({ name: `status/${name}`, document: read(`status/${name}`), pinned: PINNED_STATUS_KEYS })),
  ];
  assert.ok(committed.length > 2, "the provisioned era commits credentials and both status lists");
  const failures = [];
  for (const { name, document, pinned } of committed) {
    const fragment = document.proof.verificationMethod.split("#")[1];
    const { publicKeyMultibase } = pinned.find((key) => key.id === fragment);
    const workerKey = ed25519KeyFromMultibase(publicKeyMultibase);
    const stripped = withoutProofContext(document);
    const outcome = {
      carriesContext: JSON.stringify(document.proof["@context"]) === JSON.stringify(document["@context"]),
      scripts: verifyCredential(document, publicKeyMultibase).ok,
      worker: (await verifyEddsaJcs2022(document, workerKey)).ok,
      strippedScripts: verifyCredential(stripped, publicKeyMultibase).ok,
      strippedWorker: (await verifyEddsaJcs2022(stripped, workerKey)).ok,
    };
    const expected = { carriesContext: true, scripts: true, worker: true, strippedScripts: false, strippedWorker: false };
    if (JSON.stringify(outcome) !== JSON.stringify(expected)) failures.push({ name, ...outcome });
  }
  assert.deepEqual(failures, []);
});
