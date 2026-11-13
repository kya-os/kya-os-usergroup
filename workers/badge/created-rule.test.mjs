/**
 * proof.created, one rule on both full verifiers: the public verifier
 * (scripts/verify-credential.mjs, whose shape check and cryptosuite share
 * scripts/lib/datetime.mjs) and this worker (verify.mjs, its own parser)
 * both require it, and both hold it to the [XMLSCHEMA11-2] dateTimeStamp
 * that VC Data Integrity 1.0 section 2.1 requires, in UTC (Z) or with any
 * offset, on a credential and on a status list alike. Each world is a
 * credential and both status lists signed by the scripts side's signer
 * under throwaway keys (scripts/__tests__/fixtures/signed-documents.mjs).
 * A value that is not a dateTimeStamp is refused by both cryptosuites
 * (spec-conformance.test.mjs) and by the shape check
 * (scripts/__tests__/created.test.mjs). A proof without created verifies
 * under both cryptosuites, which check created only when it is set
 * (EdDSA Cryptosuites v1.0, section 3.3.5 step 3), so refusing it is the
 * program's policy: the shape check's on one side, worker.mjs's on the other.
 *
 *   node --test workers/badge/created-rule.test.mjs
 */
import test from "node:test";
import { ACCEPTED, DOCUMENT_NAMES, assertVerdicts, each, refusedFor, verdictsOnWorlds } from "./fixtures/full-verifiers.mjs";
import { BADGE, PROGRAM_KEYS, resigned, signedCredential, signedList, signedWorld } from "../../scripts/__tests__/fixtures/signed-documents.mjs";

const verdicts = (t, worlds) => verdictsOnWorlds(t, worlds, { ...BADGE, programKeys: PROGRAM_KEYS });

test("verify-credential.mjs and the worker both accept proof.created in every dateTimeStamp form, on a credential and on a status list", async (t) => {
  const forms = {
    "Z, as the program signs it": undefined,
    "fractional seconds": "2026-01-01T00:00:00.000Z",
    "a +00:00 offset": "2026-01-01T00:00:00+00:00",
    "a -05:00 offset": "2025-12-31T19:00:00-05:00",
    "a +14:00 offset": "2026-01-01T14:00:00+14:00",
  };
  const worlds = {};
  for (const [form, created] of Object.entries(forms)) {
    worlds[`a credential, created with ${form}`] = signedWorld({ credential: signedCredential({ created }) });
    worlds[`a revocation list, created with ${form}`] = signedWorld({ revocation: signedList("revocation", { created }) });
  }
  assertVerdicts(await verdicts(t, worlds), each(worlds, ACCEPTED));
});

test("verify-credential.mjs and the worker both refuse a credential or status list whose proof carries no created", async (t) => {
  const withoutCreated = (document) => resigned(document, (proof) => delete proof.created);
  const documents = { credential: signedCredential(), revocation: signedList("revocation") };
  const worlds = {};
  const expected = {};
  for (const [kind, document] of Object.entries(documents)) {
    const name = DOCUMENT_NAMES[kind];
    const label = `a ${name} whose proof carries no created`;
    worlds[label] = signedWorld({ [kind]: withoutCreated(document) });
    expected[label] = refusedFor(`${name}: proof: "created" is required`, `${name} proof carries no created`);
  }
  assertVerdicts(await verdicts(t, worlds), expected);
});
