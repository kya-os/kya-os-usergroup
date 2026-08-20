/**
 * Render checks: assert the built artifact is complete and honest, reading
 * the finished files back from dist/ rather than trusting the renderers.
 * Every page-level check runs on every page.
 *
 * The honesty rules these enforce are documented in lib/html.mjs, where they
 * are applied at render time. Two of the checks deliberately do NOT reuse
 * the shared formatters: the subset check reconstructs the expected label
 * inline and the certified check scans raw bytes, so a regression in the
 * formatter cannot make its own assertion pass. The CSP check recomputes the
 * script hash from the emitted page bytes for the same reason, and the font
 * and ui-module checks re-read the committed files rather than trusting the
 * copy step (the vendored modules additionally against the sha256 manifest
 * in site/assets/ui/VENDORED.md, so vendor drift fails the build).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATE_SLUG } from "./constants.mjs";
import { withConformance } from "./data.mjs";
import { esc } from "./html.mjs";

const PAGE_FILES = ["index.html", "builders/index.html", "conformance/index.html", "standards/index.html", "404.html"];
const FONT_FILES = ["fonts/space-grotesk-latin-wght.woff2", "fonts/jetbrains-mono-latin-wght.woff2"];
const FONT_LICENSES = ["fonts/space-grotesk-OFL.txt", "fonts/jetbrains-mono-OFL.txt"];

function assertBuild(condition, message) {
  if (!condition) {
    console.error(`Render check FAILED: ${message}`);
    process.exit(1);
  }
}

/**
 * Theme integrity: the token layer must be closed. Every page must carry
 * both theme branches (light default in :root, dark via prefers-color-scheme
 * plus the data-theme hooks the toggle drives), every var(--x) the CSS
 * references must be defined in a :root block, and no raw color may bypass
 * the token layer. `requireAllUsed` additionally rejects dead tokens - it is
 * asserted on the four content pages (which carry the full sheet), not on
 * 404.html, whose smaller page CSS legitimately leaves shared tokens untouched.
 */
function assertThemeIntegrity(name, html, { requireAllUsed = false } = {}) {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  assertBuild(styles.length > 0, `${name}: no <style> block found`);
  assertBuild(styles.includes("@media (prefers-color-scheme: dark)"), `${name}: the dark prefers-color-scheme branch is missing`);
  assertBuild(styles.includes(':root:not([data-theme="light"])'), `${name}: OS-dark must yield to a data-theme="light" override`);
  assertBuild(styles.includes(':root[data-theme="dark"]'), `${name}: the data-theme="dark" hook is missing`);

  const rootBlocks = [...styles.matchAll(/:root[^{}]*\{([^{}]*)\}/g)].map((m) => m[1]);
  const defined = new Set(rootBlocks.flatMap((body) => [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])));
  const referenced = new Set([...styles.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  for (const token of referenced) {
    assertBuild(defined.has(token), `${name}: var(${token}) is referenced but never defined in :root`);
  }
  if (requireAllUsed) {
    for (const token of defined) {
      assertBuild(referenced.has(token), `${name}: token ${token} is defined but never used`);
    }
  }
  const outsideTokens = styles.replace(/:root[^{}]*\{[^{}]*\}/g, "");
  const rawHex = outsideTokens.match(/#[0-9a-fA-F]{3,8}\b/);
  assertBuild(rawHex === null, `${name}: raw color ${rawHex?.[0]} bypasses the token layer (use var())`);
}

/**
 * The script contract, per page: exactly ONE inline script (the theme toggle
 * + js-anim pre-paint gate), byte-identical across pages, whose sha256 is
 * exactly the hash the _headers CSP allows - recomputed here from the page
 * bytes, never trusted from the build's own constants - plus the hub-init
 * module tag ('self' covers same-origin modules). All script tags sit in
 * <head> (the inline script's pre-paint halves must run before first
 * render), and the inline script must keep both the reduced-motion guard
 * and the js-anim gate.
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
  assertBuild(html.includes('id="theme-toggle"'), `${name}: the theme toggle button is missing`);
  assertBuild(
    html.includes('<script type="module" src="/ui/hub-init.js"></script>'),
    `${name}: the hub-init module tag is missing`,
  );
}

/**
 * Choreography safety, per page: any hidden initial state (opacity:0) must be
 * gated under an html.js-anim selector - EVERY selector of the rule's list,
 * the page-transition overlay rules included - so no JS, blocked JS, or
 * reduced motion always yields a fully visible page. Keyframe frames (from /
 * to / percentages) are exempt: they apply only while an animation runs on
 * an already-gated element, never as an initial state. Every page must
 * actually carry the gated motion rules (the check is never vacuous).
 */
function assertAnimGating(name, html) {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  for (const rule of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rule[2].includes("opacity:0")) continue;
    for (const selector of rule[1].split(",")) {
      const sel = selector.trim();
      if (/^(from|to|[\d.]+%)$/.test(sel)) continue;
      assertBuild(
        sel.includes("html.js-anim"),
        `${name}: hidden initial state "${selector.trim()}" is not gated under html.js-anim`,
      );
    }
  }
  assertBuild(styles.includes("html.js-anim"), `${name}: the html.js-anim motion CSS is missing`);
}

/** Verify every dist/ artifact against the shaped registry data; exits non-zero on the first failure. */
export function runRenderChecks({ distDir, rendered, interopSorted }) {
  const conformanceEntries = withConformance(rendered);

  for (const name of [...PAGE_FILES, "builders.json", "interop.json", "_headers", ...FONT_FILES, ...FONT_LICENSES]) {
    const path = join(distDir, name);
    assertBuild(statSync(path).size > 0, `dist/${name} is missing or empty`);
  }
  const pages = Object.fromEntries(PAGE_FILES.map((name) => [name, readFileSync(join(distDir, name), "utf8")]));
  const headers = readFileSync(join(distDir, "_headers"), "utf8");

  // The CSP must be exactly 'self' (the same-origin /ui/ modules) plus ONE
  // script hash (the theme script) - nothing else in script-src - plus
  // self-hosted fonts; every page's inline script must hash to it.
  const scriptSrc = headers.match(/script-src ([^;]+);/)?.[1] ?? "";
  const cspHashes = [...scriptSrc.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map((m) => m[1]);
  assertBuild(cspHashes.length === 1, `_headers must pin exactly one script-src hash, found ${cspHashes.length}`);
  assertBuild(scriptSrc.trim() === `'self' 'sha256-${cspHashes[0]}'`, "script-src must be exactly 'self' plus the theme script hash");
  assertBuild(headers.includes("font-src 'self'"), "the CSP must allow the self-hosted fonts via font-src 'self'");
  const referenceScript = pages["index.html"].match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  for (const [name, html] of Object.entries(pages)) {
    assertPageScripts(name, html, cspHashes[0], referenceScript);
    assertAnimGating(name, html);
  }

  // Motion modules: dist/ui/*.js must be exact byte copies of the committed
  // site/assets/ui/*.js (both directions - same file set), every vendored
  // module must match its sha256 in VENDORED.md (vendor drift fails the
  // build; update = re-copy from source, never edit in place), and hub-init
  // must keep its reduced-motion / js-anim guard.
  const uiSrcDir = join(distDir, "..", "site", "assets", "ui");
  const uiCommitted = readdirSync(uiSrcDir).filter((n) => n.endsWith(".js")).sort();
  const uiBuilt = readdirSync(join(distDir, "ui")).sort();
  assertBuild(uiBuilt.join(",") === uiCommitted.join(","), `dist/ui/ (${uiBuilt.join(", ")}) must mirror site/assets/ui/*.js (${uiCommitted.join(", ")})`);
  for (const name of uiCommitted) {
    const built = readFileSync(join(distDir, "ui", name));
    assertBuild(built.equals(readFileSync(join(uiSrcDir, name))), `dist/ui/${name} is not a byte copy of site/assets/ui/${name}`);
  }
  const manifest = readFileSync(join(uiSrcDir, "VENDORED.md"), "utf8");
  const vendored = [...manifest.matchAll(/\|\s*([\w.]+\.js)\s*\|\s*`([0-9a-f]{64})`\s*\|/g)];
  assertBuild(vendored.length === 5, `VENDORED.md must pin exactly the five vendored modules, found ${vendored.length}`);
  for (const [, name, expected] of vendored) {
    const actual = createHash("sha256").update(readFileSync(join(uiSrcDir, name))).digest("hex");
    assertBuild(actual === expected, `vendor drift: ${name} sha256 ${actual} does not match VENDORED.md (re-copy from kya-os-site, never edit in place)`);
  }
  const hubInit = readFileSync(join(distDir, "ui", "hub-init.js"), "utf8");
  assertBuild(
    hubInit.includes("prefers-reduced-motion") && hubInit.includes("js-anim"),
    "hub-init.js lost its reduced-motion / js-anim guard",
  );

  // Fonts: dist/fonts/ must be exact byte copies of the committed binaries,
  // and each binary must really be woff2 (leading wOF2 magic). Every page
  // must declare both brand faces.
  for (const name of FONT_FILES) {
    const built = readFileSync(join(distDir, name));
    const committed = readFileSync(join(distDir, "..", "site", "assets", name));
    assertBuild(built.equals(committed), `dist/${name} is not a byte copy of site/assets/${name}`);
    assertBuild(built.subarray(0, 4).toString("latin1") === "wOF2", `dist/${name} does not carry the woff2 magic bytes`);
  }
  for (const [name, html] of Object.entries(pages)) {
    for (const family of ["Space Grotesk", "JetBrains Mono"]) {
      assertBuild(html.includes(`@font-face{font-family:"${family}"`), `${name}: the @font-face for ${family} is missing`);
    }
  }

  // Honesty assertions, on EVERY page.
  // "Certificate Transparency" (RFC 9162) is a standard's proper name and is
  // fine; conformance-flavored "certified"/"certification" language is not.
  for (const [name, html] of Object.entries(pages)) {
    assertBuild(!/certified|certification/i.test(html), `the word "certified"/"certification" leaked into ${name}`);
    // A green "verified" chip exists only as a credential link: no anchor-less occurrence.
    assertBuild(!/<span class="chip st-verified(?! demo)/.test(html), `a "verified" chip rendered without a credential link in ${name}`);
  }

  // Completeness: the directory lists every entry, the matrix every rail.
  const buildersHtml = pages["builders/index.html"];
  const standardsHtml = pages["standards/index.html"];
  for (const entry of rendered) {
    assertBuild(buildersHtml.includes(esc(entry.name)), `dist/builders/index.html does not list "${entry.name}"`);
  }
  for (const entry of interopSorted) {
    assertBuild(standardsHtml.includes(`id="std-${entry.slug}"`), `dist/standards/index.html does not list standard "${entry.slug}"`);
  }
  // Every standards row shows its listing date - freshness is auditable on-page.
  assertBuild(
    (standardsHtml.match(/class="row-listed/g) ?? []).length === interopSorted.length,
    "every interop row must render its listedAt date",
  );

  // Claim honesty on both pages that render claims (cards and the table).
  for (const html of [buildersHtml, pages["conformance/index.html"]]) {
    for (const entry of conformanceEntries) {
      const c = entry.conformance;
      if (c.scope === "subset") {
        assertBuild(
          html.includes(esc(`${c.level} subset (${c.categories.join(", ")})`)),
          `subset claim for "${entry.slug}" must render with its categories, never as a bare level`,
        );
      }
      // Non-verified claims that carry public evidence must render it (the chip is the link).
      if (c.status !== "verified" && c.evidenceUrl) {
        assertBuild(html.includes(`href="${esc(c.evidenceUrl)}"`), `evidenceUrl for "${entry.slug}" did not render`);
      }
    }
  }

  // The landing stays calm: live counts, no tables.
  const landingHtml = pages["index.html"];
  assertBuild(landingHtml.includes(`<b>${rendered.length}</b>`), "the landing page must show the live entry count");
  assertBuild(landingHtml.includes(`<b>${interopSorted.length}</b>`), "the landing page must show the live rails count");
  assertBuild(!landingHtml.includes("<table"), "no tables on the landing page");

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
  assertBuild(notFoundHtml.includes("404"), "dist/404.html is not a not-found page");
  for (const path of ['href="/"', 'href="/builders/"', 'href="/conformance/"', 'href="/standards/"']) {
    assertBuild(notFoundHtml.includes(path), `dist/404.html must link ${path.slice(6, -1)}`);
  }

  // Theme assertions: every page ships both themes and a closed token layer.
  for (const [name, html] of Object.entries(pages)) {
    assertThemeIntegrity(name, html, { requireAllUsed: name !== "404.html" });
  }
}
