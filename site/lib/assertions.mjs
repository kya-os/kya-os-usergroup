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
 * script hash from the emitted page bytes for the same reason.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATE_SLUG } from "./constants.mjs";
import { withConformance } from "./data.mjs";
import { esc } from "./html.mjs";

const PAGE_FILES = ["index.html", "builders/index.html", "conformance/index.html", "standards/index.html", "404.html"];

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
 * The theme script contract, per page: exactly ONE inline script, emitted in
 * <head> (so the stored preference applies before first paint), byte-identical
 * across pages, and its sha256 is exactly the hash the _headers CSP allows.
 * The hash is recomputed here from the page bytes, never trusted from the
 * build's own constant.
 */
function assertThemeScript(name, html, cspHash, referenceScript) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assertBuild(scripts.length === 1, `${name}: expected exactly 1 inline script, found ${scripts.length}`);
  const script = scripts[0];
  const headEnd = html.indexOf("</head>");
  assertBuild(headEnd !== -1 && html.indexOf("<script>") < headEnd, `${name}: the theme script must run in <head>, before paint`);
  assertBuild(script === referenceScript, `${name}: the inline script drifted from the other pages' bytes`);
  const hash = createHash("sha256").update(script, "utf8").digest("base64");
  assertBuild(hash === cspHash, `${name}: script sha256 ${hash} does not match the CSP allowance ${cspHash}`);
  assertBuild(html.includes('id="theme-toggle"'), `${name}: the theme toggle button is missing`);
}

/** Verify every dist/ artifact against the shaped registry data; exits non-zero on the first failure. */
export function runRenderChecks({ distDir, rendered, interopSorted }) {
  const conformanceEntries = withConformance(rendered);

  for (const name of [...PAGE_FILES, "builders.json", "interop.json", "_headers"]) {
    const path = join(distDir, name);
    assertBuild(statSync(path).size > 0, `dist/${name} is missing or empty`);
  }
  const pages = Object.fromEntries(PAGE_FILES.map((name) => [name, readFileSync(join(distDir, name), "utf8")]));
  const headers = readFileSync(join(distDir, "_headers"), "utf8");

  // The CSP must allow exactly one script hash; every page's one script must hash to it.
  const cspHashes = [...headers.matchAll(/script-src 'sha256-([A-Za-z0-9+/=]+)'/g)];
  assertBuild(cspHashes.length === 1, `_headers must pin exactly one script-src hash, found ${cspHashes.length}`);
  const referenceScript = pages["index.html"].match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  for (const [name, html] of Object.entries(pages)) {
    assertThemeScript(name, html, cspHashes[0][1], referenceScript);
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
