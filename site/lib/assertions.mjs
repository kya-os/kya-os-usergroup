/**
 * Render checks: assert the built artifact is complete and honest, reading
 * the finished files back from dist/ rather than trusting the renderers.
 * Every page-level check runs on every page.
 *
 * The honesty rules these enforce are documented in lib/html.mjs, where they
 * are applied at render time. Several checks deliberately do NOT reuse the
 * shared formatters: the subset check reconstructs the expected label inline
 * and the certified check scans raw bytes, so a regression in a formatter
 * cannot make its own assertion pass. The CSP check recomputes the script
 * hash from the emitted page bytes for the same reason; the font, mark, and
 * ui-module checks re-read the committed files rather than trusting the copy
 * step; the prompt-parity check re-extracts button/fallback pairs from the
 * page bytes and matches them against lib/constants.mjs. The theme, gating,
 * prompt-parity, and suite-pin checks live in lib/checks.mjs (split to keep
 * both files under the lib LOC cap) and run from here.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SUITE, TEMPLATE_SLUG } from "./constants.mjs";
import { withConformance } from "./data.mjs";
import { esc } from "./html.mjs";
import { assertAnimGating, assertBuild, assertPromptParity, assertSuitePinAgreement, assertThemeIntegrity } from "./checks.mjs";
import { THEME_COLORS } from "./theme.mjs";

const PAGE_FILES = [
  "index.html",
  "builders/index.html",
  "conformance/index.html",
  "standards/index.html",
  "rails/index.html",
  "use-cases/index.html",
  "404.html",
];
const FONT_FILES = ["fonts/space-grotesk-latin-wght.woff2", "fonts/jetbrains-mono-latin-wght.woff2"];
const FONT_LICENSES = ["fonts/space-grotesk-OFL.txt", "fonts/jetbrains-mono-OFL.txt"];
const MARK_FILES = ["img/kya-mark-white.svg", "img/kya-mark-black.svg"];
const CSS_FILES = ["tokens.css", "hub.css"];
const UI_FILES = ["copy-prompt.js", "page-fx.js"];

/**
 * The script and style contract, per page: exactly ONE inline script (the
 * theme toggle + js-anim pre-paint gate + page-fx failsafe), byte-identical
 * across pages, whose sha256 is exactly the hash the _headers CSP allows -
 * recomputed from the page bytes, never trusted from the build's own
 * constants - plus the two module tags; all script tags in <head>,
 * reduced-motion guard, js-anim gate, and failsafe intact. Styles are the
 * mirror image: style-src is 'self', so every page must link both
 * same-origin stylesheets and carry NO <style> block and NO style attribute
 * anywhere (the build-time waveforms use SVG presentation attributes only).
 */
function assertPageScripts(name, html, themeHash, referenceScript) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assertBuild(scripts.length === 1, `${name}: expected exactly one inline script, found ${scripts.length}`);
  const headEnd = html.indexOf("</head>");
  assertBuild(headEnd !== -1 && html.lastIndexOf("<script") < headEnd, `${name}: every script tag must sit in <head>, before paint`);
  assertBuild(scripts[0] === referenceScript, `${name}: the theme script drifted from the other pages' bytes`);
  const hash = createHash("sha256").update(scripts[0], "utf8").digest("base64");
  assertBuild(hash === themeHash, `${name}: theme script sha256 ${hash} does not match the CSP allowance ${themeHash}`);
  assertBuild(scripts[0].includes("prefers-reduced-motion"), `${name}: the theme script lost its reduced-motion guard`);
  assertBuild(scripts[0].includes('classList.add("js-anim")'), `${name}: the theme script lost the js-anim pre-paint gate`);
  assertBuild(scripts[0].includes("__pageFxInit"), `${name}: the theme script lost the 2.5s page-fx failsafe`);
  assertBuild(scripts[0].includes("data-theme"), `${name}: the theme script no longer drives data-theme`);
  assertBuild(html.includes('id="theme-toggle"'), `${name}: the theme toggle button is missing`);
  for (const module of UI_FILES) {
    assertBuild(
      html.includes(`<script type="module" src="/ui/${module}"></script>`),
      `${name}: the /ui/${module} module tag is missing`,
    );
  }
  for (const href of ["/tokens.css", "/hub.css"]) {
    assertBuild(html.includes(`<link rel="stylesheet" href="${href}" />`), `${name}: the ${href} stylesheet link is missing`);
  }
  assertBuild(!/<style[\s>]/.test(html), `${name}: inline <style> blocks are banned under style-src 'self'`);
  assertBuild(!/\sstyle="/.test(html), `${name}: inline style attributes are banned under style-src 'self'`);
  for (const [scheme, color] of Object.entries(THEME_COLORS)) {
    assertBuild(
      html.includes(`media="(prefers-color-scheme: ${scheme})" content="${color}"`),
      `${name}: the ${scheme} theme-color meta drifted from THEME_COLORS`,
    );
  }
}

/** Verify every dist/ artifact against the shaped registry data; exits non-zero on the first failure. */
export function runRenderChecks({ distDir, rendered, interopSorted }) {
  assertSuitePinAgreement(join(distDir, ".."));
  const conformanceEntries = withConformance(rendered);

  for (const name of [...PAGE_FILES, "builders.json", "interop.json", "_headers", ...FONT_FILES, ...FONT_LICENSES, ...MARK_FILES, ...CSS_FILES]) {
    const path = join(distDir, name);
    assertBuild(statSync(path).size > 0, `dist/${name} is missing or empty`);
  }
  const pages = Object.fromEntries(PAGE_FILES.map((name) => [name, readFileSync(join(distDir, name), "utf8")]));
  const headers = readFileSync(join(distDir, "_headers"), "utf8");

  // Stylesheets: each dist copy must be exactly the committed source with
  // comments and leading indentation stripped (the transform recomputed
  // here, never trusted from the build), the emitted pair must stay inside
  // the size budget, and theme integrity plus motion gating run on the dist
  // bytes - what actually ships.
  const stripCss = (css) =>
    css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n[ \t]+/g, "\n").replace(/\n{2,}/g, "\n").replace(/^\n/, "");
  const sheets = Object.fromEntries(CSS_FILES.map((name) => [name, readFileSync(join(distDir, name), "utf8")]));
  for (const name of CSS_FILES) {
    const committed = readFileSync(join(distDir, "..", "site", "assets", "css", name), "utf8");
    assertBuild(sheets[name] === stripCss(committed), `dist/${name} is not the comment-stripped copy of site/assets/css/${name}`);
  }
  // Budget raised 25KB -> 32KB with the Builders Site design swap: six pages
  // of layout (directory grid + CSS-only filter, rails diagrams, badge
  // lockups) ship ~28KB; the ceiling still catches runaway growth.
  const cssBytes = CSS_FILES.reduce((sum, name) => sum + Buffer.byteLength(sheets[name]), 0);
  assertBuild(cssBytes <= 32 * 1024, `emitted CSS is ${cssBytes} bytes; the budget is 32KB total`);
  assertThemeIntegrity(sheets);
  assertAnimGating(sheets);

  // The CSP must be exactly 'self' (the same-origin /ui/ modules) plus ONE
  // script hash (the theme script) - nothing else in script-src - style-src
  // exactly 'self' (all CSS is the two same-origin stylesheets), img-src
  // exactly 'self' (the logo marks; nothing external, no data:), plus
  // self-hosted fonts; every page's inline script must hash to it.
  const scriptSrc = headers.match(/script-src ([^;]+);/)?.[1] ?? "";
  const cspHashes = [...scriptSrc.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map((m) => m[1]);
  assertBuild(cspHashes.length === 1, `_headers must pin exactly one script-src hash, found ${cspHashes.length}`);
  assertBuild(scriptSrc.trim() === `'self' 'sha256-${cspHashes[0]}'`, "script-src must be exactly 'self' plus the theme script hash");
  assertBuild((headers.match(/style-src ([^;]+);/)?.[1] ?? "").trim() === "'self'", "style-src must be exactly 'self'");
  assertBuild((headers.match(/img-src ([^;]+);/)?.[1] ?? "").trim() === "'self'", "img-src must be exactly 'self'");
  assertBuild(headers.includes("font-src 'self'"), "the CSP must allow the self-hosted fonts via font-src 'self'");
  const referenceScript = pages["index.html"].match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  for (const [name, html] of Object.entries(pages)) {
    assertPageScripts(name, html, cspHashes[0], referenceScript);
  }
  assertPromptParity(pages);

  // Client modules: dist/ui/*.js must be exact byte copies of the committed
  // site/assets/ui/*.js (both directions - same file set), page-fx must keep
  // its reduced-motion / js-anim guard and the failsafe handshake, and
  // copy-prompt must keep the hidden-button reveal (the no-JS contract).
  const uiSrcDir = join(distDir, "..", "site", "assets", "ui");
  const uiCommitted = readdirSync(uiSrcDir, { recursive: true }).map(String).filter((n) => n.endsWith(".js")).sort();
  const uiBuilt = readdirSync(join(distDir, "ui"), { recursive: true }).map(String).filter((n) => n.endsWith(".js")).sort();
  assertBuild(uiBuilt.join(",") === UI_FILES.join(","), `dist/ui/ (${uiBuilt.join(", ")}) must hold exactly: ${UI_FILES.join(", ")}`);
  assertBuild(uiCommitted.join(",") === UI_FILES.join(","), `site/assets/ui/ (${uiCommitted.join(", ")}) must hold exactly: ${UI_FILES.join(", ")}`);
  for (const name of uiCommitted) {
    const built = readFileSync(join(distDir, "ui", name));
    assertBuild(built.equals(readFileSync(join(uiSrcDir, name))), `dist/ui/${name} is not a byte copy of site/assets/ui/${name}`);
  }
  const pageFx = readFileSync(join(distDir, "ui", "page-fx.js"), "utf8");
  assertBuild(
    pageFx.includes("prefers-reduced-motion") && pageFx.includes("js-anim"),
    "page-fx.js lost its reduced-motion / js-anim guard",
  );
  assertBuild(pageFx.includes("__pageFxInit"), "page-fx.js lost the failsafe handshake (__pageFxInit)");
  const copyPrompt = readFileSync(join(distDir, "ui", "copy-prompt.js"), "utf8");
  assertBuild(
    copyPrompt.includes("data-copy-target") && copyPrompt.includes("hidden = false"),
    "copy-prompt.js lost the hidden-button reveal wiring",
  );

  // Fonts and marks: dist copies must be exact byte copies of the committed
  // sources, each font must really be woff2 (leading wOF2 magic), and the
  // hub stylesheet must declare both brand faces.
  for (const name of [...FONT_FILES, ...MARK_FILES]) {
    const built = readFileSync(join(distDir, name));
    const committed = readFileSync(join(distDir, "..", "site", "assets", name));
    assertBuild(built.equals(committed), `dist/${name} is not a byte copy of site/assets/${name}`);
  }
  for (const name of FONT_FILES) {
    const built = readFileSync(join(distDir, name));
    assertBuild(built.subarray(0, 4).toString("latin1") === "wOF2", `dist/${name} does not carry the woff2 magic bytes`);
  }
  for (const family of ["Space Grotesk", "JetBrains Mono"]) {
    assertBuild(sheets["hub.css"].includes(`@font-face{font-family:"${family}"`), `hub.css: the @font-face for ${family} is missing`);
  }

  // Honesty assertions, on EVERY page.
  // "Certificate Transparency" (RFC 9162) is a standard's proper name and is
  // fine; conformance-flavored "certified"/"certification" language is not.
  for (const [name, html] of Object.entries(pages)) {
    assertBuild(!/certified|certification/i.test(html), `the word "certified"/"certification" leaked into ${name}`);
    // A green "verified" chip exists only as a credential link (the .demo
    // state-machine samples on the conformance page are the one labeled
    // exception): every non-demo st-verified chip must sit inside a
    // .chip-link anchor.
    for (const match of html.matchAll(/<(a|span)[^>]*class="[^"]*\bst-verified\b[^"]*"[^>]*>/g)) {
      if (match[0].includes("demo")) continue;
      const before = html.slice(Math.max(0, match.index - 120), match.index);
      assertBuild(
        /<a class="chip-link" href="[^"]+">$/.test(before),
        `a "verified" chip rendered without a credential link in ${name}`,
      );
    }
  }

  // Completeness: the directory lists every entry (with its anchor id), the
  // matrix every rail; every standards row shows its listedAt date so
  // freshness is auditable on-page.
  const buildersHtml = pages["builders/index.html"];
  const standardsHtml = pages["standards/index.html"];
  for (const entry of rendered) {
    assertBuild(buildersHtml.includes(esc(entry.name)), `dist/builders/index.html does not list "${entry.name}"`);
    assertBuild(buildersHtml.includes(`id="${esc(entry.slug)}"`), `dist/builders/index.html has no anchor for "${entry.slug}"`);
  }
  for (const entry of interopSorted) {
    assertBuild(standardsHtml.includes(`id="std-${entry.slug}"`), `dist/standards/index.html does not list standard "${entry.slug}"`);
    assertBuild(
      standardsHtml.includes(`<span class="slisted">${esc(entry.listedAt)}</span>`),
      `dist/standards/index.html does not date standard "${entry.slug}" (${entry.listedAt})`,
    );
  }

  // Claim honesty on both pages that render claims (directory rows and the
  // implementations table).
  for (const html of [buildersHtml, pages["conformance/index.html"]]) {
    for (const entry of conformanceEntries) {
      const c = entry.conformance;
      if (c.scope === "subset") {
        assertBuild(
          html.includes(esc(`${c.level} subset (${c.categories.join(", ")})`)),
          `subset claim for "${entry.slug}" must render with its categories, never as a bare level`,
        );
      }
      // Non-verified claims that carry public evidence must render it.
      if (c.status !== "verified" && c.evidenceUrl) {
        assertBuild(html.includes(`href="${esc(c.evidenceUrl)}"`), `evidenceUrl for "${entry.slug}" did not render`);
      }
    }
  }
  // The implementations table lists every claim.
  for (const entry of conformanceEntries) {
    assertBuild(
      pages["conformance/index.html"].includes(`href="/builders/#${esc(entry.slug)}"`),
      `dist/conformance/index.html does not list the "${entry.slug}" claim`,
    );
  }

  // Readout truth: every count the pages show must be the live registry
  // number (recomputed here from the shaped data, never from a formatter) -
  // the home stats strip, the directory filter counts, the rails page's
  // matrix pointer, and the suite pin strip. No tables anywhere: the design
  // renders rows as grids.
  const landingHtml = pages["index.html"];
  assertBuild(landingHtml.includes(`<b>${rendered.length}</b> projects listed`), "the home stats strip must show the live entry count");
  assertBuild(landingHtml.includes(`<b>${interopSorted.length}</b> standards mapped`), "the home stats strip must show the live rails count");
  assertBuild(landingHtml.includes(`suite <b>${esc(SUITE.version)}</b>`), "the home stats strip must show the pinned suite version");
  assertBuild(landingHtml.includes(`<b>${SUITE.vectors}</b> vectors`), "the home stats strip must show the pinned vector count");
  assertBuild(
    landingHtml.includes(`${interopSorted.length} rows, each grounded in evidence and dated`),
    "the home standards card must carry the live rails count",
  );
  assertBuild(!landingHtml.includes("<table"), "no tables on the landing page");
  assertBuild(
    buildersHtml.includes(`>all ${rendered.length}</label>`),
    "the directory filter strip must show the live all-count",
  );
  assertBuild(
    pages["rails/index.html"].includes(`see all ${interopSorted.length} standards rows, with evidence -&gt;`),
    "the rails page must point at the live standards-row count",
  );
  const pin = pages["conformance/index.html"];
  assertBuild(
    pin.includes(`suite <b>${esc(SUITE.version)}</b>`) && pin.includes(`<b>${SUITE.vectors}</b> vectors`) && pin.includes(esc(SUITE.vectorSetHash)),
    "the conformance pin strip must carry the full SUITE pin",
  );

  const published = JSON.parse(readFileSync(join(distDir, "builders.json"), "utf8"));
  assertBuild(published.count === rendered.length, "builders.json count mismatch");
  assertBuild(
    !published.builders.some((entry) => entry.slug === TEMPLATE_SLUG),
    `template entry "${TEMPLATE_SLUG}" leaked into builders.json`,
  );
  assertBuild(!buildersHtml.includes(`id="${TEMPLATE_SLUG}"`), `template entry "${TEMPLATE_SLUG}" leaked into builders/index.html`);
  const publishedInterop = JSON.parse(readFileSync(join(distDir, "interop.json"), "utf8"));
  assertBuild(publishedInterop.count === interopSorted.length, "interop.json count mismatch");

  // The 404 page really is one, and it hands the reader every page.
  const notFoundHtml = pages["404.html"];
  assertBuild(notFoundHtml.includes("NOT FOUND"), "dist/404.html is not a not-found page");
  for (const path of ["/", "/builders/", "/conformance/", "/standards/", "/rails/", "/use-cases/"]) {
    assertBuild(notFoundHtml.includes(`href="${path}"`), `dist/404.html must link ${path}`);
  }
}
