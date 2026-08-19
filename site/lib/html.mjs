/**
 * Shared HTML primitives for the site build: escaping, the chip and card
 * helpers, the shared page shell and CSS, and the 404 page.
 *
 * CONFORMANCE HONESTY RULES are enforced here at render time (and asserted
 * against the finished artifact in lib/assertions.mjs):
 *   - a subset claim NEVER renders as a bare level ("L1 subset (signed-proof)",
 *     never "L1")
 *   - "verified" renders green ONLY with the credential link (attestationUrl);
 *     in-verification is amber, self-reported is grey
 *   - the word "certified" appears nowhere
 */
import { ADD_PROJECT_URL, DIF_URL, MCP_REPO_URL, REPO_URL, SITE_URL, TITLE } from "./constants.mjs";
import { conformanceLabel, conformanceLevelUrl } from "./data.mjs";

/** Minimal HTML entity escaping for interpolated registry data. */
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * Conformance status chip. `verified` is green ONLY because the schema and
 * validator guarantee attestationUrl exists when status is verified; the chip
 * itself is the credential link. No credential link, no green - by
 * construction there is no other code path.
 *
 * Non-verified chips follow the same pattern one tier down: when the entry
 * carries evidenceUrl (the public submission issue or verification thread),
 * the chip links it, so the middle credibility tiers are auditable on-page
 * instead of dead-ending at the claim text.
 */
export function conformanceStatusChip(conformance) {
  if (conformance.status === "verified") {
    return `<a class="chip st-verified" href="${esc(conformance.attestationUrl)}">verified</a>`;
  }
  const label = conformance.status === "in-verification" ? "in verification" : "self-reported";
  const cls = conformance.status === "in-verification" ? "st-inverif" : "st-self";
  if (conformance.evidenceUrl) {
    return `<a class="chip ${cls}" href="${esc(conformance.evidenceUrl)}">${label}</a>`;
  }
  return `<span class="chip ${cls}">${label}</span>`;
}

export function interopStatusChip(status) {
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

export function entryCard(entry) {
  const conformance = entry.conformance
    ? `\n          <div class="conf-line"><a class="chip conf" href="${esc(conformanceLevelUrl(entry.conformance))}">${esc(conformanceLabel(entry.conformance))}</a> ${conformanceStatusChip(entry.conformance)}</div>`
    : "";
  const deploys = (entry.deploy ?? [])
    .map((target) => `<a class="deploy-btn" href="${esc(target.url)}">Deploy on ${esc(platformName(target.platform))}</a>`)
    .join("\n            ");
  const repoLink = entry.repo && entry.repo !== entry.homepage ? `\n            <a href="${esc(entry.repo)}">repo</a>` : "";
  return `        <article class="card" id="${esc(entry.slug)}">
          <div class="card-head">
            <h3><a href="${esc(entry.homepage)}">${esc(entry.name)}</a></h3>
            <span class="chip kind">${esc(entry.kind)}</span>
          </div>
          <p class="desc">${esc(entry.description)}</p>${conformance}
          <div class="links">
            <a href="${esc(entry.homepage)}">homepage</a>${repoLink}${tagRow(entry)}
          </div>${deploys ? `\n          <div class="deploys">\n            ${deploys}\n          </div>` : ""}
        </article>`;
}

function platformName(platform) {
  return { vercel: "Vercel", railway: "Railway", cloudflare: "Cloudflare", docker: "Docker", other: "your platform" }[platform];
}

export function addCta(label) {
  return `<p class="add-cta"><a href="${esc(ADD_PROJECT_URL)}">[ ${esc(label)} -&gt; ]</a></p>`;
}

// The base look every page shares; page-specific CSS is appended into the
// same <style> block by the page renderers (see the .replace in render404Html
// and lib/sections.mjs renderIndexHtml).
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
  header.bar .wrap{display:flex;align-items:center;flex-wrap:wrap;gap:10px 16px;min-height:64px;padding-top:10px;padding-bottom:10px}
  .brand{color:var(--accent);font-weight:600;font-size:16px;letter-spacing:-.01em;white-space:nowrap}
  .brand .sub{color:var(--muted);font-weight:400}
  nav{margin-left:auto;display:flex;gap:8px 18px;font-family:ui-monospace,monospace;font-size:13px;flex-wrap:wrap}
  nav a{color:var(--muted)}
  nav a:hover{color:var(--accent)}
  @media(max-width:800px){header.bar{position:static}}
  footer{border-top:1px solid var(--grid);margin-top:72px;padding:28px 0 64px;color:var(--muted);font-size:13px}
  footer .wrap{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center}
  footer a{color:var(--muted)}
  footer a:hover{color:var(--accent)}`;

export function pageShell({ title, headExtra = "", body, nav = "" }) {
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

export function render404Html() {
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
