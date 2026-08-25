/**
 * Page bodies for the builders directory page (the home page lives in
 * lib/home.mjs), translated from the Builders Site design handoff
 * artboards. Every renderer
 * is a pure function of the shaped registry data from lib/data.mjs; markup
 * primitives come from lib/html.mjs; waveforms are computed at build time by
 * lib/waveform.mjs.
 *
 * The directory's type filter and expandable rows are CSS-only translations
 * of the prototype's React state: hidden radio inputs + sibling selectors
 * drive the filter, and native <details> rows carry the expansion - both
 * fully functional without JavaScript.
 */
import { ADD_PROJECT_URL, DEMO_MCP_URL, PLAYGROUND_URL, REPO_URL, REVOKED_TREE_URL, STARTER_URL, SUITE } from "./constants.mjs";
import { CLAIM_WAVE, claimWaveSeed } from "../../scripts/lib/builder-entry.mjs";
import { conformanceLabel, conformanceLevelUrl, directorySorted } from "./data.mjs";
import { conformanceStatusChip, esc, promptBlock } from "./html.mjs";
import { KINDS } from "../../scripts/lib/registry-enums.mjs";
import { waveformSvg } from "./waveform.mjs";

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
    return { dot: "", line: "" };
  }
  const checked = `checked ${esc(probes.probedAt)}`;
  if (probe.status === "enforcing") {
    return {
      dot: "",
      line: `<div class="dprobe tone-signal">&#9679; live &middot; enforcement verified &middot; ${checked}</div>`,
    };
  }
  if (probe.status === "open") {
    return {
      dot: "",
      line: `<div class="dprobe quiet">&#9679; live &middot; open (no proof required) &middot; ${checked}</div>`,
    };
  }
  return {
    dot: "",
    line: `<div class="dprobe tone-faint">&#9675; unreachable &middot; ${checked}</div>`,
  };
}

// Row marks: first-party entries carry the KYA-OS mark, partner entries their
// own brand asset (both theme-paired like the nav logo); everything else
// keeps the first-letter box. Presentation-only - no registry field.
const KYA_MARK_SLUGS = new Set(["kya-os-mcp", "kya-os-demo-server", "kya-os-schema"]);
const BRAND_LOGOS = { "knowthat-ai": { onDark: "/img/knowthat-mark-ondark.png", onLight: "/img/knowthat-mark-onlight.png" } };
function rowMark(entry) {
  if (KYA_MARK_SLUGS.has(entry.slug)) {
    return `<span class="dmark dmark-logo" aria-hidden="true"><img class="mark mark-white" src="/img/kya-mark-white.svg" alt="" width="14" height="16" /><img class="mark mark-black" src="/img/kya-mark-black.svg" alt="" width="14" height="16" /></span>`;
  }
  const brand = BRAND_LOGOS[entry.slug];
  if (brand) {
    return `<span class="dmark dmark-logo dmark-wide" aria-hidden="true"><img class="mark mark-white" src="${brand.onDark}" alt="" height="14" /><img class="mark mark-black" src="${brand.onLight}" alt="" height="14" /></span>`;
  }
  return `<span class="dmark" aria-hidden="true">${esc(entry.name.charAt(0))}</span>`;
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
    ? `<div class="dconf-line tone-${CONF_TONE[state]}">${waveformSvg(claimWaveSeed(entry.slug, c), CLAIM_WAVE)}<p>conformance: <a href="${esc(conformanceLevelUrl(c))}">${esc(conformanceLabel(c))}</a>${deployed} - ${esc(CONF_TEXT[state])}</p></div>`
    : `<div class="dconf-line tone-faint"><p>Listed in the registry — no conformance claim yet.</p></div>`;
  const capabilities = [];
  if (entry.buildsOn?.length) capabilities.push(`builds on: ${entry.buildsOn.map((repo) => esc(repo)).join(", ")}`);
  if (entry.standards?.length) capabilities.push(`speaks: ${entry.standards.map((slug) => esc(slug)).join(", ")}`);
  const capLine = capabilities.length ? `<div class="dcap">${capabilities.join(" &middot; ")}</div>` : "";
  const links = [`<a href="${esc(entry.homepage)}">homepage -&gt;</a>`];
  if (entry.repo && entry.repo !== entry.homepage) links.push(`<a href="${esc(entry.repo)}">repo -&gt;</a>`);
  if (c?.attestationUrl) links.push(`<a href="${esc(c.attestationUrl)}">credential -&gt;</a>`);
  if (c?.evidenceUrl) links.push(`<a href="${esc(c.evidenceUrl)}">evidence -&gt;</a>`);
  if (entry.contact?.github) links.push(`<a href="https://github.com/${esc(entry.contact.github)}">@${esc(entry.contact.github)} -&gt;</a>`);
  return `      <details class="drow k-${esc(entry.kind)}" id="${esc(entry.slug)}">
        <summary class="dgrid">
          <span class="dname">${rowMark(entry)}<span class="dtitle">${esc(entry.name)}</span>${liveDot}</span>
          <span class="dtype">${esc(entry.kind)}</span>
          <span class="dwhat">${esc(entry.description)}</span>
          <span class="dconf">${chip}</span>
          <span class="dlisted">${esc(entry.listedAt)}</span>
          <span class="caret" aria-hidden="true"></span>
        </summary>
        <div class="dexpand">
          ${probeLine ? `${probeLine}\n          ` : ""}${confLine}
          ${capLine ? `${capLine}\n          ` : ""}<div class="dlinks">${links.join("\n            ")}</div>
          
        </div>
      </details>`;
}

/** The compact add-your-project strip under the lede: the invitation first, the detail at the bottom. */
export function sectionAddCta() {
  return `  <div class="cta-strip fx fxd-10">
    <span class="cta-lede">Add your project: one JSON file, one pull request, listed in five minutes.</span>
    <a class="btn-solid" href="#build-entry">build your entry -&gt;</a>
    <a href="${esc(ADD_PROJECT_URL)}">or open the prefilled editor -&gt;</a>
    <a class="quiet" href="#submit">the three paths -&gt;</a>
  </div>`;
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
        <a class="pc-title" href="${REVOKED_TREE_URL}">see it in action</a>
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
