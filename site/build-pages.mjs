#!/usr/bin/env node
/**
 * Build the Cloudflare Pages artifact for the KYA-OS community hub
 * (planned target: https://builders.kya-os.org - subdomain-vs-path decision
 * still open, see README).
 *
 * Validates both registries first (via the shared core in scripts/validate.mjs;
 * refuses to render on any error), then emits to dist/ (gitignored):
 *   - index.html      single dark page: conformance program, kind-grouped
 *                     builder directory, templates, examples, the standards
 *                     rails matrix, and the three submission paths
 *   - 404.html        real not-found page
 *   - builders.json   machine-readable merged builder registry (open CORS)
 *   - interop.json    machine-readable standards-rail registry (open CORS)
 *   - _headers        security headers + content types
 * plus one COMMITTED artifact outside dist/: the badge worker's slug
 * allowlist (workers/badge/generated-allowlist.mjs).
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
 *   lib/html.mjs        escaping, chips, cards, page shell, the 404 page
 *                       (the conformance honesty rules are enforced there)
 *   lib/sections.mjs    the index page sections and their assembly
 *   lib/assertions.mjs  post-build render checks: completeness + honesty
 *
 * Output is deterministic: a pure function of registry/**.json (entries
 * sorted by slug, no build timestamps), so re-running on the same commit
 * yields byte-identical dist/.
 *
 * Run: node site/build-pages.mjs   (or: npm run build)
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runRenderChecks } from "./lib/assertions.mjs";
import { loadSiteData, renderBadgeAllowlist, renderBuildersJson, renderInteropJson } from "./lib/data.mjs";
import { render404Html } from "./lib/html.mjs";
import { renderIndexHtml } from "./lib/sections.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const distDir = join(repoRoot, "dist");

function renderHeaders() {
  // Security headers for every route; content type + open CORS for the
  // machine-readable registries. The pages ship zero client JS, so the CSP
  // allows nothing but inline styles.
  return [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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

writeFileSync(join(distDir, "index.html"), renderIndexHtml({ rendered, interopSorted }));
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
  `Built Pages artifact: ${rendered.length} entr${rendered.length === 1 ? "y" : "ies"}, ${interopSorted.length} standards rails -> dist/ (static-only, real 404.html, no worker)`,
);
