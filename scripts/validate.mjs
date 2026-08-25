#!/usr/bin/env node
/**
 * Structural validation for the whole KYA-OS community registry:
 *
 *   registry/builders/*.json   one entry per project (builder.schema.json)
 *   registry/interop/*.json    one entry per standards rail (interop.schema.json)
 *
 * Deliberately Ajv-free: every check is implemented in plain JS on Node
 * builtins so this repo carries ZERO npm dependencies. The checks mirror the
 * two JSON Schemas - the vocabulary (enums, property order) is READ from the
 * schemas (scripts/lib/registry-enums.mjs), so only bounds and patterns
 * need keeping in sync by hand when a shape changes.
 *
 * Per builder entry, the static rules live in scripts/lib/builder-entry.mjs
 * (a pure, browser-safe module the site's entry builder runs as well, so
 * the checks a visitor sees on the page are the checks CI runs):
 *   - valid JSON, top-level object, no unknown properties
 *   - name: string, 1-80 chars
 *   - slug: ^[a-z0-9-]{2,40}$, equal to the filename, unique across BOTH
 *     registry directories (uniqueness is the one cross-file rule, checked
 *     here)
 *   - description: string, 1-280 chars
 *   - homepage: https URL (required); repo: https URL (optional)
 *   - kind: one of the schema's kind enum
 *   - buildsOn: optional non-empty unique array from the known repo set
 *   - standards: optional non-empty unique array of slugs, each of which MUST
 *     resolve to registry/interop/<slug>.json (cross-file check)
 *   - conformance: optional object; scope=subset requires categories;
 *     status verified|revoked requires attestationUrl (and any other status
 *     forbids it - a claim below the verified rung never links a credential);
 *     optional evidenceUrl is the public claim/verification thread;
 *     suiteVersion is semver
 *   - probeUrl: optional https URL of a live MCP endpoint for the daily
 *     enforcement probe; kinds service|implementation only
 *   - deploy: optional non-empty array of {platform, url(https)}
 *   - contact: optional object with at least one of email / github
 *   - listedAt: real calendar date, YYYY-MM-DD
 *
 * Enforced per interop entry (here):
 *   - valid JSON, top-level object, no unknown properties
 *   - standard: string, 1-120 chars
 *   - slug: pattern + filename match + uniqueness across BOTH directories
 *   - category: one of the known rails
 *   - relationship: string, 1-200 chars
 *   - status: shipping|specified|planned|exploring|none
 *   - evidence: https URL, REQUIRED when status is shipping or specified
 *   - notes: optional string, 1-600 chars
 *   - listedAt: real calendar date, YYYY-MM-DD
 *
 * registry/probes.json (the committed daily probe output) is validated by
 * scripts/validate-probes.mjs, and the conformance program's committed
 * credential artifacts (registry/keys/ + registry/credentials/) by
 * scripts/validate-credentials.mjs - both called from validateRegistry()
 * below, so every consumer sees one merged verdict.
 *
 * Run directly (node scripts/validate.mjs) for CI / local use: prints every
 * error per file and exits non-zero on any failure. The site build imports
 * validateRegistry() (via site/lib/data.mjs) and refuses to render when it
 * reports errors.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { builderEntryErrors, isBoundedString, isCalendarDate, isHttpsUrl, SLUG_RE } from "./lib/builder-entry.mjs";
import * as vocab from "./lib/registry-enums.mjs";
import { validateCredentials } from "./validate-credentials.mjs";
import { validateProbes } from "./validate-probes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const buildersDir = join(repoRoot, "registry", "builders");
const interopDir = join(repoRoot, "registry", "interop");

function readDirEntries(dir, relDir, errors) {
  const parsed = [];
  if (!existsSync(dir)) {
    errors.push(`${relDir}/: directory is missing`);
    return parsed;
  }
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) errors.push(`${relDir}/: no .json entries found`);
  for (const file of files) {
    const rel = `${relDir}/${file}`;
    let value;
    try {
      value = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (err) {
      errors.push(`${rel}: invalid JSON (${err.message})`);
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${rel}: entry must be a JSON object`);
      continue;
    }
    parsed.push({ file, rel, value });
  }
  return parsed;
}

/** Slug uniqueness across BOTH directories - the one rule only this file can see. */
function checkSlugUnique(slug, rel, seenSlugs, fail) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return;
  const prior = seenSlugs.get(slug);
  if (prior) fail(`duplicate slug "${slug}" (also used by ${prior})`);
  else seenSlugs.set(slug, rel);
}

function checkInteropEntry(entry, file, fail) {
  for (const key of Object.keys(entry)) {
    if (!vocab.INTEROP_KEYS.includes(key)) fail(`unexpected property "${key}" (additionalProperties: false)`);
  }
  if (!isBoundedString(entry.standard, 1, 120)) fail('"standard" is required: a string of 1-120 characters');
  if (typeof entry.slug !== "string" || !SLUG_RE.test(entry.slug)) {
    fail('"slug" is required: lowercase letters, digits, and dashes, 2-40 characters (^[a-z0-9-]{2,40}$)');
  } else if (`${entry.slug}.json` !== file) {
    fail(`"slug" (${entry.slug}) must match the filename (expected ${entry.slug}.json)`);
  }
  if (!vocab.INTEROP_CATEGORIES.includes(entry.category)) {
    fail(`"category" is required: one of ${vocab.INTEROP_CATEGORIES.join(", ")}`);
  }
  if (!isBoundedString(entry.relationship, 1, 200)) fail('"relationship" is required: a string of 1-200 characters');
  if (!vocab.INTEROP_STATUSES.includes(entry.status)) {
    fail(`"status" is required: one of ${vocab.INTEROP_STATUSES.join(", ")}`);
  }
  if ((entry.status === "shipping" || entry.status === "specified") && entry.evidence === undefined) {
    fail(`"evidence" is required when status is "${entry.status}" (a status is never listed above what the evidence shows)`);
  }
  if (entry.evidence !== undefined && !isHttpsUrl(entry.evidence)) fail('"evidence" must be a valid https:// URL');
  if (entry.notes !== undefined && !isBoundedString(entry.notes, 1, 600)) fail('"notes" must be a string of 1-600 characters');
  if (!isCalendarDate(entry.listedAt)) fail('"listedAt" is required: a real calendar date in YYYY-MM-DD form');
}

/**
 * Validate every registry entry in both directories, plus the committed
 * probe results and credential artifacts.
 * @returns {{ entries: object[], interop: object[], probes: object|null, errors: string[] }}
 * parsed builder entries (as `entries`), parsed interop entries, the parsed
 * registry/probes.json (null when absent), and the full list of validation
 * errors. Entries are returned valid or not, for callers that want them;
 * callers must treat a non-empty `errors` as fatal.
 */
export function validateRegistry() {
  const errors = [];
  const seenSlugs = new Map();

  // ── interop entries first: builders cross-reference their slugs ──────────
  const interop = [];
  for (const { file, rel, value: entry } of readDirEntries(interopDir, "registry/interop", errors)) {
    const fail = (message) => errors.push(`${rel}: ${message}`);
    checkInteropEntry(entry, file, fail);
    checkSlugUnique(entry.slug, rel, seenSlugs, fail);
    interop.push(entry);
  }
  const interopSlugs = new Set(interop.map((entry) => entry.slug).filter((slug) => typeof slug === "string"));

  // ── builder entries: the shared static rules + slug uniqueness ───────────
  const entries = [];
  for (const { file, rel, value: entry } of readDirEntries(buildersDir, "registry/builders", errors)) {
    const fail = (message) => errors.push(`${rel}: ${message}`);
    for (const { message } of builderEntryErrors(entry, { filename: file, vocab, interopSlugs })) fail(message);
    checkSlugUnique(entry.slug, rel, seenSlugs, fail);
    entries.push(entry);
  }

  // ── probe results: committed data, cross-checked against the entries ─────
  const { probes, errors: probeErrors } = validateProbes(entries);
  errors.push(...probeErrors);

  // ── credential artifacts: keys, credentials, status lists, allocations ───
  // (structural + cross-file; scripts/validate-credentials.mjs. The build
  // adds cryptographic verification on top - site/lib/credentials.mjs.)
  const { programKeys, credentials, statusLists, allocations, errors: credentialErrors } = validateCredentials(entries);
  errors.push(...credentialErrors);

  return { entries, interop, probes, programKeys, credentials, statusLists, allocations, errors };
}

// CLI entry point: report and gate.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { entries, interop, errors } = validateRegistry();
  if (errors.length > 0) {
    console.error(`Registry validation FAILED (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(
    `Registry validation passed: ${entries.length} builder entr${entries.length === 1 ? "y" : "ies"}, ${interop.length} interop entr${interop.length === 1 ? "y" : "ies"} valid.`,
  );
}
