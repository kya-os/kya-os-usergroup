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
import { ADD_PROJECT_URL, DEMO_MCP_URL, DOCS_QUICKSTART_URL, FOUNDING_CUTOFF, MIGRATE_README_URL, ORIGIN, PLAYGROUND_URL, REPO_URL, REVOKED_TREE_URL, STARTER_URL, SUITE, MIGRATE_LINES } from "./constants.mjs";
import { conformanceLabel, conformanceLevelUrl, directorySorted } from "./data.mjs";
import { conformanceStatusChip, esc, promptBlock } from "./html.mjs";
import { highlightTs } from "./highlight.mjs";
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

// The honest per-state conformance line for the expanded row, keyed on the
// DISPLAY state: the entry status refined by the build's credential verdict
// (a suspension bit renders a verified entry as suspended).
const CONF_TEXT = {
  "in-verification": `Claim being independently re-run against suite ${SUITE.version} — the program attests exactly what it observes.`,
  verified:
    "The program re-ran the suite, this build cryptographically verified the linked credential, and its status bits are clean: verify it yourself without trusting this site.",
  suspended:
    "Credential under appeal: the program set the suspension bit on its signed status list while a dispute is resolved - the linked credential carries the public record.",
  revoked:
    "The program revoked this credential; the revocation bit on its signed status list is the public record. The claim no longer counts as verified.",
  "self-reported": "Self-reported against the pinned suite, not yet independently re-run by the program.",
};
const CONF_TONE = { "in-verification": "amber", verified: "signal", suspended: "amber", revoked: "faint", "self-reported": "faint" };

/** The display state for one claim: the entry status refined by the verdict. */
function displayState(conformance, verdict) {
  if (conformance.status === "verified" && verdict?.state === "suspended") return "suspended";
  return conformance.status;
}


function sectionMigrate() {
  // One source (MIGRATE_LINES), two renders: the visible block carries
  // build-time token highlighting and diff gutters; the hidden raw <pre> is
  // what the copy button reads, so clipboard text is always the plain code.
  const code = MIGRATE_LINES.map(
    ([text, added]) => `<span class="cl${added ? " hl" : ""}">${highlightTs(text)}</span>`,
  ).join("");
  const raw = esc(MIGRATE_LINES.map(([text]) => text).join("\n"));
  return `  <section class="fx fxd-20">
    <h2>Two lines to a verifiable server</h2>
    <div class="rule"></div>
    <div class="code-wrap">
      <pre class="code-block"><code>${code}</code></pre>
      <pre id="migrate-code" hidden aria-hidden="true">${raw}</pre>
      <button type="button" class="copy-code" data-copy-target="migrate-code" hidden>[ copy ]</button>
    </div>
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
    <p class="lede">Authority and accountability for the agentic web. Verifiable identity and scoped delegation rooted at a <a href="https://kya-os.org/mcp/docs/concepts/delegation-layer">Responsible Party</a> - every agent action authorized before it runs, and audit-ready after.</p>
  </header>
  <div class="stats fx fxd-15">
${[
    stat("/conformance/", `suite <b>${esc(SUITE.version)}</b>`),
    stat("/conformance/", `<b>${SUITE.vectors}</b> vectors`),
    stat("/conformance/#levels", `levels <b>L1–L3</b>`),
    stat("/standards/", `<b>${interopSorted.length}</b> standards mapped`),
    stat("/builders/", `<b>${rendered.length}</b> projects listed`),
    stat(
      "/builders/",
      `<b>${rendered.filter((entry) => entry.conformance?.status === "in-verification").length}</b> in verification &middot; <b>${rendered.filter((entry) => entry.conformance?.status === "verified").length}</b> verified`,
    ),
  ].join("\n")}
  </div>
${sectionMigrate()}
  <a href="/rails/" class="rails-panel fx fxd-25" aria-label="The rails: AI agents send signed requests through KYA-OS to MCP servers, A2A peers, and any API - verified before they run. Read how one proof reaches every protocol.">
    <div class="rails-head">
      <div class="rails-title">THE RAILS</div>
      <div class="rails-sub">how one proof reaches every protocol -&gt;</div>
    </div>
    <div class="rails-mini" aria-hidden="true">
      <div class="rm-box rm-c1">AI</div>
      <div class="wire rm-w2"><span class="wire-dot"></span></div>
      <div class="rm-box rm-core rm-c3">KYA-OS</div>
      <div class="wire rm-w4"><span class="wire-dot wd-late"></span></div>
      <div class="rm-outs rm-c5">
        <span class="rm-out"><span>MCP server</span><span class="ok">&check;</span></span>
        <span class="rm-out"><span>A2A peer</span><span class="ok">&check;</span></span>
        <span class="rm-out"><span>any API</span><span class="ok">&check;</span></span>
      </div>
      <div class="rm-cap rm-u1">agents &middot; orchestrators &middot; autonomous</div>
      <div class="rm-under rm-u3">
        <div class="rm-wf">${waveformLockup("kya-os:signed-proof:v1.14", { bars: 18, trackHeight: 12 })}</div>
        <div class="rm-cap">who acts &middot; for whom &middot; with what authority</div>
      </div>
      <div class="rm-cap rm-u5">verified before it runs</div>
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

/**
 * The live signal for a service row. Without probe data: the neutral static
 * dot. With probe data: the summary dot takes the classified tone, and the
 * expanded row carries the dated, classified line - enforcement language is
 * NEVER rendered without a probe result behind it, and an open endpoint is
 * stated honestly, not shamed.
 */
function probeSignal(entry, probes) {
  if (entry.kind !== "service" && entry.kind !== "implementation") return { dot: "", line: "" };
  const probe = probes?.results?.[entry.slug];
  // The unproved fallback dot is a service affordance (a hosted endpoint you
  // can point at); a library/implementation earns a signal only from a real
  // probe result on a declared probeUrl.
  if (!probe) {
    if (entry.kind !== "service") return { dot: "", line: "" };
    return { dot: `<span class="live-dot" title="hosted service: an endpoint you can point at today"></span>`, line: "" };
  }
  const checked = `checked ${esc(probes.probedAt)}`;
  if (probe.status === "enforcing") {
    return {
      dot: `<span class="live-dot"></span>`,
      line: `<div class="dprobe tone-signal">&#9679; live &middot; enforcement verified &middot; ${checked}</div>`,
    };
  }
  if (probe.status === "open") {
    return {
      dot: `<span class="live-dot dot-open"></span>`,
      line: `<div class="dprobe quiet">&#9679; live &middot; open (no proof required) &middot; ${checked}</div>`,
    };
  }
  return {
    dot: `<span class="live-dot dot-off"></span>`,
    line: `<div class="dprobe tone-faint">&#9675; unreachable &middot; ${checked}</div>`,
  };
}

function directoryRow(entry, probes, verdicts) {
  const c = entry.conformance;
  const verdict = verdicts.get(entry.slug);
  const chip = c
    ? conformanceStatusChip(c, { link: false, verdict })
    : `<span class="chip st-listed">&middot; listed</span>`;
  const { dot: liveDot, line: probeLine } = probeSignal(entry, probes);
  // The provenance tie: the probe's reported deployment version beside the
  // claim - two facts displayed side by side, equality never asserted here
  // (the claim's verification thread documents the tie).
  const provenanceVersion = probes?.results?.[entry.slug]?.provenanceVersion;
  const deployed = c && provenanceVersion ? ` <span class="dprov">&middot; deployed ${esc(provenanceVersion)}</span>` : "";
  const state = c && displayState(c, verdict);
  const confLine = c
    ? `<div class="dconf-line tone-${CONF_TONE[state]}">${waveformSvg(`${entry.slug}#${conformanceLabel(c)}`, { bars: 16, trackHeight: 11, barWidth: 2, gap: 1.5 })}<p>conformance: <a href="${esc(conformanceLevelUrl(c))}">${esc(conformanceLabel(c))}</a>${deployed} — ${esc(CONF_TEXT[state])}</p></div>`
    : `<div class="dconf-line tone-faint"><p>Listed in the registry — no conformance claim yet.</p></div>`;
  const founding =
    entry.listedAt <= FOUNDING_CUTOFF
      ? `<span class="tag-founding" title="listed during the founding window (through ${esc(FOUNDING_CUTOFF)})">founding builder</span>`
      : "";
  const capabilities = [];
  if (entry.buildsOn?.length) capabilities.push(`builds on: ${entry.buildsOn.map((repo) => esc(repo)).join(", ")}`);
  if (entry.standards?.length) capabilities.push(`speaks: ${entry.standards.map((slug) => esc(slug)).join(", ")}`);
  const capLine = capabilities.length ? `<div class="dcap">${capabilities.join(" &middot; ")}</div>` : "";
  const links = [`<a href="${esc(entry.homepage)}">homepage -&gt;</a>`];
  if (entry.repo && entry.repo !== entry.homepage) links.push(`<a href="${esc(entry.repo)}">repo -&gt;</a>`);
  if (c?.attestationUrl) links.push(`<a href="${esc(c.attestationUrl)}">credential -&gt;</a>`);
  if (c?.evidenceUrl) links.push(`<a href="${esc(c.evidenceUrl)}">evidence -&gt;</a>`);
  if (entry.contact?.github) links.push(`<a href="https://github.com/${esc(entry.contact.github)}">@${esc(entry.contact.github)} -&gt;</a>`);
  // The copy-ready badge embed, in every expanded row: a plain selectable
  // line (user-select: all), deliberately not a copy button - per-row buttons
  // would dilute the prompt-parity contract the copy module asserts.
  const embed = `<p class="micro">your badge, copy-ready (click selects):</p>
          <div class="dembed">[![KYA-OS conformance](${esc(ORIGIN)}/badge/${esc(entry.slug)}.svg)](${esc(ORIGIN)}/builders/#${esc(entry.slug)})</div>`;
  return `      <details class="drow k-${esc(entry.kind)}" id="${esc(entry.slug)}">
        <summary class="dgrid">
          <span class="dname"><span class="dmark" aria-hidden="true">${esc(entry.name.charAt(0))}</span><span class="dtitle">${esc(entry.name)}</span>${liveDot}${founding}</span>
          <span class="dtype">${esc(entry.kind)}</span>
          <span class="dwhat">${esc(entry.description)}</span>
          <span class="dconf">${chip}</span>
          <span class="dlisted">${esc(entry.listedAt)}</span>
          <span class="caret" aria-hidden="true"></span>
        </summary>
        <div class="dexpand">
          ${probeLine ? `${probeLine}\n          ` : ""}${confLine}
          ${capLine ? `${capLine}\n          ` : ""}<div class="dlinks">${links.join("\n            ")}</div>
          ${embed}
        </div>
      </details>`;
}

/** The directory: CSS-only type filter + expandable registry rows. */
export function sectionDirectory(rendered, probes, verdicts) {
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
  const rows = directorySorted(rendered)
    .map((entry) => directoryRow(entry, probes, verdicts))
    .join("\n");
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
    <p class="dnote">Ordered by the ladder: verified first, then in verification, then self-reported, then everything listed. A <span class="tone-signal">&#9679;</span> next to the name marks a hosted service endpoint you can point at today; where the entry names a probe endpoint, the daily probe classifies it in the expanded row - dated, from the wire, independent of any claim.</p>
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

/** The trust ladder plus the one primary action (prompt + prefilled link). */
export function sectionSubmit() {
  const rung = (chip, note) => `      <span class="rung">${chip}<span class="rung-note">${note}</span></span>`;
  return `  <section id="submit" class="fx fxd-40">
    <h2>Join the registry</h2>
    <div class="rule"></div>
    <p class="section-lede">Getting listed and claiming conformance are not separate acts — they are rungs of one ladder, and the same registry entry climbs it in public. Corrections count too: every standards-matrix row is one file in <code>registry/interop/</code> — use the row's edit link on <a href="/standards/">the standards page</a>, or PR the file directly.</p>
    <div class="ladder">
${[
    rung(`<span class="chip st-listed">&middot; listed</span>`, "5 minutes"),
    rung(`<span class="chip st-self">&middot; self-reported</span>`, "same hour"),
    rung(`<span class="chip st-inverif">&#9676; in verification</span>`, "issue open"),
    rung(`<span class="chip st-verified demo">&check; verified</span>`, "the program re-runs your bytes"),
  ].join(`\n      <span class="ladder-arrow" aria-hidden="true">-&gt;</span>\n`)}
    </div>
    <p class="ladder-copy">Listed in five minutes. Self-reported the same hour. Verified when the <a href="/conformance/">program</a> re-runs your bytes. Services can additionally prove live enforcement via the daily probe - the wire is the witness: a bare request must be refused.</p>
    <div class="panel-card path-primary">
      <div class="pc-title t-static">one action, every rung</div>
      <p>Hand the prompt to your coding agent and it walks the ladder with you: your entry, an optional self-reported conformance run against the pinned suite, one pull request, and the submission issue if you want verification. Or take the one-click path — the button opens the GitHub editor on <code>registry/builders/</code> with the entry template prefilled: rename to <code>&lt;your-slug&gt;.json</code>, edit the fields, propose the change.</p>
      ${promptBlock("prompt-join-registry")}
      <p class="pc-sub">Two fields CI will not forgive: set <code>listedAt</code> to today's real date, and keep <code>slug</code> equal to your filename.</p>
      <a class="btn-solid" href="${esc(ADD_PROJECT_URL)}">add your project -&gt;</a>
    </div>
    <p class="note">Prefer a local workflow? Copy <a href="${REPO_URL}/blob/main/registry/builders/example-builder.json"><code>example-builder.json</code></a> to <code>registry/builders/&lt;your-slug&gt;.json</code>, run <code>npm test</code> (no dependencies to install), and open a PR — the field reference is in <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.</p>
  </section>`;
}
