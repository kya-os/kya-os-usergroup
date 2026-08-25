#!/usr/bin/env node
/**
 * The anyone-can-check verifier for KYA-OS conformance attestation
 * credentials. Zero dependencies; Node 20+.
 *
 *   node scripts/verify-credential.mjs https://builders.kya-os.org/credentials/<id32>.json
 *   node scripts/verify-credential.mjs registry/credentials/<id32>.json
 *   curl -s https://builders.kya-os.org/credentials/<id32>.json | node scripts/verify-credential.mjs -
 *
 * Checks, all fail-closed:
 *   schema  the credential matches the published shape exactly - including
 *           NO validUntil (a validUntil is a schema violation by design, so
 *           there is no "expired" state to invent) and a deterministic id
 *           that recomputes from the subject fields
 *   proof   the eddsa-jcs-2022 DataIntegrityProof verifies against the
 *           committed program ISSUER key its verificationMethod names
 *   status  both signed status lists fetch (or load with --offline), their
 *           proofs verify against the committed STATUS keys - a separate key
 *           set, so a stolen issuer key cannot clear its own bits - and the
 *           credential's bits are read
 *
 * TRUST ROOT: the public keys committed at registry/keys/program-keys.json
 * in the clone you run this from (override with --keys <path>). You are
 * trusting git history and the repo's review gates, not this site.
 *
 * Output: one verdict JSON on stdout -
 *   { verdict: VERIFIED|SUSPENDED|REVOKED|INVALID, checks: {schema, proof,
 *     status}, credential: <summary> }
 * Exit codes: 0 VERIFIED, 1 INVALID, 2 SUSPENDED, 3 REVOKED.
 *
 * Flags:
 *   --keys <path>     program key file (default: this repo's committed file)
 *   --offline [dir]   read status lists from local files by URL basename
 *                     (default dir: registry/credentials/status)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ISSUER_DID, decodeStatusList, statusBitAt, verifyCredential } from "./lib/attest.mjs";
import { readProgramKeys } from "./lib/keys.mjs";
import { checkCredentialShape, checkStatusListShape } from "./lib/shape.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const CLOCK_SKEW_MS = 300_000; // the protocol's skew allowance, as in the badge worker

const EXIT = { VERIFIED: 0, INVALID: 1, SUSPENDED: 2, REVOKED: 3 };

const { values: flags, positionals } = parseArgs({
  options: {
    keys: { type: "string" },
    offline: { type: "boolean", default: false },
    "status-dir": { type: "string" },
  },
  allowPositionals: true,
});

function finish(verdict, checks, credential) {
  const summary =
    credential === null
      ? null
      : {
          id: credential.id,
          subject: credential.credentialSubject?.id,
          implementation: credential.credentialSubject?.implementation,
          level: credential.credentialSubject?.level,
          scope: credential.credentialSubject?.scope,
          categories: credential.credentialSubject?.categories,
          suite: credential.credentialSubject?.suite,
          issuer: credential.issuer,
          validFrom: credential.validFrom,
        };
  console.log(JSON.stringify({ verdict, checks, credential: summary }, null, 2));
  process.exit(EXIT[verdict]);
}

async function loadJson(source, what) {
  if (source === "-") return JSON.parse(readFileSync(0, "utf8"));
  if (/^https:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`${what} fetch failed: ${response.status} ${source}`);
    return await response.json();
  }
  if (/^[a-z][a-z0-9+.-]*:/.test(source) && !/^[a-zA-Z]:\\/.test(source)) {
    throw new Error(`${what} URL must be https (got ${source})`);
  }
  return JSON.parse(readFileSync(source, "utf8"));
}

const source = positionals[0] ?? (process.stdin.isTTY ? undefined : "-");
if (source === undefined) {
  console.error("usage: node scripts/verify-credential.mjs <credential-url-or-path | -> [--keys <path>] [--offline [--status-dir <dir>]]");
  process.exit(EXIT.INVALID);
}

const checks = { schema: { ok: false }, proof: { ok: false }, status: { ok: false } };
let credential = null;
try {
  credential = await loadJson(source, "credential");
} catch (err) {
  checks.schema.errors = [err.message];
  finish("INVALID", checks, null);
}

// ── keys: the committed trust root, refusing the sentinel ───────────────────
const keysPath = flags.keys ?? join(repoRoot, "registry", "keys", "program-keys.json");
const programKeys = readProgramKeys(keysPath);
if (!programKeys.provisioned) {
  checks.proof.reason =
    programKeys.errors.length > 0
      ? `program key file is unusable: ${programKeys.errors.join("; ")}`
      : "program keys are unprovisioned (the committed sentinel) - nothing can verify yet";
  finish("INVALID", checks, credential);
}
const keyByFragment = new Map(programKeys.keys.map((key) => [key.id, key]));
const keyFor = (document, purpose, label) => {
  const fragment = String(document?.proof?.verificationMethod ?? "").split("#")[1];
  const key = keyByFragment.get(fragment);
  if (key === undefined || key.purpose !== purpose) {
    throw new Error(`${label}: proof.verificationMethod does not name a committed "${purpose}" key (got "${fragment ?? "none"}")`);
  }
  return key;
};

// ── schema ──────────────────────────────────────────────────────────────────
const schemaErrors = checkCredentialShape(credential, "credential");
if (credential?.proof === undefined) schemaErrors.push("credential: proof is missing");
const validFromMs = Date.parse(credential?.validFrom ?? "");
if (Number.isFinite(validFromMs) && validFromMs > Date.now() + CLOCK_SKEW_MS) {
  schemaErrors.push("credential: validFrom sits in the future beyond the 300s clock skew");
}
if (schemaErrors.length > 0) {
  checks.schema.errors = schemaErrors;
  finish("INVALID", checks, credential);
}
checks.schema.ok = true;

// ── proof ───────────────────────────────────────────────────────────────────
try {
  const issuerKey = keyFor(credential, "issuer", "credential");
  const { ok, reason } = verifyCredential(credential, issuerKey.publicKeyMultibase);
  if (!ok) {
    checks.proof.reason = reason;
    finish("INVALID", checks, credential);
  }
  checks.proof.ok = true;
  checks.proof.verificationMethod = credential.proof.verificationMethod;
} catch (err) {
  checks.proof.reason = err.message;
  finish("INVALID", checks, credential);
}

// ── status: both lists, proof-verified before any bit is read ───────────────
try {
  const statusDir = flags["status-dir"] ?? join(repoRoot, "registry", "credentials", "status");
  const bits = {};
  for (const entry of credential.credentialStatus) {
    const listSource = flags.offline ? join(statusDir, entry.statusListCredential.split("/").at(-1)) : entry.statusListCredential;
    const list = await loadJson(listSource, `${entry.statusPurpose} status list`);
    const listErrors = checkStatusListShape(list, entry.statusPurpose, `${entry.statusPurpose} list`);
    if (listErrors.length > 0) throw new Error(listErrors.join("; "));
    const statusKeyEntry = keyFor(list, "status", `${entry.statusPurpose} list`);
    const { ok, reason } = verifyCredential(list, statusKeyEntry.publicKeyMultibase);
    if (!ok) throw new Error(`${entry.statusPurpose} list proof did not verify (${reason})`);
    bits[entry.statusPurpose] = statusBitAt(decodeStatusList(list.credentialSubject.encodedList), Number(entry.statusListIndex));
  }
  checks.status.ok = true;
  checks.status.revoked = bits.revocation === true;
  checks.status.suspended = bits.suspension === true;
  if (checks.status.revoked) finish("REVOKED", checks, credential);
  if (checks.status.suspended) finish("SUSPENDED", checks, credential);
  finish("VERIFIED", checks, credential);
} catch (err) {
  checks.status.reason = err.message;
  finish("INVALID", checks, credential);
}
