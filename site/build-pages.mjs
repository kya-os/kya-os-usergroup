#!/usr/bin/env node
/**
 * Build the Cloudflare Pages artifact for the KYA-OS community hub
 * (planned target: https://builders.kya-os.org - subdomain-vs-path decision
 * still open, see README).
 *
 * Validates both registries first (via the shared core in scripts/validate.mjs;
 * refuses to render on any error), then emits to dist/ (gitignored):
 *   - index.html               the overview: the two-line hook, how it
 *                              works, the path, define-once + THE RAILS
 *                              panel, explore (stats strip + five cards)
 *   - builders/index.html      the directory: filterable registry rows, the
 *                              on-ramps, and the three submission paths
 *   - conformance/index.html   the program, badge first: suite pin, the
 *                              badge preview, what a verified claim gives
 *                              you, pipeline, levels, implementations
 *   - standards/index.html     the rails matrix grouped by category
 *   - rails/index.html         the protocol rails diagram page
 *   - use-cases/index.html     the REVOKED flagship and the recipe grid
 *   - 404.html                 real not-found page linking every page
 *   - builders.json            machine-readable merged builder registry (open CORS)
 *   - interop.json             machine-readable standards-rail registry (open CORS)
 *   - badge/                   badge tiers per rendered entry (<slug>.svg +
 *                              <slug>.json, shields endpoint schema) from
 *                              lib/badge.mjs - the verified/under-appeal/
 *                              revoked tiers render ONLY from the build's
 *                              cryptographic credential verification below
 *   - credentials/             the published credential schema (always) plus
 *                              byte copies of every committed credential and
 *                              both signed status lists (provisioned era) -
 *                              each VERIFIED at build time by
 *                              lib/credentials.mjs before anything renders
 *   - .well-known/did.json     the did:web issuer document from the
 *                              committed program public keys - never emitted
 *                              on the unprovisioned sentinel
 *   - fonts/                   byte copies of site/assets/fonts/ (the two
 *                              self-hosted variable woff2 faces + their OFL
 *                              licenses)
 *   - img/                     byte copies of site/assets/img/ (the KYA
 *                              logo marks, white for dark / black for light)
 *   - tokens.css, hub.css      comment-stripped copies of site/assets/css/:
 *                              the Builders Site design-language token layer
 *                              and the hub page layer - ALL page CSS, served
 *                              same-origin so style-src stays 'self'
 *   - ui/                      byte copies of site/assets/ui/*.js (the
 *                              page-fx motion module, the copy-prompt
 *                              module, the builders page's entry-builder
 *                              module), byte copies of the browser-safe
 *                              library modules the client shares with the
 *                              build (builder-entry.js), and the generated
 *                              registry vocabulary (registry-enums.js, from
 *                              registry/schema/)
 *   - _headers                 security headers + content types; the CSP pins
 *                              the one inline script by sha256 (computed here
 *                              from the exact THEME_SCRIPT bytes), covers the
 *                              same-origin modules with script-src 'self',
 *                              keeps style-src at 'self' (no inline styles
 *                              anywhere), and allows font-src 'self'
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
 *   lib/constants.mjs   canonical URLs, the pinned suite, the prefilled add
 *                       link, the copy-to-agent prompts
 *   lib/data.mjs        registry loading + shaping, machine-readable artifacts
 *   lib/html.mjs        escaping, chips, the prompt block, the shared shell
 *                       + nav, the 404 page (honesty rules enforced there)
 *   lib/snippets.mjs    the code snippets as data (the migrate pair verbatim
 *                       from the reference README) - parity-asserted
 *   lib/highlight.mjs   build-time TypeScript highlighting + the copyable
 *                       code block
 *   lib/waveform.mjs    build-time seeded proof waveforms as static SVG
 *   lib/home.mjs        the overview page body (the two-line hook hero +
 *                       how it works)
 *   lib/home-sections.mjs  the overview's path, define-once, and explore
 *                       sections
 *   lib/sections.mjs    the directory page bodies
 *   lib/entry-builder.mjs  the builders page's entry-builder form markup
 *   lib/program.mjs     the conformance page body
 *   lib/rails.mjs       the standards and rails page bodies
 *   lib/use-cases.mjs   the use-cases page body (REVOKED + recipes with
 *                       their reference examples)
 *   lib/pages.mjs       page assembly: hero + sections per page, per-page meta
 *   lib/theme.mjs       the inline-only pieces: THEME_SCRIPT (theme toggle +
 *                       js-anim gate + page-fx failsafe) and the theme-color
 *                       meta pair; all CSS lives in site/assets/css/
 *   lib/assertions.mjs  post-build render checks, run per page: completeness,
 *                       honesty, theme integrity, copy parity, and the CSP
 *                       script hash (client-module checks in
 *                       lib/module-checks.mjs)
 *
 * Output is deterministic: a pure function of registry/**.json, fixed
 * strings, and committed binaries/modules (entries sorted by slug, no build
 * timestamps; waveforms are seeded, never random; the script hash is sha256
 * of a constant; fonts, marks, and ui modules are byte copies), so
 * re-running on the same commit yields byte-identical dist/.
 *
 * Run: node site/build-pages.mjs   (or: npm run build)
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runRenderChecks } from "./lib/assertions.mjs";
import { renderBadgeFiles } from "./lib/badge.mjs";
import { renderDidJson, verifyCredentialArtifacts } from "./lib/credentials.mjs";
import { loadSiteData, renderBadgeAllowlist, renderBuildersJson, renderGeneratedKeys, renderInteropJson, renderRegistryEnums } from "./lib/data.mjs";
import { COPIED_MODULES } from "./lib/module-checks.mjs";
import { render404Html } from "./lib/html.mjs";
import {
  renderBuildersHtml,
  renderConformanceHtml,
  renderLandingHtml,
  renderRailsHtml,
  renderStandardsHtml,
  renderUseCasesHtml,
} from "./lib/pages.mjs";
import { THEME_SCRIPT } from "./lib/theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const distDir = join(repoRoot, "dist");
const fontsSrcDir = join(here, "assets", "fonts");
const imgSrcDir = join(here, "assets", "img");
const cssSrcDir = join(here, "assets", "css");
const uiSrcDir = join(here, "assets", "ui");

function renderHeaders({ withDid }) {
  // Security headers for every route; content type + open CORS for the
  // machine-readable registries. The pages ship exactly ONE inline script
  // (the theme toggle + js-anim gate), so script-src allows exactly its
  // sha256 hash - computed from the same constant the pages embed, so policy
  // and pages can never drift - plus 'self' for the same-origin /ui/ ES
  // modules. style-src is 'self': all CSS ships as the two same-origin
  // stylesheets (no <style> blocks, no style attributes - asserted).
  // font-src 'self' covers the self-hosted woff2 files; img-src 'self'
  // covers the logo marks. Nothing else loosens.
  //
  // /credentials/* (the attestation credentials, status lists, and schema)
  // and, once the program keys are provisioned, /.well-known/did.json are
  // open-CORS JSON: external verifiers and DID resolvers must be able to
  // fetch them cross-origin - that is the whole point of publishing them.
  const sha256 = (script) => createHash("sha256").update(script, "utf8").digest("base64");
  const jsonBlock = (route) => [
    route,
    "  Content-Type: application/json; charset=utf-8",
    "  Access-Control-Allow-Origin: *",
    "  Cache-Control: public, max-age=300, s-maxage=3600",
  ];
  return [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    `  Content-Security-Policy: default-src 'none'; script-src 'self' 'sha256-${sha256(THEME_SCRIPT)}'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    ...jsonBlock("/builders.json"),
    ...jsonBlock("/interop.json"),
    ...jsonBlock("/credentials/*"),
    ...(withDid ? jsonBlock("/.well-known/did.json") : []),
    "",
  ].join("\n");
}

// ── gate: never render an invalid registry ──────────────────────────────────

const { errors, rendered, interopSorted, probes, credentialData } = loadSiteData();
if (errors.length > 0) {
  console.error(`Refusing to build: registry validation failed (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

// ── gate: the build IS the verifier - refuse on any credential failure ──────
// Every committed credential's eddsa-jcs-2022 proof and status bits are
// cryptographically verified here against the committed program keys
// (site/lib/credentials.mjs); nothing may render verified without this.

const { verdicts, errors: credentialErrors } = verifyCredentialArtifacts(credentialData);
if (credentialErrors.length > 0) {
  console.error(`Refusing to build: credential verification failed (${credentialErrors.length} error${credentialErrors.length === 1 ? "" : "s"}):`);
  for (const error of credentialErrors) console.error(`  - ${error}`);
  process.exit(1);
}

// ── emit ────────────────────────────────────────────────────────────────────

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
for (const page of ["builders", "conformance", "standards", "rails", "use-cases"]) {
  mkdirSync(join(distDir, page), { recursive: true });
}

writeFileSync(join(distDir, "index.html"), renderLandingHtml({ rendered, interopSorted }));
writeFileSync(join(distDir, "builders", "index.html"), renderBuildersHtml({ rendered, interopSorted, probes, verdicts }));
writeFileSync(join(distDir, "conformance", "index.html"), renderConformanceHtml({ rendered, verdicts }));
writeFileSync(join(distDir, "standards", "index.html"), renderStandardsHtml({ interopSorted }));
writeFileSync(join(distDir, "rails", "index.html"), renderRailsHtml({ interopSorted }));
writeFileSync(join(distDir, "use-cases", "index.html"), renderUseCasesHtml());
writeFileSync(join(distDir, "404.html"), render404Html());
writeFileSync(join(distDir, "builders.json"), renderBuildersJson(rendered));
writeFileSync(join(distDir, "interop.json"), renderInteropJson(interopSorted));
writeFileSync(join(distDir, "_headers"), renderHeaders({ withDid: credentialData.programKeys.provisioned }));

// Badge tiers: one .svg + shields .json pair per rendered entry, from the
// same chip semantics as the pages. The "verified" tier renders ONLY for
// entries whose credential the gate above cryptographically verified.
mkdirSync(join(distDir, "badge"), { recursive: true });
for (const [name, contents] of renderBadgeFiles(rendered, verdicts)) {
  writeFileSync(join(distDir, "badge", name), contents);
}

// Credential artifacts: the published schema always; each committed
// credential, both signed status lists, and /.well-known/did.json (the
// did:web issuer document, from the committed publics) only in the
// provisioned era - the sentinel emits nothing green and no DID.
mkdirSync(join(distDir, "credentials", "schema"), { recursive: true });
copyFileSync(
  join(repoRoot, "registry", "credentials", "schema", "attestation-v1.json"),
  join(distDir, "credentials", "schema", "attestation-v1.json"),
);
const { programKeys, credentials, statusLists } = credentialData;
for (const { id32 } of credentials) {
  copyFileSync(join(repoRoot, "registry", "credentials", `${id32}.json`), join(distDir, "credentials", `${id32}.json`));
}
if (statusLists.revocation !== null || statusLists.suspension !== null) {
  mkdirSync(join(distDir, "credentials", "status"), { recursive: true });
  for (const purpose of ["revocation", "suspension"]) {
    if (statusLists[purpose] === null) continue;
    copyFileSync(
      join(repoRoot, "registry", "credentials", "status", `${purpose}-1.json`),
      join(distDir, "credentials", "status", `${purpose}-1.json`),
    );
  }
}
const didJson = renderDidJson(programKeys);
if (didJson !== null) {
  mkdirSync(join(distDir, ".well-known"), { recursive: true });
  writeFileSync(join(distDir, ".well-known", "did.json"), didJson);
}

// Fonts and logo marks: deterministic byte copies of the committed binaries,
// sorted for a stable order.
for (const [srcDir, outName] of [
  [fontsSrcDir, "fonts"],
  [imgSrcDir, "img"],
]) {
  mkdirSync(join(distDir, outName), { recursive: true });
  for (const name of readdirSync(srcDir).sort()) {
    copyFileSync(join(srcDir, name), join(distDir, outName, name));
  }
}

// Stylesheets: site/assets/css/ emitted to the dist root (/tokens.css - the
// design-language token layer - and /hub.css - the page layer). Real
// same-origin files, which is what keeps style-src at 'self'. The emitted
// copies are a deterministic pure function of the committed sources:
// comments (provenance headers stay in the repo) and leading indentation
// stripped, nothing else - assertions recompute the same transform
// independently and verify the dist bytes against it.
const stripCss = (css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n[ \t]+/g, "\n").replace(/\n{2,}/g, "\n").replace(/^\n/, "");
for (const name of readdirSync(cssSrcDir).sort()) {
  writeFileSync(join(distDir, name), stripCss(readFileSync(join(cssSrcDir, name), "utf8")));
}

// Client modules, all same-origin under script-src 'self': deterministic
// byte copies of site/assets/ui/*.js (page-fx, copy-prompt, and the
// page-specific modules), byte copies of the browser-safe library modules
// the client shares with the build and the validator (COPIED_MODULES - the
// same bytes run in Node and in the browser), and the generated registry
// vocabulary from the schemas. lib/module-checks.mjs verifies byte
// equality, the generated lines, the import graph, and the guard lines.
mkdirSync(join(distDir, "ui"), { recursive: true });
for (const entry of readdirSync(uiSrcDir, { recursive: true }).map(String).sort()) {
  if (entry.endsWith(".js")) copyFileSync(join(uiSrcDir, entry), join(distDir, "ui", entry));
}
for (const [name, source] of Object.entries(COPIED_MODULES)) {
  copyFileSync(join(repoRoot, source), join(distDir, "ui", name));
}
writeFileSync(join(distDir, "ui", "registry-enums.js"), renderRegistryEnums(interopSorted));

// The badge worker's generated modules are committed, not dist/ artifacts:
// the worker deploy must never depend on a site build having run. The slug
// allowlist comes from the rendered entries; the pinned program keys come
// from registry/keys/program-keys.json (sentinel era: PROVISIONED false and
// empty key arrays, so the worker fail-closes everything to unverified;
// once the provisioning PR commits real publics, this regeneration arms the
// worker with zero hand edits).
const badgeDir = join(repoRoot, "workers", "badge");
mkdirSync(badgeDir, { recursive: true });
writeFileSync(join(badgeDir, "generated-allowlist.mjs"), renderBadgeAllowlist(rendered));
writeFileSync(join(badgeDir, "generated-keys.mjs"), renderGeneratedKeys(credentialData.programKeys));

// ── render check: assert the artifact is complete and honest ────────────────

runRenderChecks({ distDir, rendered, interopSorted, probes, credentialData, verdicts });

console.log(
  `Built Pages artifact: ${rendered.length} entr${rendered.length === 1 ? "y" : "ies"}, ${interopSorted.length} standards rails -> dist/ (6 pages, static + one hashed inline script + same-origin ui modules and stylesheets, build-time waveforms, self-hosted fonts, real 404.html, no worker)`,
);
