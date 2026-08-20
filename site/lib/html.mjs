/**
 * Shared HTML primitives for the site build: escaping, the chip and card
 * helpers, the shared page shell, and the 404 page. All CSS (tokens and
 * rules, light and dark) lives in lib/theme.mjs.
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
import { NOT_FOUND_CSS, SHARED_CSS, THEME_COLORS, THEME_SCRIPT } from "./theme.mjs";

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
    .map((slug) => `<a class="stdtag" href="/standards/#std-${esc(slug)}">${esc(slug)}</a>`)
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

// The site's page set, in nav order. Root-absolute hrefs (never relative):
// both Cloudflare Pages and a local `python3 -m http.server` on dist/ serve
// from the root, so the links hold from any subfolder page.
export const NAV_PAGES = [
  ["/builders/", "Builders"],
  ["/conformance/", "Conformance"],
  ["/standards/", "Standards"],
];

/**
 * The shared shell: head (meta, style, the inline theme script - CSP-pinned
 * by hash), the top nav with the current page highlighted, and the footer.
 * `current` is the page's root-absolute path ("/builders/"); null (the 404
 * page) highlights nothing. `animScript` (landing page only) emits a second
 * hashed inline script right after the theme script, still in <head> so its
 * pre-paint half runs before first render.
 */
export function pageShell({ title, headExtra = "", body, current = null, animScript = null }) {
  const navLinks = NAV_PAGES.map(
    ([href, label]) => `\n      <a href="${href}"${href === current ? ' class="active" aria-current="page"' : ""}>${label}</a>`,
  ).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="color-scheme" content="light dark" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLORS.dark}" />
${headExtra}<style>${SHARED_CSS}
</style>
<script>${THEME_SCRIPT}</script>
${animScript ? `<script>${animScript}</script>\n` : ""}</head>
<body>
  <header class="bar"><div class="wrap">
    <a class="brand" href="/">KYA-OS<span class="sub"> / community</span></a>
    <nav>${navLinks}
      <button id="theme-toggle" type="button" class="theme-btn" aria-label="Theme: system. Click to change.">auto</button>
      <a class="nav-cta" href="${esc(ADD_PROJECT_URL)}">Add project -&gt;</a>
    </nav>
  </div></header>
${body}
  <footer><div class="wrap">
    <span>KYA-OS Usergroup &middot; <span class="mono">builders.kya-os.org</span></span>
    <a href="${SITE_URL}">Protocol</a>
    <a href="${MCP_REPO_URL}">Spec repo</a>
    <a href="${DIF_URL}">DIF</a>
    <a href="${REPO_URL}">GitHub</a>
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
      <p class="nf-pages mono"><a href="/builders/">/builders/</a> &middot; <a href="/conformance/">/conformance/</a> &middot; <a href="/standards/">/standards/</a></p>
    </section>
  </article>`;
  return pageShell({
    title: `Not found · ${TITLE}`,
    headExtra: '<meta name="robots" content="noindex" />\n',
    body,
  }).replace("\n</style>", `${NOT_FOUND_CSS}\n</style>`);
}
