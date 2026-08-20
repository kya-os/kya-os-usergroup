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
 *   - fonts/                   byte copies of site/assets/fonts/ (the two
 *                              self-hosted variable woff2 faces + their OFL
 *                              licenses)
 *   - _headers                 security headers + content types; the CSP pins
 *                              both inline scripts by sha256 (computed here
 *                              from the exact THEME_SCRIPT / ANIM_SCRIPT
 *                              bytes) and allows font-src 'self'
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
 *   lib/theme.mjs       the color tokens (light/dark pairs), the self-hosted
 *                       font faces, all page CSS, and the site's two inline
 *                       scripts: THEME_SCRIPT (every page) and ANIM_SCRIPT
 *                       (the landing hero choreography)
 *   lib/assertions.mjs  post-build render checks, run per page: completeness,
 *                       honesty, theme integrity, and the CSP script hash
 *
 * Output is deterministic: a pure function of registry/**.json, fixed
 * strings, and committed font binaries (entries sorted by slug, no build
 * timestamps; the script hashes are sha256 of constants; fonts are byte
 * copies), so re-running on the same commit yields byte-identical dist/.
 *
 * Run: node site/build-pages.mjs   (or: npm run build)
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runRenderChecks } from "./lib/assertions.mjs";
import { loadSiteData, renderBadgeAllowlist, renderBuildersJson, renderInteropJson } from "./lib/data.mjs";
import { render404Html } from "./lib/html.mjs";
import { renderBuildersHtml, renderConformanceHtml, renderLandingHtml, renderStandardsHtml } from "./lib/pages.mjs";
import { ANIM_SCRIPT, THEME_SCRIPT } from "./lib/theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const distDir = join(repoRoot, "dist");
const fontsSrcDir = join(here, "assets", "fonts");

function renderHeaders() {
  // Security headers for every route; content type + open CORS for the
  // machine-readable registries. The pages ship exactly two inline scripts
  // (the theme toggle everywhere, the hero choreography on the landing), so
  // script-src allows exactly their two sha256 hashes - computed from the
  // same constants the pages embed, so policy and pages can never drift.
  // font-src 'self' covers the self-hosted woff2 files; nothing else loosens.
  const sha256 = (script) => createHash("sha256").update(script, "utf8").digest("base64");
  return [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    `  Content-Security-Policy: default-src 'none'; script-src 'sha256-${sha256(THEME_SCRIPT)}' 'sha256-${sha256(ANIM_SCRIPT)}'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
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

// Fonts: deterministic byte copies of the committed binaries (the two
// variable woff2 faces + their OFL licenses), sorted for a stable order.
mkdirSync(join(distDir, "fonts"), { recursive: true });
for (const name of readdirSync(fontsSrcDir).sort()) {
  copyFileSync(join(fontsSrcDir, name), join(distDir, "fonts", name));
}

// The badge worker's slug allowlist is committed, not a dist/ artifact: the
// worker deploy must never depend on a site build having run.
const badgeDir = join(repoRoot, "workers", "badge");
mkdirSync(badgeDir, { recursive: true });
writeFileSync(join(badgeDir, "generated-allowlist.mjs"), renderBadgeAllowlist(rendered));

// ── render check: assert the artifact is complete and honest ────────────────

runRenderChecks({ distDir, rendered, interopSorted });

console.log(
  `Built Pages artifact: ${rendered.length} entr${rendered.length === 1 ? "y" : "ies"}, ${interopSorted.length} standards rails -> dist/ (4 pages, static + two hashed inline scripts, self-hosted fonts, real 404.html, no worker)`,
);
