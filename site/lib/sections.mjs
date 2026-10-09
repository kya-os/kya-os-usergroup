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
import { flatWaveSvg, waveformSvg } from "./waveform.mjs";

// What each entry kind means, shown under the filter strip (design copy,
// verbatim; marketplace added for the hub's schema).
const TYPE_DEFS = {
  all: "",
  implementation: "implementation - an independent build of the protocol itself",
  service: "service - something hosted that you can point at today",
  integration: "integration - a product that uses KYA-OS inside",
  marketplace: "marketplace - a directory or store that lists KYA-OS agents",
  template: "template - a starting point to fork",
  example: "example - a working demonstration to learn from",
};

// The honest per-state conformance line for the expanded row, keyed on the
// DISPLAY state: the entry status refined by the build's credential verdict
// (a suspension bit renders a verified entry as suspended).
const CONF_TEXT = {
  "in-verification": `Claim being independently re-run against suite ${SUITE.version} - the program attests exactly what it observes.`,
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
 * The probe's dated, classified fact for the provenance panel, when the
 * entry names a probe endpoint and the daily probe has a result for it.
 * Enforcement language is NEVER rendered without a probe result behind it,
 * and an open endpoint is stated honestly, not shamed.
 */
function probeFact(entry, probes) {
  if (entry.kind !== "service" && entry.kind !== "implementation") return "";
  const probe = probes?.results?.[entry.slug];
  if (!probe) return "";
  const checked = `checked ${esc(probes.probedAt)}`;
  if (probe.status === "enforcing") return `<dd class="dprobe tone-signal">enforcement verified, ${checked}</dd>`;
  if (probe.status === "open") return `<dd class="dprobe">open (no proof required), ${checked}</dd>`;
  return `<dd class="dprobe tone-faint">unreachable, ${checked}</dd>`;
}

// Row marks: first-party entries carry the KYA-OS mark, partner entries their
// own brand asset (both theme-paired like the nav logo); everything else
// keeps the first-letter box. Every mark shares one cap height (the 16px
// .dmark box) so no brand reads shorter than another; width follows the
// asset's own aspect. Presentation-only - no registry field.
const KYA_MARK_SLUGS = new Set(["kya-os-mcp", "kya-os-demo-server", "kya-os-schema"]);
// KnowThat.ai is always the red mark: the owner wants the brand red on both
// themes, so the theme-paired slot points at the same asset twice.
const BRAND_LOGOS = { "knowthat-ai": { onDark: "/img/knowthat-mark-onlight.png", onLight: "/img/knowthat-mark-onlight.png" } };
function rowMark(entry) {
  if (KYA_MARK_SLUGS.has(entry.slug)) {
    return `<span class="dmark dmark-logo" aria-hidden="true"><img class="mark mark-white" src="/img/kya-mark-white.svg" alt="" width="14" height="16" /><img class="mark mark-black" src="/img/kya-mark-black.svg" alt="" width="14" height="16" /></span>`;
  }
  const brand = BRAND_LOGOS[entry.slug];
  if (brand) {
    return `<span class="dmark dmark-logo dmark-wide" aria-hidden="true"><img class="mark mark-white" src="${brand.onDark}" alt="" height="16" /><img class="mark mark-black" src="${brand.onLight}" alt="" height="16" /></span>`;
  }
  return `<span class="dmark" aria-hidden="true">${esc(entry.name.charAt(0))}</span>`;
}

/**
 * The CONFORMANCE cell: the claim's wave beside its label, the state under
 * them, and the credential's id beside the state (revealed on hover or
 * focus where motion is allowed, always shown otherwise). The state comes
 * from conformanceStatusChip, so a green "verified" still has exactly one
 * code path and fails closed without a verdict; it is unlinked here because
 * the provenance panel carries the credential link.
 */
function claimCell(conformance, verdict, waveSeed, state) {
  const id = verdict?.id32 ? `<code class="dclaim-sig">${esc(verdict.id32.slice(0, 8))}</code>` : "";
  return `<span class="dclaim tone-${CONF_TONE[state]}">` +
    `<span class="dclaim-head">${waveformSvg(waveSeed, CLAIM_WAVE)}<span class="dclaim-label">${esc(conformanceLabel(conformance))}</span></span>` +
    `<span class="dclaim-foot">${conformanceStatusChip(conformance, { link: false, verdict, bare: true })}${id}</span></span>`;
}

/** No claim, no signature: the flat line where the fingerprint would be. */
function unclaimedCell() {
  return `<span class="dclaim dclaim-none">` +
    `<span class="dclaim-head">${flatWaveSvg(CLAIM_WAVE)}<span class="dclaim-label">listed</span></span>` +
    `<span class="dclaim-foot">no claim yet</span></span>`;
}

// The panel draws the row's wave longer: the same seed, so its first 16
// bars are the row's 16.
const PANEL_WAVE = { bars: 48, trackHeight: 30, barWidth: 3, gap: 2.2 };

/** A signature shortened for display: enough to recognize, never to rely on. */
function shortSignature(proofValue) {
  return proofValue.length > 20 ? `${proofValue.slice(0, 10)}...${proofValue.slice(-6)}` : proofValue;
}

/**
 * The verify command for a credential, with a copy button that
 * /ui/copy-prompt.js reveals (no JS, no dead button: the command itself is
 * selectable text).
 */
function verifyBlock(slug, attestationUrl) {
  const id = `verify-${slug}`;
  return `<div class="pverify">
              <div class="pverify-head"><span>Verify it yourself from a clone of this registry's repo</span><button type="button" class="copy-cmd" data-copy-target="${esc(id)}" data-copied="Copied" hidden>Copy</button></div>
              <pre class="pcmd" id="${esc(id)}">curl -s ${esc(attestationUrl)} | node scripts/verify-credential.mjs -</pre>
            </div>`;
}

/**
 * The expanded row: the provenance panel. On the left, the wave drawn large
 * with what it was drawn from, the facts as a list, and one sentence on what
 * the state means; on the right, the verify command and the links. The
 * probe's reported deployment version sits beside the claim - two facts
 * side by side, equality never asserted here (the claim's verification
 * thread documents the tie).
 */
function provenancePanel(entry, { c, verdict, state, waveSeed, probeFact, provenanceVersion }) {
  const fact = (term, value, cls = "") => `<div><dt>${term}</dt><dd${cls ? ` class="${cls}"` : ""}>${value}</dd></div>`;
  const facts = [];
  if (c) {
    facts.push(fact("Claim", `<a href="${esc(conformanceLevelUrl(c))}">${esc(conformanceLabel(c))}</a>`));
    facts.push(fact("Suite", esc(c.suiteVersion)));
    if (provenanceVersion) facts.push(fact("Deployed", esc(provenanceVersion), "dprov"));
  }
  if (probeFact) facts.push(`<div><dt>Live probe</dt>${probeFact}</div>`);
  if (verdict?.id32) facts.push(fact("Credential", `<code>${esc(verdict.id32)}</code>`));
  if (entry.buildsOn?.length) facts.push(fact("Builds on", entry.buildsOn.map((repo) => esc(repo)).join(", ")));
  if (entry.standards?.length) facts.push(fact("Speaks", entry.standards.map((slug) => esc(slug)).join(", ")));
  facts.push(fact("Listed", esc(entry.listedAt)));

  const signature = c
    ? `<div class="psig tone-${CONF_TONE[state]}">${waveformSvg(waveSeed, PANEL_WAVE)}<p class="psig-cap">${
        verdict?.signature
          ? `Drawn from signature <code>${esc(shortSignature(verdict.signature))}</code>`
          : "Drawn from the claim until a credential signs it"
      }</p></div>`
    : `<div class="psig psig-none">${flatWaveSvg(PANEL_WAVE)}<p class="psig-cap">No claim, so no signature to draw</p></div>`;
  const note = c ? CONF_TEXT[state] : "Listed in the registry, with no conformance claim yet.";

  const links = [`<a href="${esc(entry.homepage)}">homepage -&gt;</a>`];
  if (entry.repo && entry.repo !== entry.homepage) links.push(`<a href="${esc(entry.repo)}">repo -&gt;</a>`);
  if (c?.attestationUrl) links.push(`<a href="${esc(c.attestationUrl)}">credential -&gt;</a>`);
  if (c?.evidenceUrl) links.push(`<a href="${esc(c.evidenceUrl)}">evidence -&gt;</a>`);
  if (entry.contact?.github) links.push(`<a href="https://github.com/${esc(entry.contact.github)}">@${esc(entry.contact.github)} -&gt;</a>`);

  return `<div class="dexpand">
          <div class="prov">
            ${signature}
            <dl class="pfacts">${facts.join("")}</dl>
          </div>
          <div class="pactions">
            <p class="pnote">${esc(note)}</p>
            <div class="dlinks">${links.join("\n              ")}</div>
          </div>
          ${c?.attestationUrl ? verifyBlock(entry.slug, c.attestationUrl) : ""}
        </div>`;
}

function directoryRow(entry, probes, verdicts) {
  const c = entry.conformance;
  const verdict = verdicts.get(entry.slug);
  const probeLine = probeFact(entry, probes);
  const provenanceVersion = c ? probes?.results?.[entry.slug]?.provenanceVersion : undefined;
  const state = c && displayState(c, verdict);
  // The wave: seeded by the credential's SIGNATURE once there is one to
  // fingerprint (verdict.waveSeed, from proof.proofValue - the same seed the
  // entry's badge draws with, so the row and the badge are one wave), and by
  // the claim itself while the entry carries no credential.
  const waveSeed = verdict?.waveSeed ?? (c && claimWaveSeed(entry.slug, c));
  const cell = c ? claimCell(c, verdict, waveSeed, state) : unclaimedCell();
  return `      <details class="drow k-${esc(entry.kind)}" id="${esc(entry.slug)}">
        <summary class="dgrid">
          <span class="dname">${rowMark(entry)}<span class="dname-text"><span class="dtitle">${esc(entry.name)}</span><span class="dtype">${esc(entry.kind)}</span></span></span>
          <span class="dwhat">${esc(entry.description)}</span>
          <span class="dconf">${cell}</span>
          <span class="caret" aria-hidden="true"></span>
        </summary>
        ${provenancePanel(entry, { c, verdict, state, waveSeed, probeFact: probeLine, provenanceVersion })}
      </details>`;
}

/** The add-your-project strip under the lede: one invitation, one action. */
export function sectionAddCta() {
  return `  <div class="cta-strip">
    <span class="cta-lede">Add your project: one JSON file and one pull request.</span>
    <a class="btn-solid" href="#build-entry">Build your entry</a>
  </div>`;
}

/** The directory: CSS-only type filter + expandable registry rows. */
export function sectionDirectory(rendered, probes, verdicts) {
  const counts = { all: rendered.length };
  for (const entry of rendered) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  // Only kinds with entries get a radio and a label: an empty filter is a
  // dead end, and a radio without its label would still be reachable with
  // the arrow keys. (The CSS filter's selectors for absent kinds simply never
  // match.) One noun form throughout - the kind's own name, as each row
  // prints it.
  const types = ["all", ...KINDS].filter((t) => t === "all" || (counts[t] ?? 0) > 0);
  const inputs = types
    .map((t, i) => `    <input type="radio" name="kind-filter" id="f-${t}"${i === 0 ? " checked" : ""} />`)
    .join("\n");
  const chips = types
    .map((t) => `      <label class="filter-chip" for="f-${t}">${esc(`${t} ${counts[t]}`)}</label>`)
    .join("\n");
  const hints = types
    .filter((t) => TYPE_DEFS[t] !== "")
    .map((t) => `<span class="fh fh-${t}">${esc(TYPE_DEFS[t])}</span>`)
    .join("");
  const rows = directorySorted(rendered)
    .map((entry) => directoryRow(entry, probes, verdicts))
    .join("\n");
  return `  <section class="dir">
${inputs}
    <div class="filter-row">
${chips}
    </div>
    <p class="filter-hint">${hints}</p>
    <div class="dtable">
      <div class="dgrid dhead" aria-hidden="true"><span>Project</span><span>What it is</span><span>Conformance</span><span></span></div>
${rows}
      <div class="dfoot">Your project here: <a href="${esc(ADD_PROJECT_URL)}">one JSON file and one pull request &rarr;</a></div>
    </div>
    <p class="dnote">Ordered by the ladder: verified first, then in verification, then self-reported, then everything listed. Each wave is drawn from its credential's signature; a flat line means no claim yet. Where an entry names a probe endpoint, the daily probe's dated result is in the expanded row.</p>
  </section>`;
}

/**
 * The builders hero: the registry's own signatures. Every verified
 * credential's wave, drawn long from the same seed its row and badge use,
 * with what it attests; then the counts in one sentence. The page is about
 * proof, so the first thing it shows is proof - no title decrypt, no
 * eyebrow.
 */
const HERO_WAVE = { bars: 96, trackHeight: 44, barWidth: 3, gap: 2.4 };

export function builderHero(rendered, verdicts) {
  const verified = directorySorted(rendered).filter((entry) => verdicts.get(entry.slug)?.state === "verified");
  const signatures = verified
    .map((entry) => {
      const verdict = verdicts.get(entry.slug);
      return `      <a class="hsig" href="#${esc(entry.slug)}">
        <span class="hsig-wave tone-signal">${waveformSvg(verdict.waveSeed, HERO_WAVE)}</span>
        <span class="hsig-meta"><span class="hsig-name">${esc(entry.name)}</span><span class="hsig-claim">${esc(conformanceLabel(entry.conformance))} <code>${esc(verdict.id32.slice(0, 8))}</code></span></span>
      </a>`;
    })
    .join("\n");
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return `  <header class="hero hero-builders">
    <h1>Builders</h1>
    <p class="lede">Everyone building on KYA-OS, in one registry. Conformance is measured against the pinned vector suite, never self-asserted, and every verified claim is a signed credential this site re-checks.</p>
${verified.length > 0 ? `    <div class="hsigs">\n${signatures}\n    </div>\n` : ""}    <p class="hsig-caption"><span class="hsig-count">${esc(count(verified.length, "verified credential", "verified credentials"))}, ${esc(count(rendered.length, "project", "projects"))}.</span><span>Each wave is drawn from its credential's signature: no two match, and a reissue draws a new one.</span></p>
  </header>`;
}

/** The three "start here" on-ramps. */
export function sectionStartHere() {
  return `  <section>
    <h2>Start here</h2>
    <div class="rule"></div>
    <div class="grid-3">
      <div class="panel-card">
        <a class="pc-title" href="${PLAYGROUND_URL}">Poke a live server</a>
        <p>Speak MCP to a real KYA-OS endpoint before running your own - inspect the signed proof in every response.</p>
        <p class="pc-sub">raw endpoint: <code>POST ${DEMO_MCP_URL}</code></p>
        <a class="pc-link" href="${PLAYGROUND_URL}">open the playground -&gt;</a>
      </div>
      <div class="panel-card">
        <a class="pc-title" href="${STARTER_URL}">Fork the starter</a>
        <p>From existing implementation to submission-ready conformance claim in under an hour - all ${SUITE.vectors} vectors, any language.</p>
        <a class="pc-link" href="${STARTER_URL}">conformance-starter -&gt;</a>
      </div>
      <div class="panel-card">
        <a class="pc-title" href="${REVOKED_TREE_URL}">See it in action</a>
        <p>REVOKED: an on-chain kill switch for wallet agents. A genuinely revoked credential is anchored on-chain right now.</p>
        <a class="pc-link" href="/use-cases/">use-cases -&gt;</a>
      </div>
    </div>
  </section>`;
}

/** The trust ladder plus the one primary action (prompt + prefilled link). */
export function sectionSubmit() {
  const rung = (chip, note) => `      <span class="rung">${chip}<span class="rung-note">${note}</span></span>`;
  return `  <section id="submit">
    <h2>Join the registry</h2>
    <div class="rule"></div>
    <p class="section-lede">Getting listed and claiming conformance are not separate acts - they are rungs of one ladder, and the same registry entry climbs it in public. Corrections count too: every standards-matrix row is one file in <code>registry/interop/</code> - use the row's edit link on <a href="/standards/">the standards page</a>, or PR the file directly.</p>
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
      <p>Hand the prompt to your coding agent and it walks the ladder with you: your entry, an optional self-reported conformance run against the pinned suite, one pull request, and the submission issue if you want verification. Or take the one-click path - the button opens the GitHub editor on <code>registry/builders/</code> with the entry template prefilled: rename to <code>&lt;your-slug&gt;.json</code>, edit the fields, propose the change.</p>
      ${promptBlock("prompt-join-registry")}
      <p class="pc-sub">Two fields CI will not forgive: set <code>listedAt</code> to today's real date, and keep <code>slug</code> equal to your filename.</p>
      <a class="btn-solid" href="${esc(ADD_PROJECT_URL)}">add your project -&gt;</a>
    </div>
    <p class="note">Prefer a local workflow? Copy <a href="${REPO_URL}/blob/main/registry/builders/example-builder.json"><code>example-builder.json</code></a> to <code>registry/builders/&lt;your-slug&gt;.json</code>, run <code>npm test</code> (no dependencies to install), and open a PR - the field reference is in <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.</p>
  </section>`;
}
