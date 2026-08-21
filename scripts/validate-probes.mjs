/**
 * Structural validation for registry/probes.json - the committed output of
 * the daily live-enforcement probe (scripts/probe-live.mjs):
 *
 *   {
 *     "probedAt": "YYYY-MM-DD",
 *     "results": { "<slug>": { "status": "...", "provenanceVersion": "..." } }
 *   }
 *
 * Enforced:
 *   - valid JSON, top-level object with exactly {probedAt, results}
 *   - probedAt: real calendar date, YYYY-MM-DD (day precision by design)
 *   - every results key resolves to a builder entry of a probeable kind (service or implementation) that
 *     still carries probeUrl - a stale result names the fix in its error
 *   - status: one of enforcing|open|unreachable; provenanceVersion optional
 *
 * A missing file is valid (probes: null): the site then renders every
 * service neutrally, and enforcement language renders nowhere - fail-closed.
 *
 * Split from scripts/validate.mjs for the file LOC cap; validateRegistry()
 * calls this, so the CI gate and the site build both consume it. The
 * calendar-date check deliberately mirrors validate.mjs rather than
 * importing it, keeping this module a leaf (no import cycle).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROBE_STATUSES = ["enforcing", "open", "unreachable"];
const PROBE_KEYS = ["probedAt", "results"];
const RESULT_KEYS = ["status", "provenanceVersion"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const here = dirname(fileURLToPath(import.meta.url));
const probesPath = join(here, "..", "registry", "probes.json");
const rel = "registry/probes.json";

function isCalendarDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Validate registry/probes.json against the parsed builder entries.
 * @returns {{ probes: object|null, errors: string[] }} the parsed probe file
 * (null when absent) and every validation error. Callers must treat a
 * non-empty `errors` as fatal.
 */
export function validateProbes(entries) {
  const errors = [];
  if (!existsSync(probesPath)) return { probes: null, errors };
  const fail = (message) => errors.push(`${rel}: ${message}`);

  let probes;
  try {
    probes = JSON.parse(readFileSync(probesPath, "utf8"));
  } catch (err) {
    return { probes: null, errors: [`${rel}: invalid JSON (${err.message})`] };
  }
  if (typeof probes !== "object" || probes === null || Array.isArray(probes)) {
    return { probes: null, errors: [`${rel}: must be a JSON object`] };
  }

  for (const key of Object.keys(probes)) {
    if (!PROBE_KEYS.includes(key)) fail(`unexpected property "${key}" (allowed: ${PROBE_KEYS.join(", ")})`);
  }
  if (!isCalendarDate(probes.probedAt)) fail('"probedAt" is required: a real calendar date in YYYY-MM-DD form');
  if (typeof probes.results !== "object" || probes.results === null || Array.isArray(probes.results)) {
    fail('"results" is required: an object keyed by builder slug');
    return { probes: null, errors };
  }

  for (const [slug, result] of Object.entries(probes.results)) {
    const entry = entries.find((candidate) => candidate.slug === slug);
    if (entry === undefined) {
      fail(`result "${slug}" does not resolve to a registry/builders/ entry - remove the stale result in the same PR`);
    } else if ((entry.kind !== "service" && entry.kind !== "implementation") || entry.probeUrl === undefined) {
      fail(`result "${slug}" names an entry that is not a probeUrl-carrying service - remove the stale result in the same PR`);
    }
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      fail(`result "${slug}" must be an object`);
      continue;
    }
    for (const key of Object.keys(result)) {
      if (!RESULT_KEYS.includes(key)) fail(`unexpected result property "${slug}.${key}" (allowed: ${RESULT_KEYS.join(", ")})`);
    }
    if (!PROBE_STATUSES.includes(result.status)) {
      fail(`result "${slug}.status" is required: one of ${PROBE_STATUSES.join(", ")}`);
    }
    if (result.provenanceVersion !== undefined && (typeof result.provenanceVersion !== "string" || result.provenanceVersion.length < 1 || result.provenanceVersion.length > 40)) {
      fail(`result "${slug}.provenanceVersion" must be a string of 1-40 characters`);
    }
  }

  return { probes, errors };
}
