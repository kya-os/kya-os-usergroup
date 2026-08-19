#!/usr/bin/env node
/**
 * Build the Cloudflare Pages artifact for the KYA-OS community hub
 * (planned target: https://builders.kya-os.org - subdomain-vs-path decision
 * still open, see README).
 *
 * Validates both registries first (via the shared core in scripts/validate.mjs;
 * refuses to render on any error), then emits to dist/ (gitignored):
 *   - index.html               calm landing: hero, mission line, three nav
 *                              cards with live counts, the add-project CTA
 *   - builders/index.html      the directory: kind-grouped entries, templates,
 *                              examples, and the three submission paths
 *   - conformance/index.html   the program: explainer, suite pin, 4-step
 *                              strip, and the implementations table
 *   - standards/index.html     the rails matrix grouped by category
 *   - 404.html                 real not-found page linking the four pages
 *   - builders.json            machine-readable merged builder registry (open CORS)
 *   - interop.json             machine-readable standards-rail registry (open CORS)
 *   - _headers                 security headers + content types; the CSP pins
 *                              the theme script by sha256 (computed here from
 *                              the exact THEME_SCRIPT bytes)
 * plus one COMMITTED artifact outside dist/: the badge worker's slug
 * allowlist (workers/badge/generated-allowlist.mjs).
 *
 * Pages are folder-style (dist/builders/index.html -> /builders/) so
 * Cloudflare Pages serves clean URLs; every internal link is root-absolute.
 *
 * STATIC-ONLY BY DESIGN - no _worker.js. The kya-os-schema Pages worker has a
 * known fail-open bug: its `if (response.status !== 404) return response`
 * branch never fires because the ASSETS binding serves an SPA fallback with
 * 200, so unknown paths get the index page instead of a 404. This site avoids
 * the whole bug class: only explicit files are emitted, and the presence of a
 * root 404.html makes Cloudflare Pages serve real 404 responses for unknown
 * paths (it disables the SPA fallback). Nothing to fail open.
 *
 * Each lib/ module owns one concern:
 *   lib/constants.mjs   canonical URLs, the pinned suite, the prefilled add link
 *   lib/data.mjs        registry loading + shaping, machine-readable artifacts
 *   lib/html.mjs        escaping, chips, cards, the shared shell + nav, the
 *                       404 page (conformance honesty rules enforced there)
 *   lib/sections.mjs    the section renderers (the page bodies)
 *   lib/pages.mjs       page assembly: hero + sections per page, per-page meta
 *   lib/theme.mjs       the color tokens (light/dark pairs), all page CSS,
 *                       and THEME_SCRIPT - the site's only client JS
 *   lib/assertions.mjs  post-build render checks, run per page: completeness,
 *                       honesty, theme integrity, and the CSP script hash
 *
 * Output is deterministic: a pure function of registry/**.json and fixed
 * strings (entries sorted by slug, no build timestamps; the script hash is
 * the sha256 of a constant), so re-running on the same commit yields
 * byte-identical dist/.
 *
 * Run: node site/build-pages.mjs   (or: npm run build)
 */
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runRenderChecks } from "./lib/assertions.mjs";
import { loadSiteData, renderBadgeAllowlist, renderBuildersJson, renderInteropJson } from "./lib/data.mjs";
import { render404Html } from "./lib/html.mjs";
import { renderBuildersHtml, renderConformanceHtml, renderLandingHtml, renderStandardsHtml } from "./lib/pages.mjs";
import { THEME_SCRIPT } from "./lib/theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const distDir = join(repoRoot, "dist");

function renderHeaders() {
  // Security headers for every route; content type + open CORS for the
  // machine-readable registries. The pages ship exactly one inline script
  // (the theme toggle), so script-src allows exactly its sha256 - computed
  // from the same constant the pages embed, so the two can never drift.
  const scriptHash = createHash("sha256").update(THEME_SCRIPT, "utf8").digest("base64");
  return [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    `  Content-Security-Policy: default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "/builders.json",
    "  Content-Type: application/json; charset=utf-8",
    "  Access-Control-Allow-Origin: *",
    "  Cache-Control: public, max-age=300, s-maxage=3600",
    "/interop.json",
    "  Content-Type: application/json; charset=utf-8",
    "  Access-Control-Allow-Origin: *",
    "  Cache-Control: public, max-age=300, s-maxage=3600",
    "",
  ].join("\n");
}

// ── gate: never render an invalid registry ──────────────────────────────────

const { errors, rendered, interopSorted } = loadSiteData();
if (errors.length > 0) {
  console.error(`Refusing to build: registry validation failed (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

// ── emit ────────────────────────────────────────────────────────────────────

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
for (const page of ["builders", "conformance", "standards"]) {
  mkdirSync(join(distDir, page), { recursive: true });
}

writeFileSync(join(distDir, "index.html"), renderLandingHtml({ rendered, interopSorted }));
writeFileSync(join(distDir, "builders", "index.html"), renderBuildersHtml({ rendered }));
writeFileSync(join(distDir, "conformance", "index.html"), renderConformanceHtml({ rendered }));
writeFileSync(join(distDir, "standards", "index.html"), renderStandardsHtml({ interopSorted }));
writeFileSync(join(distDir, "404.html"), render404Html());
writeFileSync(join(distDir, "builders.json"), renderBuildersJson(rendered));
writeFileSync(join(distDir, "interop.json"), renderInteropJson(interopSorted));
writeFileSync(join(distDir, "_headers"), renderHeaders());

// The badge worker's slug allowlist is committed, not a dist/ artifact: the
// worker deploy must never depend on a site build having run.
const badgeDir = join(repoRoot, "workers", "badge");
mkdirSync(badgeDir, { recursive: true });
writeFileSync(join(badgeDir, "generated-allowlist.mjs"), renderBadgeAllowlist(rendered));

// ── render check: assert the artifact is complete and honest ────────────────

runRenderChecks({ distDir, rendered, interopSorted });

console.log(
  `Built Pages artifact: ${rendered.length} entr${rendered.length === 1 ? "y" : "ies"}, ${interopSorted.length} standards rails -> dist/ (4 pages, static + one hashed theme script, real 404.html, no worker)`,
);
