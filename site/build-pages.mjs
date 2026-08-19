#!/usr/bin/env node
/**
 * Build the Cloudflare Pages artifact for the KYA-OS community hub
 * (planned target: https://builders.kya-os.org - subdomain-vs-path decision
 * still open, see README).
 *
 * Validates both registries first (imports scripts/validate.mjs; refuses to
 * render on any error), then emits to dist/ (gitignored):
 *   - index.html      single dark page: conformance program, kind-grouped
 *                     builder directory, templates, examples, the standards
 *                     rails matrix, and the three submission paths
 *   - 404.html        real not-found page
 *   - builders.json   machine-readable merged builder registry (open CORS)
 *   - interop.json    machine-readable standards-rail registry (open CORS)
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
 * CONFORMANCE HONESTY RULES, enforced at render time and asserted after:
 *   - a subset claim NEVER renders as a bare level ("L1 subset (signed-proof)",
 *     never "L1")
 *   - "verified" renders green ONLY with the credential link (attestationUrl);
 *     in-verification is amber, self-reported is grey
 *   - the word "certified" appears nowhere
 *
 * The template entry (slug "example-builder") is validated like every other
 * entry but EXCLUDED from the rendered site and from builders.json - it exists
 * only as the file contributors copy.
 *
 * Output is deterministic: a pure function of registry/**.json (entries
 * sorted by slug, no build timestamps), so re-running on the same commit
 * yields byte-identical dist/.
 *
 * Run: node site/build-pages.mjs   (or: npm run build)
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRegistry, INTEROP_CATEGORIES } from "../scripts/validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const distDir = join(repoRoot, "dist");

const ORIGIN = "https://builders.kya-os.org"; // planned; final URL decision open
const SITE_URL = "https://kya-os.org";
const MCP_REPO_URL = "https://github.com/decentralized-identity/kya-os-mcp";
const REPO_URL = "https://github.com/kya-os/kya-os-usergroup";
const DIF_URL = "https://identity.foundation";
const TEMPLATE_SLUG = "example-builder";

const CONFORMANCE_MD_URL = `${MCP_REPO_URL}/blob/main/CONFORMANCE.md`;
const SUBMISSION_ISSUE_URL = `${MCP_REPO_URL}/issues/new?template=conformance_submission.md`;
const STARTER_URL = `${REPO_URL}/tree/main/conformance/starter`;
const SUITE = {
  version: "1.0.0",
  vectors: 44,
  vectorSetHash: "sha256:81d537d4574d3f66d651a03ca41c0b18493b67ea6f3e61aba47d1bda4f3cf49b",
};

const TITLE = "KYA-OS Community";
const DESCRIPTION =
  "The KYA-OS community registry: who builds on it, what conforms to it, and the standards it carries.";

// The prefilled "Add your project" link: opens the GitHub new-file editor on
// registry/builders/ with the entry template already in the buffer. GitHub
// auto-forks for non-collaborators and opens the PR from the fork.
const ENTRY_TEMPLATE = {
  name: "Your Project",
  slug: "your-project",
  description: "One or two sentences on what you ship on KYA-OS.",
  homepage: "https://example.com",
  repo: "https://github.com/your-org/your-project",
  kind: "implementation",
  buildsOn: ["kya-os-mcp"],
  contact: { github: "your-github-username" },
  listedAt: "YYYY-MM-DD",
};
const ADD_PROJECT_URL = `${REPO_URL}/new/main/registry/builders?filename=your-project.json&value=${encodeURIComponent(
  JSON.stringify(ENTRY_TEMPLATE, null, 2) + "\n",
)}`;

// ── gate: never render an invalid registry ──────────────────────────────────

const { entries, interop, errors } = validateRegistry();
if (errors.length > 0) {
  console.error(`Refusing to build: registry validation failed (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const rendered = entries
  .filter((entry) => entry.slug !== TEMPLATE_SLUG)
  .sort((a, b) => a.slug.localeCompare(b.slug, "en"));
const interopSorted = [...interop].sort(
  (a, b) => INTEROP_CATEGORIES.indexOf(a.category) - INTEROP_CATEGORIES.indexOf(b.category) || a.slug.localeCompare(b.slug, "en"),
);

const byKind = (kind) => rendered.filter((entry) => entry.kind === kind);
const conformanceEntries = rendered.filter((entry) => entry.conformance !== undefined);

// ── helpers ─────────────────────────────────────────────────────────────────

/** Minimal HTML entity escaping for interpolated registry data. */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * The one honest way to print a conformance claim: a subset never renders as
 * a bare level - the covered categories are always part of the label.
 */
function conformanceLabel(conformance) {
  if (conformance.scope === "subset") {
    return `${conformance.level} subset (${conformance.categories.join(", ")})`;
  }
  return `${conformance.level} full`;
}

/**
 * Conformance status chip. `verified` is green ONLY because the schema and
 * validator guarantee attestationUrl exists when status is verified; the chip
 * itself is the credential link. No credential link, no green - by
 * construction there is no other code path.
 */
function conformanceStatusChip(conformance) {
  if (conformance.status === "verified") {
    return `<a class="chip st-verified" href="${esc(conformance.attestationUrl)}">verified</a>`;
  }
  if (conformance.status === "in-verification") {
    return '<span class="chip st-inverif">in verification</span>';
  }
  return '<span class="chip st-self">self-reported</span>';
}

function interopStatusChip(status) {
  const cls = { shipping: "st-shipping", specified: "st-specified", planned: "st-planned", exploring: "st-exploring", none: "st-none" }[status];
  return `<span class="chip ${cls}">${esc(status)}</span>`;
}

function tagRow(entry) {
  const buildsOn = (entry.buildsOn ?? []).map((repo) => `<code class="krepo">${esc(repo)}</code>`).join(" ");
  const standards = (entry.standards ?? [])
    .map((slug) => `<a class="stdtag" href="#std-${esc(slug)}">${esc(slug)}</a>`)
    .join(" ");
  const parts = [];
  if (buildsOn) parts.push(`<span class="builds-on">builds on ${buildsOn}</span>`);
  if (standards) parts.push(`<span class="builds-on">standards ${standards}</span>`);
  return parts.length > 0 ? `\n            ${parts.join("\n            ")}` : "";
}

function entryCard(entry) {
  const conformance = entry.conformance
    ? `\n          <div class="conf-line"><span class="chip conf">${esc(conformanceLabel(entry.conformance))}</span> ${conformanceStatusChip(entry.conformance)}</div>`
    : "";
  const deploys = (entry.deploy ?? [])
    .map((target) => `<a class="deploy-btn" href="${esc(target.url)}">Deploy on ${esc(platformName(target.platform))}</a>`)
    .join("\n            ");
  return `        <article class="card" id="${esc(entry.slug)}">
          <div class="card-head">
            <h3><a href="${esc(entry.homepage)}">${esc(entry.name)}</a></h3>
            <span class="chip kind">${esc(entry.kind)}</span>
          </div>
          <p class="desc">${esc(entry.description)}</p>${conformance}
          <div class="links">
            <a href="${esc(entry.homepage)}">homepage</a>${entry.repo ? `\n            <a href="${esc(entry.repo)}">repo</a>` : ""}${tagRow(entry)}
          </div>${deploys ? `\n          <div class="deploys">\n            ${deploys}\n          </div>` : ""}
        </article>`;
}

function platformName(platform) {
  return { vercel: "Vercel", railway: "Railway", cloudflare: "Cloudflare", docker: "Docker", other: "your platform" }[platform];
}

function addCta(label) {
  return `<p class="add-cta"><a href="${esc(ADD_PROJECT_URL)}">[ ${esc(label)} -&gt; ]</a></p>`;
}

// ── page sections ───────────────────────────────────────────────────────────

function sectionConformance() {
  const rows = conformanceEntries
    .map((entry) => {
      const c = entry.conformance;
      return `          <tr>
            <td><a href="#${esc(entry.slug)}">${esc(entry.name)}</a></td>
            <td class="mono">${esc(conformanceLabel(c))}</td>
            <td class="mono">${esc(c.suiteVersion)}</td>
            <td>${conformanceStatusChip(c)}</td>
            <td class="links-cell"><a href="${esc(entry.homepage)}">homepage</a>${entry.repo ? ` <a href="${esc(entry.repo)}">repo</a>` : ""}</td>
          </tr>`;
    })
    .join("\n");

  const table =
    conformanceEntries.length > 0
      ? `      <div class="table-wrap"><table>
        <thead><tr><th>Implementation</th><th>Claim</th><th>Suite</th><th>Status</th><th>Links</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table></div>`
      : `      <p class="empty">No conformance claims listed yet.</p>`;

  return `    <section id="conformance">
      <h2>Conformance</h2>
      <p class="section-lede">Conformance to KYA-OS is measured, not asserted: the program attests exactly the bytes it re-runs against the published vector suite at your pinned commit.
      Requirements live in <a href="${CONFORMANCE_MD_URL}">CONFORMANCE.md</a> (levels L1 core crypto, L2 full session, L3 full delegation), and any language that can read JSON and do Ed25519 + SHA-256 can play.
      The fastest on-ramp is the <a href="${STARTER_URL}">conformance starter</a>: clone to a submission-ready claim in under an hour.</p>
      <div class="pin mono">suite <b>${esc(SUITE.version)}</b> &middot; <b>${SUITE.vectors}</b> vectors &middot; pinned <span class="hash">${esc(SUITE.vectorSetHash)}</span></div>
      <div class="steps">
        <div class="step"><span class="step-n">1</span>Run the suite</div>
        <div class="step"><span class="step-n">2</span>Submit the claim</div>
        <div class="step"><span class="step-n">3</span>Independent re-run</div>
        <div class="step"><span class="step-n">4</span>Credential + badge</div>
      </div>
${table}
      <p class="note">Live badges at <span class="mono">badge.kya-os.org</span> ship at Phase B of the conformance program; until then the status chips above are the source of truth, and a claim is <span class="chip st-verified demo">verified</span> only when it links its credential.</p>
    </section>`;
}

function sectionBuilders() {
  const groups = [
    ["implementation", "Implementations"],
    ["service", "Services"],
    ["integration", "Integrations"],
    ["marketplace", "Marketplaces"],
  ];
  const blocks = groups
    .map(([kind, heading]) => {
      const list = byKind(kind);
      const cards = list.map((entry) => entryCard(entry)).join("\n");
      const body =
        list.length > 0
          ? `      <div class="cards">\n${cards}\n      </div>`
          : `      <p class="empty">None listed yet.</p>`;
      return `      <h3 class="group-head">${esc(heading)}<span class="group-count mono">${list.length}</span></h3>\n${body}`;
    })
    .join("\n");
  return `    <section id="builders">
      <h2>Builders</h2>
      <p class="section-lede">Who is building on KYA-OS, grouped by what they ship. Listing is one JSON file and one pull request; the criteria are in <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.</p>
${blocks}
      ${addCta("Add your project")}
    </section>`;
}

function sectionTemplates() {
  const list = byKind("template");
  const body =
    list.length > 0
      ? `      <div class="cards">\n${list.map((entry) => entryCard(entry)).join("\n")}\n      </div>`
      : `      <p class="empty">No templates listed yet.</p>`;
  return `    <section id="templates">
      <h2>Templates</h2>
      <p class="section-lede">Starting points you can copy: fork, fill in the marked seams, ship. Templates with one-click deploys carry their deploy buttons.</p>
${body}
      ${addCta("Add your template")}
    </section>`;
}

function sectionExamples() {
  const list = byKind("example");
  const body =
    list.length > 0
      ? `      <div class="cards">\n${list.map((entry) => entryCard(entry)).join("\n")}\n      </div>`
      : `      <p class="empty">No examples listed yet.</p>`;
  return `    <section id="examples">
      <h2>Examples</h2>
      <p class="section-lede">Working demonstrations of the protocol in the wild: read them before you build, steal from them while you build.</p>
${body}
      ${addCta("Add your example")}
    </section>`;
}

const CATEGORY_LABELS = {
  "discovery-projection": "Discovery projections",
  identity: "Identity",
  "credential-format": "Credential formats",
  revocation: "Revocation",
  transparency: "Transparency",
  payments: "Payments",
  canonicalization: "Canonicalization",
  transport: "Transport",
};

function sectionStandards() {
  const groups = INTEROP_CATEGORIES.filter((category) => interopSorted.some((entry) => entry.category === category));
  const blocks = groups
    .map((category) => {
      const rows = interopSorted
        .filter((entry) => entry.category === category)
        .map((entry) => {
          const evidence = entry.evidence ? `<a href="${esc(entry.evidence)}">evidence</a>` : "";
          const notes = entry.notes ? `<div class="row-notes">${esc(entry.notes)}</div>` : "";
          return `          <tr id="std-${esc(entry.slug)}">
            <td class="std-name">${esc(entry.standard)}</td>
            <td>${esc(entry.relationship)}${notes}</td>
            <td>${interopStatusChip(entry.status)}</td>
            <td class="links-cell">${evidence}</td>
          </tr>`;
        })
        .join("\n");
      return `      <h3 class="group-head">${esc(CATEGORY_LABELS[category])}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Standard</th><th>Relationship</th><th>Status</th><th>Evidence</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table></div>`;
    })
    .join("\n");
  return `    <section id="standards">
      <h2>Standards rails: what KYA-OS provides, carries, and projects onto</h2>
      <p class="section-lede">Every row is grounded: <span class="chip st-shipping demo">shipping</span> means code at the current release, <span class="chip st-specified demo">specified</span> means normative spec text, <span class="chip st-planned demo">planned</span> is on the roadmap, <span class="chip st-exploring demo">exploring</span> is under evaluation, and <span class="chip st-none demo">none</span> means exactly that - listed so nobody has to guess.
      A status is never listed above what its evidence link shows. The machine-readable matrix is <a href="/interop.json">interop.json</a>.</p>
${blocks}
    </section>`;
}

function sectionSubmit() {
  return `    <section id="submit">
      <h2>Submit</h2>
      <p class="section-lede">Three paths, all public, none gatekept.</p>
      <div class="paths">
        <article class="path primary">
          <h3>1. Add your project (prefilled)</h3>
          <p>One click opens the GitHub editor on <code>registry/builders/</code> with the entry template already filled in.
          Rename the file to <code>&lt;your-slug&gt;.json</code>, edit the fields, and propose the change: GitHub forks the repo for you and opens the pull request.</p>
          <p><a class="btn" href="${esc(ADD_PROJECT_URL)}">Add your project -&gt;</a></p>
        </article>
        <article class="path">
          <h3>2. Copy the template file</h3>
          <p>Prefer a local workflow? Copy <a href="${REPO_URL}/blob/main/registry/builders/example-builder.json"><code>example-builder.json</code></a> to <code>registry/builders/&lt;your-slug&gt;.json</code>, run <code>npm test</code> (no dependencies to install), and open a PR.
          Full field reference in <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.</p>
        </article>
        <article class="path">
          <h3>3. Claim conformance</h3>
          <p>Run the pinned vector suite (the <a href="${STARTER_URL}">starter</a> automates it), then open a <a href="${SUBMISSION_ISSUE_URL}">conformance submission issue</a> on kya-os-mcp with your <code>claim.json</code>.
          The program re-runs your suite independently and attests what it observes; your registry entry then carries the claim.</p>
        </article>
      </div>
    </section>`;
}

// ── pages ───────────────────────────────────────────────────────────────────

const SHARED_CSS = `
  :root{ --bg:#0a0a0a; --fg:#e0e0e0; --muted:#666; --accent:#fff; --grid:#1a1a1a;
    --green:#3fb950; --amber:#d29922; --blue:#58a6ff; --red:#f85149; }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg);
    line-height:1.6;-webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden;min-height:100vh}
  body::before{content:"";position:fixed;inset:0;background-image:radial-gradient(circle,var(--grid) 1px,transparent 1px);background-size:40px 40px;opacity:.5;pointer-events:none;z-index:0}
  .wrap{max-width:980px;margin:0 auto;padding:0 40px;position:relative;z-index:1}
  a{color:var(--fg);text-decoration:none}
  a:hover{color:var(--accent)}
  code,.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
  ::selection{background:var(--accent);color:var(--bg)}
  header.bar{border-bottom:1px solid var(--grid);position:sticky;top:0;background:rgba(10,10,10,.92);backdrop-filter:blur(6px);z-index:2}
  header.bar .wrap{display:flex;align-items:center;gap:16px;height:64px}
  .brand{color:var(--accent);font-weight:600;font-size:16px;letter-spacing:-.01em;white-space:nowrap}
  .brand .sub{color:var(--muted);font-weight:400}
  nav{margin-left:auto;display:flex;gap:18px;font-family:ui-monospace,monospace;font-size:13px;flex-wrap:wrap}
  nav a{color:var(--muted)}
  nav a:hover{color:var(--accent)}
  footer{border-top:1px solid var(--grid);margin-top:72px;padding:28px 0 64px;color:var(--muted);font-size:13px}
  footer .wrap{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center}
  footer a{color:var(--muted)}
  footer a:hover{color:var(--accent)}`;

function pageShell({ title, headExtra = "", body, nav = "" }) {
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
    <a class="brand" href="/">KYA-OS<span class="sub"> / community</span></a>
    <nav>${nav}
      <a href="${REPO_URL}">GitHub</a>
    </nav>
  </div></header>
${body}
  <footer><div class="wrap">
    <span>KYA-OS Usergroup &middot; <span class="mono">builders.kya-os.org</span></span>
    <a href="${SITE_URL}">Protocol</a>
    <a href="${MCP_REPO_URL}">Spec repo</a>
    <a href="${DIF_URL}">DIF</a>
    <a href="/builders.json">builders.json</a>
    <a href="/interop.json">interop.json</a>
    <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">Get listed</a>
  </div></footer>
</body>
</html>
`;
}

const NAV_LINKS = `
      <a href="#conformance">Conformance</a>
      <a href="#builders">Builders</a>
      <a href="#templates">Templates</a>
      <a href="#examples">Examples</a>
      <a href="#standards">Standards</a>
      <a href="#submit">Submit</a>`;

function renderIndexHtml() {
  const body = `
  <article class="wrap">
    <section class="hero">
      <div class="eyebrow">Decentralized Identity Foundation</div>
      <h1>KYA-OS community</h1>
      <p class="lede">${esc(DESCRIPTION)}</p>
      <div class="chips-row">
        <a class="btn" href="${esc(ADD_PROJECT_URL)}">Add your project -&gt;</a>
        <span class="stat"><b>${rendered.length}</b> listed</span>
        <span class="stat"><b>${interopSorted.length}</b> standards rails</span>
        <a class="stat" href="/builders.json">builders.json</a>
        <a class="stat" href="/interop.json">interop.json</a>
      </div>
    </section>
    <main>
${sectionConformance()}
${sectionBuilders()}
${sectionTemplates()}
${sectionExamples()}
${sectionStandards()}
${sectionSubmit()}
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
  .hero{padding:72px 0 20px}
  .eyebrow{font-family:ui-monospace,monospace;font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin-bottom:24px}
  h1{font-size:clamp(42px,7vw,64px);font-weight:300;letter-spacing:-.02em;line-height:1.05;color:var(--accent)}
  .lede{max-width:680px;font-size:18px;line-height:1.85;margin-top:24px}
  .chips-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:32px;align-items:center}
  .stat{font-family:ui-monospace,monospace;font-size:12.5px;color:var(--muted);border:1px solid var(--grid);padding:7px 13px;background:rgba(255,255,255,.02)}
  .stat b{color:var(--fg);font-weight:500}
  a.stat:hover{color:var(--accent);border-color:var(--muted)}
  .btn{display:inline-block;font-family:ui-monospace,monospace;font-size:13px;color:var(--bg);background:var(--accent);padding:9px 16px;font-weight:600;border:1px solid var(--accent)}
  .btn:hover{background:var(--bg);color:var(--accent)}
  main{padding:8px 0}
  section{padding:44px 0 8px;scroll-margin-top:76px}
  h2{font-size:26px;font-weight:400;letter-spacing:-.01em;color:var(--accent);margin-bottom:14px}
  .section-lede{max-width:760px;font-size:15px;color:var(--fg);margin-bottom:20px}
  .section-lede a{text-decoration:underline;text-underline-offset:3px}
  .group-head{font-family:ui-monospace,monospace;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:26px 0 12px;display:flex;align-items:center;gap:10px}
  .group-count{font-size:11px;border:1px solid var(--grid);padding:1px 7px;color:var(--muted)}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(390px,1fr));gap:16px}
  @media(max-width:520px){.cards{grid-template-columns:1fr}}
  .card{padding:26px;background:rgba(255,255,255,.02);border:1px solid var(--grid);transition:background .2s ease,border-color .2s ease}
  .card:hover{background:rgba(255,255,255,.04);border-color:var(--muted)}
  .card-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
  .card h3{font-size:18px;font-weight:600;letter-spacing:-.01em}
  .card h3 a{color:var(--accent)}
  .chip{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border:1px solid var(--grid);padding:3px 8px;white-space:nowrap}
  .chip.demo{font-size:10px;padding:1px 6px}
  .chip.kind{text-transform:none}
  .chip.conf{color:var(--fg);text-transform:none}
  .st-verified{color:var(--green);border-color:var(--green)}
  a.st-verified{text-decoration:underline;text-underline-offset:3px}
  .st-inverif{color:var(--amber);border-color:var(--amber)}
  .st-self{color:var(--muted);border-color:var(--grid)}
  .st-shipping{color:var(--green);border-color:var(--green)}
  .st-specified{color:var(--blue);border-color:var(--blue)}
  .st-planned{color:var(--muted);border-color:var(--muted)}
  .st-exploring{color:var(--muted);border-style:dashed;border-color:var(--muted)}
  .st-none{color:var(--muted);border-color:var(--grid)}
  .conf-line{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
  .card .desc{font-size:15px;line-height:1.6;margin-bottom:16px}
  .card .links{display:flex;gap:14px;flex-wrap:wrap;font-family:ui-monospace,monospace;font-size:12.5px;align-items:baseline}
  .card .links a{color:var(--muted);text-decoration:underline;text-underline-offset:3px}
  .card .links a:hover{color:var(--accent)}
  .builds-on{color:var(--muted);font-size:12px}
  .krepo{color:var(--fg);font-size:12px}
  .stdtag{color:var(--fg);font-family:ui-monospace,monospace;font-size:12px;text-decoration:underline;text-underline-offset:3px}
  .deploys{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
  .deploy-btn{font-family:ui-monospace,monospace;font-size:12px;color:var(--fg);border:1px solid var(--muted);padding:6px 12px}
  .deploy-btn:hover{color:var(--bg);background:var(--accent);border-color:var(--accent)}
  .empty{color:var(--muted);font-size:14px;padding:6px 0 10px}
  .add-cta{margin-top:20px;font-family:ui-monospace,monospace;font-size:13px}
  .add-cta a{color:var(--muted)}
  .add-cta a:hover{color:var(--accent)}
  .pin{font-size:12.5px;color:var(--muted);border:1px solid var(--grid);background:rgba(255,255,255,.02);padding:10px 14px;margin-bottom:18px;overflow-x:auto;white-space:nowrap}
  .pin b{color:var(--fg);font-weight:500}
  .pin .hash{color:var(--fg)}
  .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:22px}
  .step{border:1px solid var(--grid);background:rgba(255,255,255,.02);padding:14px;font-size:13.5px;display:flex;align-items:center;gap:10px}
  .step-n{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);border:1px solid var(--grid);width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
  .table-wrap{overflow-x:auto;border:1px solid var(--grid);background:rgba(255,255,255,.02);margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:left;padding:10px 14px;border-bottom:1px solid var(--grid)}
  td{padding:12px 14px;border-bottom:1px solid var(--grid);vertical-align:top}
  tr:last-child td{border-bottom:none}
  td.mono{font-size:12.5px;white-space:nowrap}
  td.std-name{color:var(--accent);min-width:180px}
  td.links-cell{font-family:ui-monospace,monospace;font-size:12px;white-space:nowrap}
  td.links-cell a{color:var(--muted);text-decoration:underline;text-underline-offset:3px}
  td.links-cell a:hover{color:var(--accent)}
  .row-notes{color:var(--muted);font-size:12.5px;margin-top:6px}
  .note{color:var(--muted);font-size:13.5px;max-width:760px}
  .paths{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
  .path{padding:24px;border:1px solid var(--grid);background:rgba(255,255,255,.02)}
  .path.primary{border-color:var(--muted)}
  .path h3{font-size:15px;font-weight:600;color:var(--accent);margin-bottom:10px}
  .path p{font-size:14px;margin-bottom:10px}
  .path a{text-decoration:underline;text-underline-offset:3px}
  .path a.btn{text-decoration:none}
  .path code{font-size:12.5px;color:var(--fg)}`;

  return pageShell({ title: TITLE, headExtra, body, nav: NAV_LINKS }).replace("\n</style>", `${extraCss}\n</style>`);
}

function render404Html() {
  const body = `
  <article class="wrap">
    <section class="nf">
      <div class="code mono">404</div>
      <h1>Not found</h1>
      <p>No page or registry resource matches this path.</p>
      <p><a class="back" href="/">&larr; The community hub</a></p>
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

function renderBuildersJson() {
  return (
    JSON.stringify(
      {
        registry: "kya-os-usergroup",
        source: REPO_URL,
        schema: `${REPO_URL}/blob/main/registry/schema/builder.schema.json`,
        count: rendered.length,
        builders: rendered,
      },
      null,
      2,
    ) + "\n"
  );
}

function renderInteropJson() {
  return (
    JSON.stringify(
      {
        registry: "kya-os-usergroup/interop",
        source: REPO_URL,
        schema: `${REPO_URL}/blob/main/registry/schema/interop.schema.json`,
        count: interopSorted.length,
        interop: interopSorted,
      },
      null,
      2,
    ) + "\n"
  );
}

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

// ── emit ────────────────────────────────────────────────────────────────────

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

writeFileSync(join(distDir, "index.html"), renderIndexHtml());
writeFileSync(join(distDir, "404.html"), render404Html());
writeFileSync(join(distDir, "builders.json"), renderBuildersJson());
writeFileSync(join(distDir, "interop.json"), renderInteropJson());
writeFileSync(join(distDir, "_headers"), renderHeaders());

// ── render check: assert the artifact is complete and honest ────────────────

function assertBuild(condition, message) {
  if (!condition) {
    console.error(`Render check FAILED: ${message}`);
    process.exit(1);
  }
}

for (const name of ["index.html", "404.html", "builders.json", "interop.json", "_headers"]) {
  const path = join(distDir, name);
  assertBuild(statSync(path).size > 0, `dist/${name} is missing or empty`);
}
const indexHtml = readFileSync(join(distDir, "index.html"), "utf8");
for (const entry of rendered) {
  assertBuild(indexHtml.includes(esc(entry.name)), `dist/index.html does not list "${entry.name}"`);
}
for (const entry of interopSorted) {
  assertBuild(indexHtml.includes(`id="std-${entry.slug}"`), `dist/index.html does not list standard "${entry.slug}"`);
}

// Honesty assertions.
// "Certificate Transparency" (RFC 9162) is a standard's proper name and is
// fine; conformance-flavored "certified"/"certification" language is not.
assertBuild(!/certified|certification/i.test(indexHtml), 'the word "certified"/"certification" leaked into index.html');
for (const entry of conformanceEntries) {
  const c = entry.conformance;
  if (c.scope === "subset") {
    assertBuild(
      indexHtml.includes(esc(`${c.level} subset (${c.categories.join(", ")})`)),
      `subset claim for "${entry.slug}" must render with its categories, never as a bare level`,
    );
  }
}
// A green "verified" chip exists only as a credential link: no anchor-less occurrence.
assertBuild(
  !/<span class="chip st-verified(?! demo)/.test(indexHtml),
  'a "verified" chip rendered without a credential link',
);

const published = JSON.parse(readFileSync(join(distDir, "builders.json"), "utf8"));
assertBuild(published.count === rendered.length, "builders.json count mismatch");
assertBuild(
  !published.builders.some((entry) => entry.slug === TEMPLATE_SLUG),
  `template entry "${TEMPLATE_SLUG}" leaked into builders.json`,
);
assertBuild(!indexHtml.includes(`id="${TEMPLATE_SLUG}"`), `template entry "${TEMPLATE_SLUG}" leaked into index.html`);
const publishedInterop = JSON.parse(readFileSync(join(distDir, "interop.json"), "utf8"));
assertBuild(publishedInterop.count === interopSorted.length, "interop.json count mismatch");
const notFoundHtml = readFileSync(join(distDir, "404.html"), "utf8");
assertBuild(notFoundHtml.includes("404"), "dist/404.html is not a not-found page");

console.log(
  `Built Pages artifact: ${rendered.length} entr${rendered.length === 1 ? "y" : "ies"}, ${interopSorted.length} standards rails -> dist/ (static-only, real 404.html, no worker)`,
);
