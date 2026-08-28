/**
 * Fact-checked copy, on the dist bytes (split from lib/checks.mjs for the
 * lib LOC cap): the rails page's rail-by-rail cards name each rail's real
 * emit.ts exports and link a standards row that exists; the conformance
 * page's levels section names L1, L2, and L3 with their CONFORMANCE.md
 * anchors and heading names and says what a level is; the conformance page
 * keeps its badge-first section order, its badge preview and embed ahead of
 * the levels, the ops detail out of the page and in docs/BADGE-WORKER.md
 * (read here), and one implementations-table row per claim plus the CTA
 * row; the use-cases page's REVOKED section
 * carries the README's own numbers and commands, every recipe card has its
 * Target and Reference lines and its "Open the example" button, the consent
 * card's authorization-methods row names exactly the requirement types
 * src/authz/requirement.ts declares, in its order, with the adapter note
 * and the copyable ToolProtection sample, and every
 * link into the reference tree names
 * a path verified to exist there; and the owner's banned vocabulary appears
 * on none of the three pages. Expected strings are reconstructed here,
 * never taken from the renderers, so a regression cannot pass its own check.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BADGE_WORKER_DOC_URL, CONFORMANCE_MD_URL, MCP_REPO_URL } from "./constants.mjs";
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
// The three level names exactly as CONFORMANCE.md heads them (plain dash,
// house style; GitHub slugs the heading to the anchors above).
const LEVEL_NAMES = { L1: "Level 1 - Core Crypto", L2: "Level 2 - Full Session", L3: "Level 3 - Full Delegation" };
// The conformance page, badge first: its h2s in exactly this order.
const CONFORMANCE_H2S = ["The badge", "What a verified claim gives you", "How verification works", "Levels", "Implementations"];
// Vocabulary that never belongs on the conformance page, beyond BANNED_COPY.
const CONFORMANCE_BANNED = /\b(leaderboard|prestige|trophy|mathematically|guarantees|gamify|pulse)\b/i;
// The badge ops detail lives in docs/BADGE-WORKER.md, not on the page: the
// facts the doc must keep (the worker's cache bound, the failure cache, the
// manual deploy, the key provisioning) and the marker that must not return.
const BADGE_WORKER_DOC = "docs/BADGE-WORKER.md";
const BADGE_WORKER_FACTS = ["s-maxage=300", "60 seconds", "workflow_dispatch", "PROVISIONED"];

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
    assertBuild(levels.includes(`>${level} <span class="pc-tag">${LEVEL_NAMES[level]}</span>`), `the ${level} card must carry its CONFORMANCE.md heading name "${LEVEL_NAMES[level]}"`);
  }
  assertBuild(levels.includes("capability tiers"), 'the levels section must say levels are "capability tiers"');

  assertUseCasesFacts(pages["use-cases/index.html"]);

  for (const name of ["rails/index.html", "conformance/index.html", "use-cases/index.html"]) {
    const banned = pages[name].match(BANNED_COPY);
    assertBuild(banned === null, `banned vocabulary "${banned?.[0]}" leaked into dist/${name}`);
  }
}

/**
 * The conformance page's structure, on the dist bytes: the h2s in the
 * badge-first order; the badge section (linked from the home path) ahead of
 * the pipeline, its preview form and embed ahead of the levels, and its
 * pointer to the ops doc; the ops marker absent from the page and every
 * ops fact present in docs/BADGE-WORKER.md (read from the repo, dashes
 * plain); the page's extra banned vocabulary absent; and the
 * implementations table one body row per claim plus exactly one CTA row.
 */
export function assertConformanceStructure({ html, repoRoot, conformanceEntries }) {
  const name = "dist/conformance/index.html";
  const h2s = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assertBuild(h2s.join("|") === CONFORMANCE_H2S.join("|"), `${name}: h2 order must be exactly [${CONFORMANCE_H2S.join(", ")}], found [${h2s.join(", ")}]`);
  const at = (marker) => {
    const index = html.indexOf(marker);
    assertBuild(index !== -1, `${name}: lost ${marker}`);
    return index;
  };
  assertBuild(at('id="the-badge"') < at('id="how-verification-works"'), `${name}: the badge section must precede the pipeline`);
  assertBuild(at('id="badge-preview"') < at('id="levels"'), `${name}: the badge preview must precede the levels section`);
  const badge = sectionById(html, "the-badge", name);
  for (const id of ["badge-preview", "badge-embed"]) {
    assertBuild(badge.includes(`id="${id}"`), `${name}: the badge section lost its ${id} block`);
  }
  assertBuild(badge.includes(`href="${BADGE_WORKER_DOC_URL}">how the badge worker serves this -&gt;</a>`), `${name}: the badge section must link ${BADGE_WORKER_DOC}`);
  assertBuild(!html.includes("s-maxage"), `${name}: badge ops detail (s-maxage) belongs in ${BADGE_WORKER_DOC}, not on the page`);
  const doc = readFileSync(join(repoRoot, BADGE_WORKER_DOC), "utf8");
  for (const fact of BADGE_WORKER_FACTS) {
    assertBuild(doc.includes(fact), `${BADGE_WORKER_DOC} lost the ops fact "${fact}"`);
  }
  assertBuild(!doc.includes("\u2014"), `${BADGE_WORKER_DOC} carries an em dash`);
  const banned = html.match(CONFORMANCE_BANNED);
  assertBuild(banned === null, `banned vocabulary "${banned?.[0]}" leaked into ${name}`);

  const table = sectionById(html, "implementations", name).match(/<table class="impl">([\s\S]*?)<\/table>/)?.[1];
  assertBuild(table !== undefined, `${name}: the implementations section lost its table`);
  const rows = (table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>/g) ?? []).length;
  assertBuild(rows === conformanceEntries.length, `${name}: the implementations table renders ${rows} rows, expected one per claim (${conformanceEntries.length})`);
  assertBuild(
    (table.match(/<tfoot>/g) ?? []).length === 1 && /<tfoot><tr><td colspan="5" class="ifoot">[^<]* - <a href="\/builders\/#submit">claim conformance -&gt;<\/a><\/td><\/tr><\/tfoot>/.test(table),
    `${name}: the implementations table must end in exactly one claim-conformance CTA row`,
  );
}

// Every path the use-cases page links inside decentralized-identity/
// kya-os-mcp. VERIFIED 2026-08-25 against origin/main at 966b5406 (the
// src/authz pair at 77040d7c) with
// `git -C <kya-os-mcp> cat-file -e origin/main:<path>` for each entry (trees
// and blobs alike); re-verify the same way before adding a path. A link to
// a path outside this list fails the build.
const VERIFIED_MCP_PATHS = [
  "AUDITABILITY.md",
  "examples/revoked",
  "examples/revoked/README.md",
  "examples/consent-basic",
  "examples/consent-full",
  "examples/consent-persistence",
  "examples/outbound-delegation",
  "examples/entity-card/walkthrough.ts",
  "examples/entity-card/server.ts",
  "examples/audit-trail",
  "examples/statuslist",
  "examples/cheqd-dlr",
  "src/card/index.ts",
  "src/card/emit.ts",
  "src/card/revocation.ts",
  "src/card/delegation.ts",
  "src/delegation/index.ts",
  "src/audit/index.ts",
  "src/integrations/cheqd/index.ts",
  "src/authz",
  "src/authz/requirement.ts",
];
// The authorization-methods row on the consent card: the requirement
// types, in the order AuthorizationRequirementSchema declares them
// (src/authz/requirement.ts), and the two facts its note must keep (the
// one shipped adapter, and consent-full/README.md line 73's mode count).
const AUTHZ_TYPES = ["oauth", "mdl", "idv", "credential", "none"];
const AUTHZ_NOTE_FACTS = ["reference adapter", "8 sign-in modes"];
// The README facts the REVOKED section must keep somewhere on the page
// (examples/revoked/README.md lines 18-20, 29, 69, 71): the cap, the verify
// run's elapsedMs (the showcase console and the 60-second block carry it;
// the walkthrough does not repeat the verdict), the zero-config command,
// the hardware kill, and the append-only status list.
const REVOKED_FACTS = ["10 CHEQ", "828", "npm run verify:once", "FIDO2", "append-only"];
// The showcase console: five beats in README order (lines 69-72, the verify
// run line 29), each opening with a dot in the beat's tone - signal for the
// delegation and the payment, alert from the kill on - and the facts the
// line must keep. The signed-proof lockup appears at the payment beat only.
const CONSOLE_BEATS = [
  ["signal", ["payments.transfer", "cap 10 CHEQ"]],
  ["signal", ["wallet_send"]],
  ["alert", ["new status-list version", "append-only"]],
  ["alert", ["DENIED (CREDENTIAL_REVOKED)"]],
  ["alert", ["elapsedMs: 828"]],
];
// The before / after walkthrough: both state headings, and the facts the
// two states carry (README lines 69, 71, and 33).
const WALKTHROUGH_HEADINGS = ["The agent spends, safely", "After the kill"];
const WALKTHROUGH_FACTS = ["10 CHEQ", "holderBinding", "append-only", "That refusal is the product."];

function assertUseCasesFacts(html) {
  const revoked = sectionById(html, "revoked", "dist/use-cases/index.html");
  for (const fact of REVOKED_FACTS) {
    assertBuild(revoked.includes(fact), `the REVOKED section lost the README fact "${fact}"`);
  }
  const walkStart = revoked.indexOf('id="revoked-walkthrough"');
  assertBuild(walkStart !== -1, "the REVOKED section lost its before / after walkthrough");
  assertConsoleBeats(revoked.slice(revoked.indexOf('<div class="flag-console'), walkStart));
  const walkthrough = revoked.slice(walkStart, revoked.indexOf('<div class="uc-block">', walkStart));
  for (const heading of WALKTHROUGH_HEADINGS) {
    assertBuild(walkthrough.includes(`<h3 class="walk-title">${heading}</h3>`), `the walkthrough lost its state heading "${heading}"`);
  }
  for (const fact of WALKTHROUGH_FACTS) {
    assertBuild(walkthrough.includes(fact), `the walkthrough lost the README fact "${fact}"`);
  }
  assertBuild(revoked.includes('data-copy-target="revoked-verify"'), "the REVOKED section must carry the copy button for the 60-second verify commands");

  const recipes = sectionById(html, "recipes", "dist/use-cases/index.html");
  const cards = recipes.split('<div class="panel-card recipe').slice(1);
  assertBuild(cards.length === 6, `the recipes grid must render six cards, found ${cards.length}`);
  for (const card of cards) {
    const title = card.match(/<div class="pc-title t-static">([^<]+)<\/div>/)?.[1] ?? "(untitled)";
    for (const line of ["Target", "Reference"]) {
      assertBuild(card.includes(`<p class="recipe-kv"><strong>${line}</strong> `), `recipe "${title}" lost its ${line} line`);
    }
    assertBuild(/<a class="btn-solid" href="[^"]+">Open the example -&gt;<\/a>/.test(card), `recipe "${title}" lost its "Open the example" button`);
  }
  assertAuthzRow(cards.find((card) => card.includes('<div class="pc-title t-static">gated MCP tools</div>')));

  const prefix = `${MCP_REPO_URL}/`;
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (!href.startsWith(prefix)) continue;
    const path = href.slice(prefix.length).replace(/#.*$/, "").match(/^(?:tree|blob)\/main\/(.+)$/)?.[1];
    assertBuild(path !== undefined, `use-cases links "${href}", which is not a /tree/main/ or /blob/main/ path in the reference tree`);
    assertBuild(VERIFIED_MCP_PATHS.includes(path), `use-cases links reference path "${path}", which is not in the verified allowlist`);
  }
}

// The showcase console renders exactly the five beats, each line opening
// with its tone's dot and carrying its fact, and the signed-proof lockup
// once, on the payment line.
function assertConsoleBeats(console_) {
  const lines = console_.split('<div class="fc-line">').slice(1);
  assertBuild(lines.length === CONSOLE_BEATS.length, `the REVOKED console must render ${CONSOLE_BEATS.length} lines, found ${lines.length}`);
  CONSOLE_BEATS.forEach(([tone, facts], i) => {
    assertBuild(lines[i].startsWith(`<span class="fc-dot tone-${tone}" aria-hidden="true"></span>`), `console line ${i + 1} must open with the ${tone} dot`);
    for (const fact of facts) assertBuild(lines[i].includes(fact), `console line ${i + 1} lost the README fact "${fact}"`);
  });
  assertBuild(console_.split('<span class="wf-lockup').length === 2 && lines[1].includes('<span class="fc-proof"><span class="wf-lockup') && lines[1].includes("signed proof"), "the signed-proof lockup must appear once, on the console's payment line");
}

// The consent card's authorization-methods row sits between the Reference
// line and the tags, renders exactly the five type chips in schema order,
// keeps both note facts, and carries the copy button for the ToolProtection
// sample (its bytes are parity-checked in lib/checks.mjs). Banned
// vocabulary is checked page-wide above, so it covers this row too.
function assertAuthzRow(card) {
  assertBuild(card !== undefined, "the recipes grid lost the gated MCP tools card");
  // The row spans the full card width beneath the two columns (prose,
  // wrapWithDelegation sample), so it must come after both.
  const start = card.indexOf('<div class="recipe-authz">');
  assertBuild(start !== -1 && card.indexOf("<strong>Reference</strong>") < start && card.indexOf('data-copy-target="consent-gate"') < start, "the gated MCP tools card must carry the authorization-methods row as a full-width band after its Reference line and its code sample");
  const row = card.slice(start);
  const chips = [...row.matchAll(/<li class="authz-item" data-authz="([a-z]+)"/g)].map((m) => m[1]);
  assertBuild(chips.join(",") === AUTHZ_TYPES.join(","), `the authorization-methods row must render exactly the requirement types ${AUTHZ_TYPES.join(", ")} in order (found: ${chips.join(", ")})`);
  for (const fact of AUTHZ_NOTE_FACTS) {
    assertBuild(row.includes(fact), `the authorization-methods note lost "${fact}"`);
  }
  assertBuild(row.includes('data-copy-target="consent-protection"'), "the authorization-methods row must carry the copy button for the ToolProtection sample");
}
