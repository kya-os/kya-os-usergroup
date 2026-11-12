/**
 * The program's context policy, on both sides: a program credential or
 * status list carries exactly the program's @context, and so does its proof.
 *
 * An eddsa-jcs-2022 signature binds only the proof's @context, as a prefix
 * of the document's (VC Data Integrity EdDSA Cryptosuites v1.0, section
 * 3.3.2 step 4), so a context appended to a document after signing, or a
 * list turned into a bare string, still verifies; so does a proof signed
 * over a configuration with no @context, since step 4 runs only when the
 * proof carries one. VC Data Integrity 1.0 section 2.4.1 leaves context
 * validation to the verifier, after the proof verifies: the scripts side
 * holds the rule in scripts/lib/shape.mjs, the worker in worker.mjs, each
 * with its own copy of the program context (pinned equal in
 * parity.test.mjs). This file shows the public verifier
 * (scripts/verify-credential.mjs) and the worker reach the same verdict, a
 * refusal for the context rule's reason, on a committed credential and both
 * committed status lists with their @context changed (and both accept them
 * as committed), on a credential and each status list signed in-test over a
 * proof configuration with no @context, and on a credential and a status
 * list signed with the bare string in place of the program's list, in the
 * document and in the proof.
 *
 * The proof's purpose is the same kind of rule: neither cryptosuite reads
 * proofPurpose, so a document signed for another purpose verifies, and each
 * side refuses it on its own, for that reason (scripts/lib/shape.mjs,
 * worker.mjs).
 *
 *   node --test workers/badge/context-policy.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCEPTED, DOCUMENT_NAMES, assertVerdicts, refusedFor, verdictsOnWorlds } from "./fixtures/full-verifiers.mjs";
import { BADGE_ALLOWLIST } from "./generated-allowlist.mjs";
import { PROVISIONED } from "./generated-keys.mjs";
import { ed25519KeyFromMultibase, verifyEddsaJcs2022 } from "./verify.mjs";
import { verifyCredential } from "../../scripts/lib/attest.mjs";
import {
  BADGE,
  PROGRAM_KEYS,
  resigned,
  signedCredential,
  signedList,
  signedWorld,
  signerKey,
} from "../../scripts/__tests__/fixtures/signed-documents.mjs";

const credentialsDir = fileURLToPath(new URL("../../registry/credentials/", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const V2 = "https://www.w3.org/ns/credentials/v2";

/** Both verifiers refusing document `name` for its @context or its proof's: the worker by its one context rule, the public verifier's shape check saying `cli` of it. */
const refusedForContext = (name, cli = '"@context" must be exactly') => refusedFor(`${name}: ${cli}`, `${name} @context, and its proof's, must be exactly`);

test("verify-credential.mjs and the worker reach the same verdict on a committed credential and both status lists, as committed and with their @context appended to or turned into a bare string", async (t) => {
  if (!PROVISIONED) {
    t.skip("program keys are unprovisioned - nothing signed is committed");
    return;
  }
  const [slug, entry] = Object.entries(BADGE_ALLOWLIST).find(([, candidate]) => candidate.status === "verified") ?? [];
  if (slug === undefined) {
    t.skip("no allowlist entry sits at status verified");
    return;
  }
  const committed = {
    credential: readJson(join(credentialsDir, entry.credentialUrl.split("/").at(-1))),
    revocation: readJson(join(credentialsDir, "status", "revocation-1.json")),
    suspension: readJson(join(credentialsDir, "status", "suspension-1.json")),
  };
  const changes = { "appended to": [V2, "https://example.org/extra/v1"], "turned into a bare string": V2 };
  const changed = {};
  const expected = { "as committed": ACCEPTED };
  for (const [document, name] of Object.entries(DOCUMENT_NAMES)) {
    for (const [change, context] of Object.entries(changes)) {
      changed[`${document} @context ${change}`] = { ...committed, [document]: { ...committed[document], "@context": context } };
      expected[`${document} @context ${change}`] = refusedForContext(name);
    }
  }
  assertVerdicts(await verdictsOnWorlds(t, { "as committed": committed, ...changed }, { slug, entry }), expected);
});

/**
 * Both full verifiers on one world for each of `documents` (kind ->
 * document), each document first shown to verify under both cryptosuites,
 * so a refusal is the program's policy and not the signature; the world for
 * a kind, labelled "the <kind> <how>", must be refused as `refusal` says for
 * that document's name.
 */
async function assertRefusedOnSignedDocuments(t, documents, how, refusal) {
  const worlds = {};
  const expected = {};
  for (const [kind, document] of Object.entries(documents)) {
    assert.equal(verifyCredential(document, signerKey(document)).ok, true, `${kind}: the scripts side's cryptosuite verifies it`);
    assert.equal((await verifyEddsaJcs2022(document, ed25519KeyFromMultibase(signerKey(document)))).ok, true, `${kind}: the worker's cryptosuite verifies it`);
    worlds[`the ${kind} ${how}`] = signedWorld({ [kind]: document });
    expected[`the ${kind} ${how}`] = refusal(DOCUMENT_NAMES[kind]);
  }
  assertVerdicts(await verdictsOnWorlds(t, worlds, { ...BADGE, programKeys: PROGRAM_KEYS }), expected);
}

test("verify-credential.mjs and the worker both refuse a credential or status list signed over a proof configuration with no @context, though both cryptosuites verify it", async (t) => {
  const signedWithoutProofContext = (document) => resigned(document, (proof) => delete proof["@context"]);
  const documents = {
    credential: signedWithoutProofContext(signedCredential()),
    revocation: signedWithoutProofContext(signedList("revocation")),
    suspension: signedWithoutProofContext(signedList("suspension")),
  };
  for (const [kind, document] of Object.entries(documents)) assert.equal(document.proof["@context"], undefined, kind);
  await assertRefusedOnSignedDocuments(t, documents, "signed with no proof @context", (name) => refusedForContext(name, 'proof: "@context" is required'));
});

// A bare string is a list of one to the cryptosuite (section 3.3.2 step 4),
// so the proof's @context is a prefix of the document's and the signature
// verifies; the program's context is the list, so both sides refuse.
test("verify-credential.mjs and the worker both refuse a credential or status list whose @context, and its proof's, is the bare string the program's list holds, though both cryptosuites verify it", async (t) => {
  const signedWithBareContext = (document) =>
    resigned(document, (proof, unsecured) => {
      unsecured["@context"] = V2;
      proof["@context"] = V2;
    });
  const documents = {
    credential: signedWithBareContext(signedCredential()),
    revocation: signedWithBareContext(signedList("revocation")),
  };
  for (const [kind, document] of Object.entries(documents)) assert.deepEqual([document["@context"], document.proof["@context"]], [V2, V2], kind);
  await assertRefusedOnSignedDocuments(t, documents, "signed with a bare-string @context in the document and the proof", (name) => refusedForContext(name));
});

test("verify-credential.mjs and the worker both refuse a credential or status list whose proof purpose is not assertionMethod, though both cryptosuites verify it", async (t) => {
  const signedForAuthentication = (document) => resigned(document, (proof) => (proof.proofPurpose = "authentication"));
  const documents = {
    credential: signedForAuthentication(signedCredential()),
    revocation: signedForAuthentication(signedList("revocation")),
  };
  await assertRefusedOnSignedDocuments(t, documents, "signed for authentication", (name) =>
    refusedFor(`${name}: proof.proofPurpose must be "assertionMethod"`, `${name} proof purpose must be assertionMethod`),
  );
});
