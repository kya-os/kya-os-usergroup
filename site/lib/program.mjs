/**
 * The conformance page body, translated from the "Conformance" artboard of
 * the Builders Site design handoff: the suite pin strip, the four-step
 * verification pipeline, the badge anatomy (with build-time signature
 * waveforms), the levels, the verification state machine, and the
 * implementations table rendered from the registry entries that carry a
 * conformance claim, plus the README embed block and the client-side badge
 * preview. Honesty rules from lib/html.mjs apply throughout:
 * measured-not-asserted language, subset claims never render bare, and the
 * badge states are labeled as the Phase B state machine, not live claims.
 */
import { CLAIM_WAVE, claimWaveSeed } from "../../scripts/lib/builder-entry.mjs";
import { CONFORMANCE_LEVELS } from "../../scripts/lib/registry-enums.mjs";
import { CONFORMANCE_MD_URL, MCP_REPO_URL, ORIGIN, SUBMISSION_ISSUE_URL, SUITE, STARTER_URL } from "./constants.mjs";
import { conformanceLabel, conformanceLevelUrl, levelUrl, withConformance } from "./data.mjs";
import { conformanceStatusChip, esc, promptBlock } from "./html.mjs";
import { BADGE_EMBED, BADGE_EMBED_SLUG, snippetText } from "./snippets.mjs";
import { waveformSvg } from "./waveform.mjs";

// The CONFORMANCE.md section the levels cite for the audit axis, and the
// committed suite manifest the pin strip's numbers come from.
const AAP_URL = `${CONFORMANCE_MD_URL}#audit-assurance-profile-conformance`;
const SUITE_MANIFEST_URL = `${MCP_REPO_URL}/blob/main/conformance/SUITE-MANIFEST.json`;

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
 * out, drawn at build time for the placeholder and redrawn client-side by
 * /ui/badge-preview.js from the same waveform bytes and the same seed
 * derivation the directory row uses. Visual only - the label says so.
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
      </div>`;
}

/**
 * How the badge works, from workers/badge/worker.mjs and its README: the
 * paths and the two tiers behind them, what a green badge requires, the
 * state grammar, the propagation bound, and which artifact carries the
 * waveform (the site's lockups, seeded by `seed`) versus the README badge
 * (the flat SVG). Every state and header named here is the worker's own.
 */
function badgeHow(seed) {
  return `<div class="badge-how">
        <div class="pc-title t-static">how the badge works</div>
        <ul class="bullets">
          <li><strong>Where it is served.</strong> <code>/badge/&lt;slug&gt;.svg</code> and <code>.json</code> (the shields.io endpoint schema) on <code>builders.kya-os.org</code>. Two tiers share those paths: today the site build emits every badge as a static file, and the badge worker takes over <code>builders.kya-os.org/badge/*</code> with request-time verification once it deploys. The worker is armed (the program keys are provisioned and pinned in it) but not deployed yet: deployment is a manual workflow run, and until it runs the static tier answers on these paths.</li>
          <li><strong>What makes it green.</strong> Only a verified credential, on either tier. The worker fetches the credential from its canonical URL (the build reads the committed copy); its Ed25519 <code>eddsa-jcs-2022</code> proof is checked against the pinned issuer key the proof names, never a key the credential carries; then the revocation and suspension bits are read from two signed Bitstring status lists, each verified against a separate pinned status key before any bit is read, so a stolen issuer key can never clear its own revocation bits. The credential has no expiry: currency lives in suite supersession, recorded in its <code>termsOfUse</code>.</li>
          <li><strong>The states.</strong> <code>&middot; listed</code>, <code>&middot; &lt;claim&gt; self-reported</code>, and <code>&#9676; &lt;claim&gt; in verification</code> render from the registry entry alone, no fetch; <code>&check; &lt;claim&gt; verified</code> needs the proof valid and both bits clear; <code>&#9676; under appeal</code> is the suspension bit (contested, not withdrawn); <code>revoked</code> is the revocation bit, terminal; <code>unverified</code> is the worker's fail-closed answer to unprovisioned keys or any failure anywhere, never a 500 and never anything green.</li>
          <li><strong>How fast it changes.</strong> On the static tier a revocation lands when its PR merges and the site redeploys. On the worker it propagates in one cache TTL: <code>s-maxage=300</code>, about five minutes, before any caching by the page that embeds the image; failure responses cache for 60 seconds so an outage cannot pin a stale answer.</li>
          <li><strong>Waveform versus README badge.</strong> The waveform lockups on this site are drawn at build time from a seed, not from the badge: a listed claim's wave is seeded by <code>&lt;slug&gt;#&lt;claim label&gt;</code> (<code>${esc(seed)}</code> for the preview below), the same derivation the directory row draws from, so the same claim always draws the same wave. The badge you embed in a README is the flat two-cell SVG (a KYA-OS label cell and a state cell) the build emits and the worker serves, byte-identical between the tiers; it carries no waveform.</li>
        </ul>
      </div>`;
}

function implementationsTable(conformanceEntries, verdicts) {
  if (conformanceEntries.length === 0) {
    return `      <div class="ifoot">no conformance claims yet - <a href="/builders/#submit">claim conformance -&gt;</a></div>`;
  }
  const rows = conformanceEntries
    .map((entry) => {
      const c = entry.conformance;
      return `      <div class="igrid irow">
        <a class="iname" href="/builders/#${esc(entry.slug)}">${esc(entry.name)}</a>
        <a class="iclaim" href="${esc(conformanceLevelUrl(c))}">${esc(conformanceLabel(c))}</a>
        <span class="isuite">${esc(c.suiteVersion)}</span>
        <span>${conformanceStatusChip(c, { verdict: verdicts.get(entry.slug) })}</span>
        <a class="ilink" href="${esc(entry.homepage)}">homepage</a>
      </div>`;
    })
    .join("\n");
  return `${rows}
      <div class="ifoot">your implementation here - <a href="/builders/#submit">claim conformance -&gt;</a></div>`;
}

export function sectionsConformance(rendered, verdicts) {
  const conformanceEntries = withConformance(rendered);
  return `  <div class="pin-strip fx fxd-10">
    <span>suite <b>${esc(SUITE.version)}</b></span>
    <span><b>${SUITE.vectors}</b> vectors</span>
    <span class="pin-hash">pinned <span class="hash">${esc(SUITE.vectorSetHash)}</span></span>
  </div>
  <section id="how-verification-works" class="fx fxd-20">
    <h2>How verification works</h2>
    <div class="rule"></div>
    <p class="section-lede lede-lg">Requirements are defined in <a href="${CONFORMANCE_MD_URL}">CONFORMANCE.md</a>. Any language that can read JSON and do Ed25519 + SHA-256 can play. A level is claimed in full or as a named subset of vector categories - a subset claim covers exactly the categories it names and never rounds up to the bare level.</p>
    <div class="grid-4">
      <div class="panel-card step">
        <div class="step-n">01</div>
        <div class="pc-title t-static">run the suite</div>
        <p>Fetch the pinned vectors hash-verified, run all ${SUITE.vectors} through your adapter.</p>
      </div>
      <div class="panel-card step">
        <div class="step-n">02</div>
        <div class="pc-title t-static">submit the claim</div>
        <p>Open a conformance submission issue with your claim.json.</p>
      </div>
      <div class="panel-card step">
        <div class="step-n">03</div>
        <div class="pc-title t-static">independent re-run</div>
        <p>The program re-runs your suite and attests exactly what it observes.</p>
      </div>
      <div class="panel-card step">
        <div class="step-n">04</div>
        <div class="pc-title t-static">credential + badge</div>
        <p>Your registry entry carries the claim; the credential makes it portable.</p>
      </div>
    </div>
    <div class="pipeline"><span class="pipe-dot"></span></div>
    <p class="note">Fastest on-ramp: the <a href="${STARTER_URL}">conformance starter</a> - clone to a submission-ready claim in under an hour.</p>
    <p class="note">These are rungs of one ladder, not a separate act: listed in five minutes, self-reported the same hour, verified when the program re-runs your bytes - <a href="/builders/#submit">join on the builders page -&gt;</a></p>
    <p class="note">Services: add a <code>probeUrl</code> to your registry entry and the daily probe verifies your deployment enforces, independent of any claim - a bare request on the wire, answered by the protocol&#39;s own refusal.</p>
    ${promptBlock("prompt-prove-conformance")}
  </section>
  <section id="the-badge" class="fx fxd-25">
    <h2>The badge</h2>
    <div class="rule"></div>
    <div class="badge-copy">
      <p class="lede-lg">The payoff of the pipeline. A badge is not a logo you paste - it resolves to the signed credential behind it, so anyone can verify your claim without trusting this site.</p>
      <p class="note">It renders <span class="tone-signal">verified</span> only while the claim links its credential; revoke the credential and every embedded badge downgrades itself. Amber means the program is still re-running your suite.</p>
      <p class="note">Embed it the day you are listed: every tier builds with the site - grey <span class="tone-faint">listed</span> and <span class="tone-faint">self-reported</span>, amber <span class="tone-amber">in verification</span>, and <span class="tone-signal">verified</span> only after the build has cryptographically verified your credential against the program keys and its signed status lists (build-time verification of in-repo state). The badge upgrades itself as your status climbs the ladder.</p>
      <p class="note">Paste this into your README the day you are listed - it is the same <code>/badge/&lt;slug&gt;.svg</code> the build emits and the worker serves, so it upgrades itself as your status climbs:</p>
      ${embedBlock()}
      <div class="badge-row">
        <span class="badge-lockup bl-verified">
          <span class="bl-scan" aria-hidden="true"></span>
          <span class="bl-brand"><img class="mark mark-white" src="/img/kya-mark-white.svg" alt="" width="13" height="15" /><img class="mark mark-black" src="/img/kya-mark-black.svg" alt="" width="13" height="15" />KYA-OS</span>
          <span class="bl-wave" title="claim wave - the same seed always draws the same wave">${waveformSvg("did:web:poc.kya-os.ai#l1-claim-suite-1.0.0", { bars: 18, trackHeight: 16 })}</span>
          <span class="bl-state">&check; L1 verified v${esc(SUITE.version)}</span>
        </span>
        <span class="badge-lockup bl-verifying">
          <span class="bl-scan" aria-hidden="true"></span>
          <span class="bl-brand"><img class="mark mark-white" src="/img/kya-mark-white.svg" alt="" width="11" height="13" /><img class="mark mark-black" src="/img/kya-mark-black.svg" alt="" width="11" height="13" />KYA-OS</span>
          <span class="bl-wave">${waveformSvg("mycelium-trails#claim-pending", { bars: 14, trackHeight: 12 })}</span>
          <span class="bl-state">&#9676; in verification</span>
        </span>
        <span class="badge-lockup bl-none">
          <span class="bl-brand"><img class="mark mark-white" src="/img/kya-mark-white.svg" alt="" width="11" height="13" /><img class="mark mark-black" src="/img/kya-mark-black.svg" alt="" width="11" height="13" />KYA-OS</span>
          <span class="bl-state">&middot; no claim</span>
        </span>
      </div>
      <p class="micro">badges build with the site at /badge/&lt;slug&gt;.svg &middot; verified renders only from build-time credential verification</p>
      ${badgeHow(claimWaveSeed(BADGE_EMBED_SLUG, { level: CONFORMANCE_LEVELS[0], scope: "full" }))}
      ${badgePreview()}
    </div>
  </section>
  <section id="levels" class="fx fxd-30">
    <h2>Levels</h2>
    <div class="rule"></div>
    <p class="section-lede"><a href="${CONFORMANCE_MD_URL}">CONFORMANCE.md</a> defines three levels. Each builds on the previous, with increasing capability requirements, and an implementation must pass all tests for a level to claim conformance at it. Levels are capability tiers, not vector ranges: the suite is one pinned set (suite ${esc(SUITE.version)}, ${SUITE.vectors} vectors in ${SUITE.categories} categories, per <a href="${SUITE_MANIFEST_URL}">SUITE-MANIFEST.json</a>), and a claim names the level your implementation supports, in full or as a named subset of categories.</p>
    <div class="grid-3">
      <div class="panel-card">
        <a class="pc-title pc-lg" href="${levelUrl("L1")}">L1 <span class="pc-tag">core crypto</span></a>
        <p>"Level 1 establishes the cryptographic foundation. An implementation at this level can generate identities, sign data, verify signatures, and expose discovery metadata."</p>
        <p class="pc-sub">Requires an Ed25519 key pair with a <code>did:key</code> DID, SHA-256 over RFC 8785 (JCS) canonical JSON, EdDSA signing and verification in JWS compact serialization, and <code>did:key</code> resolution to a DID Document. Audit logging MAY be implemented.</p>
      </div>
      <div class="panel-card">
        <a class="pc-title pc-lg" href="${levelUrl("L2")}">L2 <span class="pc-tag">full session</span></a>
        <p>"Level 2 adds session management with replay prevention and proof generation. An implementation at this level can establish secure sessions and generate non-repudiation proofs."</p>
        <p class="pc-sub">Requires all of Level 1, plus handshake validation, nonce format and uniqueness (replay prevention), a timestamp skew of 120 seconds by default, session TTL, and detached proofs (a JWS binding a tool request and its response together) that carry the request and response hashes and verify against them. Audit logging SHOULD be implemented.</p>
      </div>
      <div class="panel-card">
        <a class="pc-title pc-lg" href="${levelUrl("L3")}">L3 <span class="pc-tag">full delegation</span></a>
        <p>"Level 3 adds W3C Verifiable Credential-based delegation with revocation support. An implementation at this level can issue, verify, and revoke delegations, and propagate delegation context on outbound calls."</p>
        <p class="pc-sub">Requires all of Level 2, plus issuing and verifying DelegationCredentials, StatusList2021 status checks, delegation chain validation with cascading revocation, and a delegation proof on outbound calls. Audit logging MUST be implemented.</p>
      </div>
    </div>
    <p class="note">Audit assurance is a separate axis, not a fourth level: the <a href="${AAP_URL}">Audit Assurance Profile ladder</a> (AAP-0 to AAP-4: no claim, Recorded, Chained, Transparent, Observed) is claimed alongside L1 to L3, and each profile requires all lower profiles plus its own executable evidence.</p>
  </section>
  <section class="fx fxd-40">
    <h2>Verification states</h2>
    <div class="rule"></div>
    <div class="grid-3">
      <div class="panel-card">
        <span class="chip st-submitted demo">submitted</span>
        <p>claim.json received. The claim is public from the moment it lands - nothing is gatekept. <a href="${SUBMISSION_ISSUE_URL}">open a submission issue -&gt;</a></p>
      </div>
      <div class="panel-card state-verifying">
        <span class="bl-scan" aria-hidden="true"></span>
        <span class="chip st-inverif demo pulse-ring">in verification</span>
        <p>The program is independently re-running your suite against the pinned vectors. Attests exactly what it observes - no more, no less.</p>
      </div>
      <div class="panel-card state-verified">
        <span class="chip st-verified demo">&check; verified</span>
        <p>The claim links its credential. Only this state counts as verified - a claim without a linked credential never displays it.</p>
        <div class="readout">
          <div><span class="tone-signal">&check;</span> vectors <b>${SUITE.vectors}/${SUITE.vectors}</b> &middot; suite <b>${esc(SUITE.version)}</b></div>
          <div>attested <b>${esc(SUITE.vectorSetHash.slice(0, 11))}&hellip;${esc(SUITE.vectorSetHash.slice(-4))}</b></div>
          <div>credential <b>eddsa-jcs-2022 &middot; did:web:builders.kya-os.org</b></div>
        </div>
      </div>
    </div>
    <p class="dnote">The badge tiers at <code>/badge/&lt;slug&gt;.svg</code> mirror these chips. The <span class="tone-signal">verified</span> tier renders only when this site's build has cryptographically verified the credential and its signed status lists (a suspension renders <span class="tone-amber">under appeal</span>, a revocation renders dark).</p>
  </section>
  <section class="fx fxd-50">
    <h2>Implementations</h2>
    <div class="rule"></div>
    <div class="itable">
      <div class="igrid ihead" aria-hidden="true"><span>IMPLEMENTATION</span><span>CLAIM</span><span>SUITE</span><span>STATUS</span><span>LINKS</span></div>
${implementationsTable(conformanceEntries, verdicts)}
    </div>
  </section>`;
}
