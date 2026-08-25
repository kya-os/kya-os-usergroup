/**
 * Shared HTML primitives for the site build: escaping, the honesty chips,
 * the copy-to-agent prompt block, the shared page shell (fixed nav + footer,
 * per the Builders Site design handoff), and the 404 page. All CSS lives in
 * site/assets/css/ (tokens.css + hub.css).
 *
 * CONFORMANCE HONESTY RULES are enforced here at render time (and asserted
 * against the finished artifact in lib/assertions.mjs):
 *   - a subset claim NEVER renders as a bare level ("L1 subset (signed-proof)",
 *     never "L1")
 *   - "verified" renders green ONLY with the credential link (attestationUrl);
 *     in-verification is amber, self-reported is grey
 *   - the word "certified" appears nowhere
 */
import { DIF_URL, MCP_REPO_URL, PROMPTS, REPO_URL, SITE_URL, TITLE } from "./constants.mjs";
import { THEME_COLORS, THEME_SCRIPT } from "./theme.mjs";

/** Minimal HTML entity escaping for interpolated registry data. */
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * Conformance status chip. `verified` is green ONLY when the build's
 * cryptographic verification produced a verdict for the entry's credential
 * (site/lib/credentials.mjs - the build refuses before rendering otherwise)
 * AND the credential's status bits are clean; the chip itself is the
 * credential link. No verified credential, no green - by construction there
 * is no other code path. A suspension bit renders the claim contested
 * ("under appeal", amber) and a revoked credential renders the terminal dark
 * chip - both still linking the credential, which carries the public record.
 *
 * Non-verified chips follow the same pattern one tier down: when the entry
 * carries evidenceUrl (the public submission issue or verification thread),
 * the chip links it, so the middle credibility tiers are auditable on-page.
 * Wording is fixed (verified / in verification / self-reported / under
 * appeal / revoked); the design swap restyled the chips, never the words.
 */
export function conformanceStatusChip(conformance, { link = true, verdict } = {}) {
  if (conformance.status === "verified" || conformance.status === "revoked") {
    if (verdict === undefined) {
      throw new Error(`a "${conformance.status}" chip cannot render without the build's credential verdict (fail closed)`);
    }
    const inner =
      verdict.state === "revoked"
        ? `<span class="chip st-revoked">revoked</span>`
        : verdict.state === "suspended"
          ? `<span class="chip st-inverif">&#9676; under appeal</span>`
          : `<span class="chip st-verified">&check; verified</span>`;
    return link ? `<a class="chip-link" href="${esc(conformance.attestationUrl)}">${inner}</a>` : inner;
  }
  const [label, cls, mark] =
    conformance.status === "in-verification" ? ["in verification", "st-inverif", "&#9676;"] : ["self-reported", "st-self", "&middot;"];
  const inner = `<span class="chip ${cls}">${mark} ${label}</span>`;
  if (link && conformance.evidenceUrl) {
    return `<a class="chip-link" href="${esc(conformance.evidenceUrl)}">${inner}</a>`;
  }
  return inner;
}

export function interopStatusChip(status) {
  const cls = { shipping: "st-shipping", specified: "st-specified", planned: "st-planned", exploring: "st-exploring", none: "st-none" }[status];
  return `<span class="chip ${cls}">${esc(status)}</span>`;
}

/**
 * A copy-to-agent prompt block: the bordered mono button (hidden until
 * /ui/copy-prompt.js reveals and wires it - no JS, no dead button) plus the
 * always-reachable <details> fallback carrying the same text. The button
 * copies FROM the fallback's <pre>, so the two can never disagree; the
 * assertion in lib/assertions.mjs re-checks the rendered pair anyway.
 */
export function promptBlock(promptId) {
  const prompt = PROMPTS.find((p) => p.id === promptId);
  return `<div class="agent-prompt">
        <button type="button" class="copy-btn" data-copy-target="${prompt.id}" hidden>[ copy prompt for your agent ]</button>
        <details class="prompt-fallback"><summary>or copy manually</summary><pre id="${prompt.id}">${esc(prompt.text)}</pre></details>
      </div>`;
}

// The site's page set, in nav order (label, root-absolute href). Both
// Cloudflare Pages and a local `python3 -m http.server` on dist/ serve from
// the root, so root-absolute links hold from any subfolder page.
export const NAV_PAGES = [
  ["/", "overview"],
  ["/builders/", "builders"],
  ["/conformance/", "conformance"],
  ["/standards/", "standards"],
  ["/rails/", "rails"],
  ["/use-cases/", "use-cases"],
];

/** The theme-swapping logo mark pair (white mark in dark, black in light). */
function logoMark(cls = "") {
  return (
    `<img class="mark mark-white${cls}" src="/img/kya-mark-white.svg" alt="" width="16" height="18" />` +
    `<img class="mark mark-black${cls}" src="/img/kya-mark-black.svg" alt="" width="16" height="18" />`
  );
}

/**
 * The shared shell: head (meta, the two same-origin stylesheets, the ONE
 * inline script - theme toggle + js-anim gate + page-fx failsafe, CSP-pinned
 * by hash - and the two module tags, covered by script-src 'self'), the
 * fixed top nav with the current page in white, and the footer. `current` is
 * the page's root-absolute path ("/builders/"); null (the 404 page)
 * highlights nothing. Scripts sit in <head>: the inline script's pre-paint
 * halves must run before first render, and modules are deferred by nature.
 */
export function pageShell({ title, headExtra = "", body, current = null }) {
  const navLinks = NAV_PAGES.map(([href, label]) =>
    href === current
      ? `\n    <a href="${href}" data-glitch aria-current="page" class="nav-on">${label}</a>`
      : `\n    <a href="${href}" data-glitch>${label}</a>`,
  ).join("");
  const addHref = current === "/builders/" ? "#submit" : "/builders/#submit";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="color-scheme" content="dark light" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLORS.dark}" />
${headExtra}<link rel="stylesheet" href="/tokens.css" />
<link rel="stylesheet" href="/hub.css" />
<script>${THEME_SCRIPT}</script>
<script type="module" src="/ui/page-fx.js"></script>
<script type="module" src="/ui/copy-prompt.js"></script>
</head>
<body>
<div class="page">
<nav class="topnav">
  <a class="brand" href="/">${logoMark()}<span class="brand-name">KYA-OS</span><span class="brand-sub"> / builders</span></a>
  <div class="nav-links">${navLinks}
    <button id="theme-toggle" type="button" class="theme-btn" aria-label="Theme: system. Click to change.">[ auto ]</button>
    <a class="nav-cta" href="${addHref}">[ add project -&gt; ]</a>
  </div>
</nav>
<main>
${body}
  <footer>
    <span class="foot-brand">${logoMark(" mark-sm")}KYA-OS Usergroup &middot; builders.kya-os.org</span>
    <div class="foot-links">
      <a href="${SITE_URL}">protocol</a>
      <a href="${MCP_REPO_URL}">spec repo</a>
      <a href="${DIF_URL}">DIF</a>
      <a href="${REPO_URL}">GitHub</a>
      <a href="/builders.json">builders.json</a>
      <a href="/interop.json">interop.json</a>
      <a href="/builders/#submit">get listed</a>
    </div>
  </footer>
</main>
</div>
</body>
</html>
`;
}

export function render404Html() {
  const body = `  <header class="hero fx">
    <div class="kicker">KYA-OS COMMUNITY</div>
    <h1 data-title-reveal>NOT FOUND</h1>
    <p class="lede">No page or registry resource matches this path.</p>
  </header>
  <section class="fx fxd-15">
    <p class="nf-back"><a href="/">&lt;- back to the overview</a></p>
    <p class="nf-pages">${NAV_PAGES.map(([href]) => `<a href="${href}">${href}</a>`).join(" &middot; ")}</p>
  </section>`;
  return pageShell({
    title: `Not found · ${TITLE}`,
    headExtra: '<meta name="robots" content="noindex" />\n',
    body,
  });
}
