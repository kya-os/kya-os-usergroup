/**
 * Tests that the program's own verifiers keep its two signing keys apart,
 * offline. The DID document lists K-issuer and K-status under
 * assertionMethod, because a status list is a credential too, so a verifier
 * outside the program accepts either key on an attestation. The program
 * does not:
 *
 *   - the key file ties every key id to its purpose, so the shape checks,
 *     which bind a proof's verificationMethod by id, bind it by purpose
 *   - the site build refuses an attestation signed with a status key, and a
 *     status list signed with an issuer key, so a stolen issuer key can
 *     never clear its own revocation bits
 *   - scripts/verify-credential.mjs, the verifier the program points
 *     outsiders to, refuses both as well
 *
 * Every re-signed document carries a fresh throwaway key, so the key
 * binding is the only thing that can refuse it before its signature is
 * checked, and each refusal is pinned to the message that names the key.
 *
 *   node --test scripts/__tests__/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { signCredential } from "../lib/attest.mjs";
import { readProgramKeys } from "../lib/keys.mjs";
import { checkCredentialShape } from "../lib/shape.mjs";
import { verifyCredentialArtifacts } from "../../site/lib/credentials.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const credentialsDir = join(repoRoot, "registry", "credentials");
const keysPath = join(repoRoot, "registry", "keys", "program-keys.json");
const programKeys = readProgramKeys(keysPath);
const ISSUER_KEY = "did:web:builders.kya-os.org#conformance-issuer-1";
const STATUS_KEY = "did:web:builders.kya-os.org#conformance-status-1";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
/** The shape check's refusal of a proof whose key is not of the `prefix` purpose. */
const mustName = (prefix) => new RegExp(`proof\\.verificationMethod must be a did:web:builders\\.kya-os\\.org#${prefix}-<n> key`);
const committedList = (purpose) => readJson(join(credentialsDir, "status", `${purpose}-1.json`));

/** The credential at the first allocated status index. */
function committedCredential() {
  const [first] = readJson(join(credentialsDir, "allocations.json")).allocations;
  return readJson(join(credentialsDir, `${first.credentialId.split(":").at(-1)}.json`));
}

/** `document`, signed again under `verificationMethod` with a fresh throwaway key. */
function resigned(document, verificationMethod) {
  const { privateKey } = generateKeyPairSync("ed25519");
  const seed = new Uint8Array(Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url"));
  const { proof: _proof, ...unsigned } = structuredClone(document);
  return signCredential(unsigned, seed, verificationMethod);
}

/** The status lists a verifier reads, as committed unless a test swaps one. */
const statusLists = (swapped = {}) => ({
  revocation: swapped.revocation ?? committedList("revocation"),
  suspension: swapped.suspension ?? committedList("suspension"),
});

test("the key file ties each key id to its purpose, so a status key cannot pass for an issuer key", () => {
  const dir = mkdtempSync(join(tmpdir(), "kya-key-separation-"));
  try {
    const raw = readJson(keysPath);
    const status = raw.keys.find((key) => key.purpose === "status");
    const path = join(dir, "program-keys.json");
    writeFileSync(path, JSON.stringify({ ...raw, keys: [...raw.keys, { ...status, id: "conformance-issuer-9" }] }));
    const disguised = readProgramKeys(path);
    assert.equal(disguised.provisioned, false);
    assert.ok(
      disguised.errors.some((error) => /id must match conformance-<purpose>-<n> \(got "conformance-issuer-9"\)/.test(error)),
      disguised.errors.join("; "),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the shape check refuses an attestation signed under a status key", () => {
  assert.deepEqual(checkCredentialShape(committedCredential(), "t"), []);
  const errors = checkCredentialShape(resigned(committedCredential(), STATUS_KEY), "t");
  assert.ok(errors.some((error) => mustName("conformance-issuer").test(error)), errors.join("; "));
});

/** What the site build says of one credential beside the given status lists. */
function buildVerdict(credential, lists = statusLists()) {
  const record = (purpose) => ({ rel: `registry/credentials/status/${purpose}-1.json`, list: lists[purpose] });
  return verifyCredentialArtifacts({
    programKeys,
    credentials: [{ id32: "0".repeat(32), rel: "registry/credentials/fixture.json", credential }],
    statusLists: { revocation: record("revocation"), suspension: record("suspension") },
    allocations: [],
    entries: [],
  });
}

test("the site build passes the committed credential and lists, as the control", () => {
  assert.deepEqual(buildVerdict(committedCredential()).errors, []);
});

test("the site build refuses an attestation signed with a status key", () => {
  const { verdicts, errors } = buildVerdict(resigned(committedCredential(), STATUS_KEY));
  assert.ok(
    errors.some((error) => /key "conformance-status-1" has purpose "status", not "issuer"/.test(error)),
    errors.join("; "),
  );
  assert.equal(verdicts.size, 0);
});

test("the site build refuses a status list signed with an issuer key", () => {
  const { errors } = buildVerdict(committedCredential(), statusLists({ revocation: resigned(committedList("revocation"), ISSUER_KEY) }));
  assert.ok(
    errors.some((error) => /revocation-1\.json: key "conformance-issuer-1" has purpose "issuer", not "status"/.test(error)),
    errors.join("; "),
  );
});

/** Runs scripts/verify-credential.mjs offline on `credential`, beside the given status lists. */
function verifyCredentialCli(credential, lists = statusLists()) {
  const dir = mkdtempSync(join(tmpdir(), "kya-key-separation-"));
  try {
    writeFileSync(join(dir, "credential.json"), JSON.stringify(credential));
    for (const [purpose, list] of Object.entries(lists)) writeFileSync(join(dir, `${purpose}-1.json`), JSON.stringify(list));
    const script = join(repoRoot, "scripts", "verify-credential.mjs");
    const result = spawnSync(process.execPath, [script, join(dir, "credential.json"), "--offline", "--status-dir", dir], { encoding: "utf8" });
    return { exit: result.status, report: JSON.parse(result.stdout) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("verify-credential.mjs passes the committed credential and lists, as the control", () => {
  const { checks } = verifyCredentialCli(committedCredential()).report;
  assert.ok(checks.schema.ok && checks.proof.ok && checks.status.ok, JSON.stringify(checks));
});

test("verify-credential.mjs refuses an attestation signed with a status key", () => {
  const { exit, report } = verifyCredentialCli(resigned(committedCredential(), STATUS_KEY));
  assert.equal(report.verdict, "INVALID");
  assert.equal(exit, 1);
  assert.ok(report.checks.schema.errors.some((error) => mustName("conformance-issuer").test(error)), JSON.stringify(report.checks));
});

test("verify-credential.mjs refuses a status list signed with an issuer key", () => {
  const lists = statusLists({ revocation: resigned(committedList("revocation"), ISSUER_KEY) });
  const { exit, report } = verifyCredentialCli(committedCredential(), lists);
  assert.equal(report.verdict, "INVALID");
  assert.equal(exit, 1);
  assert.equal(report.checks.proof.ok, true);
  assert.match(report.checks.status.reason, mustName("conformance-status"));
});
