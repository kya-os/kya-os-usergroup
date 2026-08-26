/**
 * Client-module checks, on the finished dist/ui/ bytes: the committed
 * modules ship as exact byte copies, the browser-safe library modules the
 * build copies out of site/lib and scripts/lib are byte-identical to their
 * sources, the generated vocabulary module agrees with the schemas (re-read
 * here, never trusted from the build), every relative import a module makes
 * resolves to a file that shipped, every page carries exactly the module
 * tags it should (the shell pair everywhere, page modules on their page
 * only), and the guard lines the no-JS contract rests on are intact. Split
 * from lib/assertions.mjs for the LOC cap; same philosophy: read the bytes
 * back, never trust the renderers.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertBuild } from "./checks.mjs";

// The module map, restated independently of lib/html.mjs and lib/pages.mjs.
export const SHELL_MODULES = ["page-fx.js", "copy-prompt.js"];
export const PAGE_MODULES = {
  "builders/index.html": ["entry-builder.js"],
  "conformance/index.html": ["badge-preview.js"],
};
export const COPIED_MODULES = { "builder-entry.js": "scripts/lib/builder-entry.mjs", "waveform.js": "site/lib/waveform.mjs" };
export const GENERATED_MODULES = ["registry-enums.js"];

const jsFiles = (dir) => readdirSync(dir).filter((name) => name.endsWith(".js")).sort();
const same = (a, b) => a.join(",") === b.join(",");

/** The vocabulary the generated module must carry, straight from the schemas. */
function schemaVocabulary(repoRoot) {
  const schema = (name) => JSON.parse(readFileSync(join(repoRoot, "registry", "schema", name), "utf8"));
  const builder = schema("builder.schema.json");
  const interop = schema("interop.schema.json");
  return {
    KINDS: builder.properties.kind.enum,
    BUILDS_ON: builder.properties.buildsOn.items.enum,
    CONFORMANCE_LEVELS: builder.properties.conformance.properties.level.enum,
    CONFORMANCE_SCOPES: builder.properties.conformance.properties.scope.enum,
    CONFORMANCE_STATUSES: builder.properties.conformance.properties.status.enum,
    DEPLOY_PLATFORMS: builder.properties.deploy.items.properties.platform.enum,
    INTEROP_CATEGORIES: interop.properties.category.enum,
    INTEROP_STATUSES: interop.properties.status.enum,
    BUILDER_KEYS: Object.keys(builder.properties),
    CONFORMANCE_KEYS: Object.keys(builder.properties.conformance.properties),
    DEPLOY_KEYS: Object.keys(builder.properties.deploy.items.properties),
    CONTACT_KEYS: Object.keys(builder.properties.contact.properties),
    INTEROP_KEYS: Object.keys(interop.properties),
  };
}

export function assertClientModules({ distDir, pages, interopSorted, repoUrl }) {
  const repoRoot = join(distDir, "..");
  const uiSrcDir = join(repoRoot, "site", "assets", "ui");
  const distUi = join(distDir, "ui");
  const committed = jsFiles(uiSrcDir);
  const expectedCommitted = [...SHELL_MODULES, ...Object.values(PAGE_MODULES).flat()].sort();
  assertBuild(same(committed, expectedCommitted), `site/assets/ui/ (${committed.join(", ")}) must hold exactly: ${expectedCommitted.join(", ")}`);
  const built = jsFiles(distUi);
  const expectedBuilt = [...expectedCommitted, ...Object.keys(COPIED_MODULES), ...GENERATED_MODULES].sort();
  assertBuild(same(built, expectedBuilt), `dist/ui/ (${built.join(", ")}) must hold exactly: ${expectedBuilt.join(", ")}`);

  for (const name of committed) {
    assertBuild(readFileSync(join(distUi, name)).equals(readFileSync(join(uiSrcDir, name))), `dist/ui/${name} is not a byte copy of site/assets/ui/${name}`);
  }
  for (const [name, source] of Object.entries(COPIED_MODULES)) {
    assertBuild(readFileSync(join(distUi, name)).equals(readFileSync(join(repoRoot, source))), `dist/ui/${name} is not a byte copy of ${source}`);
    assertBuild(!/^import\s/m.test(readFileSync(join(repoRoot, source), "utf8")), `${source} must stay browser-safe: no imports at all (vocabulary is injected)`);
  }

  // The import graph the browser will resolve: every relative import names
  // a module that shipped beside it.
  for (const name of built) {
    for (const [, specifier] of readFileSync(join(distUi, name), "utf8").matchAll(/from "\.\/([^"]+)"/g)) {
      assertBuild(built.includes(specifier), `dist/ui/${name} imports ./${specifier}, which did not ship in dist/ui/`);
    }
  }

  // Module tags per page: the shell pair on every page, page modules on
  // their page only, in that order and nothing else.
  for (const [name, html] of Object.entries(pages)) {
    const tags = [...html.matchAll(/<script type="module" src="\/ui\/([^"]+)"><\/script>/g)].map((m) => m[1]);
    const expected = [...SHELL_MODULES, ...(PAGE_MODULES[name] ?? [])];
    assertBuild(same(tags, expected), `${name}: module tags (${tags.join(", ")}) must be exactly: ${expected.join(", ")}`);
  }

  // Generated vocabulary: each export line must be exactly what the schemas
  // say, and the rails list must be the sorted registry.
  const enums = readFileSync(join(distUi, "registry-enums.js"), "utf8");
  for (const [name, value] of Object.entries(schemaVocabulary(repoRoot))) {
    assertBuild(enums.includes(`export const ${name} = ${JSON.stringify(value)};`), `dist/ui/registry-enums.js: ${name} does not match registry/schema/`);
  }
  const rails = [...interopSorted].sort((a, b) => a.slug.localeCompare(b.slug, "en")).map(({ slug, standard }) => ({ slug, standard }));
  assertBuild(enums.includes(`export const INTEROP_RAILS = ${JSON.stringify(rails)};`), "dist/ui/registry-enums.js: INTEROP_RAILS is not the sorted registry");
  assertBuild(enums.includes(`export const REPO_URL = ${JSON.stringify(repoUrl)};`), "dist/ui/registry-enums.js: REPO_URL drifted");

  // Guard lines: page-fx keeps its reduced-motion / js-anim guard and the
  // failsafe handshake; copy-prompt keeps the hidden-button reveal; the
  // entry builder and the badge preview reveal their hidden forms the same
  // way; the REVOKED walkthrough switch stays CSS-only (radios ahead of the
  // labels and the states, sibling rules in hub.css, no module).
  const pageFx = readFileSync(join(distUi, "page-fx.js"), "utf8");
  assertBuild(pageFx.includes("prefers-reduced-motion") && pageFx.includes("js-anim"), "page-fx.js lost its reduced-motion / js-anim guard");
  assertBuild(pageFx.includes("__pageFxInit"), "page-fx.js lost the failsafe handshake (__pageFxInit)");
  const copyPrompt = readFileSync(join(distUi, "copy-prompt.js"), "utf8");
  assertBuild(copyPrompt.includes("data-copy-target") && copyPrompt.includes("hidden = false"), "copy-prompt.js lost the hidden-button reveal wiring");
  const entryBuilder = readFileSync(join(distUi, "entry-builder.js"), "utf8");
  assertBuild(entryBuilder.includes("form.hidden = false") && entryBuilder.includes("builderEntryErrors("), "entry-builder.js lost the hidden-form reveal or the shared rule check");
  const badgePreview = readFileSync(join(distUi, "badge-preview.js"), "utf8");
  assertBuild(badgePreview.includes("form.hidden = false") && badgePreview.includes("claimWaveSeed("), "badge-preview.js lost the hidden-form reveal or the shared seed derivation");
  assertBuild(/<form id="badge-preview"[^>]*\bhidden\b/.test(pages["conformance/index.html"]), "the badge-preview form must ship hidden (no JS, the build-time lockup stands)");
  assertWalkthroughSwitch(pages["use-cases/index.html"], readFileSync(join(distDir, "hub.css"), "utf8"));
  const buildersHtml = pages["builders/index.html"];
  assertBuild(/<form id="entry-builder"[^>]*\bhidden\b/.test(buildersHtml), "the entry-builder form must ship hidden (no JS, no dead form)");
  assertBuild(buildersHtml.includes('<details class="disclosure">') && buildersHtml.includes('data-snippet="entry-preview"'), "the entry builder must keep its no-JS template fallback");
}

// The CSS-only switch contract: two radios named walk-state (BEFORE
// checked) come first inside .walk, ahead of the labels and both states,
// so the general-sibling rules in hub.css can reach them; each label is
// for its radio; nothing ships hidden; and hub.css carries the rules that
// hide the unchecked state and paint the checked label.
function assertWalkthroughSwitch(html, css) {
  const walk = html.slice(html.indexOf('<div class="walk" id="revoked-walkthrough">'), html.indexOf('<div class="uc-block">'));
  const before = walk.indexOf('<input type="radio" name="walk-state" id="walk-pick-before" aria-controls="walk-before" checked />');
  const after = walk.indexOf('<input type="radio" name="walk-state" id="walk-pick-after" aria-controls="walk-after" />');
  assertBuild(before !== -1 && after !== -1 && before < after, "the walkthrough must ship two walk-state radios, BEFORE first and checked");
  const switcher = walk.indexOf('<div class="walk-switch">');
  assertBuild(switcher !== -1 && after < switcher && switcher < walk.indexOf('id="walk-before"'), "the walkthrough radios must precede the switch labels and both states (sibling rules)");
  for (const name of ["before", "after"]) {
    assertBuild(walk.includes(`<label class="walk-btn" for="walk-pick-${name}">`), `the walkthrough switch lost its ${name} label`);
  }
  assertBuild(!/\bhidden\b/.test(walk.slice(0, walk.indexOf('id="walk-before"'))), "the walkthrough switch must not ship hidden (it is CSS-only, nothing reveals it)");
  for (const rule of ["#walk-pick-before:checked~#walk-after,#walk-pick-after:checked~#walk-before{display:none}", '#walk-pick-before:checked~.walk-head label[for="walk-pick-before"]', '#walk-pick-before:focus-visible~.walk-head label[for="walk-pick-before"]']) {
    assertBuild(css.includes(rule), `hub.css lost the CSS-only walkthrough switch rule: ${rule}`);
  }
}
