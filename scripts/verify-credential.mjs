#!/usr/bin/env node
/**
 * The anyone-can-check verifier for KYA-OS conformance attestation
 * credentials. Zero dependencies; Node 20+.
 *
 *   node scripts/verify-credential.mjs https://builders.kya-os.org/credentials/<id32>.json
 *   node scripts/verify-credential.mjs registry/credentials/<id32>.json
 *   curl -s https://builders.kya-os.org/credentials/<id32>.json | node scripts/verify-credential.mjs -
 *
 * Checks, in this order, all fail-closed (scripts/lib/verdict.mjs):
 *   schema  the credential matches the published shape exactly: NO
 *           validUntil (a validUntil is a schema violation by design, so
 *           there is no "expired" state to invent), validFrom in the
 *           program's timestamp form, YYYY-MM-DDThh:mm:ssZ on a day its
 *           month has, a deterministic id that recomputes from the subject
 *           fields, and a proof that carries the credential's own @context;
 *           and validFrom is less than the 300 second clock skew ahead of
 *           this machine's clock, so one 300 seconds ahead or more is refused
 *   proof   the eddsa-jcs-2022 DataIntegrityProof verifies, as VC Data
 *           Integrity EdDSA Cryptosuites v1.0 section 3.3.2 defines, against
 *           the committed program ISSUER key its verificationMethod names
 *   status  both signed status lists fetch (or load with --offline); each
 *           is held to the program's status list shape, its validFrom to
 *           the same form and the same 300 second skew, before its proof
 *           verifies against the committed STATUS keys (a separate key set,
 *           so a stolen issuer key cannot clear its own bits); then the
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
 *   --offline [--status-dir <dir>]
 *                     read status lists from local files by URL basename,
 *                     in <dir> (default: registry/credentials/status)
 * Any argument besides the one credential is refused with the usage line.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readProgramKeys } from "./lib/keys.mjs";
import { credentialVerdict } from "./lib/verdict.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

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
// One credential: --offline takes no value, so a folder typed after it would
// otherwise be passed over, or read as the credential.
if (source === undefined || positionals.length > 1) {
  console.error("usage: node scripts/verify-credential.mjs <credential-url-or-path | -> [--keys <path>] [--offline [--status-dir <dir>]]");
  process.exit(EXIT.INVALID);
}

// Each status list from the URL its credentialStatus entry names, or, with
// --offline, from the file of the same name in the status folder.
const statusDir = flags["status-dir"] ?? join(repoRoot, "registry", "credentials", "status");
const loadStatusList = (entry) =>
  loadJson(flags.offline ? join(statusDir, entry.statusListCredential.split("/").at(-1)) : entry.statusListCredential, `${entry.statusPurpose} status list`);

const { verdict, checks, credential } = await credentialVerdict({
  loadCredential: () => loadJson(source, "credential"),
  programKeys: readProgramKeys(flags.keys ?? join(repoRoot, "registry", "keys", "program-keys.json")),
  loadStatusList,
  now: Date.now(),
});
finish(verdict, checks, credential);
