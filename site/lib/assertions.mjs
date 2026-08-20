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
 * copy step (the registry-managed motion modules additionally against the
 * sha256 pins in MOTION_PINS below, so drift fails the build). The suite
 * pin check reads every committed copy of the pin as bytes and asserts
 * agreement with SUITE in lib/constants.mjs, so no copy can drift silently.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SUITE, TEMPLATE_SLUG } from "./constants.mjs";
import { withConformance } from "./data.mjs";
import { esc } from "./html.mjs";

const PAGE_FILES = ["index.html", "builders/index.html", "conformance/index.html", "standards/index.html", "404.html"];
const FONT_FILES = ["fonts/space-grotesk-latin-wght.woff2", "fonts/jetbrains-mono-latin-wght.woff2"];
const FONT_LICENSES = ["fonts/space-grotesk-OFL.txt", "fonts/jetbrains-mono-OFL.txt"];
const CSS_FILES = ["aliencn.css", "hub.css"];

// The @kya-os/aliencn motion family under site/assets/ui/motion/, pinned by
// sha256 so CI stays self-contained (it never runs the CLI). `aliencn diff
// motion` (see aliencn.json) is the drift gate against the registry itself;
// update = re-add via the CLI, never edit in place.
const MOTION_PINS = {
  "GlitchText.js": "7ddc58770d7677de9c38b3bd096f6d7103e366e5d1f532eba36569436248a81c",
  "PageTransition.js": "179e109bdacf6a24c52fc412b75676fbe997b635ead940de1b5a280fec992e7a",
  "SmoothScroll.js": "27179c8ffd18a87dc9ed4781d3b858a4be8686dc3e97b23beb0e61e87fbdc93b",
  "Title.js": "3fbfc6d1375a17f4015fc714deab9edc483f89161a6aec7ecce155f117ec1338",
  "UIUtils.js": "eb03cfa3bd58c0f8075c7c37a7e8249676f202c1ea68defe2400a57c32380f10",
};

function assertBuild(condition, message) {
  if (!condition) {
    console.error(`Render check FAILED: ${message}`);
    process.exit(1);
  }
}

/**
 * Theme integrity, on the stylesheets: the @kya-os/aliencn token layer must
 * be closed and dark-first with a complete light side - the dark :root
 * block, the OS-preference light branch (guarded so an explicit dark
 * override wins), and the :root[data-aliencn-theme="light"] hook the toggle
 * drives, with the two light blocks token-for-token identical (the
 * stylesheet equivalent of the old single-template-string guarantee). Every
 * var(--x) referenced must be defined, every :root token must be used, and
 * no raw hex may bypass the token layer outside the token blocks.
 */
function assertThemeIntegrity(sheets) {
  const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const aliencn = stripComments(sheets["aliencn.css"]);
  const combined = Object.values(sheets).map(stripComments).join("\n");
  assertBuild(aliencn.includes("@media (prefers-color-scheme: light)"), "aliencn.css: the light prefers-color-scheme branch is missing");
  assertBuild(aliencn.includes(':root:not([data-aliencn-theme="dark"])'), 'aliencn.css: OS-light must yield to a data-aliencn-theme="dark" override');
  assertBuild(aliencn.includes(':root[data-aliencn-theme="light"]'), 'aliencn.css: the data-aliencn-theme="light" hook is missing');

  const rootBlocks = [...aliencn.matchAll(/:root[^{}]*\{([^{}]*)\}/g)].map((m) => m[1]);
  assertBuild(rootBlocks.length === 3, `aliencn.css: expected exactly three token blocks (dark, OS-light, explicit light), found ${rootBlocks.length}`);
  const declarations = (body) => [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, key, value]) => `${key}:${value.trim()}`).join(";");
  assertBuild(declarations(rootBlocks[1]) === declarations(rootBlocks[2]), "aliencn.css: the OS-light and explicit-light token blocks drifted apart");

  const rootDefined = new Set(rootBlocks.flatMap((body) => [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])));
  const anyDefined = new Set([...combined.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const referenced = new Set([...combined.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  for (const token of referenced) {
    assertBuild(anyDefined.has(token), `stylesheets: var(${token}) is referenced but never defined`);
  }
  for (const token of rootDefined) {
    assertBuild(referenced.has(token), `aliencn.css: token ${token} is defined but never used`);
  }
  const outsideTokens = combined.replace(/:root[^{}]*\{[^{}]*\}/g, "");
  const rawHex = outsideTokens.match(/#[0-9a-fA-F]{3,8}\b/);
  assertBuild(rawHex === null, `stylesheets: raw color ${rawHex?.[0]} bypasses the token layer (use var())`);
}

/**
 * The script and style contract, per page: exactly ONE inline script (the
 * theme toggle + js-anim pre-paint gate), byte-identical across pages, whose
 * sha256 is exactly the hash the _headers CSP allows - recomputed from the
 * page bytes, never trusted from the build's own constants - plus the
 * hub-init module tag; all script tags in <head>, reduced-motion guard and
 * js-anim gate intact. Styles are the mirror image: style-src is 'self', so
 * every page must link both same-origin stylesheets and carry NO <style>
 * block and NO style attribute anywhere.
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
  assertBuild(scripts[0].includes("data-aliencn-theme"), `${name}: the theme script no longer drives data-aliencn-theme`);
  assertBuild(html.includes('id="theme-toggle"'), `${name}: the theme toggle button is missing`);
  assertBuild(
    html.includes('<script type="module" src="/ui/hub-init.js"></script>'),
    `${name}: the hub-init module tag is missing`,
  );
  for (const href of ["/aliencn.css", "/hub.css"]) {
    assertBuild(html.includes(`<link rel="stylesheet" href="${href}" />`), `${name}: the ${href} stylesheet link is missing`);
  }
  assertBuild(!/<style[\s>]/.test(html), `${name}: inline <style> blocks are banned under style-src 'self'`);
  assertBuild(!/\sstyle="/.test(html), `${name}: inline style attributes are banned under style-src 'self'`);
}

/**
 * Choreography safety, on the stylesheets: any hidden initial state
 * (opacity:0) must be gated under an html.js-anim selector - EVERY selector
 * of the rule's list, overlay rules included - so no JS, blocked JS, or
 * reduced motion always yields a fully visible page. Keyframe frames are
 * exempt (they apply only mid-animation, never as an initial state), and
 * the gated motion rules must actually be present (never vacuous).
 */
function assertAnimGating(sheets) {
  const styles = Object.values(sheets).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/opacity:\s*0[;}\s]|opacity:\s*0$/.test(rule[2])) continue;
    for (const selector of rule[1].split(",")) {
      const sel = selector.trim();
      if (/^(from|to|[\d.]+%(\s*,\s*[\d.]+%)*)$/.test(sel)) continue;
      assertBuild(
        sel.includes("html.js-anim"),
        `stylesheets: hidden initial state "${sel}" is not gated under html.js-anim`,
      );
    }
  }
  assertBuild(styles.includes("html.js-anim"), "stylesheets: the html.js-anim motion CSS is missing");
}

/**
 * Suite pin agreement: the suite pin (version, vector count, vector-set
 * hash) is committed in several places that deliberately cannot import each
 * other - the starter must stay standalone-copyable and the badge fixtures
 * are committed artifacts. The build is the one place that sees them all, so
 * it reads every OTHER copy as bytes and asserts agreement with SUITE in
 * lib/constants.mjs; a drifted copy fails the build naming its file.
 */
function assertSuitePinAgreement(repoRoot) {
  const read = (path) => readFileSync(join(repoRoot, path), "utf8");

  const fetchSuitePath = "conformance/starter/scripts/fetch-suite.mjs";
  const fetchSuite = read(fetchSuitePath);
  const expectedHash = fetchSuite.match(/const EXPECTED_VECTOR_SET_HASH =\s*'([^']+)'/)?.[1];
  assertBuild(
    expectedHash === SUITE.vectorSetHash,
    `${fetchSuitePath}: EXPECTED_VECTOR_SET_HASH (${expectedHash}) does not match SUITE.vectorSetHash`,
  );
  assertBuild(
    /const PINNED_COMMIT = '[0-9a-f]{40}';/.test(fetchSuite),
    `${fetchSuitePath}: PINNED_COMMIT (a 40-hex commit SHA) is missing - the harness must be fetched at a commit, not a tag`,
  );

  const programReadme = "conformance/README.md";
  assertBuild(read(programReadme).includes(SUITE.vectorSetHash), `${programReadme}: the vector-set hash does not match SUITE.vectorSetHash`);
  assertBuild(
    read(programReadme).includes(`suite \`${SUITE.version}\`, ${SUITE.vectors} vectors`),
    `${programReadme}: the suite version / vector count line does not match SUITE (${SUITE.version}, ${SUITE.vectors} vectors)`,
  );

  const starterReadme = "conformance/starter/README.md";
  assertBuild(read(starterReadme).includes(SUITE.vectorSetHash), `${starterReadme}: the vector-set hash does not match SUITE.vectorSetHash`);
  assertBuild(
    read(starterReadme).includes(`(${SUITE.vectors} vectors)`),
    `${starterReadme}: the vector count does not match SUITE.vectors (${SUITE.vectors})`,
  );

  const generatorPath = "workers/badge/fixtures/generate-fixtures.mjs";
  const generator = read(generatorPath);
  assertBuild(generator.includes(`suiteVersion: "${SUITE.version}"`), `${generatorPath}: suiteVersion does not match SUITE.version (${SUITE.version})`);
  assertBuild(generator.includes(`vectorSetHash: "${SUITE.vectorSetHash}"`), `${generatorPath}: vectorSetHash does not match SUITE.vectorSetHash`);

  for (const path of ["workers/badge/fixtures/dev-manifest.json", "workers/badge/fixtures/dev-credential.json"]) {
    const parsed = JSON.parse(read(path));
    const pin = parsed.credentialSubject?.suite ?? parsed;
    assertBuild(pin.suiteVersion === SUITE.version, `${path}: suiteVersion (${pin.suiteVersion}) does not match SUITE.version (${SUITE.version})`);
    assertBuild(pin.vectorSetHash === SUITE.vectorSetHash, `${path}: vectorSetHash (${pin.vectorSetHash}) does not match SUITE.vectorSetHash`);
  }
}

/** Verify every dist/ artifact against the shaped registry data; exits non-zero on the first failure. */
export function runRenderChecks({ distDir, rendered, interopSorted }) {
  assertSuitePinAgreement(join(distDir, ".."));
  const conformanceEntries = withConformance(rendered);

  for (const name of [...PAGE_FILES, "builders.json", "interop.json", "_headers", ...FONT_FILES, ...FONT_LICENSES, ...CSS_FILES]) {
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
  const cssBytes = CSS_FILES.reduce((sum, name) => sum + Buffer.byteLength(sheets[name]), 0);
  assertBuild(cssBytes <= 25 * 1024, `emitted CSS is ${cssBytes} bytes; the budget is 25KB total`);
  assertThemeIntegrity(sheets);
  assertAnimGating(sheets);

  // The CSP must be exactly 'self' (the same-origin /ui/ modules) plus ONE
  // script hash (the theme script) - nothing else in script-src - style-src
  // exactly 'self' (all CSS is the two same-origin stylesheets), plus
  // self-hosted fonts; every page's inline script must hash to it.
  const scriptSrc = headers.match(/script-src ([^;]+);/)?.[1] ?? "";
  const cspHashes = [...scriptSrc.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map((m) => m[1]);
  assertBuild(cspHashes.length === 1, `_headers must pin exactly one script-src hash, found ${cspHashes.length}`);
  assertBuild(scriptSrc.trim() === `'self' 'sha256-${cspHashes[0]}'`, "script-src must be exactly 'self' plus the theme script hash");
  assertBuild((headers.match(/style-src ([^;]+);/)?.[1] ?? "").trim() === "'self'", "style-src must be exactly 'self'");
  assertBuild(headers.includes("font-src 'self'"), "the CSP must allow the self-hosted fonts via font-src 'self'");
  const referenceScript = pages["index.html"].match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  for (const [name, html] of Object.entries(pages)) {
    assertPageScripts(name, html, cspHashes[0], referenceScript);
  }

  // Motion modules: dist/ui/**/*.js must be exact byte copies of the
  // committed site/assets/ui/**/*.js (both directions - same file set),
  // every module under ui/motion/ must match its MOTION_PINS sha256, and
  // hub-init must keep its reduced-motion / js-anim guard.
  const uiSrcDir = join(distDir, "..", "site", "assets", "ui");
  const uiCommitted = readdirSync(uiSrcDir, { recursive: true }).map(String).filter((n) => n.endsWith(".js")).sort();
  const uiBuilt = readdirSync(join(distDir, "ui"), { recursive: true }).map(String).filter((n) => n.endsWith(".js")).sort();
  assertBuild(uiBuilt.join(",") === uiCommitted.join(","), `dist/ui/ (${uiBuilt.join(", ")}) must mirror site/assets/ui/**/*.js (${uiCommitted.join(", ")})`);
  for (const name of uiCommitted) {
    const built = readFileSync(join(distDir, "ui", name));
    assertBuild(built.equals(readFileSync(join(uiSrcDir, name))), `dist/ui/${name} is not a byte copy of site/assets/ui/${name}`);
  }
  const pinned = Object.entries(MOTION_PINS);
  assertBuild(
    uiCommitted.filter((n) => n.startsWith("motion/")).join(",") === pinned.map(([name]) => `motion/${name}`).join(","),
    "site/assets/ui/motion/ must hold exactly the five pinned @kya-os/aliencn motion modules",
  );
  for (const [name, expected] of pinned) {
    const actual = createHash("sha256").update(readFileSync(join(uiSrcDir, "motion", name))).digest("hex");
    assertBuild(actual === expected, `motion drift: ${name} sha256 ${actual} does not match the registry pin (run \`aliencn diff motion\`; update via the aliencn CLI, never edit in place)`);
  }
  const hubInit = readFileSync(join(distDir, "ui", "hub-init.js"), "utf8");
  assertBuild(
    hubInit.includes("prefers-reduced-motion") && hubInit.includes("js-anim"),
    "hub-init.js lost its reduced-motion / js-anim guard",
  );

  // Fonts: dist/fonts/ must be exact byte copies of the committed binaries,
  // and each binary must really be woff2 (leading wOF2 magic). The hub
  // stylesheet must declare both brand faces.
  for (const name of FONT_FILES) {
    const built = readFileSync(join(distDir, name));
    const committed = readFileSync(join(distDir, "..", "site", "assets", name));
    assertBuild(built.equals(committed), `dist/${name} is not a byte copy of site/assets/${name}`);
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

  // The landing stays calm: live counts, no tables. The eyebrow readouts
  // (zero-padded for display) must carry the same live numbers - the padding
  // is recomputed here from the registry data, never from the formatter.
  const landingHtml = pages["index.html"];
  assertBuild(landingHtml.includes(`<b>${rendered.length}</b>`), "the landing page must show the live entry count");
  assertBuild(landingHtml.includes(`<b>${interopSorted.length}</b>`), "the landing page must show the live rails count");
  assertBuild(!landingHtml.includes("<table"), "no tables on the landing page");
  const pad = (count) => String(count).padStart(3, "0");
  const verifiedCount = conformanceEntries.filter((entry) => entry.conformance.status === "verified").length;
  for (const [page, readout] of [
    ["index.html", `Registry / ${pad(rendered.length)}`],
    ["builders/index.html", `Directory / ${pad(rendered.length)}`],
    ["conformance/index.html", `Verified / ${pad(verifiedCount)}`],
    ["standards/index.html", `Rails / ${pad(interopSorted.length)}`],
  ]) {
    assertBuild(pages[page].includes(`<span>${readout}</span>`), `${page}: the live eyebrow readout "${readout}" is missing or stale`);
  }

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

}
