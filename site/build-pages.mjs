#!/usr/bin/env node
/**
 * Build the Cloudflare Pages artifact for the KYA-OS builder registry
 * (planned target: https://builders.kya-os.org - subdomain-vs-path decision
 * still open, see README).
 *
 * Validates the registry first (imports scripts/validate.mjs; refuses to
 * render on any error), then emits to dist/ (gitignored):
 *   - index.html      dark-styled listing of every builder entry, zero client JS
 *   - 404.html        real not-found page
 *   - builders.json   machine-readable merged registry (open CORS)
 *   - _headers        security headers + content types
 *
 * STATIC-ONLY BY DESIGN - no _worker.js. The kya-os-schema Pages worker has a
 * known fail-open bug: its `if (response.status !== 404) return response`
 * branch never fires because the ASSETS binding serves an SPA fallback with
 * 200, so unknown paths get the index page instead of a 404. This site avoids
 * the whole bug class: only explicit files are emitted, and the presence of a
 * root 404.html makes Cloudflare Pages serve real 404 responses for unknown
 * paths (it disables the SPA fallback). Nothing to fail open.
 *
 * The template entry (slug "example-builder") is validated like every other
 * entry but EXCLUDED from the rendered site and from builders.json - it exists
 * only as the file contributors copy.
 *
 * Output is deterministic: a pure function of registry/builders/*.json
 * (entries sorted by slug, no build timestamps), so re-running on the same
 * commit yields byte-identical dist/.
 *
 * Run: node site/build-pages.mjs   (or: npm run build)
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRegistry } from "../scripts/validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const distDir = join(repoRoot, "dist");

const ORIGIN = "https://builders.kya-os.org"; // planned; final URL decision open
const SITE_URL = "https://kya-os.org";
const SPEC_REPO_URL = "https://github.com/decentralized-identity/kya-os-mcp";
const REPO_URL = "https://github.com/decentralized-identity/kya-os-usergroup";
const DIF_URL = "https://identity.foundation";
const TEMPLATE_SLUG = "example-builder";

const TITLE = "KYA-OS Builders";
const DESCRIPTION =
  "The KYA-OS usergroup: a public, PR-able registry of teams and projects building on the KYA-OS protocol for verifiable AI-agent identity, delegation, and proof.";

// ── gate: never render an invalid registry ──────────────────────────────────

const { entries, errors } = validateRegistry();
if (errors.length > 0) {
  console.error(`Refusing to build: registry validation failed (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const builders = entries
  .filter((entry) => entry.slug !== TEMPLATE_SLUG)
  .sort((a, b) => a.slug.localeCompare(b.slug, "en"));

// ── helpers ─────────────────────────────────────────────────────────────────

/** Minimal HTML entity escaping for interpolated registry data. */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ── pages ───────────────────────────────────────────────────────────────────

const SHARED_CSS = `
  :root{ --bg:#0a0a0a; --fg:#e0e0e0; --muted:#666; --accent:#fff; --grid:#1a1a1a; }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg);
    line-height:1.6;-webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden;min-height:100vh}
  body::before{content:"";position:fixed;inset:0;background-image:radial-gradient(circle,var(--grid) 1px,transparent 1px);background-size:40px 40px;opacity:.5;pointer-events:none;z-index:0}
  .wrap{max-width:880px;margin:0 auto;padding:0 40px;position:relative;z-index:1}
  a{color:var(--fg);text-decoration:none}
  a:hover{color:var(--accent)}
  code,.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
  ::selection{background:var(--accent);color:var(--bg)}
  header.bar{border-bottom:1px solid var(--grid)}
  header.bar .wrap{display:flex;align-items:center;gap:16px;height:64px}
  .brand{color:var(--accent);font-weight:600;font-size:16px;letter-spacing:-.01em}
  .brand .sub{color:var(--muted);font-weight:400}
  nav{margin-left:auto;display:flex;gap:24px;font-family:ui-monospace,monospace;font-size:13px}
  nav a{color:var(--muted)}
  nav a:hover{color:var(--accent)}
  footer{border-top:1px solid var(--grid);margin-top:72px;padding:28px 0 64px;color:var(--muted);font-size:13px}
  footer .wrap{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center}
  footer a{color:var(--muted)}
  footer a:hover{color:var(--accent)}`;

function pageShell({ title, headExtra = "", body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="theme-color" content="#0a0a0a" />
${headExtra}<style>${SHARED_CSS}
</style>
</head>
<body>
  <header class="bar"><div class="wrap">
    <a class="brand" href="/">KYA-OS<span class="sub"> / builders</span></a>
    <nav>
      <a href="${SITE_URL}">kya-os.org</a>
      <a href="/builders.json">builders.json</a>
      <a href="${REPO_URL}">GitHub</a>
    </nav>
  </div></header>
${body}
  <footer><div class="wrap">
    <span>KYA-OS Usergroup · <span class="mono">builders.kya-os.org</span></span>
    <a href="${SITE_URL}">Protocol</a>
    <a href="${SPEC_REPO_URL}">Spec repo</a>
    <a href="${DIF_URL}">DIF</a>
    <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">Get listed</a>
  </div></footer>
</body>
</html>
`;
}

function renderIndexHtml(list) {
  const cards = list
    .map((b) => {
      const categories = (b.categories ?? [])
        .map((c) => `<span class="chip">${esc(c)}</span>`)
        .join("");
      const kyaRepos = (b.kyaOsRepos ?? [])
        .map((r) => `<code class="krepo">${esc(r)}</code>`)
        .join(" ");
      return `        <article class="card" id="${esc(b.slug)}">
          <div class="card-head">
            <h3><a href="${esc(b.homepage)}">${esc(b.name)}</a></h3>
            ${categories ? `<div class="chips">${categories}</div>` : ""}
          </div>
          <p class="desc">${esc(b.description)}</p>
          <div class="links">
            <a href="${esc(b.homepage)}">homepage</a>${b.repo ? `\n            <a href="${esc(b.repo)}">repo</a>` : ""}${kyaRepos ? `\n            <span class="builds-on">builds on ${kyaRepos}</span>` : ""}
          </div>
        </article>`;
    })
    .join("\n");

  const listing =
    list.length > 0
      ? `      <div class="cards">\n${cards}\n      </div>`
      : `      <p class="empty">No builders listed yet. <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">Be the first</a>.</p>`;

  const body = `
  <article class="wrap">
    <section class="hero">
      <div class="eyebrow">Decentralized Identity Foundation</div>
      <h1>Builders</h1>
      <p class="lede">${esc(DESCRIPTION)} Listing is a public pull request away.</p>
      <div class="chips-row">
        <span class="stat"><b>${list.length}</b> listed</span>
        <a class="stat" href="/builders.json">builders.json</a>
        <a class="stat" href="${REPO_URL}/blob/main/CONTRIBUTING.md">get listed &rarr;</a>
      </div>
    </section>
    <main>
${listing}
    </main>
  </article>`;

  const headExtra = `<meta name="description" content="${esc(DESCRIPTION)}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${ORIGIN}/" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="KYA-OS" />
<meta property="og:title" content="${esc(TITLE)}" />
<meta property="og:description" content="${esc(DESCRIPTION)}" />
<meta property="og:url" content="${ORIGIN}/" />
`;

  const extraCss = `
  .hero{padding:80px 0 36px}
  .eyebrow{font-family:ui-monospace,monospace;font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin-bottom:24px}
  h1{font-size:clamp(42px,7vw,64px);font-weight:300;letter-spacing:-.02em;line-height:1.05;color:var(--accent)}
  .lede{max-width:660px;font-size:18px;line-height:1.85;margin-top:24px}
  .chips-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:32px}
  .stat{font-family:ui-monospace,monospace;font-size:12.5px;color:var(--muted);border:1px solid var(--grid);padding:7px 13px;background:rgba(255,255,255,.02)}
  .stat b{color:var(--fg);font-weight:500}
  a.stat:hover{color:var(--accent);border-color:var(--muted)}
  main{padding:28px 0 8px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(390px,1fr));gap:16px}
  @media(max-width:520px){.cards{grid-template-columns:1fr}}
  .card{padding:26px;background:rgba(255,255,255,.02);border:1px solid var(--grid);transition:background .2s ease,border-color .2s ease}
  .card:hover{background:rgba(255,255,255,.04);border-color:var(--muted)}
  .card-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
  .card h3{font-size:18px;font-weight:600;letter-spacing:-.01em}
  .card h3 a{color:var(--accent)}
  .chips{display:flex;gap:6px;flex-wrap:wrap}
  .chip{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border:1px solid var(--grid);padding:3px 8px}
  .card .desc{font-size:15px;line-height:1.6;margin-bottom:16px}
  .card .links{display:flex;gap:16px;flex-wrap:wrap;font-family:ui-monospace,monospace;font-size:12.5px;align-items:baseline}
  .card .links a{color:var(--muted);text-decoration:underline;text-underline-offset:3px}
  .card .links a:hover{color:var(--accent)}
  .builds-on{color:var(--muted);font-size:12px}
  .krepo{color:var(--fg);font-size:12px}
  .empty{color:var(--muted);font-size:16px;padding:24px 0}
  .empty a{color:var(--accent);text-decoration:underline}`;

  return pageShell({ title: TITLE, headExtra, body }).replace("\n</style>", `${extraCss}\n</style>`);
}

function render404Html() {
  const body = `
  <article class="wrap">
    <section class="nf">
      <div class="code mono">404</div>
      <h1>Not found</h1>
      <p>No page or registry resource matches this path.</p>
      <p><a class="back" href="/">&larr; All builders</a></p>
    </section>
  </article>`;
  const extraCss = `
  .nf{padding:120px 0 40px;max-width:560px}
  .nf .code{font-size:13px;letter-spacing:.18em;color:var(--muted);margin-bottom:16px}
  .nf h1{font-size:42px;font-weight:300;color:var(--accent);margin-bottom:16px}
  .nf p{color:var(--fg);margin-bottom:10px}
  .nf .back{font-family:ui-monospace,monospace;font-size:13px;color:var(--muted);text-decoration:underline;text-underline-offset:3px}
  .nf .back:hover{color:var(--accent)}`;
  return pageShell({
    title: `Not found · ${TITLE}`,
    headExtra: '<meta name="robots" content="noindex" />\n',
    body,
  }).replace("\n</style>", `${extraCss}\n</style>`);
}

function renderBuildersJson(list) {
  return (
    JSON.stringify(
      {
        registry: "kya-os-usergroup",
        source: REPO_URL,
        schema: `${REPO_URL}/blob/main/registry/schema/builder.schema.json`,
        count: list.length,
        builders: list,
      },
      null,
      2,
    ) + "\n"
  );
}

function renderHeaders() {
  // Security headers for every route; content type + open CORS for the
  // machine-readable registry. The pages ship zero client JS, so the CSP
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
    "",
  ].join("\n");
}

// ── emit ────────────────────────────────────────────────────────────────────

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

writeFileSync(join(distDir, "index.html"), renderIndexHtml(builders));
writeFileSync(join(distDir, "404.html"), render404Html());
writeFileSync(join(distDir, "builders.json"), renderBuildersJson(builders));
writeFileSync(join(distDir, "_headers"), renderHeaders());

// ── render check: assert the artifact is complete and correct ───────────────

function assertBuild(condition, message) {
  if (!condition) {
    console.error(`Render check FAILED: ${message}`);
    process.exit(1);
  }
}

for (const name of ["index.html", "404.html", "builders.json", "_headers"]) {
  const path = join(distDir, name);
  assertBuild(statSync(path).size > 0, `dist/${name} is missing or empty`);
}
const indexHtml = readFileSync(join(distDir, "index.html"), "utf8");
for (const b of builders) {
  assertBuild(indexHtml.includes(esc(b.name)), `dist/index.html does not list "${b.name}"`);
}
const published = JSON.parse(readFileSync(join(distDir, "builders.json"), "utf8"));
assertBuild(published.count === builders.length, "builders.json count mismatch");
assertBuild(
  !published.builders.some((b) => b.slug === TEMPLATE_SLUG),
  `template entry "${TEMPLATE_SLUG}" leaked into builders.json`,
);
assertBuild(!indexHtml.includes(`id="${TEMPLATE_SLUG}"`), `template entry "${TEMPLATE_SLUG}" leaked into index.html`);
const notFoundHtml = readFileSync(join(distDir, "404.html"), "utf8");
assertBuild(notFoundHtml.includes("404"), "dist/404.html is not a not-found page");

console.log(`Built Pages artifact: ${builders.length} builder${builders.length === 1 ? "" : "s"} -> dist/ (static-only, real 404.html, no worker)`);
