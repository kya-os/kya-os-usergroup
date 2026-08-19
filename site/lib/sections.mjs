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
import { INDEX_CSS } from "./theme.mjs";

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
