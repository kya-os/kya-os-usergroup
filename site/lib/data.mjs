/**
 * Registry loading and shaping for the site build.
 *
 * Validation itself lives in scripts/validate.mjs - the one shared core the
 * CI gate and this build both consume, so no check is ever duplicated here.
 * This module turns the validated entries into the shapes the renderers
 * consume, owns the claim URL formatters, and derives the machine-readable
 * artifacts (builders.json, interop.json, the badge worker's committed slug
 * allowlist, and the browser's generated registry vocabulary) from those
 * same shapes.
 *
 * The template entry (slug "example-builder") is validated like every other
 * entry but EXCLUDED from every rendered surface - it exists only as the
 * file contributors copy.
 *
 * Shaping is deterministic: entries sorted by slug, interop sorted by rail
 * order then slug, no timestamps - a pure function of registry/**.json.
 */
import { conformanceLabel } from "../../scripts/lib/builder-entry.mjs";
import * as vocab from "../../scripts/lib/registry-enums.mjs";
import { validateRegistry } from "../../scripts/validate.mjs";
import { CONFORMANCE_MD_URL, REPO_URL, TEMPLATE_SLUG } from "./constants.mjs";

const { INTEROP_CATEGORIES } = vocab;
// The one honest claim formatter lives in the shared entry contract
// (browser-safe, so the badge preview prints the same label); re-exported
// here so every renderer keeps one import site.
export { conformanceLabel };

/**
 * Validate both registries (plus the committed probe results and credential
 * artifacts) and shape them for rendering. Callers must treat a non-empty
 * `errors` as fatal; shaping is skipped on errors because invalid entries
 * need not carry sortable fields. `probes` is the parsed
 * registry/probes.json (null when absent); `credentialData` carries the
 * structurally validated program keys, credentials, status lists, and
 * allocation ledger for site/lib/credentials.mjs to verify
 * cryptographically. All committed data, so the build stays deterministic.
 * @returns {{ errors: string[], rendered: object[], interopSorted: object[], probes: object|null, credentialData: object|null }}
 */
export function loadSiteData() {
  const { entries, interop, probes, programKeys, credentials, statusLists, allocations, errors } = validateRegistry();
  if (errors.length > 0) return { errors, rendered: [], interopSorted: [], probes: null, credentialData: null };

  const rendered = entries
    .filter((entry) => entry.slug !== TEMPLATE_SLUG)
    .sort((a, b) => a.slug.localeCompare(b.slug, "en"));
  const interopSorted = [...interop].sort(
    (a, b) => INTEROP_CATEGORIES.indexOf(a.category) - INTEROP_CATEGORIES.indexOf(b.category) || a.slug.localeCompare(b.slug, "en"),
  );
  return { errors, rendered, interopSorted, probes, credentialData: { programKeys, credentials, statusLists, allocations, entries } };
}

/** The rendered entries of one kind, in registry order. */
export function byKind(entries, kind) {
  return entries.filter((entry) => entry.kind === kind);
}

/**
 * Directory order: the trust ladder itself - verified, then in verification,
 * then self-reported, then everything listed, with revoked last (the one
 * post-verified state that fell off the ladder) - rank ties broken by slug
 * so the order stays deterministic. The kind filter is orthogonal
 * (CSS-only), so within any kind group the same ladder order holds.
 */
const LADDER_RANK = { verified: 0, "in-verification": 1, "self-reported": 2, revoked: 4 };
export function directoryRank(entry) {
  return entry.conformance !== undefined ? LADDER_RANK[entry.conformance.status] : 3;
}

export function directorySorted(entries) {
  return [...entries].sort((a, b) => directoryRank(a) - directoryRank(b) || a.slug.localeCompare(b.slug, "en"));
}

/** The rendered entries that carry a conformance claim. */
export function withConformance(entries) {
  return entries.filter((entry) => entry.conformance !== undefined);
}

/** Sorted interop entries grouped as [category, rows] pairs, in rail order, empty rails skipped. */
export function interopByCategory(interopSorted) {
  return INTEROP_CATEGORIES.filter((category) => interopSorted.some((entry) => entry.category === category)).map(
    (category) => [category, interopSorted.filter((entry) => entry.category === category)],
  );
}

// Where each claimed level is defined; the claim text links here so
// "L1 subset (signed-proof)" is one click from its requirements table.
const LEVEL_ANCHORS = {
  L1: "level-1--core-crypto",
  L2: "level-2--full-session",
  L3: "level-3--full-delegation",
};

export function levelUrl(level) {
  return `${CONFORMANCE_MD_URL}#${LEVEL_ANCHORS[level]}`;
}

export function conformanceLevelUrl(conformance) {
  return levelUrl(conformance.level);
}

export function renderBuildersJson(rendered) {
  return (
    JSON.stringify(
      {
        registry: "kya-os-usergroup",
        source: REPO_URL,
        schema: `${REPO_URL}/blob/main/registry/schema/builder.schema.json`,
        count: rendered.length,
        builders: rendered,
      },
      null,
      2,
    ) + "\n"
  );
}

export function renderInteropJson(interopSorted) {
  return (
    JSON.stringify(
      {
        registry: "kya-os-usergroup/interop",
        source: REPO_URL,
        schema: `${REPO_URL}/blob/main/registry/schema/interop.schema.json`,
        count: interopSorted.length,
        interop: interopSorted,
      },
      null,
      2,
    ) + "\n"
  );
}

/**
 * The badge worker's slug allowlist, generated from the same rendered
 * entries and COMMITTED (not a dist/ artifact): the worker deploy must never
 * depend on a site build having run. Deterministic like everything else.
 */
export function renderBadgeAllowlist(rendered) {
  const lines = rendered.map((entry) => {
    const claim = entry.conformance ? conformanceLabel(entry.conformance) : null;
    const status = entry.conformance?.status ?? null;
    const credentialUrl = entry.conformance?.attestationUrl ?? null;
    return (
      `  ${JSON.stringify(entry.slug)}: { name: ${JSON.stringify(entry.name)}, claim: ${JSON.stringify(claim)},` +
      ` status: ${JSON.stringify(status)}, credentialUrl: ${JSON.stringify(credentialUrl)} },`
    );
  });
  return [
    "// GENERATED by site/build-pages.mjs from registry/builders/ - do not edit.",
    "// Slugs the badge worker will serve at all. claim is the honest display",
    "// label (a subset never renders as a bare level); status is the entry's",
    "// registry conformance status (null when the entry carries no claim) -",
    "// the worker renders the non-credential rungs from it, byte-identical to",
    "// the static tier; credentialUrl is the canonical credential location",
    "// when a credential-backed status exists, else null.",
    "export const BADGE_ALLOWLIST = {",
    ...lines,
    "};",
    "",
  ].join("\n");
}

/**
 * The badge worker's pinned program keys, generated from
 * registry/keys/program-keys.json and COMMITTED (same contract as the
 * allowlist above). Only issuer and status publics are pinned - the reserved
 * log key never reaches the worker, mirroring did.json. On the unprovisioned
 * sentinel the module exports PROVISIONED false and empty arrays, and the
 * worker fail-closes every badge to unverified. When the provisioning PR
 * commits real publics, the next build regenerates this module - the merge
 * arms the worker with zero hand edits.
 */
export function renderGeneratedKeys(programKeys) {
  const pinned = (purpose) =>
    programKeys.keys
      .filter((key) => key.purpose === purpose)
      .map((key) => `  { id: ${JSON.stringify(key.id)}, publicKeyMultibase: ${JSON.stringify(key.publicKeyMultibase)} },`);
  const constLines = (name, rows) => (rows.length === 0 ? [`export const ${name} = [];`] : [`export const ${name} = [`, ...rows, "];"]);
  return [
    "// GENERATED by site/build-pages.mjs from registry/keys/program-keys.json - do not edit.",
    "// The badge worker's pinned program public keys: issuer keys verify",
    "// credentials, status keys verify status lists (separate sets, so a",
    "// stolen issuer key can never clear its own revocation bits). Proofs",
    "// resolve by the fragment id they NAME, so rotated-out keys stay pinned",
    "// here until retired from the registry file. PROVISIONED false (the",
    "// pre-ceremony sentinel) fail-closes every badge to unverified.",
    `export const PROVISIONED = ${programKeys.provisioned};`,
    ...constLines("PINNED_ISSUER_KEYS", pinned("issuer")),
    ...constLines("PINNED_STATUS_KEYS", pinned("status")),
    "",
  ].join("\n");
}

/**
 * The browser's registry vocabulary, /ui/registry-enums.js: the schema
 * enums and key order (scripts/lib/registry-enums.mjs, read from
 * registry/schema/), the interop rails a `standards` slug may name (sorted
 * by slug), and the repo the pull request opens against. Generated so the
 * entry builder never hand-copies an enum; lib/module-checks.mjs re-reads
 * the schemas and asserts every line.
 */
export function renderRegistryEnums(interopSorted) {
  const rails = [...interopSorted].sort((a, b) => a.slug.localeCompare(b.slug, "en")).map(({ slug, standard }) => ({ slug, standard }));
  return [
    "// GENERATED by site/build-pages.mjs from registry/schema/*.json and registry/interop/ - do not edit.",
    "// The registry vocabulary the entry builder validates against: the same",
    "// enums and property order the validator reads from the schemas, the",
    "// interop rails a standards slug may name, and the repo entries land in.",
    ...Object.keys(vocab).map((name) => `export const ${name} = ${JSON.stringify(vocab[name])};`),
    `export const INTEROP_RAILS = ${JSON.stringify(rails)};`,
    `export const REPO_URL = ${JSON.stringify(REPO_URL)};`,
    "",
  ].join("\n");
}
