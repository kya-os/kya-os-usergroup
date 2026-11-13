/**
 * The @context every program proof carries (VC Data Integrity EdDSA
 * Cryptosuites v1.0, section 3.3.1 step 2), on the scripts side: the signer
 * stores its own copy of it; the shape check and the published schema
 * require it, equal to the document's own @context by JCS content, for
 * credentials and status lists alike; the public verifier passes every
 * committed credential and refuses the form without it; and a @context with
 * no canonical form ([1e999], which parses to Infinity) is a named error on
 * every path - the shape check, the public verifier, and the committed-file
 * validation - never a crash. The cryptosuite itself - the Appendix B.3
 * vector and the section 3.3.2 cases - is pinned on both implementations in
 * workers/badge/spec-conformance.test.mjs.
 *
 *   node --test scripts/__tests__/proof-context.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCredential } from "../lib/attest.mjs";
import { checkCredentialShape, checkStatusListShape } from "../lib/shape.mjs";
import { validateCredentials } from "../validate-credentials.mjs";
import { signedCredential, signedList, signerKey, withoutProofContext } from "./fixtures/signed-documents.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const credentialsDir = join(repoRoot, "registry", "credentials");
const committedCredentials = readdirSync(credentialsDir).filter((name) => /^[0-9a-f]{32}\.json$/.test(name));

const credential = signedCredential();
const list = signedList("revocation");

function withProof(document, change) {
  const copy = structuredClone(document);
  change(copy.proof);
  return copy;
}

/** The JSON text of `document` with its own or its proof's @context set to
 * [1e999], which JSON.parse reads as [Infinity]: a value with no canonical
 * form. */
function withInfiniteContext(document, where) {
  const copy = structuredClone(document);
  (where === "proof" ? copy.proof : copy)["@context"] = "__INFINITE__";
  return JSON.stringify(copy, null, 2).replace('"__INFINITE__"', "[1e999]");
}

/** scripts/verify-credential.mjs --offline on `args`: its exit code and verdict JSON. */
function verifyOffline(...args) {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "verify-credential.mjs"), ...args, "--offline"], { encoding: "utf8" });
  return { exit: result.status, ...JSON.parse(result.stdout) };
}

const PROOF_CONTEXT_ERROR = 'proof["@context"] must equal the document\'s "@context"';

test("signer: the proof keeps its own copy of the @context it was signed over, so extending the document's afterwards still verifies (section 3.3.2)", () => {
  for (const [kind, signed] of [
    ["credential", signedCredential()],
    ["status list", signedList("suspension")],
  ]) {
    signed["@context"].push("https://www.w3.org/ns/credentials/examples/v2");
    assert.deepEqual(signed.proof["@context"], ["https://www.w3.org/ns/credentials/v2"], kind);
    assert.equal(verifyCredential(signed, signerKey(signed)).ok, true, kind);
  }
});

test("shape: a credential's and a status list's proof must carry exactly the document's @context", () => {
  const shapes = [
    ["credential", credential, (document) => checkCredentialShape(document, "t")],
    ["status list", list, (document) => checkStatusListShape(document, "revocation", "t")],
  ];
  for (const [kind, signed, check] of shapes) {
    assert.deepEqual(check(signed), [], `the signer's own ${kind} passes`);
    const missing = check(withoutProofContext(signed));
    assert.deepEqual(missing, ['t: proof: "@context" is required'], `${kind} without proof @context: reported once, as missing`);
    for (const other of [["https://www.w3.org/ns/credentials/v2", "https://www.w3.org/ns/credentials/examples/v2"], "https://www.w3.org/ns/credentials/v2", []]) {
      const errors = check(withProof(signed, (proof) => (proof["@context"] = other)));
      assert.ok(errors.some((error) => error.includes(PROOF_CONTEXT_ERROR)), `${kind} with proof @context ${JSON.stringify(other)}:\n  ${errors.join("\n  ")}`);
    }
    const drifted = withProof(signed, (proof) => (proof["@context"] = [...signed["@context"], "https://www.w3.org/ns/credentials/examples/v2"]));
    drifted["@context"] = structuredClone(drifted.proof["@context"]);
    const errors = check(drifted);
    assert.ok(errors.some((error) => error.includes('"@context" must be exactly')), `${kind}: ${errors.join("; ")}`);
    assert.ok(
      !errors.some((error) => error.includes(PROOF_CONTEXT_ERROR)),
      `${kind}: the proof is held to the document's own @context, so a drifted document fails at the document alone: ${errors.join("; ")}`,
    );
    const contextless = structuredClone(signed);
    delete contextless["@context"];
    const bare = check(contextless);
    assert.ok(bare.some((error) => error.includes(PROOF_CONTEXT_ERROR)), `${kind} without a document @context: ${bare.join("; ")}`);
  }
});

test("shape: the proof's @context is held to the document's by JCS content, so the same embedded context object with its keys in another order matches", () => {
  const embedded = (keys) => ["https://www.w3.org/ns/credentials/v2", Object.fromEntries(keys.map((key) => [key, `https://schema.org/${key}`]))];
  const document = { ...structuredClone(credential), "@context": embedded(["alumniOf", "name"]) };
  document.proof["@context"] = embedded(["name", "alumniOf"]);
  const errors = checkCredentialShape(document, "t");
  assert.ok(errors.some((error) => error.includes('"@context" must be exactly')), "the document's own @context is not the program's");
  assert.ok(!errors.some((error) => error.includes(PROOF_CONTEXT_ERROR)), errors.join("; "));
});

test("shape: a proof or document @context with no canonical form ([1e999]) is a named error, not a crash", () => {
  const shapes = [
    ["credential", credential, (document) => checkCredentialShape(document, "t")],
    ["status list", list, (document) => checkStatusListShape(document, "revocation", "t")],
  ];
  for (const [kind, signed, check] of shapes) {
    for (const where of ["proof", "document"]) {
      const errors = check(JSON.parse(withInfiniteContext(signed, where)));
      assert.ok(errors.some((error) => error.includes(PROOF_CONTEXT_ERROR)), `${kind}, ${where} @context [1e999]: ${errors.join("; ")}`);
    }
  }
});

test("schema: the published proof requires @context, pinned to the document's, and lists exactly what the signer emits and the shape check requires", () => {
  const schema = JSON.parse(readFileSync(join(credentialsDir, "schema", "attestation-v1.json"), "utf8"));
  const proof = schema.properties.proof;
  assert.ok(proof.required.includes("@context"), "the schema must require proof @context");
  assert.deepEqual(proof.properties["@context"], { ...proof.properties["@context"], const: schema.properties["@context"].const });
  assert.equal(proof.additionalProperties, false);
  assert.deepEqual([...proof.required].sort(), Object.keys(proof.properties).sort(), "every proof property is required");
  assert.deepEqual(Object.keys(credential.proof).sort(), [...proof.required].sort(), "the signer emits exactly the schema's proof keys");
  for (const key of proof.required) {
    const errors = checkCredentialShape(withProof(credential, (p) => delete p[key]), "t");
    assert.ok(errors.some((error) => error.includes(`proof: "${key}" is required`)), `the shape check must require proof.${key}`);
  }
});

test("verify-credential.mjs --offline passes every committed credential, and answers INVALID for the form whose proofs lack @context", (t) => {
  assert.ok(committedCredentials.length > 0, "the provisioned era commits credentials");
  for (const name of committedCredentials) {
    const { verdict, checks } = verifyOffline(join(credentialsDir, name));
    assert.deepEqual([checks.schema.ok, checks.proof.ok, checks.status.ok], [true, true, true], `${name}: ${JSON.stringify(checks)}`);
    assert.notEqual(verdict, "INVALID", name);
  }

  // The same bytes with every proof @context stripped: the pre-fix form.
  const temp = mkdtempSync(join(tmpdir(), "kya-proof-context-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const strip = (from, to) => writeFileSync(to, JSON.stringify(withoutProofContext(JSON.parse(readFileSync(from, "utf8"))), null, 2) + "\n");
  for (const name of committedCredentials) {
    strip(join(credentialsDir, name), join(temp, name));
    const { verdict, exit, checks } = verifyOffline(join(temp, name));
    assert.deepEqual([verdict, exit], ["INVALID", 1], `${name} without proof @context: ${JSON.stringify(checks)}`);
    assert.ok(checks.schema.errors.some((error) => error.includes('proof: "@context" is required')), JSON.stringify(checks.schema));
  }
  mkdirSync(join(temp, "status"));
  for (const name of readdirSync(join(credentialsDir, "status"))) strip(join(credentialsDir, "status", name), join(temp, "status", name));
  const { verdict, checks } = verifyOffline(join(credentialsDir, committedCredentials[0]), "--status-dir", join(temp, "status"));
  assert.equal(verdict, "INVALID", "status lists without proof @context must not be read");
  assert.deepEqual([checks.proof.ok, checks.status.ok], [true, false]);
  assert.ok(checks.status.reason.includes('proof: "@context" is required'), checks.status.reason);
});

test("verify-credential.mjs answers INVALID, naming the error, for a credential or status list whose @context is [1e999]", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "kya-proof-context-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const name = committedCredentials[0];
  const committed = JSON.parse(readFileSync(join(credentialsDir, name), "utf8"));
  for (const where of ["proof", "document"]) {
    const file = join(temp, `${where}-${name}`);
    writeFileSync(file, withInfiniteContext(committed, where));
    const { verdict, exit, checks } = verifyOffline(file);
    assert.deepEqual([verdict, exit], ["INVALID", 1], `${where} @context [1e999]`);
    assert.ok(checks.schema.errors.some((error) => error.includes(PROOF_CONTEXT_ERROR)), JSON.stringify(checks.schema));
  }
  const statusDir = join(temp, "status");
  mkdirSync(statusDir);
  for (const purpose of ["revocation", "suspension"]) {
    const listText = readFileSync(join(credentialsDir, "status", `${purpose}-1.json`), "utf8");
    writeFileSync(join(statusDir, `${purpose}-1.json`), purpose === "revocation" ? withInfiniteContext(JSON.parse(listText), "proof") : listText);
  }
  const { verdict, checks } = verifyOffline(join(credentialsDir, name), "--status-dir", statusDir);
  assert.equal(verdict, "INVALID");
  assert.ok(String(checks.status.reason).includes(PROOF_CONTEXT_ERROR), checks.status.reason);
});

test("validate-credentials.mjs reports a committed credential whose proof @context is [1e999] as a named error, not a crash", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kya-proof-context-root-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["keys", "credentials"]) cpSync(join(repoRoot, "registry", dir), join(root, "registry", dir), { recursive: true });
  const name = committedCredentials[0];
  writeFileSync(join(root, "registry", "credentials", name), withInfiniteContext(JSON.parse(readFileSync(join(credentialsDir, name), "utf8")), "proof"));
  const { errors } = validateCredentials([], root);
  assert.ok(errors.some((error) => error.startsWith(`registry/credentials/${name}: `) && error.includes(PROOF_CONTEXT_ERROR)), errors.join("\n"));
});
