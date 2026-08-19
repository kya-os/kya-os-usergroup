#!/usr/bin/env node
/**
 * Structural validation for the whole KYA-OS community registry:
 *
 *   registry/builders/*.json   one entry per project (builder.schema.json)
 *   registry/interop/*.json    one entry per standards rail (interop.schema.json)
 *
 * Deliberately Ajv-free: every check is implemented in plain JS on Node
 * builtins so this repo carries ZERO npm dependencies. The checks mirror the
 * two JSON Schemas - keep them and this script in sync when a shape changes.
 *
 * Enforced per builder entry:
 *   - valid JSON, top-level object, no unknown properties
 *   - name: string, 1-80 chars
 *   - slug: ^[a-z0-9-]{2,40}$, equal to the filename, unique across BOTH
 *     registry directories
 *   - description: string, 1-280 chars
 *   - homepage: https URL (required); repo: https URL (optional)
 *   - kind: one of implementation|service|template|example|integration|marketplace
 *   - buildsOn: optional non-empty unique array from the known repo set
 *   - standards: optional non-empty unique array of slugs, each of which MUST
 *     resolve to registry/interop/<slug>.json (cross-file check)
 *   - conformance: optional object; scope=subset requires categories;
 *     status=verified requires attestationUrl; optional evidenceUrl is the
 *     public claim/verification thread; suiteVersion is semver
 *   - deploy: optional non-empty array of {platform, url(https)}
 *   - contact: optional object with at least one of email / github
 *   - listedAt: real calendar date, YYYY-MM-DD
 *
 * Enforced per interop entry:
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
 * Run directly (node scripts/validate.mjs) for CI / local use: prints every
 * error per file and exits non-zero on any failure. site/build-pages.mjs
 * imports validateRegistry() and refuses to render when it reports errors.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const buildersDir = join(repoRoot, "registry", "builders");
const interopDir = join(repoRoot, "registry", "interop");

export const KINDS = ["implementation", "service", "template", "example", "integration", "marketplace"];
export const BUILDS_ON = ["kya-os-mcp", "kya-os-schema", "kya-os", "spec"];
export const CONFORMANCE_LEVELS = ["L1", "L2", "L3"];
export const CONFORMANCE_SCOPES = ["full", "subset"];
export const CONFORMANCE_STATUSES = ["self-reported", "in-verification", "verified"];
export const DEPLOY_PLATFORMS = ["vercel", "railway", "cloudflare", "docker", "other"];
export const INTEROP_CATEGORIES = [
  "discovery-projection",
  "identity",
  "credential-format",
  "revocation",
  "transparency",
  "payments",
  "canonicalization",
  "transport",
];
export const INTEROP_STATUSES = ["shipping", "specified", "planned", "exploring", "none"];

const BUILDER_KEYS = ["name", "slug", "description", "homepage", "repo", "kind", "buildsOn", "standards", "conformance", "deploy", "contact", "listedAt"];
const CONFORMANCE_KEYS = ["level", "scope", "categories", "suiteVersion", "status", "attestationUrl", "evidenceUrl"];
const DEPLOY_KEYS = ["platform", "url"];
const CONTACT_KEYS = ["email", "github"];
const INTEROP_KEYS = ["standard", "slug", "category", "relationship", "status", "evidence", "notes", "listedAt"];

const SLUG_RE = /^[a-z0-9-]{2,40}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GITHUB_USER_RE = /^[a-zA-Z0-9-]{1,39}$/;

function isHttpsUrl(value) {
  if (typeof value !== "string") return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:";
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isBoundedString(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

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

function checkSlug(entry, file, rel, seenSlugs, fail) {
  if (typeof entry.slug !== "string" || !SLUG_RE.test(entry.slug)) {
    fail('"slug" is required: lowercase letters, digits, and dashes, 2-40 characters (^[a-z0-9-]{2,40}$)');
    return;
  }
  if (`${entry.slug}.json` !== file) fail(`"slug" (${entry.slug}) must match the filename (expected ${entry.slug}.json)`);
  const prior = seenSlugs.get(entry.slug);
  if (prior) fail(`duplicate slug "${entry.slug}" (also used by ${prior})`);
  else seenSlugs.set(entry.slug, rel);
}

function checkContact(contact, fail) {
  if (typeof contact !== "object" || contact === null || Array.isArray(contact)) {
    fail('"contact" must be an object');
    return;
  }
  const keys = Object.keys(contact);
  if (keys.length === 0) fail('"contact" must have at least one of "email" or "github"');
  for (const key of keys) {
    if (!CONTACT_KEYS.includes(key)) fail(`unexpected contact property "${key}" (allowed: ${CONTACT_KEYS.join(", ")})`);
  }
  if (contact.email !== undefined && (typeof contact.email !== "string" || !EMAIL_RE.test(contact.email))) {
    fail('"contact.email" must be a valid email address');
  }
  if (contact.github !== undefined && (typeof contact.github !== "string" || !GITHUB_USER_RE.test(contact.github))) {
    fail('"contact.github" must be a GitHub username (letters, digits, dashes, max 39 chars, no @)');
  }
}

function checkSlugArray(value, name, fail) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`"${name}" must be a non-empty array`);
    return false;
  }
  let ok = true;
  for (const item of value) {
    if (typeof item !== "string" || !SLUG_RE.test(item)) {
      fail(`"${name}" items must match ^[a-z0-9-]{2,40}$ (got ${JSON.stringify(item)})`);
      ok = false;
    }
  }
  if (new Set(value).size !== value.length) {
    fail(`"${name}" must not contain duplicates`);
    ok = false;
  }
  return ok;
}

function checkConformance(conformance, fail) {
  if (typeof conformance !== "object" || conformance === null || Array.isArray(conformance)) {
    fail('"conformance" must be an object');
    return;
  }
  for (const key of Object.keys(conformance)) {
    if (!CONFORMANCE_KEYS.includes(key)) fail(`unexpected conformance property "${key}" (allowed: ${CONFORMANCE_KEYS.join(", ")})`);
  }
  if (!CONFORMANCE_LEVELS.includes(conformance.level)) {
    fail(`"conformance.level" is required: one of ${CONFORMANCE_LEVELS.join(", ")}`);
  }
  if (!CONFORMANCE_SCOPES.includes(conformance.scope)) {
    fail(`"conformance.scope" is required: one of ${CONFORMANCE_SCOPES.join(", ")}`);
  }
  if (conformance.scope === "subset" && conformance.categories === undefined) {
    fail('"conformance.categories" is required when scope is "subset" (a subset never renders as a bare level)');
  }
  if (conformance.categories !== undefined) checkSlugArray(conformance.categories, "conformance.categories", fail);
  if (typeof conformance.suiteVersion !== "string" || !SEMVER_RE.test(conformance.suiteVersion)) {
    fail('"conformance.suiteVersion" is required: semver (X.Y.Z)');
  }
  if (!CONFORMANCE_STATUSES.includes(conformance.status)) {
    fail(`"conformance.status" is required: one of ${CONFORMANCE_STATUSES.join(", ")}`);
  }
  if (conformance.status === "verified" && conformance.attestationUrl === undefined) {
    fail('"conformance.attestationUrl" is required when status is "verified" (verified renders only with the credential link)');
  }
  if (conformance.attestationUrl !== undefined && !isHttpsUrl(conformance.attestationUrl)) {
    fail('"conformance.attestationUrl" must be a valid https:// URL');
  }
  if (conformance.evidenceUrl !== undefined && !isHttpsUrl(conformance.evidenceUrl)) {
    fail('"conformance.evidenceUrl" must be a valid https:// URL');
  }
}

function checkDeploy(deploy, fail) {
  if (!Array.isArray(deploy) || deploy.length === 0) {
    fail('"deploy" must be a non-empty array of {platform, url} objects');
    return;
  }
  deploy.forEach((target, index) => {
    if (typeof target !== "object" || target === null || Array.isArray(target)) {
      fail(`"deploy[${index}]" must be an object`);
      return;
    }
    for (const key of Object.keys(target)) {
      if (!DEPLOY_KEYS.includes(key)) fail(`unexpected deploy[${index}] property "${key}" (allowed: ${DEPLOY_KEYS.join(", ")})`);
    }
    if (!DEPLOY_PLATFORMS.includes(target.platform)) {
      fail(`"deploy[${index}].platform" is required: one of ${DEPLOY_PLATFORMS.join(", ")}`);
    }
    if (!isHttpsUrl(target.url)) fail(`"deploy[${index}].url" is required: a valid https:// URL`);
  });
}

/**
 * Validate every registry entry in both directories.
 * @returns {{ entries: object[], interop: object[], errors: string[] }}
 * parsed builder entries (as `entries`), parsed interop entries, and the full
 * list of validation errors. Entries are returned valid or not, for callers
 * that want them; callers must treat a non-empty `errors` as fatal.
 */
export function validateRegistry() {
  const errors = [];
  const seenSlugs = new Map();

  // ── interop entries first: builders cross-reference their slugs ──────────
  const interop = [];
  for (const { file, rel, value: entry } of readDirEntries(interopDir, "registry/interop", errors)) {
    const fail = (message) => errors.push(`${rel}: ${message}`);

    for (const key of Object.keys(entry)) {
      if (!INTEROP_KEYS.includes(key)) fail(`unexpected property "${key}" (additionalProperties: false)`);
    }

    if (!isBoundedString(entry.standard, 1, 120)) fail('"standard" is required: a string of 1-120 characters');
    checkSlug(entry, file, rel, seenSlugs, fail);
    if (!INTEROP_CATEGORIES.includes(entry.category)) {
      fail(`"category" is required: one of ${INTEROP_CATEGORIES.join(", ")}`);
    }
    if (!isBoundedString(entry.relationship, 1, 200)) fail('"relationship" is required: a string of 1-200 characters');
    if (!INTEROP_STATUSES.includes(entry.status)) {
      fail(`"status" is required: one of ${INTEROP_STATUSES.join(", ")}`);
    }
    if ((entry.status === "shipping" || entry.status === "specified") && entry.evidence === undefined) {
      fail(`"evidence" is required when status is "${entry.status}" (a status is never listed above what the evidence shows)`);
    }
    if (entry.evidence !== undefined && !isHttpsUrl(entry.evidence)) fail('"evidence" must be a valid https:// URL');
    if (entry.notes !== undefined && !isBoundedString(entry.notes, 1, 600)) fail('"notes" must be a string of 1-600 characters');
    if (!isCalendarDate(entry.listedAt)) fail('"listedAt" is required: a real calendar date in YYYY-MM-DD form');

    interop.push(entry);
  }
  const interopSlugs = new Set(interop.map((entry) => entry.slug).filter((slug) => typeof slug === "string"));

  // ── builder entries ───────────────────────────────────────────────────────
  const entries = [];
  for (const { file, rel, value: entry } of readDirEntries(buildersDir, "registry/builders", errors)) {
    const fail = (message) => errors.push(`${rel}: ${message}`);

    for (const key of Object.keys(entry)) {
      if (!BUILDER_KEYS.includes(key)) fail(`unexpected property "${key}" (additionalProperties: false)`);
    }

    if (!isBoundedString(entry.name, 1, 80)) fail('"name" is required: a string of 1-80 characters');
    checkSlug(entry, file, rel, seenSlugs, fail);
    if (!isBoundedString(entry.description, 1, 280)) fail('"description" is required: a string of 1-280 characters');
    if (!isHttpsUrl(entry.homepage)) fail('"homepage" is required: a valid https:// URL');
    if (entry.repo !== undefined && !isHttpsUrl(entry.repo)) fail('"repo" must be a valid https:// URL');
    if (!KINDS.includes(entry.kind)) fail(`"kind" is required: one of ${KINDS.join(", ")}`);

    if (entry.buildsOn !== undefined) {
      if (!Array.isArray(entry.buildsOn) || entry.buildsOn.length === 0) {
        fail('"buildsOn" must be a non-empty array');
      } else {
        for (const repo of entry.buildsOn) {
          if (!BUILDS_ON.includes(repo)) fail(`unknown buildsOn repo "${repo}" (allowed: ${BUILDS_ON.join(", ")})`);
        }
        if (new Set(entry.buildsOn).size !== entry.buildsOn.length) fail('"buildsOn" must not contain duplicates');
      }
    }

    if (entry.standards !== undefined && checkSlugArray(entry.standards, "standards", fail)) {
      for (const slug of entry.standards) {
        if (!interopSlugs.has(slug)) {
          fail(`"standards" slug "${slug}" does not resolve to registry/interop/${slug}.json`);
        }
      }
    }

    if (entry.conformance !== undefined) checkConformance(entry.conformance, fail);
    if (entry.deploy !== undefined) checkDeploy(entry.deploy, fail);
    if (entry.contact !== undefined) checkContact(entry.contact, fail);
    if (!isCalendarDate(entry.listedAt)) fail('"listedAt" is required: a real calendar date in YYYY-MM-DD form');

    entries.push(entry);
  }

  return { entries, interop, errors };
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
