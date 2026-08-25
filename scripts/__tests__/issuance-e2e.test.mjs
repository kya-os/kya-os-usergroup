/**
 * End-to-end dry run of the Phase A issuance machinery, in a THROWAWAY copy
 * of the repo under a temp dir - the real scripts, the real site build, real
 * signatures under keys minted for this run and discarded with it (never
 * committed, never trusted anywhere else):
 *
 *   ceremony  generate-program-keys.mjs provisions the temp registry
 *   issue     issue-credential.mjs signs a credential for the in-verification
 *             fixture entry, allocates index 0, signs both status lists,
 *             flips the entry to verified, and the build renders the green
 *             verified badge + did.json + served credential
 *   verify    verify-credential.mjs (offline) says VERIFIED, exit 0
 *   suspend   revoke-credential.mjs --purpose suspension -> badge "under
 *             appeal", verifier SUSPENDED exit 2; unsuspend restores
 *   revoke    --purpose revocation -> entry status revoked, dark badge,
 *             verifier REVOKED exit 3
 *   mutations tampered committed credential -> the build REFUSES naming it;
 *             sentinel key file over live credentials -> the build refuses
 *
 *   node --test scripts/__tests__/issuance-e2e.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const SLUG = "kya-os-mcp"; // the committed in-verification entry (L3 full, suite 1.0.0)
const GIT_COMMIT = "c0ffee0ddba11ad5c0ffee0ddba11ad5c0ffee0d";

const temp = mkdtempSync(join(tmpdir(), "kya-issuance-e2e-"));
const EXCLUDE = new Set([".git", "dist", "node_modules"]);
cpSync(repoRoot, temp, { recursive: true, filter: (source) => !EXCLUDE.has(basename(source)) });

const run = (args, env = {}) =>
  spawnSync(process.execPath, args, { cwd: temp, env: { ...process.env, ...env }, encoding: "utf8" });
const tempPath = (...parts) => join(temp, ...parts);
const read = (...parts) => readFileSync(tempPath(...parts), "utf8");

test("e2e: ceremony -> issue -> verify -> suspend -> unsuspend -> revoke -> mutations", async (t) => {
  t.after(() => rmSync(temp, { recursive: true, force: true }));

  // ── ceremony: throwaway keys into the temp registry only ──────────────────
  const ceremony = run([tempPath("scripts", "generate-program-keys.mjs")]);
  assert.equal(ceremony.status, 0, ceremony.stderr);
  const secrets = Object.fromEntries(
    [...ceremony.stdout.matchAll(/^(K_[A-Z_]+PRIVATE)=(z[1-9A-HJ-NP-Za-km-z]+)$/gm)].map((m) => [m[1], m[2]]),
  );
  assert.deepEqual(Object.keys(secrets).sort(), ["K_ISSUER_PRIVATE", "K_LOG_PRIVATE", "K_STATUS_PRIVATE"]);
  const keysFile = JSON.parse(read("registry", "keys", "program-keys.json"));
  assert.equal(keysFile.keys.length, 3, "three public keys committed");

  // Provisioned, zero credentials: the build emits did.json and nothing green.
  const provisionedBuild = run([tempPath("site", "build-pages.mjs")]);
  assert.equal(provisionedBuild.status, 0, provisionedBuild.stderr);
  assert.ok(existsSync(tempPath("dist", ".well-known", "did.json")), "provisioned build emits did.json");
  assert.ok(!read("dist", "badge", `${SLUG}.svg`).includes("verified"), "no credential yet, no verified badge");

  // The merge arms the worker: committing the ceremony publics makes the
  // next build regenerate the worker's pinned-key module with zero hand
  // edits - issuer and status publics pinned, the reserved log key never.
  const generatedKeys = read("workers", "badge", "generated-keys.mjs");
  assert.ok(generatedKeys.includes("export const PROVISIONED = true;"), "the ceremony build must arm the worker's generated keys");
  for (const key of keysFile.keys) {
    assert.equal(
      generatedKeys.includes(key.publicKeyMultibase),
      key.purpose !== "log",
      `generated-keys.mjs must pin the ${key.purpose} key ${key.purpose === "log" ? "never (reserved)" : "(committed public)"}`,
    );
  }

  // A rerun of the ceremony must refuse to overwrite provisioned keys.
  const rerun = run([tempPath("scripts", "generate-program-keys.mjs")]);
  assert.equal(rerun.status, 1);
  assert.match(rerun.stderr, /Refusing/);

  // ── issue ─────────────────────────────────────────────────────────────────
  const issueArgs = [
    tempPath("scripts", "issue-credential.mjs"),
    "--slug", SLUG,
    "--subject-id", "https://kya-os.org",
    "--impl-name", "@kya-os/mcp",
    "--impl-version", "1.14.0",
    "--git-commit", GIT_COMMIT,
    "--level", "L3",
    "--scope", "full",
    "--package-version", "1.14.0",
    "--verdict-url", "https://github.com/kya-os/kya-os-usergroup/issues/6",
    "--summary", tempPath("summary.json"),
    "--pr-body", tempPath("pr-body.md"),
  ];

  // Fail-closed first: a private key whose public half is NOT committed.
  const strangerCeremonyDir = mkdtempSync(join(tmpdir(), "kya-stranger-"));
  cpSync(temp, strangerCeremonyDir, { recursive: true, filter: (source) => !EXCLUDE.has(basename(source)) });
  writeFileSync(
    join(strangerCeremonyDir, "registry", "keys", "program-keys.json"),
    JSON.stringify({ version: 1, keys: [{ purpose: "issuer", status: "unprovisioned" }] }, null, 2) + "\n",
  );
  const strangerKeys = spawnSync(process.execPath, [join(strangerCeremonyDir, "scripts", "generate-program-keys.mjs")], { encoding: "utf8" });
  const strangerSecret = strangerKeys.stdout.match(/^K_ISSUER_PRIVATE=(z[1-9A-HJ-NP-Za-km-z]+)$/m)[1];
  rmSync(strangerCeremonyDir, { recursive: true, force: true });
  const wrongKey = run(issueArgs, { K_ISSUER_PRIVATE: strangerSecret, K_STATUS_PRIVATE: secrets.K_STATUS_PRIVATE });
  assert.equal(wrongKey.status, 1, "an uncommitted issuer key must be refused");
  assert.match(wrongKey.stderr, /not a committed "issuer" key/);

  // Mismatched claim inputs are refused (entry claims L3, input says L1).
  const mismatch = run(
    issueArgs.map((arg) => (arg === "L3" ? "L1" : arg)),
    { K_ISSUER_PRIVATE: secrets.K_ISSUER_PRIVATE, K_STATUS_PRIVATE: secrets.K_STATUS_PRIVATE },
  );
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /does not match the entry's claim/);

  // A credential about a DIFFERENT subject is refused (identity binding):
  // every other input matches the entry's claim, only the subject id lies.
  const foreignSubject = run(
    issueArgs.map((arg) => (arg === "https://kya-os.org" ? "https://attacker.example" : arg)),
    { K_ISSUER_PRIVATE: secrets.K_ISSUER_PRIVATE, K_STATUS_PRIVATE: secrets.K_STATUS_PRIVATE },
  );
  assert.equal(foreignSubject.status, 1, "a subject id the entry does not declare must be refused");
  assert.match(foreignSubject.stderr, /subject-id must be the entry's homepage or repo/);

  // The real issuance.
  const issue = run(issueArgs, { K_ISSUER_PRIVATE: secrets.K_ISSUER_PRIVATE, K_STATUS_PRIVATE: secrets.K_STATUS_PRIVATE });
  assert.equal(issue.status, 0, issue.stderr);
  const summary = JSON.parse(read("summary.json"));
  assert.equal(summary.slug, SLUG);
  assert.equal(summary.statusIndex, 0);
  assert.match(summary.credentialId, /^urn:kya:conf:[0-9a-f]{32}$/);
  const { id32 } = summary;

  const entry = JSON.parse(read("registry", "builders", `${SLUG}.json`));
  assert.equal(entry.conformance.status, "verified");
  assert.equal(entry.conformance.attestationUrl, `https://builders.kya-os.org/credentials/${id32}.json`);
  const allocations = JSON.parse(read("registry", "credentials", "allocations.json"));
  assert.equal(allocations.nextIndex, 1);
  assert.equal(allocations.allocations[0].slug, SLUG);

  // The build (already run by the script) rendered the proven state.
  const badge = read("dist", "badge", `${SLUG}.svg`);
  assert.ok(badge.includes("✓ L3 full verified"), `verified badge must render, got: ${badge.slice(0, 300)}`);
  assert.ok(badge.includes("#00c86e"), "verified badge uses the signal green tier");
  const shields = JSON.parse(read("dist", "badge", `${SLUG}.json`));
  assert.equal(shields.message, "✓ L3 full verified");
  assert.ok(existsSync(tempPath("dist", "credentials", `${id32}.json`)), "the credential is served");
  assert.ok(existsSync(tempPath("dist", "credentials", "status", "revocation-1.json")), "the revocation list is served");
  assert.ok(read("dist", "builders", "index.html").includes("&check; verified"), "the directory renders the green chip");
  assert.ok(read("workers", "badge", "generated-allowlist.mjs").includes(`credentials/${id32}.json`), "the badge allowlist carries the credential URL");

  // A duplicate issuance is refused by the deterministic id.
  const duplicate = run(issueArgs, { K_ISSUER_PRIVATE: secrets.K_ISSUER_PRIVATE, K_STATUS_PRIVATE: secrets.K_STATUS_PRIVATE });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /already committed|status is "verified"/);

  // ── the public verifier agrees ────────────────────────────────────────────
  const verify = (expectVerdict, expectExit) => {
    const result = run([tempPath("scripts", "verify-credential.mjs"), tempPath("registry", "credentials", `${id32}.json`), "--offline"]);
    assert.equal(result.status, expectExit, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.verdict, expectVerdict);
    return report;
  };
  const verified = verify("VERIFIED", 0);
  assert.deepEqual([verified.checks.schema.ok, verified.checks.proof.ok, verified.checks.status.ok], [true, true, true]);

  // ── suspend -> under appeal -> unsuspend ──────────────────────────────────
  const revokeArgs = (purpose) => [
    tempPath("scripts", "revoke-credential.mjs"),
    "--credential-id", id32,
    "--purpose", purpose,
    "--reason", `e2e dry run: ${purpose}`,
  ];
  const suspend = run(revokeArgs("suspension"), { K_STATUS_PRIVATE: secrets.K_STATUS_PRIVATE });
  assert.equal(suspend.status, 0, suspend.stderr);
  assert.ok(read("dist", "badge", `${SLUG}.svg`).includes("◌ under appeal"), "suspension renders the amber appeal badge");
  assert.ok(read("dist", "builders", "index.html").includes("under appeal"), "the directory renders the contested state");
  verify("SUSPENDED", 2);

  const unsuspend = run(revokeArgs("unsuspend"), { K_STATUS_PRIVATE: secrets.K_STATUS_PRIVATE });
  assert.equal(unsuspend.status, 0, unsuspend.stderr);
  assert.ok(read("dist", "badge", `${SLUG}.svg`).includes("✓ L3 full verified"), "unsuspend restores the verified badge");
  verify("VERIFIED", 0);

  // ── revoke: terminal ──────────────────────────────────────────────────────
  const revoke = run(revokeArgs("revocation"), { K_STATUS_PRIVATE: secrets.K_STATUS_PRIVATE });
  assert.equal(revoke.status, 0, revoke.stderr);
  assert.equal(JSON.parse(read("registry", "builders", `${SLUG}.json`)).conformance.status, "revoked");
  const revokedBadge = read("dist", "badge", `${SLUG}.svg`);
  assert.ok(revokedBadge.includes(">revoked</text>"), "revocation renders the dark badge");
  assert.ok(!revokedBadge.includes("verified"), "a revoked badge never says verified");
  verify("REVOKED", 3);

  // ── mutation proofs: the build refuses, naming the credential ─────────────
  const credentialPath = tempPath("registry", "credentials", `${id32}.json`);
  const pristine = readFileSync(credentialPath, "utf8");
  const tampered = JSON.parse(pristine);
  tampered.credentialSubject.level = "L1"; // demote-tamper without re-signing
  tampered.id = tampered.id; // id now disagrees with subject too
  writeFileSync(credentialPath, JSON.stringify(tampered, null, 2) + "\n");
  const tamperedBuild = run([tempPath("site", "build-pages.mjs")]);
  assert.equal(tamperedBuild.status, 1, "a tampered committed credential must refuse the build");
  assert.ok(
    (tamperedBuild.stderr + tamperedBuild.stdout).includes(id32),
    `the refusal must name the credential:\n${tamperedBuild.stderr}`,
  );
  writeFileSync(credentialPath, pristine);

  const proofTamper = JSON.parse(pristine);
  proofTamper.proof.proofValue = `z1${proofTamper.proof.proofValue.slice(2)}`;
  writeFileSync(credentialPath, JSON.stringify(proofTamper, null, 2) + "\n");
  const proofTamperBuild = run([tempPath("site", "build-pages.mjs")]);
  assert.equal(proofTamperBuild.status, 1, "a tampered proof must refuse the build");
  assert.ok((proofTamperBuild.stderr + proofTamperBuild.stdout).includes(id32));
  writeFileSync(credentialPath, pristine);

  // Sentinel keys over live credentials: everything fails closed.
  const keysPath = tempPath("registry", "keys", "program-keys.json");
  const provisionedKeys = readFileSync(keysPath, "utf8");
  writeFileSync(keysPath, JSON.stringify({ version: 1, keys: [{ purpose: "issuer", status: "unprovisioned" }] }, null, 2) + "\n");
  const sentinelBuild = run([tempPath("site", "build-pages.mjs")]);
  assert.equal(sentinelBuild.status, 1, "sentinel keys over live credentials must refuse the build");
  assert.match(sentinelBuild.stderr + sentinelBuild.stdout, /unprovisioned/);
  const sentinelVerify = run([tempPath("scripts", "verify-credential.mjs"), credentialPath, "--offline"]);
  assert.equal(sentinelVerify.status, 1, "the public verifier refuses on the sentinel");
  assert.equal(JSON.parse(sentinelVerify.stdout).verdict, "INVALID");
  writeFileSync(keysPath, provisionedKeys);

  // Restored: the build is green again (the temp tree ends consistent).
  const restored = run([tempPath("site", "build-pages.mjs")]);
  assert.equal(restored.status, 0, restored.stderr);
});
