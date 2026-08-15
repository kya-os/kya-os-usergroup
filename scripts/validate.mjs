#!/usr/bin/env node
/**
 * Structural validation for registry/builders/*.json.
 *
 * Deliberately Ajv-free: every check is implemented in plain JS on Node
 * builtins so this repo carries ZERO npm dependencies. The checks mirror
 * registry/schema/builder.schema.json - keep the two in sync when the entry
 * shape changes.
 *
 * Enforced per entry:
 *   - valid JSON, top-level object
 *   - no properties beyond the schema's (additionalProperties: false)
 *   - name: string, 1-80 chars
 *   - slug: ^[a-z0-9-]{2,40}$, equal to the filename, unique across entries
 *   - description: string, 1-280 chars
 *   - homepage: https URL (required); repo: https URL (optional)
 *   - categories: optional non-empty array of unique known categories
 *   - kyaOsRepos: optional non-empty array of unique non-empty strings
 *   - contact: optional object with at least one of email / github
 *   - listedAt: real calendar date, YYYY-MM-DD
 *
 * Run directly (node scripts/validate.mjs) for CI / local use: prints every
 * error per file and exits non-zero on any failure. site/build-pages.mjs
 * imports validateRegistry() and refuses to render when it reports errors.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const buildersDir = join(repoRoot, "registry", "builders");

export const CATEGORIES = ["implementation", "integration", "tooling", "demo", "research", "service"];

const ENTRY_KEYS = ["name", "slug", "description", "homepage", "repo", "categories", "kyaOsRepos", "contact", "listedAt"];
const CONTACT_KEYS = ["email", "github"];
const SLUG_RE = /^[a-z0-9-]{2,40}$/;
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

/**
 * Validate every registry entry.
 * @returns {{ entries: object[], errors: string[] }} parsed entries (valid or
 * not, for callers that want them) and the full list of validation errors.
 */
export function validateRegistry() {
  const errors = [];
  const entries = [];
  const seenSlugs = new Set();

  const files = readdirSync(buildersDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) errors.push("registry/builders/: no .json entries found");

  for (const file of files) {
    const rel = `registry/builders/${file}`;
    const fail = (message) => errors.push(`${rel}: ${message}`);

    let entry;
    try {
      entry = JSON.parse(readFileSync(join(buildersDir, file), "utf8"));
    } catch (err) {
      fail(`invalid JSON (${err.message})`);
      continue;
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail("entry must be a JSON object");
      continue;
    }

    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.includes(key)) fail(`unexpected property "${key}" (additionalProperties: false)`);
    }

    // name
    if (typeof entry.name !== "string" || entry.name.length < 1 || entry.name.length > 80) {
      fail('"name" is required: a string of 1-80 characters');
    }

    // slug: pattern, filename match, uniqueness
    if (typeof entry.slug !== "string" || !SLUG_RE.test(entry.slug)) {
      fail('"slug" is required: lowercase letters, digits, and dashes, 2-40 characters (^[a-z0-9-]{2,40}$)');
    } else {
      if (`${entry.slug}.json` !== file) fail(`"slug" (${entry.slug}) must match the filename (expected ${entry.slug}.json)`);
      if (seenSlugs.has(entry.slug)) fail(`duplicate slug "${entry.slug}"`);
      seenSlugs.add(entry.slug);
    }

    // description
    if (typeof entry.description !== "string" || entry.description.length < 1 || entry.description.length > 280) {
      fail('"description" is required: a string of 1-280 characters');
    }

    // URLs: https only
    if (!isHttpsUrl(entry.homepage)) fail('"homepage" is required: a valid https:// URL');
    if (entry.repo !== undefined && !isHttpsUrl(entry.repo)) fail('"repo" must be a valid https:// URL');

    // categories
    if (entry.categories !== undefined) {
      if (!Array.isArray(entry.categories) || entry.categories.length === 0) {
        fail('"categories" must be a non-empty array');
      } else {
        for (const category of entry.categories) {
          if (!CATEGORIES.includes(category)) fail(`unknown category "${category}" (allowed: ${CATEGORIES.join(", ")})`);
        }
        if (new Set(entry.categories).size !== entry.categories.length) fail('"categories" must not contain duplicates');
      }
    }

    // kyaOsRepos
    if (entry.kyaOsRepos !== undefined) {
      if (!Array.isArray(entry.kyaOsRepos) || entry.kyaOsRepos.length === 0) {
        fail('"kyaOsRepos" must be a non-empty array of strings');
      } else {
        for (const repo of entry.kyaOsRepos) {
          if (typeof repo !== "string" || repo.length === 0) fail('"kyaOsRepos" items must be non-empty strings');
        }
        if (new Set(entry.kyaOsRepos).size !== entry.kyaOsRepos.length) fail('"kyaOsRepos" must not contain duplicates');
      }
    }

    // contact
    if (entry.contact !== undefined) {
      if (typeof entry.contact !== "object" || entry.contact === null || Array.isArray(entry.contact)) {
        fail('"contact" must be an object');
      } else {
        const keys = Object.keys(entry.contact);
        if (keys.length === 0) fail('"contact" must have at least one of "email" or "github"');
        for (const key of keys) {
          if (!CONTACT_KEYS.includes(key)) fail(`unexpected contact property "${key}" (allowed: ${CONTACT_KEYS.join(", ")})`);
        }
        if (entry.contact.email !== undefined && (typeof entry.contact.email !== "string" || !EMAIL_RE.test(entry.contact.email))) {
          fail('"contact.email" must be a valid email address');
        }
        if (entry.contact.github !== undefined && (typeof entry.contact.github !== "string" || !GITHUB_USER_RE.test(entry.contact.github))) {
          fail('"contact.github" must be a GitHub username (letters, digits, dashes, max 39 chars, no @)');
        }
      }
    }

    // listedAt
    if (!isCalendarDate(entry.listedAt)) fail('"listedAt" is required: a real calendar date in YYYY-MM-DD form');

    entries.push(entry);
  }

  return { entries, errors };
}

// CLI entry point: report and gate.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { entries, errors } = validateRegistry();
  if (errors.length > 0) {
    console.error(`Registry validation FAILED (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`Registry validation passed: ${entries.length} entr${entries.length === 1 ? "y" : "ies"} valid.`);
}
