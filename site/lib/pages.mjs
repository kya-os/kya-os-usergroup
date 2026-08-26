/**
 * Page assembly for the community hub: one renderer per page, composing the
 * page hero + section bodies into the shared shell from lib/html.mjs. Six
 * pages, per the Builders Site design handoff: the overview (home), the
 * builders directory, conformance, the standards matrix, the protocol rails
 * diagram, and use-cases.
 *
 * URL model: folder-style pages (/builders/ -> builders/index.html) so
 * Cloudflare Pages serves them clean; every internal link is root-absolute.
 */
import { DESCRIPTION, ORIGIN, TITLE } from "./constants.mjs";
import { esc, pageShell } from "./html.mjs";
import { sectionsConformance } from "./program.mjs";
import { sectionsRails, sectionsStandards } from "./rails.mjs";
import { sectionsUseCases } from "./use-cases.mjs";
import { sectionEntryBuilder } from "./entry-builder.mjs";
import { sectionsHome } from "./home.mjs";
import { sectionAddCta, sectionDirectory, sectionStartHere, sectionSubmit } from "./sections.mjs";

function metaHead({ title, description, path }) {
  return `<meta name="description" content="${esc(description)}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${ORIGIN}${path}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="KYA-OS" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${ORIGIN}${path}" />
`;
}

// Subpage hero: mono kicker, mono h1 (decrypt-revealed), wide lede. The lede
// is trusted literal HTML authored below, never registry data.
function pageHero({ title, lede }) {
  return `  <header class="hero fx">
    <div class="kicker">KYA-OS COMMUNITY</div>
    <h1 data-title-reveal>${esc(title)}</h1>
    <p class="lede">${lede}</p>
  </header>`;
}

function contentPage({ title, description, path, hero, sections, modules }) {
  return pageShell({
    title,
    headExtra: metaHead({ title, description, path }),
    body: [hero, ...sections].join("\n"),
    current: path,
    modules,
  });
}

/** The overview: the two-line hook, how it works, the path, define-once + THE RAILS panel, explore (stats strip + five cards). */
export function renderLandingHtml({ rendered, interopSorted }) {
  return pageShell({
    title: TITLE,
    headExtra: metaHead({ title: TITLE, description: DESCRIPTION, path: "/" }),
    body: sectionsHome({ rendered, interopSorted }),
    current: "/",
  });
}

/** The directory: the add-your-project strip, filterable registry rows, the on-ramps, the entry builder, and the submission paths. */
export function renderBuildersHtml({ rendered, interopSorted, probes, verdicts }) {
  return contentPage({
    title: `Builders · ${TITLE}`,
    description: "Who builds on KYA-OS: implementations, services, integrations, templates, and examples - one PR to get listed.",
    path: "/builders/",
    hero: pageHero({
      title: "BUILDERS",
      lede: "Everyone building on KYA-OS, in one registry. Verified implementations lead the list, and every listing is one pull request away. Conformance here is measured against the pinned vector suite, never self-asserted.",
    }),
    sections: [sectionAddCta(), sectionDirectory(rendered, probes, verdicts), sectionStartHere(), sectionEntryBuilder(interopSorted), sectionSubmit()],
    modules: ["entry-builder.js"],
  });
}

/** The program, badge first: suite pin, the badge preview, what a verified claim gives you, the pipeline, levels, implementations. */
export function renderConformanceHtml({ rendered, verdicts }) {
  return contentPage({
    title: `Conformance · ${TITLE}`,
    description: "The KYA-OS conformance program: measured claims, independent re-runs, and the pinned vector suite.",
    path: "/conformance/",
    hero: pageHero({
      title: "CONFORMANCE",
      lede: "What you get: a signed, revocable credential for exactly what the program observed, a badge that re-verifies against that credential every time it renders, and a listing that climbs the ladder in public. Measured, not asserted: the program attests exactly the bytes it re-runs against the published vector suite at your pinned commit.",
    }),
    sections: [sectionsConformance(rendered, verdicts)],
    modules: ["badge-preview.js"],
  });
}

/** The standards matrix, grouped by category, every row grounded and dated. */
export function renderStandardsHtml({ interopSorted }) {
  return contentPage({
    title: `Standards · ${TITLE}`,
    description: "The KYA-OS standards rails: what the protocol provides, carries, and projects onto, with evidence per row.",
    path: "/standards/",
    hero: pageHero({
      title: "STANDARDS RAILS",
      lede: "What KYA-OS provides, carries, and projects onto: every row grounded and dated. A status is never listed above what its evidence shows.",
    }),
    sections: [sectionsStandards(interopSorted)],
  });
}

/** The rails diagram: one identity in, one signed proof, every surface out. */
export function renderRailsHtml({ interopSorted }) {
  return contentPage({
    title: `Rails · ${TITLE}`,
    description: "How KYA-OS sits underneath the protocols agents already speak: one signed proof, projected onto every registry, transport, and credential format.",
    path: "/rails/",
    hero: pageHero({
      title: "THE RAILS",
      lede: "Define your agent's Entity Card once. KYA-OS projects it onto every discovery rail your agent needs, so the same identity shows up in MCP server.json, A2A agent cards, and NANDA AgentFacts without rewriting anything.",
    }),
    sections: [sectionsRails(interopSorted)],
  });
}

/** Use-cases: REVOKED step by step (the runnable blueprint) and the recipe grid. */
export function renderUseCasesHtml() {
  return contentPage({
    title: `Use-cases · ${TITLE}`,
    description: "What the KYA-OS primitives are for: the REVOKED on-chain kill switch, and the recipes waiting for a builder.",
    path: "/use-cases/",
    hero: pageHero({
      title: "USE-CASES",
      lede: "What the primitives are for. One shipping example, step by step, and six recipes - each with a target, the runnable example in the reference repository that demonstrates it, and the exact file or subpath it comes from - plus the demo server to try a proof against before you build.",
    }),
    sections: [sectionsUseCases()],
    modules: ["revoked-console.js"],
  });
}
