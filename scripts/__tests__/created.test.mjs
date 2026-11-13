/**
 * proof.created on the scripts side: one rule from one implementation
 * (scripts/lib/datetime.mjs), the [XMLSCHEMA11-2] dateTimeStamp that VC
 * Data Integrity 1.0 section 2.1 requires, in UTC (Z) or with any offset.
 * The shape check refuses exactly the values the cryptosuite refuses to
 * sign or verify, on a credential and on a status list, so a proof the
 * cryptosuite and the badge worker accept is never INVALID on shape alone.
 * It reports a proof without created once, as missing.
 * Given no created, the signer writes the document's validFrom, so a signed
 * document is a pure function of its inputs.
 * The published schema's created pattern is the rule's lexical grammar; the
 * day-of-month constraint XMLSCHEMA11-2 section 3.3.7.2 attaches to it is
 * the verifiers' to check, not the pattern's.
 * Both full verifiers on one world: workers/badge/created-rule.test.mjs.
 *
 *   node --test scripts/__tests__/created.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signingInput } from "../lib/attest.mjs";
import { DATE_TIME_STAMP_RE, isDateTimeStamp } from "../lib/datetime.mjs";
import { checkCredentialShape, checkStatusListShape } from "../lib/shape.mjs";
import { VALID_FROM, signedCredential, signedList } from "./fixtures/signed-documents.mjs";

const SCHEMA = new URL("../../registry/credentials/schema/attestation-v1.json", import.meta.url);
const credential = signedCredential();
const list = signedList("revocation");
const SHAPES = [
  ["credential", credential, (document) => checkCredentialShape(document, "t")],
  ["status list", list, (document) => checkStatusListShape(document, "revocation", "t")],
];

const DATE_TIME_STAMPS = [
  "2026-01-01T00:00:00Z",
  "2026-01-01T00:00:00.000Z",
  "2026-01-01T00:00:00+00:00",
  "2025-12-31T19:00:00-05:00",
  "2026-01-01T14:00:00+14:00",
  "2028-02-29T00:00:00Z",
];
const NOT_DATE_TIME_STAMPS = [
  "2026-01-01T00:00:00", // no timezone: section 2.1 lets a processor read it as UTC; this side does not
  "2026-01-01T00:00:00z",
  "2026-01-01 00:00:00Z",
  "2026-02-29T00:00:00Z", // 2026 is not a leap year
  "2026-01-01T00:00:00+14:01",
  "",
  20260101,
];
const SHAPE_ERROR = "proof.created must be";

test("the shape check holds proof.created to the cryptosuite's rule, on a credential and on a status list", () => {
  const { proof: signedProof, ...unsecured } = credential;
  const disagreements = [];
  for (const created of [...DATE_TIME_STAMPS, ...NOT_DATE_TIME_STAMPS]) {
    const cryptosuiteAccepts = (() => {
      try {
        signingInput(unsecured, { ...signedProof, created });
        return true;
      } catch {
        return false;
      }
    })();
    const expected = DATE_TIME_STAMPS.includes(created);
    if (cryptosuiteAccepts !== expected) disagreements.push(`cryptosuite, created ${JSON.stringify(created)}: ${cryptosuiteAccepts ? "accepted" : "refused"}`);
    for (const [kind, signed, check] of SHAPES) {
      const errors = check({ ...signed, proof: { ...signed.proof, created } });
      const shapeAccepts = !errors.some((error) => error.includes(SHAPE_ERROR));
      if (shapeAccepts !== expected) disagreements.push(`${kind} shape, created ${JSON.stringify(created)}: ${shapeAccepts ? "accepted" : errors.join("; ")}`);
    }
  }
  assert.deepEqual(disagreements, [], "the shape check and the cryptosuite must accept exactly the dateTimeStamps");
});

test("the shape check reports a proof without created once, as missing, on a credential and on a status list", () => {
  for (const [kind, signed, check] of SHAPES) {
    const withoutCreated = structuredClone(signed);
    delete withoutCreated.proof.created;
    assert.deepEqual(check(withoutCreated), ['t: proof: "created" is required'], kind);
  }
});

test("the signer, given no created, writes the document's validFrom, so signing the same document twice gives the same bytes", () => {
  for (const sign of [signedCredential, () => signedList("revocation")]) {
    const first = sign();
    assert.equal(first.proof.created, VALID_FROM);
    assert.equal(JSON.stringify(sign()), JSON.stringify(first));
  }
});

test("the published schema's proof.created pattern is the dateTimeStamp lexical grammar the shape check and the cryptosuite apply, and leaves the day-of-month constraint to them", () => {
  const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
  const { pattern } = schema.properties.proof.properties.created;
  assert.equal(pattern, DATE_TIME_STAMP_RE.source);
  const february30 = "2026-02-30T00:00:00Z";
  assert.match(february30, new RegExp(pattern), "the grammar admits any day from 01 to 31");
  assert.equal(isDateTimeStamp(february30), false, "the rule refuses a day its month does not have");
});
