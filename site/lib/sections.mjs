/**
 * Page bodies for the overview (home) and builders directory pages,
 * translated from the Builders Site design handoff artboards. Every renderer
 * is a pure function of the shaped registry data from lib/data.mjs; markup
 * primitives come from lib/html.mjs; waveforms are computed at build time by
 * lib/waveform.mjs.
 *
 * The directory's type filter and expandable rows are CSS-only translations
 * of the prototype's React state: hidden radio inputs + sibling selectors
 * drive the filter, and native <details> rows carry the expansion - both
 * fully functional without JavaScript.
 */
import { ADD_PROJECT_URL, DEMO_MCP_URL, DOCS_QUICKSTART_URL, MIGRATE_README_URL, PLAYGROUND_URL, REPO_URL, REVOKED_TREE_URL, STARTER_URL, SUITE } from "./constants.mjs";
import { conformanceLabel, conformanceLevelUrl, directorySorted } from "./data.mjs";
import { conformanceStatusChip, esc, promptBlock } from "./html.mjs";
import { KINDS } from "../../scripts/validate.mjs";
import { waveformLockup, waveformSvg } from "./waveform.mjs";

// What each entry kind means, shown under the filter strip (design copy,
// verbatim; marketplace added for the hub's schema).
const TYPE_DEFS = {
  all: "",
  implementation: "implementation — an independent build of the protocol itself",
  service: "service — something hosted that you can point at today",
  integration: "integration — a product that uses KYA-OS inside",
  marketplace: "marketplace — a directory or store that lists KYA-OS agents",
  template: "template — a starting point to fork",
  example: "example — a working demonstration to learn from",
};

// The honest per-status conformance line for the expanded row.
const CONF_TEXT = {
  "in-verification": `Claim being independently re-run against suite ${SUITE.version} — the program attests exactly what it observes.`,
  verified: "The program re-ran the suite and the claim links its credential: verify it yourself without trusting this site.",
  "self-reported": "Self-reported against the pinned suite, not yet independently re-run by the program.",
};
const CONF_TONE = { "in-verification": "amber", verified: "signal", "self-reported": "faint" };

// The two-line migration snippet, verbatim from the reference README's
// "Migrate any MCP server in 2 lines" quickstart (the "after" block; the two
// "+1 line" comments mark the entire delta from a stock MCP server). Lines
// flagged true are the additions and render highlighted.
const MIGRATE_LINES = [
  ["import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';", false],
  ["import { withKyaOs, NodeCryptoProvider } from '@kya-os/mcp';  // +1 line", true],
  ["", false],
  ["const server = new McpServer({ name: 'my-server', version: '1.0.0' });", false],
  ["await withKyaOs(server, { crypto: new NodeCryptoProvider() }); // +1 line", true],
  ["", false],
  ["server.registerTool('greet', { description: 'Say hello' }, async (args) => ({", false],
  ["  content: [{ type: 'text', text: `Hello, ${args.name}!` }],", false],
  ["}));", false],
];

function sectionMigrate() {
  const code = MIGRATE_LINES.map(([text, added]) => (added ? `<span class="hl">${esc(text)}</span>` : esc(text))).join("\n");
  return `  <section class="fx fxd-20">
    <h2>Two lines to a verifiable server</h2>
    <div class="rule"></div>
    <pre class="code-block"><code>${code}</code></pre>
    <div class="dlinks next-strip">
      <span class="next-label">what next:</span>
      <a href="${STARTER_URL}">run the suite against it -&gt;</a>
      <a href="/conformance/">claim conformance -&gt;</a>
      <a href="${esc(ADD_PROJECT_URL)}">get listed -&gt;</a>
    </div>
    <p class="note">High-integrity identity is a wrap, not a rewrite: every tool response now carries a detached JWS proof - invisible to the LLM, verifiable by anyone.</p>
    <div class="dlinks">
      <a href="${MIGRATE_README_URL}">reference README -&gt;</a>
      <a href="${DOCS_QUICKSTART_URL}">docs quickstart -&gt;</a>
    </div>
  </section>`;
}

/** The overview (home) page body. */
export function sectionsHome({ rendered, interopSorted }) {
  const stat = (href, html) => `    <a href="${href}">${html}</a>`;
  return `  <header class="hero fx">
    <div class="kicker">BUILDERS.KYA-OS.ORG</div>
    <h1 class="h1-home"><span data-title-reveal>BUILD ON KYA-OS</span><span class="cursor" aria-hidden="true">_</span></h1>
    <p class="lede">Authority and accountability for the agentic web. Verifiable identity and scoped delegation rooted at a Responsible Party - every agent action authorized before it runs, and audit-ready after.</p>
  </header>
  <div class="stats fx fxd-15">
${[
    stat("/conformance/", `suite <b>${esc(SUITE.version)}</b>`),
    stat("/conformance/", `<b>${SUITE.vectors}</b> vectors`),
    stat("/conformance/#levels", `levels <b>L1–L3</b>`),
    stat("/standards/", `<b>${interopSorted.length}</b> standards mapped`),
    stat("/builders/", `<b>${rendered.length}</b> projects listed`),
  ].join("\n")}
  </div>
${sectionMigrate()}
  <a href="/rails/" class="rails-panel fx fxd-25">
    <div class="rails-head">
      <div class="rails-title">THE RAILS</div>
      <div class="rails-sub">how one proof reaches every protocol -&gt;</div>
    </div>
    <div class="rails-mini">
      <div class="rm-node">
        <div class="rm-box">AI</div>
        <div class="rm-cap">agents &middot; orchestrators &middot; autonomous</div>
      </div>
      <div class="wire"><span class="wire-dot"></span></div>
      <div class="rm-node">
        <div class="rm-box rm-core">KYA-OS <span class="rm-signs">&#9998; signs</span></div>
        <div class="rm-wf">${waveformLockup("kya-os:signed-proof:v1.14", { bars: 18, trackHeight: 12 })}</div>
        <div class="rm-cap">who acts &middot; for whom &middot; with what authority</div>
      </div>
      <div class="wire"><span class="wire-dot wd-late"></span></div>
      <div class="rm-node">
        <div class="rm-outs">
          <span class="rm-out"><span>MCP server</span><span class="ok">&check;</span></span>
          <span class="rm-out"><span>A2A peer</span><span class="ok">&check;</span></span>
          <span class="rm-out"><span>any API</span><span class="ok">&check;</span></span>
        </div>
        <div class="rm-cap">verified before it runs</div>
      </div>
    </div>
  </a>
  <div class="home-cards fx fxd-35">
    <a href="/builders/" class="panel-card">
      <div class="pc-head"><span class="pc-title">builders -&gt;</span></div>
      <p>Who is building on KYA-OS — implementations, services, templates, and the examples to start from. Listing is one JSON file and one pull request.</p>
    </a>
    <a href="/conformance/" class="panel-card">
      <div class="pc-head"><span class="pc-title">conformance -&gt;</span><span class="chip st-shipping pulse">verifiable</span></div>
      <p>Measured, not asserted. Run the pinned vector suite, submit a claim, and the program independently re-runs your bytes and attests what it observes.</p>
    </a>
    <a href="/standards/" class="panel-card">
      <div class="pc-head"><span class="pc-title">standards -&gt;</span></div>
      <p>Every standard KYA-OS provides, carries, or projects onto — ${interopSorted.length} rows, each grounded in evidence and dated. Disputes are one pull request.</p>
    </a>
    <a href="/use-cases/" class="panel-card">
      <div class="pc-head"><span class="pc-title">use-cases -&gt;</span></div>
      <p>What people actually build: on-chain kill switches, consent-gated tools, delegated spend ceilings. Read them before you build, steal from them while you build.</p>
    </a>
  </div>`;
}

function directoryRow(entry) {
  const c = entry.conformance;
  const chip = c
    ? conformanceStatusChip(c, { link: false })
    : `<span class="chip st-listed">&middot; listed</span>`;
  const liveDot =
    entry.kind === "service"
      ? `<span class="live-dot" title="hosted service: an endpoint you can point at today"></span>`
      : "";
  const confLine = c
    ? `<div class="dconf-line tone-${CONF_TONE[c.status]}">${waveformSvg(`${entry.slug}#${conformanceLabel(c)}`, { bars: 16, trackHeight: 11, barWidth: 2, gap: 1.5 })}<p>conformance: <a href="${esc(conformanceLevelUrl(c))}">${esc(conformanceLabel(c))}</a> — ${esc(CONF_TEXT[c.status])}</p></div>`
    : `<div class="dconf-line tone-faint"><p>Listed in the registry — no conformance claim yet.</p></div>`;
  const links = [`<a href="${esc(entry.homepage)}">homepage -&gt;</a>`];
  if (entry.repo && entry.repo !== entry.homepage) links.push(`<a href="${esc(entry.repo)}">repo -&gt;</a>`);
  if (c?.attestationUrl) links.push(`<a href="${esc(c.attestationUrl)}">credential -&gt;</a>`);
  if (c?.evidenceUrl) links.push(`<a href="${esc(c.evidenceUrl)}">evidence -&gt;</a>`);
  const buildsOn = (entry.buildsOn ?? []).map((repo) => esc(repo)).join(", ");
  return `      <details class="drow k-${esc(entry.kind)}" id="${esc(entry.slug)}">
        <summary class="dgrid">
          <span class="dname"><span class="dmark" aria-hidden="true">${esc(entry.name.charAt(0))}</span><span class="dtitle">${esc(entry.name)}</span>${liveDot}</span>
          <span class="dtype">${esc(entry.kind)}</span>
          <span class="dwhat">${esc(entry.description)}</span>
          <span class="dconf">${chip}</span>
          <span class="dlisted">${esc(entry.listedAt)}</span>
          <span class="caret" aria-hidden="true"></span>
        </summary>
        <div class="dexpand">
          ${confLine}
          <div class="dlinks">${links.join("\n            ")}${buildsOn ? `<span class="dbuilds">builds on ${buildsOn}</span>` : ""}</div>
        </div>
      </details>`;
}

/** The directory: CSS-only type filter + expandable registry rows. */
export function sectionDirectory(rendered) {
  const types = ["all", ...KINDS];
  const counts = { all: rendered.length };
  for (const entry of rendered) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  const inputs = types
    .map((t, i) => `    <input type="radio" name="kind-filter" id="f-${t}"${i === 0 ? " checked" : ""} />`)
    .join("\n");
  const chips = types
    .map((t) => {
      const count = counts[t] ?? 0;
      const label = t === "all" ? `all ${count}` : `${t}${count > 1 ? "s" : ""} ${count}`;
      return `      <label class="filter-chip" for="f-${t}">${esc(label)}</label>`;
    })
    .join("\n");
  const hints = types
    .filter((t) => TYPE_DEFS[t] !== "")
    .map((t) => `<span class="fh fh-${t}">${esc(TYPE_DEFS[t])}</span>`)
    .join("");
  const rows = directorySorted(rendered).map(directoryRow).join("\n");
  return `  <section class="dir fx fxd-15">
${inputs}
    <div class="filter-row">
${chips}
    </div>
    <p class="filter-hint">${hints}</p>
    <div class="dtable">
      <div class="dgrid dhead" aria-hidden="true"><span>PROJECT</span><span>TYPE</span><span>WHAT IT IS</span><span>CONFORMANCE</span><span>LISTED</span><span></span></div>
${rows}
      <div class="dfoot">your project here — <a href="${esc(ADD_PROJECT_URL)}">one JSON file and one pull request -&gt;</a></div>
    </div>
    <p class="dnote">Ordered by verification: claims under measurement first, then hosted service endpoints, then everything listed. A <span class="tone-signal">&#9679;</span> next to the name marks a hosted service endpoint you can point at today.</p>
  </section>`;
}

/** The three "start here" on-ramps. */
export function sectionStartHere() {
  return `  <section class="fx fxd-30">
    <h2>Start here</h2>
    <div class="rule"></div>
    <div class="grid-3">
      <div class="panel-card">
        <a class="pc-title" href="${PLAYGROUND_URL}">poke a live server</a>
        <p>Speak MCP to a real KYA-OS endpoint before running your own — inspect the signed proof in every response.</p>
        <p class="pc-sub">raw endpoint: <code>POST ${DEMO_MCP_URL}</code></p>
        <a class="pc-link" href="${PLAYGROUND_URL}">open the playground -&gt;</a>
      </div>
      <div class="panel-card">
        <a class="pc-title" href="${STARTER_URL}">fork the starter</a>
        <p>From existing implementation to submission-ready conformance claim in under an hour — all ${SUITE.vectors} vectors, any language.</p>
        <a class="pc-link" href="${STARTER_URL}">conformance-starter -&gt;</a>
      </div>
      <div class="panel-card">
        <a class="pc-title" href="${REVOKED_TREE_URL}">read the flagship</a>
        <p>REVOKED: an on-chain kill switch for wallet agents. A genuinely revoked credential is anchored on-chain right now.</p>
        <a class="pc-link" href="/use-cases/">use-cases -&gt;</a>
      </div>
    </div>
  </section>`;
}

/** The three submission paths plus the copy-to-agent prompt. */
export function sectionSubmit() {
  return `  <section id="submit" class="fx fxd-40">
    <h2>Submit</h2>
    <div class="rule"></div>
    <p class="section-lede">Three paths, all public, none gatekept. Corrections count too: every standards-matrix row is one file in <code>registry/interop/</code> — use the row's edit link on <a href="/standards/">the standards page</a>, or PR the file directly.</p>
    <div class="grid-3">
      <div class="panel-card path-primary">
        <div class="pc-title t-static">1 &middot; add your project</div>
        <p>One click opens the GitHub editor on <code>registry/builders/</code> with the entry template prefilled. Rename to <code>&lt;your-slug&gt;.json</code>, edit the fields, propose the change — GitHub forks and opens the PR for you.</p>
        <p class="pc-sub">Two fields CI will not forgive: set <code>listedAt</code> to today's real date, and keep <code>slug</code> equal to your filename.</p>
        <a class="btn-solid" href="${esc(ADD_PROJECT_URL)}">add your project -&gt;</a>
      </div>
      <div class="panel-card">
        <div class="pc-title t-static">2 &middot; copy the template file</div>
        <p>Prefer a local workflow? Copy <a href="${REPO_URL}/blob/main/registry/builders/example-builder.json"><code>example-builder.json</code></a> to <code>registry/builders/&lt;your-slug&gt;.json</code>, run <code>npm test</code> (no dependencies to install), and open a PR. Full field reference in <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.</p>
      </div>
      <div class="panel-card">
        <div class="pc-title t-static">3 &middot; claim conformance</div>
        <p>Run the pinned vector suite (the <a href="${STARTER_URL}">starter</a> automates it), then open a conformance submission issue with your <code>claim.json</code>. The program re-runs your suite independently and attests what it observes; your registry entry then carries the claim.</p>
      </div>
    </div>
    ${promptBlock("prompt-get-listed")}
  </section>`;
}
