/**
 * Structural validation for the conformance program's committed credential
 * artifacts - the Phase A issuance state carried in git:
 *
 *   registry/keys/program-keys.json         the program's public keys (or the
 *                                           pre-ceremony unprovisioned sentinel)
 *   registry/credentials/<id32>.json        one signed attestation credential
 *                                           per issued claim (filename = the
 *                                           32-hex tail of the deterministic id)
 *   registry/credentials/status/*.json      the two signed Bitstring status
 *                                           lists (revocation-1, suspension-1)
 *   registry/credentials/allocations.json   the status-index allocation ledger
 *   registry/credentials/schema/attestation-v1.json  the published JSON Schema
 *
 * Enforced here (structural + cross-file; the CRYPTOGRAPHIC verification -
 * proofs, status bits, entry/credential agreement on the bits - lives in
 * site/lib/credentials.mjs and runs on every build):
 *   - every credential passes the schema-lite shape check (scripts/lib/shape.mjs)
 *     and its filename equals its id's 32-hex tail
 *   - allocations are sequential from 0, unique per index and credential id,
 *     inside the list size; every committed credential has exactly one
 *     allocation at its own status index; no allocation dangles
 *   - a builder entry at status verified or revoked links a committed
 *     credential whose subject (level, scope, categories, suiteVersion)
 *     matches the entry's claim and whose allocation names the entry's slug -
 *     the proof replaces trust in the entry; entries below the verified rung
 *     link no credential (enforced in scripts/validate.mjs)
 *   - unprovisioned sentinel era: no credentials, no status lists, empty
 *     allocations, and no verified/revoked entries - everything fails closed
 *     on the sentinel
 *
 * Split from scripts/validate.mjs as a leaf module (same pattern as
 * scripts/validate-probes.mjs); validateRegistry() calls this, so the CI
 * gate, the issuance scripts, and the site build all consume one core.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CREDENTIALS_BASE, STATUS_LIST_BITS, STATUS_PURPOSES } from "./lib/attest.mjs";
import { readProgramKeys } from "./lib/keys.mjs";
import { checkCredentialShape, checkStatusListShape } from "./lib/shape.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = join(here, "..");

const ID32_FILE_RE = /^[0-9a-f]{32}\.json$/;
const ALLOCATION_KEYS = ["index", "credentialId", "slug", "allocatedAt"];
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function readJson(path, rel, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    errors.push(`${rel}: invalid JSON (${err.message})`);
    return null;
  }
}

function readAllocations(credentialsDir, errors) {
  const rel = "registry/credentials/allocations.json";
  const path = join(credentialsDir, "allocations.json");
  const empty = { nextIndex: 0, allocations: [] };
  if (!existsSync(path)) {
    errors.push(`${rel}: file is missing (commit the empty ledger {"nextIndex": 0, "allocations": []})`);
    return empty;
  }
  const parsed = readJson(path, rel, errors);
  if (parsed === null) return empty;
  const fail = (message) => errors.push(`${rel}: ${message}`);
  for (const key of Object.keys(parsed)) {
    if (key !== "nextIndex" && key !== "allocations") fail(`unexpected property "${key}" (allowed: nextIndex, allocations)`);
  }
  if (!Number.isInteger(parsed.nextIndex) || parsed.nextIndex < 0) fail('"nextIndex" must be a non-negative integer');
  if (!Array.isArray(parsed.allocations)) {
    fail('"allocations" must be an array');
    return empty;
  }
  const seenIndexes = new Set();
  const seenIds = new Set();
  parsed.allocations.forEach((allocation, i) => {
    if (typeof allocation !== "object" || allocation === null || Array.isArray(allocation)) {
      fail(`allocations[${i}] must be an object`);
      return;
    }
    for (const key of Object.keys(allocation)) {
      if (!ALLOCATION_KEYS.includes(key)) fail(`unexpected allocations[${i}] property "${key}" (allowed: ${ALLOCATION_KEYS.join(", ")})`);
    }
    if (!Number.isInteger(allocation.index) || allocation.index < 0 || allocation.index >= STATUS_LIST_BITS) {
      fail(`allocations[${i}].index must be an integer in [0, ${STATUS_LIST_BITS})`);
    } else if (seenIndexes.has(allocation.index)) {
      fail(`duplicate allocation index ${allocation.index}`);
    } else {
      seenIndexes.add(allocation.index);
    }
    if (typeof allocation.credentialId !== "string" || !/^urn:kya:conf:[0-9a-f]{32}$/.test(allocation.credentialId)) {
      fail(`allocations[${i}].credentialId must match urn:kya:conf:<32 hex>`);
    } else if (seenIds.has(allocation.credentialId)) {
      fail(`duplicate allocation for credential ${allocation.credentialId}`);
    } else {
      seenIds.add(allocation.credentialId);
    }
    if (typeof allocation.slug !== "string" || !/^[a-z0-9-]{2,40}$/.test(allocation.slug)) {
      fail(`allocations[${i}].slug must be a registry slug`);
    }
    if (typeof allocation.allocatedAt !== "string" || !DATETIME_RE.test(allocation.allocatedAt)) {
      fail(`allocations[${i}].allocatedAt must be an ISO 8601 UTC datetime`);
    }
  });
  // Sequential-from-zero allocation: indexes are exactly 0..n-1 and nextIndex
  // is n, so "the next index" is never ambiguous and gaps cannot hide reuse.
  const sorted = [...seenIndexes].sort((a, b) => a - b);
  if (sorted.some((index, i) => index !== i)) fail("allocation indexes must be exactly 0..n-1 (sequential, no gaps)");
  if (parsed.nextIndex !== parsed.allocations.length) {
    fail(`"nextIndex" (${parsed.nextIndex}) must equal the allocation count (${parsed.allocations.length})`);
  }
  return parsed;
}

/**
 * Validate every committed credential artifact against the parsed builder
 * entries. `rootDir` is injectable for tests; the default is the repo root.
 * @returns {{ programKeys: object, credentials: object[], statusLists: object,
 *   allocations: object, errors: string[] }} programKeys is the readProgramKeys
 * result; credentials is [{ id32, rel, credential }]; statusLists maps purpose
 * to { rel, list } or null; callers must treat a non-empty errors as fatal.
 */
export function validateCredentials(entries, rootDir = defaultRoot) {
  const errors = [];
  const credentialsDir = join(rootDir, "registry", "credentials");
  const statusDir = join(credentialsDir, "status");

  const programKeys = readProgramKeys(join(rootDir, "registry", "keys", "program-keys.json"));
  errors.push(...programKeys.errors);

  if (!existsSync(join(credentialsDir, "schema", "attestation-v1.json"))) {
    errors.push("registry/credentials/schema/attestation-v1.json: the published credential schema is missing");
  }

  // ── committed credentials ─────────────────────────────────────────────────
  const credentials = [];
  if (existsSync(credentialsDir)) {
    for (const file of readdirSync(credentialsDir, { withFileTypes: true })) {
      if (file.isDirectory()) {
        if (file.name !== "status" && file.name !== "schema") {
          errors.push(`registry/credentials/${file.name}/: unexpected directory (allowed: status, schema)`);
        }
        continue;
      }
      if (file.name === "allocations.json") continue;
      const rel = `registry/credentials/${file.name}`;
      if (!ID32_FILE_RE.test(file.name)) {
        errors.push(`${rel}: unexpected file (credentials are named <32-hex id>.json)`);
        continue;
      }
      const credential = readJson(join(credentialsDir, file.name), rel, errors);
      if (credential === null) continue;
      errors.push(...checkCredentialShape(credential, rel));
      if (credential.proof === undefined) errors.push(`${rel}: a committed credential must carry its proof`);
      const id32 = file.name.slice(0, 32);
      if (typeof credential.id === "string" && credential.id !== `urn:kya:conf:${id32}`) {
        errors.push(`${rel}: filename does not match the credential id (${credential.id})`);
      }
      credentials.push({ id32, rel, credential });
    }
  } else {
    errors.push("registry/credentials/: directory is missing");
  }

  // ── status lists ──────────────────────────────────────────────────────────
  const statusLists = { revocation: null, suspension: null };
  if (existsSync(statusDir)) {
    const files = readdirSync(statusDir).sort();
    const expected = STATUS_PURPOSES.map((purpose) => `${purpose}-1.json`).sort();
    if (files.join(",") !== expected.join(",")) {
      errors.push(`registry/credentials/status/: must hold exactly ${expected.join(" and ")} (found: ${files.join(", ") || "nothing"})`);
    }
    for (const purpose of STATUS_PURPOSES) {
      const name = `${purpose}-1.json`;
      if (!files.includes(name)) continue;
      const rel = `registry/credentials/status/${name}`;
      const list = readJson(join(statusDir, name), rel, errors);
      if (list === null) continue;
      errors.push(...checkStatusListShape(list, purpose, rel));
      statusLists[purpose] = { rel, list };
    }
  }

  // ── allocation ledger ─────────────────────────────────────────────────────
  const allocations = readAllocations(credentialsDir, errors);
  const allocationById = new Map(allocations.allocations.map((allocation) => [allocation.credentialId, allocation]));
  for (const { rel, credential } of credentials) {
    const allocation = allocationById.get(credential.id);
    if (allocation === undefined) {
      errors.push(`${rel}: no allocation in registry/credentials/allocations.json for ${credential.id}`);
      continue;
    }
    const index = credential.credentialStatus?.[0]?.statusListIndex;
    if (index !== undefined && String(allocation.index) !== index) {
      errors.push(`${rel}: statusListIndex ${index} does not match the allocated index ${allocation.index}`);
    }
  }
  const committedIds = new Set(credentials.map(({ credential }) => credential.id));
  for (const allocation of allocations.allocations) {
    if (typeof allocation.credentialId === "string" && !committedIds.has(allocation.credentialId)) {
      errors.push(`registry/credentials/allocations.json: allocation ${allocation.index} names uncommitted credential ${allocation.credentialId}`);
    }
  }

  // ── entry cross-checks: the credential replaces trust in the entry ────────
  const byAttestationUrl = new Map(credentials.map((record) => [`${CREDENTIALS_BASE}/${record.id32}.json`, record]));
  for (const entry of entries) {
    const c = entry.conformance;
    if (c === undefined || (c.status !== "verified" && c.status !== "revoked") || typeof c.attestationUrl !== "string") continue;
    const record = byAttestationUrl.get(c.attestationUrl);
    const rel = `registry/builders/${entry.slug}.json`;
    if (record === undefined) {
      errors.push(`${rel}: attestationUrl does not point at a committed registry/credentials/<id32>.json credential (${c.attestationUrl})`);
      continue;
    }
    const subject = record.credential.credentialSubject ?? {};
    // Identity binding: the credential must be ABOUT this entry's project -
    // its subject id must be one of the identity URLs the entry itself
    // declares. Without this, a credential about a different subject could
    // render green on this row while every other cross-check still passes.
    const entryIdentities = [entry.homepage, entry.repo].filter((u) => typeof u === "string");
    if (!entryIdentities.includes(subject.id)) {
      errors.push(`${rel}: credential subject ${JSON.stringify(subject.id)} is not this entry's homepage or repo`);
    }
    if (subject.level !== c.level) errors.push(`${rel}: credential level ${subject.level} does not match the entry claim ${c.level}`);
    if (subject.scope !== c.scope) errors.push(`${rel}: credential scope ${subject.scope} does not match the entry claim ${c.scope}`);
    const entryCategories = [...(c.categories ?? [])].sort().join(",");
    const credentialCategories = (subject.categories ?? []).join(",");
    if (entryCategories !== credentialCategories) {
      errors.push(`${rel}: credential categories (${credentialCategories || "none"}) do not match the entry claim (${entryCategories || "none"})`);
    }
    if (subject.suite?.suiteVersion !== c.suiteVersion) {
      errors.push(`${rel}: credential suiteVersion ${subject.suite?.suiteVersion} does not match the entry claim ${c.suiteVersion}`);
    }
    const allocation = allocationById.get(record.credential.id);
    if (allocation !== undefined && allocation.slug !== entry.slug) {
      errors.push(`${rel}: the linked credential's allocation names slug "${allocation.slug}", not "${entry.slug}"`);
    }
  }

  // ── fail closed on the unprovisioned sentinel ─────────────────────────────
  if (!programKeys.provisioned) {
    if (credentials.length > 0) {
      errors.push("registry/keys/program-keys.json: keys are unprovisioned but committed credentials exist - refusing (fail closed)");
    }
    if (statusLists.revocation !== null || statusLists.suspension !== null) {
      errors.push("registry/keys/program-keys.json: keys are unprovisioned but status lists exist - refusing (fail closed)");
    }
    if (allocations.allocations.length > 0) {
      errors.push("registry/keys/program-keys.json: keys are unprovisioned but the allocation ledger is not empty - refusing (fail closed)");
    }
    for (const entry of entries) {
      const status = entry.conformance?.status;
      if (status === "verified" || status === "revoked") {
        errors.push(`registry/builders/${entry.slug}.json: status "${status}" requires provisioned program keys - nothing renders verified on the sentinel`);
      }
    }
  } else if (credentials.length > 0 && (statusLists.revocation === null || statusLists.suspension === null)) {
    errors.push("registry/credentials/status/: committed credentials exist but the signed status lists are missing");
  }

  return { programKeys, credentials, statusLists, allocations, errors };
}
