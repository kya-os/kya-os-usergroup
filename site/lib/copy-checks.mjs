/**
 * Fact-checked copy, on the dist bytes (split from lib/checks.mjs for the
 * lib LOC cap): the rails page's rail-by-rail cards name each rail's real
 * emit.ts exports and link a standards row that exists; the conformance
 * page's levels section names L1, L2, and L3 with their CONFORMANCE.md
 * anchors and says what a level is; and the owner's banned vocabulary
 * appears on neither page. Expected strings are reconstructed here, never
 * taken from the renderers, so a regression cannot pass its own check.
 */
import { CONFORMANCE_MD_URL } from "./constants.mjs";
import { assertBuild, BANNED_COPY } from "./checks.mjs";

// The export each rail card must name, per src/card/emit.ts in the reference tree.
const RAIL_EXPORTS = {
  MCP: ["toServerCardMeta", "toCatalogEntry"],
  A2A: ["toA2AExtension"],
  NANDA: ["toAgentFacts"],
};
// CONFORMANCE.md heading anchors, one per level (the GitHub slug of each
// "Level N - ..." heading).
const LEVEL_ANCHORS = { L1: "level-1--core-crypto", L2: "level-2--full-session", L3: "level-3--full-delegation" };

function sectionById(html, id, name) {
  const start = html.indexOf(`id="${id}"`);
  assertBuild(start !== -1, `${name}: no section with id="${id}"`);
  return html.slice(start, html.indexOf("</section>", start));
}

export function assertCopyFacts(pages) {
  const rails = sectionById(pages["rails/index.html"], "rail-by-rail", "dist/rails/index.html");
  const titles = [...rails.matchAll(/<div class="pc-title t-static">([A-Z0-9]+)<\/div>/g)].map((m) => m[1]);
  assertBuild(titles.join(",") === Object.keys(RAIL_EXPORTS).join(","), `the rail-by-rail cards must be exactly MCP, A2A, NANDA in order (found: ${titles.join(", ")})`);
  for (const [rail, exports] of Object.entries(RAIL_EXPORTS)) {
    const start = rails.indexOf(`<div class="pc-title t-static">${rail}</div>`);
    const next = rails.indexOf('<div class="pc-title t-static">', start + 1);
    const card = rails.slice(start, next === -1 ? undefined : next);
    for (const name of exports) {
      assertBuild(card.includes(`<code>${name}</code>`), `the ${rail} rail card must name its emit.ts export ${name} exactly`);
    }
    for (const line of ["output", "mechanic"]) {
      assertBuild(card.includes(`<span class="rail-kv">${line}</span>`), `the ${rail} rail card lost its ${line} line`);
    }
  }
  for (const [, slug] of rails.matchAll(/href="\/standards\/#std-([a-z0-9-]+)"/g)) {
    assertBuild(pages["standards/index.html"].includes(`id="std-${slug}"`), `a rail card links standards row "${slug}", which does not exist`);
  }

  const levels = sectionById(pages["conformance/index.html"], "levels", "dist/conformance/index.html");
  for (const [level, anchor] of Object.entries(LEVEL_ANCHORS)) {
    assertBuild(levels.includes(`href="${CONFORMANCE_MD_URL}#${anchor}">${level} `), `the levels section must render ${level} linked to its CONFORMANCE.md anchor`);
  }
  assertBuild(levels.includes("capability tiers"), 'the levels section must say levels are "capability tiers"');

  for (const name of ["rails/index.html", "conformance/index.html"]) {
    const banned = pages[name].match(BANNED_COPY);
    assertBuild(banned === null, `banned vocabulary "${banned?.[0]}" leaked into dist/${name}`);
  }
}
