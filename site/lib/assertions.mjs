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
 * ui-module checks (lib/module-checks.mjs) re-read the committed files
 * rather than trusting the copy step; the copy-parity check re-extracts button/fallback pairs from the
 * page bytes and matches them against lib/constants.mjs and
 * lib/snippets.mjs. The theme, gating, copy-parity, migration-hook, and
 * suite-pin checks live in lib/checks.mjs (split to keep
 * both files under the lib LOC cap) and run from here.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO_URL, SUITE, TEMPLATE_SLUG } from "./constants.mjs";
import { assertBadges } from "./badge.mjs";
import { assertCredentialArtifacts } from "./credential-checks.mjs";
import { withConformance } from "./data.mjs";
import { esc } from "./html.mjs";
import {
  assertAnimGating,
  assertBuild,
  assertCopyParity,
  assertFoundingCohort,
  assertHomePolish,
  assertLadderReadout,
  assertMigrateHook,
  assertProbeHonesty,
  assertSuitePinAgreement,
  assertThemeIntegrity,
} from "./checks.mjs";
import { assertCopyFacts } from "./copy-checks.mjs";
import { assertClientModules } from "./module-checks.mjs";
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

/**
 * The script and style contract, per page: exactly ONE inline script (the
 * theme toggle + js-anim pre-paint gate + page-fx failsafe), byte-identical
 * across pages, whose sha256 is exactly the hash the _headers CSP allows -
 * recomputed from the page bytes, never trusted from the build's own
 * constants - plus the module tags (lib/module-checks.mjs); all script tags in <head>,
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
export function runRenderChecks({ distDir, rendered, interopSorted, probes, credentialData, verdicts }) {
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
  // Budget raised 25KB -> 32KB with the Builders Site design swap (six pages
  // of layout: directory grid + CSS-only filter, rails diagrams, badge
  // lockups), then 32KB -> 40KB with the developer-conversion pass (the
  // entry-builder form, the Before / After pair, the badge preview); the
  // ceiling still catches runaway growth.
  const cssBytes = CSS_FILES.reduce((sum, name) => sum + Buffer.byteLength(sheets[name]), 0);
  // 40KB -> 44KB with the rails restructure (rail rows, projection flow) and
  // the authorization-methods row on the gated-tools recipe; both are
  // content, not chrome, and the emitted total landed at 41.2KB.
  assertBuild(cssBytes <= 44 * 1024, `emitted CSS is ${cssBytes} bytes; the budget is 44KB total`);
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
  assertCopyParity(pages);
  assertMigrateHook(pages["index.html"]);
  assertHomePolish(pages);
  assertCopyFacts(pages);

  // Client modules: byte copies, the generated vocabulary, the import graph,
  // per-page module tags, and the no-JS guard lines (lib/module-checks.mjs).
  assertClientModules({ distDir, pages, interopSorted, repoUrl: REPO_URL });

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
  // fine; conformance-flavored "certified"/"certification" language is not,
  // and neither is "tamper-proof" ("tamper-evident" is the honest phrase).
  for (const [name, html] of Object.entries(pages)) {
    assertBuild(!/certified|certification|tamper-proof/i.test(html), `a banned term (certified/certification/tamper-proof) leaked into ${name}`);
    // A green "verified" chip exists only as a credential link (the .demo
    // state-machine samples on the conformance page are the one labeled
    // exception): every non-demo st-verified chip must sit inside a
    // .chip-link anchor.
    for (const match of html.matchAll(/<(a|span)[^>]*class="[^"]*\bst-verified\b[^"]*"[^>]*>/g)) {
      if (match[0].includes("demo")) continue;
      // Directory summaries deliberately render chips unlinked - an anchor
      // nested in a <summary> fights the disclosure control for the click.
      // There the credential link must appear in the expanded row instead
      // (asserted below); everywhere else the chip itself is the link.
      // Containment is exact, not windowed: inside a summary iff the last
      // <summary before the chip opens after the last </summary> closes.
      const upToChip = html.slice(0, match.index);
      if (upToChip.lastIndexOf("<summary") > upToChip.lastIndexOf("</summary>")) continue;
      const near = html.slice(Math.max(0, match.index - 120), match.index);
      assertBuild(
        /<a class="chip-link" href="[^"]+">$/.test(near),
        `a "verified" chip rendered without a credential link in ${name}`,
      );
    }
  }

  // A verified or revoked entry's expanded directory row must link its
  // credential - the public record either way (the summary chip is unlinked
  // by design - see above).
  for (const entry of rendered) {
    const c = entry.conformance;
    if (c?.status === "verified" || c?.status === "revoked") {
      assertBuild(
        pages["builders/index.html"].includes(`<a href="${esc(c.attestationUrl)}">credential -&gt;</a>`),
        `${c.status} entry ${entry.slug} does not link its credential in the expanded row`,
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
    if (entry.implementation !== undefined) {
      assertBuild(
        standardsHtml.includes(`href="${esc(entry.implementation)}"`),
        `dist/standards/index.html does not link the implementation of "${entry.slug}"`,
      );
    }
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
      // The middle rungs (no credential yet) that carry public evidence must
      // render it; verified and revoked link the credential itself instead.
      if ((c.status === "self-reported" || c.status === "in-verification") && c.evidenceUrl) {
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
    landingHtml.includes(`${interopSorted.length} rows with evidence`),
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

  // The incentive machine: per-rung readout truth on the home strip, probe
  // honesty (enforcement language only ever with probe data, every probe
  // line dated and classified), and the founding cohort + badge embed per
  // directory row (all in lib/checks.mjs, on the dist bytes).
  assertLadderReadout(landingHtml, rendered);
  assertProbeHonesty(pages, rendered, probes);
  assertFoundingCohort(buildersHtml, rendered);

  const published = JSON.parse(readFileSync(join(distDir, "builders.json"), "utf8"));
  assertBuild(published.count === rendered.length, "builders.json count mismatch");
  assertBuild(
    !published.builders.some((entry) => entry.slug === TEMPLATE_SLUG),
    `template entry "${TEMPLATE_SLUG}" leaked into builders.json`,
  );
  assertBuild(!buildersHtml.includes(`id="${TEMPLATE_SLUG}"`), `template entry "${TEMPLATE_SLUG}" leaked into builders/index.html`);
  const publishedInterop = JSON.parse(readFileSync(join(distDir, "interop.json"), "utf8"));
  assertBuild(publishedInterop.count === interopSorted.length, "interop.json count mismatch");

  // Badge tiers: every rendered entry has its .svg + shields .json pair,
  // states match the entries, and "verified" appears exactly where the build
  // cryptographically verified the credential (checks live in lib/badge.mjs,
  // on the dist bytes).
  assertBadges(distDir, rendered, verdicts);

  // Credential artifacts: the sentinel provably renders nothing green; a
  // provisioned build ships did.json + byte-identical credential copies and
  // re-verifies every shipped credential from its dist bytes (checks live in
  // lib/credential-checks.mjs).
  assertCredentialArtifacts({ distDir, rendered, credentialData, verdicts });

  // The 404 page really is one, and it hands the reader every page.
  const notFoundHtml = pages["404.html"];
  assertBuild(notFoundHtml.includes("NOT FOUND"), "dist/404.html is not a not-found page");
  for (const path of ["/", "/builders/", "/conformance/", "/standards/", "/rails/", "/use-cases/"]) {
    assertBuild(notFoundHtml.includes(`href="${path}"`), `dist/404.html must link ${path}`);
  }
}
