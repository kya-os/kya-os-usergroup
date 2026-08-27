/**
 * The builder-entry contract as pure functions: the static rules one
 * registry/builders/<slug>.json must satisfy (mirroring builder.schema.json,
 * Ajv-free), the one honest way to print a conformance claim, the seed a
 * claim's proof waveform draws from, and the prefilled GitHub new-file URL.
 *
 * BROWSER-SAFE BY CONTRACT: no imports, no Node builtins, no I/O. The site
 * build copies this file byte-for-byte to dist/ui/builder-entry.js, where
 * /ui/entry-builder.js runs the SAME checks the validator runs in CI as the
 * visitor types - one implementation, two runtimes. The vocabulary (enums
 * and key order) is injected: Node passes scripts/lib/registry-enums.mjs,
 * the browser passes the generated /ui/registry-enums.js, both read from
 * the schemas. Cross-file rules (slug uniqueness across both registries)
 * stay in scripts/validate.mjs, which is the only place that sees every
 * file.
 */

export const SLUG_RE = /^[a-z0-9-]{2,40}$/;
export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 280;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GITHUB_USER_RE = /^[a-zA-Z0-9-]{1,39}$/;

export function isHttpsUrl(value) {
  if (typeof value !== "string") return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:";
}

export function isCalendarDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isBoundedString(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The one honest way to print a conformance claim: a subset never renders
 * as a bare level - the covered categories are always part of the label.
 * Site chips, badges, and the worker allowlist all print through this.
 */
export function conformanceLabel(conformance) {
  if (conformance.scope === "subset") {
    return `${conformance.level} subset (${conformance.categories.join(", ")})`;
  }
  return `${conformance.level} full`;
}

/**
 * The seed and geometry a listed claim's proof waveform draws with. The
 * directory row and the conformance page's badge preview both use them, so
 * the preview IS the wave the entry will get.
 */
export function claimWaveSeed(slug, conformance) {
  return `${slug}#${conformanceLabel(conformance)}`;
}
export const CLAIM_WAVE = { bars: 16, trackHeight: 11, barWidth: 2, gap: 1.5 };

/**
 * The prefilled GitHub new-file URL: opens the editor on registry/builders/
 * with the entry already in the buffer (GitHub auto-forks for
 * non-collaborators and opens the PR from the fork).
 */
export function newEntryUrl(repoUrl, entry) {
  const value = encodeURIComponent(JSON.stringify(entry, null, 2) + "\n");
  return `${repoUrl}/new/main/registry/builders?filename=${entry.slug}.json&value=${value}`;
}

function slugArrayErrors(value, name, fail) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(name, `"${name}" must be a non-empty array`);
    return false;
  }
  let ok = true;
  for (const item of value) {
    if (typeof item !== "string" || !SLUG_RE.test(item)) {
      fail(name, `"${name}" items must match ^[a-z0-9-]{2,40}$ (got ${JSON.stringify(item)})`);
      ok = false;
    }
  }
  if (new Set(value).size !== value.length) {
    fail(name, `"${name}" must not contain duplicates`);
    ok = false;
  }
  return ok;
}

function conformanceErrors(c, vocab, fail) {
  const at = (message) => fail("conformance", message);
  if (!isObject(c)) return at('"conformance" must be an object');
  for (const key of Object.keys(c)) {
    if (!vocab.CONFORMANCE_KEYS.includes(key)) at(`unexpected conformance property "${key}" (allowed: ${vocab.CONFORMANCE_KEYS.join(", ")})`);
  }
  if (!vocab.CONFORMANCE_LEVELS.includes(c.level)) at(`"conformance.level" is required: one of ${vocab.CONFORMANCE_LEVELS.join(", ")}`);
  if (!vocab.CONFORMANCE_SCOPES.includes(c.scope)) at(`"conformance.scope" is required: one of ${vocab.CONFORMANCE_SCOPES.join(", ")}`);
  if (c.scope === "subset" && c.categories === undefined) {
    at('"conformance.categories" is required when scope is "subset" (a subset never renders as a bare level)');
  }
  if (c.categories !== undefined) slugArrayErrors(c.categories, "conformance.categories", (_, message) => at(message));
  if (typeof c.suiteVersion !== "string" || !SEMVER_RE.test(c.suiteVersion)) at('"conformance.suiteVersion" is required: semver (X.Y.Z)');
  if (!vocab.CONFORMANCE_STATUSES.includes(c.status)) at(`"conformance.status" is required: one of ${vocab.CONFORMANCE_STATUSES.join(", ")}`);
  const credentialRung = c.status === "verified" || c.status === "revoked";
  if (credentialRung && c.attestationUrl === undefined) {
    at(`"conformance.attestationUrl" is required when status is "${c.status}" (the credential is the public record)`);
  }
  if (c.attestationUrl !== undefined && !credentialRung) {
    at('"conformance.attestationUrl" is only allowed at status "verified" or "revoked" - a claim below the verified rung never links a credential');
  }
  if (c.attestationUrl !== undefined && !isHttpsUrl(c.attestationUrl)) at('"conformance.attestationUrl" must be a valid https:// URL');
  if (c.evidenceUrl !== undefined && !isHttpsUrl(c.evidenceUrl)) at('"conformance.evidenceUrl" must be a valid https:// URL');
}

function deployErrors(deploy, vocab, fail) {
  const at = (message) => fail("deploy", message);
  if (!Array.isArray(deploy) || deploy.length === 0) return at('"deploy" must be a non-empty array of {platform, url} objects');
  deploy.forEach((target, index) => {
    if (!isObject(target)) return at(`"deploy[${index}]" must be an object`);
    for (const key of Object.keys(target)) {
      if (!vocab.DEPLOY_KEYS.includes(key)) at(`unexpected deploy[${index}] property "${key}" (allowed: ${vocab.DEPLOY_KEYS.join(", ")})`);
    }
    if (!vocab.DEPLOY_PLATFORMS.includes(target.platform)) {
      at(`"deploy[${index}].platform" is required: one of ${vocab.DEPLOY_PLATFORMS.join(", ")}`);
    }
    if (!isHttpsUrl(target.url)) at(`"deploy[${index}].url" is required: a valid https:// URL`);
  });
}

function contactErrors(contact, vocab, fail) {
  const at = (message) => fail("contact", message);
  if (!isObject(contact)) return at('"contact" must be an object');
  const keys = Object.keys(contact);
  if (keys.length === 0) at(`"contact" must have at least one of ${vocab.CONTACT_KEYS.map((k) => `"${k}"`).join(", ")}`);
  for (const key of keys) {
    if (!vocab.CONTACT_KEYS.includes(key)) at(`unexpected contact property "${key}" (allowed: ${vocab.CONTACT_KEYS.join(", ")})`);
  }
  if (contact.email !== undefined && (typeof contact.email !== "string" || !EMAIL_RE.test(contact.email))) {
    at('"contact.email" must be a valid email address');
  }
  if (contact["press-email"] !== undefined && (typeof contact["press-email"] !== "string" || !EMAIL_RE.test(contact["press-email"]))) {
    at('"contact.press-email" must be a valid email address');
  }
  if (contact.github !== undefined && (typeof contact.github !== "string" || !GITHUB_USER_RE.test(contact.github))) {
    at('"contact.github" must be a GitHub username (letters, digits, dashes, max 39 chars, no @)');
  }
}

/**
 * Every static rule for one builder entry, as [{ field, message }] - empty
 * when the entry is valid. `filename` is the file the entry lives in (the
 * slug must equal it); `vocab` is the registry vocabulary (see the header);
 * `interopSlugs` is the Set of registry/interop/ slugs a `standards` item
 * may name. Messages are the CI messages, verbatim, so a visitor reading
 * them on the site sees exactly what the validator would print.
 */
export function builderEntryErrors(entry, { filename, vocab, interopSlugs }) {
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });

  for (const key of Object.keys(entry)) {
    if (!vocab.BUILDER_KEYS.includes(key)) fail("entry", `unexpected property "${key}" (additionalProperties: false)`);
  }
  if (!isBoundedString(entry.name, 1, NAME_MAX)) fail("name", `"name" is required: a string of 1-${NAME_MAX} characters`);
  if (typeof entry.slug !== "string" || !SLUG_RE.test(entry.slug)) {
    fail("slug", '"slug" is required: lowercase letters, digits, and dashes, 2-40 characters (^[a-z0-9-]{2,40}$)');
  } else if (`${entry.slug}.json` !== filename) {
    fail("slug", `"slug" (${entry.slug}) must match the filename (expected ${entry.slug}.json)`);
  }
  if (!isBoundedString(entry.description, 1, DESCRIPTION_MAX)) {
    fail("description", `"description" is required: a string of 1-${DESCRIPTION_MAX} characters`);
  }
  if (!isHttpsUrl(entry.homepage)) fail("homepage", '"homepage" is required: a valid https:// URL');
  if (entry.repo !== undefined && !isHttpsUrl(entry.repo)) fail("repo", '"repo" must be a valid https:// URL');
  if (!vocab.KINDS.includes(entry.kind)) {
    fail(
      "kind",
      entry.kind === undefined
        ? `"kind" is required: one of ${vocab.KINDS.join(", ")}`
        : `"kind" must be one of ${vocab.KINDS.join(", ")}, got: ${JSON.stringify(entry.kind)}`,
    );
  }
  if (entry.buildsOn !== undefined) {
    if (!Array.isArray(entry.buildsOn) || entry.buildsOn.length === 0) {
      fail("buildsOn", '"buildsOn" must be a non-empty array');
    } else {
      for (const repo of entry.buildsOn) {
        if (!vocab.BUILDS_ON.includes(repo)) fail("buildsOn", `unknown buildsOn repo "${repo}" (allowed: ${vocab.BUILDS_ON.join(", ")})`);
      }
      if (new Set(entry.buildsOn).size !== entry.buildsOn.length) fail("buildsOn", '"buildsOn" must not contain duplicates');
    }
  }
  if (entry.standards !== undefined && slugArrayErrors(entry.standards, "standards", fail)) {
    for (const slug of entry.standards) {
      if (!interopSlugs.has(slug)) fail("standards", `"standards" slug "${slug}" does not resolve to registry/interop/${slug}.json`);
    }
  }
  if (entry.conformance !== undefined) conformanceErrors(entry.conformance, vocab, fail);
  if (entry.probeUrl !== undefined) {
    if (!isHttpsUrl(entry.probeUrl)) fail("probeUrl", '"probeUrl" must be a valid https:// URL');
    if (entry.kind !== "service" && entry.kind !== "implementation") {
      fail("probeUrl", `"probeUrl" is only allowed on kind service or implementation (got kind ${JSON.stringify(entry.kind)}) - the live probe targets deployed endpoints`);
    }
  }
  if (entry.deploy !== undefined) deployErrors(entry.deploy, vocab, fail);
  if (entry.contact !== undefined) contactErrors(entry.contact, vocab, fail);
  if (!isCalendarDate(entry.listedAt)) fail("listedAt", '"listedAt" is required: a real calendar date in YYYY-MM-DD form');
  return errors;
}
