#!/usr/bin/env node
/**
 * Flip one credential's status bit - revocation (terminal), suspension
 * (reversible), or unsuspend - and re-sign the touched status list. The
 * locked half of .github/workflows/revoke-credential.yml; the human act is
 * approving that protected workflow run, and the PR it opens (carrying the
 * stated reason) is the auditable record.
 *
 * Fail closed on: unprovisioned keys; an env status key whose public half is
 * not committed; an unknown credential id; a missing or proof-invalid status
 * list (bits are never trusted, let alone rewritten, off an unverified
 * list); revoking an already-revoked credential; unsuspending a bit that is
 * not set; and the full site build refusing the result.
 *
 * Terminal semantics: revocation also updates the linked registry entry to
 * status "revoked" (keeping attestationUrl - the credential and its set bit
 * ARE the public record; the site renders the dark revoked tier). Suspension
 * and unsuspend leave the entry at "verified": the build renders the
 * suspension bit as "under appeal" without a registry edit, so the two
 * channels cannot disagree.
 *
 * Usage: node scripts/revoke-credential.mjs --credential-id <urn-or-32hex>
 *   --purpose revocation|suspension|unsuspend --reason "..."
 *   [--summary PATH] [--pr-body PATH]
 * Env: K_STATUS_PRIVATE (only the status key ever touches a bit).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  ISSUER_DID,
  buildStatusListCredential,
  decodeStatusList,
  encodeStatusList,
  setStatusBit,
  signCredential,
  statusBitAt,
  verifyCredential,
  verifyStatusListAgainstCommittedKey,
} from "./lib/attest.mjs";
import { decodePrivateKeyMultibase, encodePublicKeyMultibase, publicRawFromSeed } from "./lib/keys.mjs";
import { validateRegistry } from "./validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const rel = (...parts) => join(repoRoot, ...parts);

const fail = (message) => {
  console.error(`revoke-credential: ${message}`);
  process.exit(1);
};

const { values: args } = parseArgs({
  options: {
    "credential-id": { type: "string" },
    purpose: { type: "string" },
    reason: { type: "string" },
    summary: { type: "string" },
    "pr-body": { type: "string" },
  },
});
for (const required of ["credential-id", "purpose", "reason"]) {
  if (args[required] === undefined || args[required] === "") fail(`--${required} is required`);
}
const action = args.purpose;
if (!["revocation", "suspension", "unsuspend"].includes(action)) fail('--purpose must be "revocation", "suspension", or "unsuspend"');
const id32 = args["credential-id"].replace(/^urn:kya:conf:/, "");
if (!/^[0-9a-f]{32}$/.test(id32)) fail(`--credential-id must be urn:kya:conf:<32 hex> or the bare 32 hex (got ${args["credential-id"]})`);
const credentialId = `urn:kya:conf:${id32}`;

// ── gates: valid registry, provisioned keys, committed status key match ─────
const { programKeys, allocations, entries, errors: preErrors } = validateRegistry();
if (preErrors.length > 0) fail(`the registry must validate before a status change:\n  - ${preErrors.join("\n  - ")}`);
if (!programKeys.provisioned) fail("program keys are unprovisioned - there is nothing to revoke");

const envKey = process.env.K_STATUS_PRIVATE;
if (typeof envKey !== "string" || envKey.length === 0) fail("K_STATUS_PRIVATE is not set (an environment secret of the conformance-issuance environment)");
let seed;
try {
  seed = decodePrivateKeyMultibase(envKey.trim());
} catch (err) {
  fail(`K_STATUS_PRIVATE: ${err.message}`);
}
const publicMultibase = encodePublicKeyMultibase(publicRawFromSeed(seed));
const statusKey = programKeys.keys.find((key) => key.purpose === "status" && key.publicKeyMultibase === publicMultibase);
if (statusKey === undefined) fail('K_STATUS_PRIVATE: its public half is not a committed "status" key - refusing to sign');

const allocation = allocations.allocations.find((candidate) => candidate.credentialId === credentialId);
if (allocation === undefined) fail(`no allocation for ${credentialId} - is it committed?`);
const index = allocation.index;

// ── flip the bit on a proof-verified list, then re-sign ─────────────────────
const listPurpose = action === "revocation" ? "revocation" : "suspension";
const listPath = rel("registry", "credentials", "status", `${listPurpose}-1.json`);
let existing;
try {
  existing = JSON.parse(readFileSync(listPath, "utf8"));
} catch (err) {
  fail(`registry/credentials/status/${listPurpose}-1.json: ${err.message}`);
}
{
  const { ok, reason } = verifyStatusListAgainstCommittedKey(existing, programKeys);
  if (!ok) fail(`current ${listPurpose} list proof does not verify (${reason}) - refusing to rewrite unverified bits`);
}
const bytes = decodeStatusList(existing.credentialSubject.encodedList);
const wasSet = statusBitAt(bytes, index);
if (action === "revocation" && wasSet) fail(`${credentialId} is already revoked (bit ${index} set)`);
if (action === "suspension" && wasSet) fail(`${credentialId} is already suspended (bit ${index} set)`);
if (action === "unsuspend" && !wasSet) fail(`${credentialId} is not suspended (bit ${index} clear) - nothing to unsuspend`);
setStatusBit(bytes, index, action !== "unsuspend");

const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const unsigned = buildStatusListCredential({ purpose: listPurpose, encodedList: encodeStatusList(bytes), validFrom: now });
const signedList = signCredential(unsigned, seed, `${ISSUER_DID}#${statusKey.id}`);
{
  const { ok, reason } = verifyCredential(signedList, statusKey.publicKeyMultibase);
  if (!ok) fail(`self-verification of the re-signed ${listPurpose} list failed (${reason}) - nothing written`);
}
writeFileSync(listPath, JSON.stringify(signedList, null, 2) + "\n");

// ── terminal action: the linked entry becomes "revoked" ─────────────────────
const entry = entries.find((candidate) => candidate.slug === allocation.slug);
let entryUpdated = false;
if (action === "revocation" && entry?.conformance?.status === "verified") {
  entry.conformance.status = "revoked";
  writeFileSync(rel("registry", "builders", `${entry.slug}.json`), JSON.stringify(entry, null, 2) + "\n");
  entryUpdated = true;
}

// The site build is the final gate: it re-verifies the flipped bit against
// the re-signed list, checks entry/credential agreement, and re-renders the
// badge tier. A refusal exits non-zero and the workflow opens no PR.
const build = spawnSync(process.execPath, [join(repoRoot, "site", "build-pages.mjs")], { stdio: "inherit" });
if (build.status !== 0) fail("the site build refused the status change - see errors above; nothing should be committed");

const summary = { credentialId, id8: id32.slice(0, 8), slug: allocation.slug, action, statusIndex: index, reason: args.reason, entryUpdated, at: now };
if (args.summary) writeFileSync(args.summary, JSON.stringify(summary, null, 2) + "\n");
if (args["pr-body"]) {
  const verb = { revocation: "Revoke", suspension: "Suspend", unsuspend: "Unsuspend" }[action];
  writeFileSync(
    args["pr-body"],
    [
      `## ${verb}: ${allocation.slug} (\`${credentialId}\`)`,
      "",
      `Executed under the \`conformance-issuance\` protected environment; this PR is the auditable record. Merging deploys the re-signed status list${entryUpdated ? " and the entry's terminal status" : ""}.`,
      "",
      `| field | value |`,
      `| --- | --- |`,
      `| action | ${action} (bit ${index} on ${listPurpose}-1) |`,
      `| entry | registry/builders/${allocation.slug}.json${entryUpdated ? " -> status: revoked" : " (unchanged)"} |`,
      `| reason | ${args.reason} |`,
      "",
      `Verify locally: \`node scripts/verify-credential.mjs --offline registry/credentials/${id32}.json\``,
    ].join("\n") + "\n",
  );
}
console.log(JSON.stringify(summary, null, 2));
