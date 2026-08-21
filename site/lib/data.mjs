/**
 * Registry loading and shaping for the site build.
 *
 * Validation itself lives in scripts/validate.mjs - the one shared core the
 * CI gate and this build both consume, so no check is ever duplicated here.
 * This module turns the validated entries into the shapes the renderers
 * consume, owns the plain-text claim formatters, and derives the
 * machine-readable artifacts (builders.json, interop.json, and the badge
 * worker's committed slug allowlist) from those same shapes.
 *
 * The template entry (slug "example-builder") is validated like every other
 * entry but EXCLUDED from every rendered surface - it exists only as the
 * file contributors copy.
 *
 * Shaping is deterministic: entries sorted by slug, interop sorted by rail
 * order then slug, no timestamps - a pure function of registry/**.json.
 */
import { validateRegistry, INTEROP_CATEGORIES } from "../../scripts/validate.mjs";
import { CONFORMANCE_MD_URL, REPO_URL, TEMPLATE_SLUG } from "./constants.mjs";

/**
 * Validate both registries (plus the committed probe results) and shape them
 * for rendering. Callers must treat a non-empty `errors` as fatal; shaping
 * is skipped on errors because invalid entries need not carry sortable
 * fields. `probes` is the parsed registry/probes.json (null when absent) -
 * committed data, so the build stays deterministic.
 * @returns {{ errors: string[], rendered: object[], interopSorted: object[], probes: object|null }}
 */
export function loadSiteData() {
  const { entries, interop, probes, errors } = validateRegistry();
  if (errors.length > 0) return { errors, rendered: [], interopSorted: [], probes: null };

  const rendered = entries
    .filter((entry) => entry.slug !== TEMPLATE_SLUG)
    .sort((a, b) => a.slug.localeCompare(b.slug, "en"));
  const interopSorted = [...interop].sort(
    (a, b) => INTEROP_CATEGORIES.indexOf(a.category) - INTEROP_CATEGORIES.indexOf(b.category) || a.slug.localeCompare(b.slug, "en"),
  );
  return { errors, rendered, interopSorted, probes };
}

/** The rendered entries of one kind, in registry order. */
export function byKind(entries, kind) {
  return entries.filter((entry) => entry.kind === kind);
}

/**
 * Directory order: the trust ladder itself - verified, then in verification,
 * then self-reported, then everything listed - rank ties broken by slug so
 * the order stays deterministic. The kind filter is orthogonal (CSS-only),
 * so within any kind group the same ladder order holds.
 */
const LADDER_RANK = { verified: 0, "in-verification": 1, "self-reported": 2 };
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

/**
 * The one honest way to print a conformance claim: a subset never renders as
 * a bare level - the covered categories are always part of the label. The
 * site chips and the badge allowlist both print through this formatter, so
 * the two surfaces can never disagree.
 */
export function conformanceLabel(conformance) {
  if (conformance.scope === "subset") {
    return `${conformance.level} subset (${conformance.categories.join(", ")})`;
  }
  return `${conformance.level} full`;
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
    const credentialUrl = entry.conformance?.attestationUrl ?? null;
    return `  ${JSON.stringify(entry.slug)}: { name: ${JSON.stringify(entry.name)}, claim: ${JSON.stringify(claim)}, credentialUrl: ${JSON.stringify(credentialUrl)} },`;
  });
  return [
    "// GENERATED by site/build-pages.mjs from registry/builders/ - do not edit.",
    "// Slugs the badge worker will serve at all. claim is the honest display",
    "// label (a subset never renders as a bare level); credentialUrl is the",
    "// canonical credential location when a verified claim exists, else null",
    "// (the worker renders those as unverified).",
    "export const BADGE_ALLOWLIST = {",
    ...lines,
    "};",
    "",
  ].join("\n");
}
