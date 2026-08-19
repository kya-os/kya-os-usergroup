/**
 * Page assembly for the community hub: one renderer per page, each composing
 * a page hero + section bodies from lib/sections.mjs into the shared shell
 * from lib/html.mjs. Split out of lib/sections.mjs when the site went from
 * one long page to four (landing / builders / conformance / standards) so
 * each module stays under the LOC cap and owns one concern.
 *
 * URL model: folder-style pages (/builders/ -> builders/index.html) so
 * Cloudflare Pages serves them clean; every internal link is root-absolute.
 */
import { ADD_PROJECT_URL, DESCRIPTION, ORIGIN, TITLE } from "./constants.mjs";
import { withConformance } from "./data.mjs";
import { esc, pageShell } from "./html.mjs";
import {
  sectionBuilders,
  sectionConformance,
  sectionExamples,
  sectionStandards,
  sectionSubmit,
  sectionTemplates,
} from "./sections.mjs";
import { INDEX_CSS } from "./theme.mjs";

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

// `lede` is trusted literal HTML authored below (never registry data).
function pageHero({ title, lede }) {
  return `    <section class="hero page-hero">
      <div class="eyebrow">KYA-OS community</div>
      <h1>${esc(title)}</h1>
      <p class="lede">${lede}</p>
    </section>`;
}

/** A content page: hero + sections in the shared shell, with the page CSS appended. */
function contentPage({ title, description, path, hero, sections }) {
  const body = `
  <article class="wrap">
${hero}
    <main>
${sections.join("\n")}
    </main>
  </article>`;
  return pageShell({ title, headExtra: metaHead({ title, description, path }), body, current: path }).replace(
    "\n</style>",
    `${INDEX_CSS}\n</style>`,
  );
}

function navCard({ href, title, count, countLabel, desc, go }) {
  return `        <a class="card nav-card" href="${href}">
          <div class="card-head"><h3>${esc(title)}</h3><span class="stat"><b>${count}</b> ${esc(countLabel)}</span></div>
          <p class="desc">${esc(desc)}</p>
          <span class="go">${esc(go)} -&gt;</span>
        </a>`;
}

/** The landing page: short hero, one-line mission, three nav cards with live counts. No tables. */
export function renderLandingHtml({ rendered, interopSorted }) {
  const verified = withConformance(rendered).filter((entry) => entry.conformance.status === "verified").length;
  const cards = [
    navCard({
      href: "/builders/",
      title: "Builders",
      count: rendered.length,
      countLabel: "listed",
      desc: "The directory of who ships on KYA-OS, plus templates and examples to start from.",
      go: "Browse the directory",
    }),
    navCard({
      href: "/conformance/",
      title: "Conformance",
      count: verified,
      countLabel: "verified",
      desc: "Measured, not asserted: claims are re-run against the pinned vector suite.",
      go: "See the program",
    }),
    navCard({
      href: "/standards/",
      title: "Standards",
      count: interopSorted.length,
      countLabel: "rails",
      desc: "What KYA-OS provides, carries, and projects onto, with evidence per row.",
      go: "Read the matrix",
    }),
  ].join("\n");

  const body = `
  <article class="wrap">
    <section class="hero">
      <div class="eyebrow">Decentralized Identity Foundation</div>
      <h1>KYA-OS community</h1>
      <p class="lede">${esc(DESCRIPTION)}</p>
      <div class="chips-row">
        <a class="btn" href="${esc(ADD_PROJECT_URL)}">Add your project -&gt;</a>
      </div>
    </section>
    <main>
      <section class="cards">
${cards}
      </section>
    </main>
  </article>`;
  return pageShell({
    title: TITLE,
    headExtra: metaHead({ title: TITLE, description: DESCRIPTION, path: "/" }),
    body,
    current: null,
  }).replace("\n</style>", `${INDEX_CSS}\n</style>`);
}

/** The directory page: kind-grouped entries, templates, examples, and the three submission paths. */
export function renderBuildersHtml({ rendered }) {
  return contentPage({
    title: `Builders · ${TITLE}`,
    description: "Who builds on KYA-OS: implementations, services, integrations, templates, and examples - one PR to get listed.",
    path: "/builders/",
    hero: pageHero({
      title: "Builders",
      lede: "Who is building on KYA-OS - and the templates and examples to start from.",
    }),
    sections: [sectionBuilders(rendered), sectionTemplates(rendered), sectionExamples(rendered), sectionSubmit()],
  });
}

/** The program page: explainer, suite pin, 4-step strip, and the implementations table. */
export function renderConformanceHtml({ rendered }) {
  return contentPage({
    title: `Conformance · ${TITLE}`,
    description: "The KYA-OS conformance program: measured claims, independent re-runs, and the pinned vector suite.",
    path: "/conformance/",
    hero: pageHero({
      title: "Conformance",
      lede: "Measured, not asserted: the program attests exactly the bytes it re-runs against the published vector suite at your pinned commit.",
    }),
    sections: [sectionConformance(rendered)],
  });
}

/** The rails page: the standards matrix grouped by category, with the correction path. */
export function renderStandardsHtml({ interopSorted }) {
  return contentPage({
    title: `Standards · ${TITLE}`,
    description: "The KYA-OS standards rails: what the protocol provides, carries, and projects onto, with evidence per row.",
    path: "/standards/",
    hero: pageHero({
      title: "Standards rails",
      lede: "What KYA-OS provides, carries, and projects onto - every row grounded and dated.",
    }),
    sections: [sectionStandards(interopSorted)],
  });
}
