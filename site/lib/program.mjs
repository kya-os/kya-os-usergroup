/**
 * The conformance page body, badge first: the suite pin strip; the badge
 * (the preview widget - slug and claimed level in, the grey lockup and the
 * README embed out - the one line of real states, and the pointer to the
 * ops doc); what a verified claim gives you; the four-step verification
 * pipeline; the levels; and the implementations table rendered from the
 * registry entries that carry a conformance claim. Honesty rules from
 * lib/html.mjs apply throughout: measured-not-asserted language, subset
 * claims never render bare, the badge states named here are the worker's
 * own, and the ops detail (tiers, cache bound, deploy status) lives in
 * docs/BADGE-WORKER.md, linked from the badge section rather than restated.
 * The section order, the level names, and the table shape are asserted on
 * the dist bytes in lib/copy-checks.mjs.
 */
import { CLAIM_WAVE, claimWaveSeed } from "../../scripts/lib/builder-entry.mjs";
import { CONFORMANCE_LEVELS } from "../../scripts/lib/registry-enums.mjs";
import { BADGE_WORKER_DOC_URL, CONFORMANCE_MD_URL, MCP_REPO_URL, SUITE, STARTER_URL } from "./constants.mjs";
import { conformanceLabel, conformanceLevelUrl, levelUrl, withConformance } from "./data.mjs";
import { conformanceStatusChip, esc, promptBlock } from "./html.mjs";
import { BADGE_EMBED, BADGE_EMBED_SLUG, snippetText } from "./snippets.mjs";
import { waveformSvg } from "./waveform.mjs";

// The CONFORMANCE.md section the levels cite for the audit axis, and the
// committed suite manifest the pin strip's numbers come from.
const AAP_URL = `${CONFORMANCE_MD_URL}#audit-assurance-profile-conformance`;
const SUITE_MANIFEST_URL = `${MCP_REPO_URL}/blob/f2c615c/conformance/SUITE-MANIFEST.json`;

// CONFORMANCE.md's three levels: the heading name (plain dash, house style;
// GitHub slugs the heading to the anchor lib/data.mjs links), the
// document's own one-sentence definition, and the requirement summary.
const LEVELS = [
  {
    level: "L1",
    name: "Level 1 - Core Crypto",
    quote: "Level 1 establishes the cryptographic foundation. An implementation at this level can generate identities, sign data, verify signatures, and expose discovery metadata.",
    requires: "Requires an Ed25519 key pair with a <code>did:key</code> DID, SHA-256 over RFC 8785 (JCS) canonical JSON, EdDSA signing and verification in JWS compact serialization, and <code>did:key</code> resolution to a DID Document. Audit logging MAY be implemented.",
  },
  {
    level: "L2",
    name: "Level 2 - Full Session",
    quote: "Level 2 adds session management with replay prevention and proof generation. An implementation at this level can establish secure sessions and generate non-repudiation proofs.",
    requires: "Requires all of Level 1, plus handshake validation, nonce format and uniqueness (replay prevention), a timestamp skew of 120 seconds by default, session TTL, and detached proofs (a JWS binding a tool request and its response together) that carry the request and response hashes and verify against them. Audit logging SHOULD be implemented.",
  },
  {
    level: "L3",
    name: "Level 3 - Full Delegation",
    quote: "Level 3 adds W3C Verifiable Credential-based delegation with revocation support. An implementation at this level can issue, verify, and revoke delegations, and propagate delegation context on outbound calls.",
    requires: "Requires all of Level 2, plus issuing and verifying DelegationCredentials, StatusList2021 status checks, delegation chain validation with cascading revocation, and a delegation proof on outbound calls. Audit logging MUST be implemented.",
  },
];

const brandCell = (size) =>
  `<span class="bl-brand"><img class="mark mark-white" src="/img/kya-mark-white.svg" alt="" width="${size}" height="${size + 2}" /><img class="mark mark-black" src="/img/kya-mark-black.svg" alt="" width="${size}" height="${size + 2}" />KYA-OS</span>`;

/**
 * The README embed block: the visible line with the placeholder slug
 * highlighted (the preview module fills it in), the raw <pre> the copy
 * button reads, and the button - the copy-prompt pattern.
 */
function embedBlock() {
  const slugSpan = `<span class="hl" data-embed-slug>${BADGE_EMBED_SLUG}</span>`;
  return `<div class="code-wrap embed-wrap">
          <div class="embed-snippet" data-snippet="${BADGE_EMBED.id}">${esc(snippetText(BADGE_EMBED)).split(BADGE_EMBED_SLUG).join(slugSpan)}</div>
          <pre id="${BADGE_EMBED.id}" hidden aria-hidden="true">${esc(snippetText(BADGE_EMBED))}</pre>
          <button type="button" class="copy-code" data-copy-target="${BADGE_EMBED.id}" hidden>[ copy ]</button>
        </div>`;
}

/**
 * Preview your badge: slug + claimed level in, the grey unverified lockup
 * and the README embed out. The lockup is drawn at build time for the
 * placeholder and redrawn client-side by /ui/badge-preview.js from the same
 * waveform bytes and the same seed derivation the directory row uses; the
 * same module fills the slug into the embed. Visual only - the label says
 * so. There is no tier toggle: the badge renders the claim from the
 * verified credential, never from a chosen tier.
 */
function badgePreview() {
  const level = CONFORMANCE_LEVELS[0];
  const seed = claimWaveSeed(BADGE_EMBED_SLUG, { level, scope: "full" });
  const levels = CONFORMANCE_LEVELS.map((l) => `<option value="${l}">${l}</option>`).join("");
  return `<div class="badge-preview">
        <div class="pc-title t-static">preview your badge</div>
        <form id="badge-preview" class="eb bp-form" hidden novalidate>
          <div class="eb-field"><label class="eb-label" for="bp-slug">your slug</label><input id="bp-slug" name="slug" type="text" maxlength="40" placeholder="${BADGE_EMBED_SLUG}" autocomplete="off" spellcheck="false" /></div>
          <div class="eb-field"><label class="eb-label" for="bp-level">claimed level</label><select id="bp-level" name="level">${levels}</select></div>
        </form>
        <span class="badge-lockup bl-preview">
          ${brandCell(11)}
          <span class="bl-wave" id="bp-wave">${waveformSvg(seed, CLAIM_WAVE)}</span>
          <span class="bl-state">&middot; preview</span>
        </span>
        <p class="micro">preview of the visual only - not a verified badge; verification comes from the program &middot; seed <span id="bp-seed">${esc(seed)}</span> - the same derivation the directory row draws your wave from</p>
        <p class="note">Paste this into your README the day you are listed - it is the same <code>/badge/&lt;slug&gt;.svg</code> the build emits and the worker serves, so it climbs as your status does:</p>
        ${embedBlock()}
      </div>`;
}

/**
 * The badge, first: what it resolves to, the preview widget, the one line
 * of real states (the worker's own grammar, workers/badge/worker.mjs), and
 * the pointer to the ops doc that carries tiers, cache bound, and deploy
 * status.
 */
function sectionBadge() {
  return `  <section id="the-badge" class="fx fxd-20">
    <h2>The badge</h2>
    <div class="rule"></div>
    <div class="badge-copy">
      <p class="lede-lg">The badge resolves to the signed credential behind it, so anyone can check your claim without trusting this site. Revoke the credential and every embedded badge downgrades itself.</p>
      ${badgePreview()}
      <p class="note">It has seven states and nothing else: <span class="tone-faint">listed</span>, <span class="tone-faint">self-reported</span>, <span class="tone-amber">in verification</span>, <span class="tone-signal">verified</span>, <span class="tone-amber">under appeal</span>, revoked, and <span class="tone-faint">unverified</span> (the fail-closed answer to any failure). Only a verified credential with clean status bits renders green, and the badge re-verifies that credential on every render.</p>
      <p class="see-all"><a href="${BADGE_WORKER_DOC_URL}">how the badge worker serves this -&gt;</a></p>
    </div>
  </section>`;
}

/**
 * What a verified claim gives you: three honest benefits. Each names what
 * was tested against the pinned suite (CONFORMANCE.md: L3.25
 * needs_authorization hints; the delegation-chain vectors reject scope
 * widening; L3.11 and L3.22 revocation) - never what it proves about the
 * agent.
 */
function sectionWhy() {
  return `  <section id="why-conform" class="fx fxd-25">
    <h2>What a verified claim gives you</h2>
    <div class="rule"></div>
    <ul class="bullets why">
      <li><strong>Interoperability you can point at.</strong> Your implementation passed the same ${SUITE.vectors} vectors the reference implementation passes, so peers know which behaviors to expect from it.</li>
      <li><strong>A claim anyone can check.</strong> A signed, revocable credential at a canonical URL, and a badge that re-verifies it - not a logo you paste.</li>
      <li><strong>Behavior under authority.</strong> The Level 2 and Level 3 requirements exercise consent gating (<code>needs_authorization</code>), delegation attenuation (a chain that widens scope is rejected), and revocation, so a verified L3 says those paths were tested against the pinned vectors. Tested is the whole claim: the credential asserts a test result, not that your agent is safe.</li>
    </ul>
  </section>`;
}

/** The four-step pipeline, from the program README's claim flow. */
function sectionHow() {
  const step = (n, title, copy) => `      <div class="panel-card step">
        <div class="step-n">${n}</div>
        <div class="pc-title t-static">${title}</div>
        <p>${copy}</p>
      </div>`;
  return `  <section id="how-verification-works" class="fx fxd-30">
    <h2>How verification works</h2>
    <div class="rule"></div>
    <p class="section-lede lede-lg">Requirements are defined in <a href="${CONFORMANCE_MD_URL}">CONFORMANCE.md</a>. Any language that can read JSON and do Ed25519 + SHA-256 can play. A level is claimed in full or as a named subset of vector categories - a subset claim covers exactly the categories it names and never rounds up to the bare level.</p>
    <div class="grid-4">
${[
    step("01", "run the suite", `Fetch the pinned vectors hash-verified, run all ${SUITE.vectors} through your adapter.`),
    step("02", "submit the claim", "Open a conformance submission issue with your claim.json."),
    step("03", "independent re-run", "The program re-runs your suite and attests exactly what it observes."),
    step("04", "credential + badge", "Your registry entry carries the claim; the credential makes it portable."),
  ].join("\n")}
    </div>
    <div class="pipeline"><span class="pipe-dot"></span></div>
    <p class="note">Fastest on-ramp: the <a href="${STARTER_URL}">conformance starter</a> - clone to a submission-ready claim in under an hour.</p>
    <p class="note">These are rungs of one ladder, not a separate act: listed in five minutes, self-reported the same hour, verified when the program re-runs your bytes - <a href="/builders/#submit">join on the builders page -&gt;</a></p>
    <p class="note">Services: add a <code>probeUrl</code> to your registry entry and the daily probe verifies your deployment enforces, independent of any claim - a bare request on the wire, answered by the protocol&#39;s own refusal.</p>
    ${promptBlock("prompt-prove-conformance")}
  </section>`;
}

/** The levels: capability tiers, not vector ranges; the AAP axis alongside. */
function sectionLevels() {
  const card = ({ level, name, quote, requires }) => `      <div class="panel-card">
        <a class="pc-title pc-lg" href="${levelUrl(level)}">${level} <span class="pc-tag">${name}</span></a>
        <p>"${quote}"</p>
        <p class="pc-sub">${requires}</p>
      </div>`;
  return `  <section id="levels" class="fx fxd-35">
    <h2>Levels</h2>
    <div class="rule"></div>
    <p class="section-lede"><a href="${CONFORMANCE_MD_URL}">CONFORMANCE.md</a> defines three levels. Each builds on the previous, with increasing capability requirements, and an implementation must pass all tests for a level to claim conformance at it. Levels are capability tiers, not vector ranges: the suite is one pinned set (suite ${esc(SUITE.version)}, ${SUITE.vectors} vectors in ${SUITE.categories} categories, per <a href="${SUITE_MANIFEST_URL}">SUITE-MANIFEST.json</a>), and a claim names the level your implementation supports, in full or as a named subset of categories.</p>
    <div class="grid-3">
${LEVELS.map(card).join("\n")}
    </div>
    <p class="note">Audit assurance is a separate axis, not a fourth level: the <a href="${AAP_URL}">Audit Assurance Profile ladder</a> (AAP-0 to AAP-4: no claim, Recorded, Chained, Transparent, Observed) is claimed alongside L1 to L3, and each profile requires all lower profiles plus its own executable evidence.</p>
  </section>`;
}

/**
 * One table row per registry entry that carries a conformance claim: the
 * name (linking its directory row), the honest claim label (a subset never
 * renders bare) linking its level, the suite, the status chip (green only
 * as the credential link), and the links - the repo when the entry names
 * one, else its homepage, plus the credential when a status carries one.
 */
function implementationRow(entry, verdicts) {
  const c = entry.conformance;
  const links = [entry.repo ? `<a href="${esc(entry.repo)}">repo -&gt;</a>` : `<a href="${esc(entry.homepage)}">homepage -&gt;</a>`];
  if (c.attestationUrl) links.push(`<a href="${esc(c.attestationUrl)}">credential -&gt;</a>`);
  return `        <tr>
          <td class="iname"><a href="/builders/#${esc(entry.slug)}">${esc(entry.name)}</a></td>
          <td class="iclaim"><a href="${esc(conformanceLevelUrl(c))}">${esc(conformanceLabel(c))}</a></td>
          <td class="isuite">${esc(c.suiteVersion)}</td>
          <td>${conformanceStatusChip(c, { verdict: verdicts.get(entry.slug) })}</td>
          <td class="ilinks">${links.join(" ")}</td>
        </tr>`;
}

/** The implementations table, scrolling inside .itable, ending in the claim CTA row. */
function sectionImplementations(conformanceEntries, verdicts) {
  const cta = conformanceEntries.length === 0 ? "no conformance claims yet" : "your implementation here";
  return `  <section id="implementations" class="fx fxd-40">
    <h2>Implementations</h2>
    <div class="rule"></div>
    <div class="itable">
      <table class="impl">
        <thead><tr><th scope="col">Implementation</th><th scope="col">Claim</th><th scope="col">Suite</th><th scope="col">Status</th><th scope="col">Links</th></tr></thead>
        <tbody>
${conformanceEntries.map((entry) => implementationRow(entry, verdicts)).join("\n")}
        </tbody>
        <tfoot><tr><td colspan="5" class="ifoot">${cta} - <a href="/builders/#submit">claim conformance -&gt;</a></td></tr></tfoot>
      </table>
    </div>
  </section>`;
}

export function sectionsConformance(rendered, verdicts) {
  const pinStrip = `  <div class="pin-strip fx fxd-10">
    <span>suite <b>${esc(SUITE.version)}</b></span>
    <span><b>${SUITE.vectors}</b> vectors</span>
    <span class="pin-hash">pinned <span class="hash">${esc(SUITE.vectorSetHash)}</span></span>
  </div>`;
  return [pinStrip, sectionBadge(), sectionWhy(), sectionHow(), sectionLevels(), sectionImplementations(withConformance(rendered), verdicts)].join("\n");
}
