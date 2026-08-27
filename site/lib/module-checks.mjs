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
  "use-cases/index.html": ["revoked-console.js"],
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
  // way; the REVOKED console keeps its motion gate and its hidden-button
  // reveal; the REVOKED walkthrough switch stays CSS-only (radios ahead of
  // the labels and the states, sibling rules in hub.css, no module).
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
  const revokedConsole = readFileSync(join(distUi, "revoked-console.js"), "utf8");
  assertBuild(revokedConsole.includes("prefers-reduced-motion") && revokedConsole.includes("js-anim"), "revoked-console.js lost its reduced-motion / js-anim gate");
  assertBuild(revokedConsole.includes("button.hidden = false"), "revoked-console.js lost the hidden-button reveal");
  const hubCss = readFileSync(join(distDir, "hub.css"), "utf8");
  assertRevokedConsole(pages["use-cases/index.html"], hubCss);
  assertWalkthroughSwitch(pages["use-cases/index.html"], hubCss);
  const buildersHtml = pages["builders/index.html"];
  assertBuild(/<form id="entry-builder"[^>]*\bhidden\b/.test(buildersHtml), "the entry-builder form must ship hidden (no JS, no dead form)");
  assertBuild(buildersHtml.includes('<details class="disclosure">') && buildersHtml.includes('data-snippet="entry-preview"'), "the entry builder must keep its no-JS template fallback");
  assertEntryBuilderWiring(buildersHtml, entryBuilder, ruleCoreFields(repoRoot));
}

/**
 * The field names the rule core keys its messages with, scraped from the rule
 * core's own source so no list of them is restated here. Every call is
 * fail("<field>", ...) but for the shared slug-array helper, which takes its
 * field as an argument; both spellings are collected.
 */
function ruleCoreFields(repoRoot) {
  const source = readFileSync(join(repoRoot, "scripts", "lib", "builder-entry.mjs"), "utf8");
  const fields = new Set();
  for (const pattern of [/fail\(\s*"([\w-]+)"/g, /slugArrayErrors\([^,]+,\s*"([\w-]+)"/g]) {
    for (const [, field] of source.matchAll(pattern)) fields.add(field);
  }
  assertBuild(fields.size > 0, "scripts/lib/builder-entry.mjs: no error field names found - the rule core's fail() shape changed");
  return fields;
}

/**
 * The entry-builder form's wiring, read back off the page it ships on. Each
 * field must name its control (a `for` that resolves to a control in the same
 * field, or aria-labelledby for a group of controls, which has no single id to
 * point `for` at) and must key its error slot with a field the rule core
 * actually emits - otherwise the visitor's live messages miss the field
 * entirely and pile up in the catch-all beside the JSON preview. Both halves
 * have broken silently before, in opposite directions, when one field key was
 * renamed. The module must derive the touched-set key from these slots too,
 * so the mapping lives in one place.
 */
function assertEntryBuilderWiring(html, module, ruleFields) {
  const form = html.slice(html.indexOf('<form id="entry-builder"'), html.indexOf('<div class="eb-side">'));
  const fields = form.split('<div class="eb-field">').slice(1);
  assertBuild(fields.length > 0, "the entry-builder form rendered no fields");
  for (const field of fields) {
    const slots = [...field.matchAll(/data-err="([^"]+)"/g)].map((m) => m[1]);
    assertBuild(slots.length === 1, `an entry-builder field carries ${slots.length} error slots; each field needs exactly one`);
    assertBuild(
      ruleFields.has(slots[0]),
      `entry-builder slot data-err="${slots[0]}" is not a field the rule core keys errors with (${[...ruleFields].sort().join(", ")}), so its messages would fall through to the catch-all`,
    );
    const target = field.match(/<label class="eb-label" for="([^"]+)"/)?.[1];
    if (target !== undefined) {
      assertBuild(
        new RegExp(`<(?:input|select|textarea)[^>]*\\bid="${target}"`).test(field),
        `the entry-builder label for="${target}" names no control in its own field`,
      );
    } else {
      const labelId = field.match(/<span class="eb-label" id="([^"]+)"/)?.[1];
      assertBuild(
        labelId !== undefined && field.includes(`role="group" aria-labelledby="${labelId}"`),
        `entry-builder field ${slots[0]} labels neither a control (label for) nor a group (aria-labelledby)`,
      );
    }
  }
  assertBuild(html.includes('data-err="entry"'), "the entry builder lost the catch-all error slot beside the JSON preview");
  assertBuild(
    /closest\("\.eb-field"\)[\s\S]{0,120}data-err/.test(module),
    "entry-builder.js must read each control's error key off its own field slot, never restate the control-to-rule mapping",
  );
}

// The console's no-JS contract: it ships in its FINAL state (fc-killed on
// the root, nothing armed, no line lit) with the [ send payment ] button
// hidden, so no JS and reduced motion read the finished story; hub.css keeps
// the one hidden initial state gated (html.js-anim .fc-armed); and no
// keyframe is left behind by a deleted animation - every @keyframes name in
// hub.css is used by an animation declaration.
function assertRevokedConsole(html, css) {
  const start = html.indexOf('<div class="flag-console');
  assertBuild(start !== -1, "the use-cases page lost the REVOKED showcase console");
  const console_ = html.slice(start, html.indexOf('id="revoked-walkthrough"', start));
  assertBuild(console_.startsWith('<div class="flag-console fc-killed" id="revoked-console">'), "the REVOKED console must ship in its final state (fc-killed on the root)");
  assertBuild(!console_.includes("fc-armed") && !console_.includes('class="fc-line on"'), "the REVOKED console must not ship armed or lit (the module does that)");
  assertBuild(console_.includes('<button type="button" class="fc-btn" hidden>[ send payment ]</button>'), "the console's [ send payment ] button must ship hidden (no JS, no dead button)");
  assertBuild(css.includes("html.js-anim .fc-armed .fc-line{opacity:0"), "hub.css lost the gated armed-console rule");
  for (const [, name] of css.matchAll(/@keyframes\s+([\w-]+)/g)) {
    assertBuild(new RegExp(`animation(?:-name)?:[^;{}]*\\b${name}\\b`).test(css), `hub.css: @keyframes ${name} is declared but no animation uses it`);
  }
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
