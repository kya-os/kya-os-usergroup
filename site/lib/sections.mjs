/**
 * The index page: one renderer per section (hero, conformance, builders,
 * templates, examples, standards, submit) and the assembly that composes
 * them into index.html. Every renderer is a pure function of the shaped
 * registry data from lib/data.mjs; all markup primitives come from
 * lib/html.mjs.
 */
import {
  ADD_PROJECT_URL,
  CONFORMANCE_MD_URL,
  DESCRIPTION,
  ORIGIN,
  REPO_URL,
  STARTER_URL,
  SUBMISSION_ISSUE_URL,
  SUITE,
  TITLE,
} from "./constants.mjs";
import { byKind, conformanceLabel, conformanceLevelUrl, interopByCategory, withConformance } from "./data.mjs";
import { addCta, conformanceStatusChip, entryCard, esc, interopStatusChip, pageShell } from "./html.mjs";

function sectionHero({ rendered, interopSorted }) {
  return `    <section class="hero">
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
    </section>`;
}

function sectionConformance(rendered) {
  const conformanceEntries = withConformance(rendered);
  const rows = conformanceEntries
    .map((entry) => {
      const c = entry.conformance;
      const repoLink = entry.repo && entry.repo !== entry.homepage ? ` <a href="${esc(entry.repo)}">repo</a>` : "";
      return `          <tr>
            <td><a href="#${esc(entry.slug)}">${esc(entry.name)}</a></td>
            <td class="mono"><a class="claim-link" href="${esc(conformanceLevelUrl(c))}">${esc(conformanceLabel(c))}</a></td>
            <td class="mono">${esc(c.suiteVersion)}</td>
            <td>${conformanceStatusChip(c)}</td>
            <td class="links-cell"><a href="${esc(entry.homepage)}">homepage</a>${repoLink}</td>
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
      A level is claimed in full or as a named subset of vector categories - a subset claim covers exactly the categories it names and never rounds up to the bare level.
      The fastest on-ramp is the <a href="${STARTER_URL}">conformance starter</a>: clone to a submission-ready claim in under an hour.</p>
      <div class="pin mono">suite <b>${esc(SUITE.version)}</b> &middot; <b>${SUITE.vectors}</b> vectors &middot; pinned <span class="hash">${esc(SUITE.vectorSetHash)}</span></div>
      <div class="steps">
        <a class="step" href="${STARTER_URL}"><span class="step-n">1</span>Run the suite</a>
        <a class="step" href="${SUBMISSION_ISSUE_URL}"><span class="step-n">2</span>Submit the claim</a>
        <div class="step"><span class="step-n">3</span>Independent re-run</div>
        <div class="step"><span class="step-n">4</span>Credential + badge</div>
      </div>
${table}
      <p class="note">Live badges at <span class="mono">badge.kya-os.org</span> ship at Phase B of the conformance program; until then the status chips above are the source of truth, and a claim is <span class="chip st-verified demo">verified</span> only when it links its credential.</p>
    </section>`;
}

// SCALE TRIGGER: when the rendered entry count passes ~25, add a zero-dep
// inline filter (a vanilla-JS <input>; the CSP script-src must gain a hash)
// or a per-kind/per-letter anchor strip. Below that, group counts suffice.
function sectionBuilders(rendered) {
  const groups = [
    ["implementation", "Implementations"],
    ["service", "Services"],
    ["integration", "Integrations"],
    ["marketplace", "Marketplaces"],
  ];
  // Empty kinds collapse into one invitation line instead of manufacturing
  // empty sections that read as weakness at launch.
  const nonEmpty = groups.filter(([kind]) => byKind(rendered, kind).length > 0);
  const empty = groups.filter(([kind]) => byKind(rendered, kind).length === 0);
  const blocks = nonEmpty
    .map(([kind, heading]) => {
      const list = byKind(rendered, kind);
      const cards = list.map((entry) => entryCard(entry)).join("\n");
      return `      <h3 class="group-head">${esc(heading)}<span class="group-count mono">${list.length}</span></h3>\n      <div class="cards">\n${cards}\n      </div>`;
    })
    .join("\n");
  const emptyLine =
    empty.length > 0
      ? `\n      <p class="empty">No ${esc(empty.map(([, heading]) => heading.toLowerCase()).join(" or "))} yet - <a href="${esc(ADD_PROJECT_URL)}">be the first -&gt;</a></p>`
      : "";
  return `    <section id="builders">
      <h2>Builders</h2>
      <p class="section-lede">Who is building on KYA-OS, grouped by what they ship. Listing is one JSON file and one pull request; the criteria are in <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.</p>
${blocks}${emptyLine}
      ${addCta("Add your project")}
    </section>`;
}

function sectionTemplates(rendered) {
  const list = byKind(rendered, "template");
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

function sectionExamples(rendered) {
  const list = byKind(rendered, "example");
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

function sectionStandards(interopSorted) {
  const blocks = interopByCategory(interopSorted)
    .map(([category, entries]) => {
      const rows = entries
        .map((entry) => {
          const evidence = entry.evidence ? `<a href="${esc(entry.evidence)}">evidence</a> ` : "";
          const editLink = `<a href="${REPO_URL}/edit/main/registry/interop/${esc(entry.slug)}.json">edit</a>`;
          const notes = entry.notes ? `<div class="row-notes">${esc(entry.notes)}</div>` : "";
          return `          <tr id="std-${esc(entry.slug)}">
            <td class="std-name">${esc(entry.standard)}</td>
            <td>${esc(entry.relationship)}${notes}</td>
            <td>${interopStatusChip(entry.status)}<div class="row-listed mono">listed ${esc(entry.listedAt)}</div></td>
            <td class="links-cell">${evidence}${editLink}</td>
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
      A status is never listed above what its evidence link shows, and every row carries the date it was listed.
      Disputes and updates are one pull request: each row's <b>edit</b> link opens its file in <code>registry/interop/</code>. The machine-readable matrix is <a href="/interop.json">interop.json</a>.</p>
${blocks}
    </section>`;
}

function sectionSubmit() {
  return `    <section id="submit">
      <h2>Submit</h2>
      <p class="section-lede">Three paths, all public, none gatekept.
      Corrections count too: every standards-matrix row is one file in <code>registry/interop/</code> - use the row's edit link, or PR the file directly.</p>
      <div class="paths">
        <article class="path primary">
          <h3>1. Add your project (prefilled)</h3>
          <p>One click opens the GitHub editor on <code>registry/builders/</code> with the entry template already filled in.
          Rename the file to <code>&lt;your-slug&gt;.json</code>, edit the fields, and propose the change: GitHub forks the repo for you and opens the pull request.</p>
          <p>Two fields CI will not forgive: set <code>listedAt</code> to today's real date (the <code>YYYY-MM-DD</code> placeholder is rejected), and keep <code>slug</code> equal to your filename.</p>
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

const NAV_LINKS = `
      <a href="#conformance">Conformance</a>
      <a href="#builders">Builders</a>
      <a href="#templates">Templates</a>
      <a href="#examples">Examples</a>
      <a href="#standards">Standards</a>
      <a href="#submit">Submit</a>`;

const INDEX_CSS = `
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
  @media(max-width:800px){section{scroll-margin-top:12px}}
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
  a.st-verified,a.st-inverif,a.st-self,a.chip.conf,.claim-link{text-decoration:underline;text-underline-offset:3px}
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
  .empty a{color:var(--muted);text-decoration:underline;text-underline-offset:3px}
  .empty a:hover{color:var(--accent)}
  .add-cta{margin-top:20px;font-family:ui-monospace,monospace;font-size:13px}
  .add-cta a{color:var(--muted)}
  .add-cta a:hover{color:var(--accent)}
  .pin{font-size:12.5px;color:var(--muted);border:1px solid var(--grid);background:rgba(255,255,255,.02);padding:10px 14px;margin-bottom:18px;overflow-x:auto;white-space:nowrap}
  .pin b{color:var(--fg);font-weight:500}
  .pin .hash{color:var(--fg)}
  .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:22px}
  .step{border:1px solid var(--grid);background:rgba(255,255,255,.02);padding:14px;font-size:13.5px;display:flex;align-items:center;gap:10px}
  a.step{text-decoration:underline;text-underline-offset:3px}
  a.step:hover{border-color:var(--muted);background:rgba(255,255,255,.04)}
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
  .row-listed{color:var(--muted);font-size:11px;margin-top:6px;white-space:nowrap}
  .note{color:var(--muted);font-size:13.5px;max-width:760px}
  .paths{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
  .path{padding:24px;border:1px solid var(--grid);background:rgba(255,255,255,.02)}
  .path.primary{border-color:var(--muted)}
  .path h3{font-size:15px;font-weight:600;color:var(--accent);margin-bottom:10px}
  .path p{font-size:14px;margin-bottom:10px}
  .path a{text-decoration:underline;text-underline-offset:3px}
  .path a.btn{text-decoration:none}
  .path code{font-size:12.5px;color:var(--fg)}`;

export function renderIndexHtml({ rendered, interopSorted }) {
  const body = `
  <article class="wrap">
${sectionHero({ rendered, interopSorted })}
    <main>
${sectionConformance(rendered)}
${sectionBuilders(rendered)}
${sectionTemplates(rendered)}
${sectionExamples(rendered)}
${sectionStandards(interopSorted)}
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

  return pageShell({ title: TITLE, headExtra, body, nav: NAV_LINKS }).replace("\n</style>", `${INDEX_CSS}\n</style>`);
}
