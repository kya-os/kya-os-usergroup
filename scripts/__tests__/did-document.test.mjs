/**
 * Tests for the did:web:builders.kya-os.org DID document, offline:
 *
 *   - every proof the program publishes, on an attestation credential or a
 *     status list, names a key the document lists under the verification
 *     relationship the proof's proofPurpose names. W3C Controlled
 *     Identifiers 1.0, section 3.3 (Retrieve Verification Method), has a
 *     verifier raise INVALID_RELATIONSHIP_FOR_VERIFICATION_METHOD otherwise,
 *     so a verifier that follows it refuses any proof this would miss
 *   - the reserved log key stays out of the document
 *
 *   node --test scripts/__tests__/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readProgramKeys } from "../lib/keys.mjs";
import { renderDidJson } from "../../site/lib/credentials.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const credentialsDir = join(repoRoot, "registry", "credentials");
const programKeys = readProgramKeys(join(repoRoot, "registry", "keys", "program-keys.json"));
const did = JSON.parse(renderDidJson(programKeys));

/** Every signed document the program publishes: the attestation credentials and the status lists. */
const signedDocuments = () =>
  [credentialsDir, join(credentialsDir, "status")].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({ name, document: JSON.parse(readFileSync(join(dir, name), "utf8")) }))
      .filter(({ document }) => document.proof !== undefined),
  );

test("the program publishes credentials and status lists to check", () => {
  const names = signedDocuments().map(({ name }) => name);
  assert.ok(names.includes("revocation-1.json") && names.includes("suspension-1.json"), names.join(", "));
  assert.ok(names.length > 2, names.join(", "));
});

test("every published proof's key is listed under the relationship its proofPurpose names", () => {
  for (const { name, document } of signedDocuments()) {
    const { verificationMethod, proofPurpose } = document.proof;
    assert.ok(
      Array.isArray(did[proofPurpose]) && did[proofPurpose].includes(verificationMethod),
      `${name}: ${verificationMethod} is not listed under ${proofPurpose} in did.json`,
    );
  }
});

test("lists the issuer and status keys under assertionMethod, and never the reserved log key", () => {
  const listed = (purpose) =>
    programKeys.keys.filter((key) => key.purpose === purpose).map((key) => `${did.id}#${key.id}`);
  assert.deepEqual([...did.assertionMethod].sort(), [...listed("issuer"), ...listed("status")].sort());
  for (const id of listed("log")) {
    assert.ok(!did.assertionMethod.includes(id) && !did.verificationMethod.some((method) => method.id === id), id);
  }
});
