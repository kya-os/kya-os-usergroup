/**
 * The public verifier's verdict (scripts/lib/verdict.mjs), the function
 * scripts/verify-credential.mjs calls with its loaders, the program key file
 * and this machine's clock: each refusal at the step that makes it, with its
 * reason, and VERIFIED, SUSPENDED and REVOKED from the status bits, on
 * documents signed in-test under throwaway keys, at a time the tests give
 * it; and the command line handing it its reader's error, and refusing an
 * argument it would otherwise pass over.
 *
 *   node --test scripts/__tests__/verdict.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decodeStatusList, encodeStatusList, setStatusBit, verifyCredential } from "../lib/attest.mjs";
import { credentialVerdict } from "../lib/verdict.mjs";
import { PROGRAM_KEYS, VALID_FROM, resigned, signedCredential, signedList, signedWorld, signerKey, verdictOnWorld } from "./fixtures/signed-documents.mjs";

const NOW = Date.parse(VALID_FROM);
const CLI = fileURLToPath(new URL("../verify-credential.mjs", import.meta.url));
const INDEX = Number(signedCredential().credentialStatus[0].statusListIndex);

/** The verdict on `changes` to the signed world (signedWorld), at NOW unless `now` is given. */
const verdictOn = (changes, { now = NOW, programKeys } = {}) => verdictOnWorld(signedWorld(changes), { now, programKeys });

/** One purpose's status list, signed, with the bit at `index` set. */
function listWithBit(purpose, index) {
  return resigned(signedList(purpose), (configuration, unsecured) => {
    const bits = decodeStatusList(unsecured.credentialSubject.encodedList);
    setStatusBit(bits, index, true);
    unsecured.credentialSubject.encodedList = encodeStatusList(bits);
  });
}

test("VERIFIED when every check passes: the credential, the key its proof verified under, and both bits clear", async () => {
  const world = signedWorld();
  const answer = await verdictOnWorld(world, { now: NOW });
  assert.deepEqual(answer, {
    verdict: "VERIFIED",
    checks: { schema: { ok: true }, proof: { ok: true, verificationMethod: world.credential.proof.verificationMethod }, status: { ok: true, revoked: false, suspended: false } },
    credential: world.credential,
  });
});

test("REVOKED or SUSPENDED from the bit at the credential's own index, REVOKED when both are set", async () => {
  const verdicts = {
    revoked: await verdictOn({ revocation: listWithBit("revocation", INDEX) }),
    suspended: await verdictOn({ suspension: listWithBit("suspension", INDEX) }),
    both: await verdictOn({ revocation: listWithBit("revocation", INDEX), suspension: listWithBit("suspension", INDEX) }),
    "the next bit": await verdictOn({ revocation: listWithBit("revocation", INDEX + 1), suspension: listWithBit("suspension", INDEX + 1) }),
  };
  assert.deepEqual(
    Object.fromEntries(Object.entries(verdicts).map(([label, { verdict, checks }]) => [label, [verdict, checks.status.revoked, checks.status.suspended]])),
    { revoked: ["REVOKED", true, false], suspended: ["SUSPENDED", false, true], both: ["REVOKED", true, true], "the next bit": ["VERIFIED", false, false] },
  );
});

test("holds validFrom to the time it is given, not to this machine's clock", async () => {
  const at = async (now) => (await verdictOn({}, { now })).verdict;
  assert.deepEqual([await at(NOW - 299_999), await at(NOW - 300_000)], ["VERIFIED", "INVALID"]);
});

test("INVALID with the reader's own error, and no credential, when the credential cannot be read", async () => {
  const answer = await credentialVerdict({
    loadCredential: async () => {
      throw new Error("credential fetch failed: 404 https://example.invalid/credential.json");
    },
    programKeys: { provisioned: true, keys: PROGRAM_KEYS, errors: [] },
    loadStatusList: async () => assert.fail("no status list is read for a credential that cannot be read"),
    now: NOW,
  });
  assert.deepEqual(answer, {
    verdict: "INVALID",
    checks: { schema: { ok: false, errors: ["credential fetch failed: 404 https://example.invalid/credential.json"] }, proof: { ok: false }, status: { ok: false } },
    credential: null,
  });
});

test("INVALID at the key step on the committed sentinel, and on an unusable key file, naming which", async () => {
  const sentinel = await verdictOn({}, { programKeys: { provisioned: false, keys: [], errors: [] } });
  const unusable = await verdictOn({}, { programKeys: { provisioned: false, keys: [], errors: ["first problem", "second problem"] } });
  assert.deepEqual(
    [sentinel.verdict, sentinel.checks.schema.ok, sentinel.checks.proof.reason, unusable.verdict, unusable.checks.proof.reason],
    ["INVALID", false, "program keys are unprovisioned (the committed sentinel) - nothing can verify yet", "INVALID", "program key file is unusable: first problem; second problem"],
  );
});

test("INVALID at the schema step for a credential without a proof, saying so", async () => {
  const unsigned = signedCredential();
  delete unsigned.proof;
  const answer = await verdictOn({ credential: unsigned });
  assert.deepEqual([answer.verdict, answer.checks.schema.errors, answer.checks.proof], ["INVALID", ["credential: proof is missing"], { ok: false }]);
});

test("INVALID at the proof step when the credential's signature does not verify, with the cryptosuite's reason", async () => {
  const tampered = signedCredential();
  tampered.credentialSubject.implementation.version = "9.9.9";
  const { reason } = verifyCredential(tampered, signerKey(tampered));
  assert.ok(reason, "the cryptosuite names why it refuses");
  const answer = await verdictOn({ credential: tampered });
  assert.deepEqual([answer.verdict, answer.checks.schema.ok, answer.checks.proof, answer.checks.status], ["INVALID", true, { ok: false, reason }, { ok: false }]);
});

test("INVALID at the proof step when the key file lists the key the proof names under another purpose", async () => {
  const misfiled = PROGRAM_KEYS.map((key) => ({ ...key, purpose: "status" }));
  const answer = await verdictOn({}, { programKeys: { provisioned: true, keys: misfiled, errors: [] } });
  assert.deepEqual(
    [answer.verdict, answer.checks.proof.reason],
    ["INVALID", 'credential: proof.verificationMethod does not name a committed "issuer" key (got "conformance-issuer-1")'],
  );
});

test("INVALID at the status step when a status list's signature does not verify, naming the list and the cryptosuite's reason", async () => {
  const tampered = signedList("suspension");
  tampered.credentialSubject.encodedList = tampered.credentialSubject.encodedList.replace(/.$/, (last) => (last === "A" ? "B" : "A"));
  const { reason } = verifyCredential(tampered, signerKey(tampered));
  const answer = await verdictOn({ suspension: tampered });
  assert.deepEqual(
    [answer.verdict, answer.checks.proof.ok, answer.checks.status],
    ["INVALID", true, { ok: false, reason: `suspension list proof did not verify (${reason})` }],
  );
});

test("the command line hands the verdict its reader's error, naming the credential", () => {
  const run = spawnSync(process.execPath, [CLI, "http://example.invalid/credential.json", "--offline"], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.deepEqual(JSON.parse(run.stdout).checks.schema.errors, ["credential URL must be https (got http://example.invalid/credential.json)"]);
});

// --offline takes no value, so a folder typed after it is an argument of its
// own; read as the credential or passed over, it would check something other
// than what the reader asked for.
test("the command line refuses any argument besides the one credential, a folder after --offline among them, with its usage line and no verdict", () => {
  const credentials = fileURLToPath(new URL("../../registry/credentials/", import.meta.url));
  const credential = `${credentials}${readdirSync(credentials).find((name) => /^[0-9a-f]{32}\.json$/.test(name))}`;
  for (const args of [[credential, "--offline", "/nonexistent-dir"], ["--offline", "/nonexistent-dir", credential]]) {
    const run = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
    assert.deepEqual([run.status, run.stdout], [1, ""], args.join(" "));
    assert.match(run.stderr, /^usage: node scripts\/verify-credential\.mjs <credential-url-or-path \| -> \[--keys <path>\] \[--offline \[--status-dir <dir>\]\]\n$/, args.join(" "));
  }
});
