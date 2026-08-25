/**
 * Page bodies for the standards matrix, the protocol rails diagram page, and
 * the use-cases page, translated from the Builders Site design handoff
 * artboards. The standards matrix renders every registry/interop/ row as an
 * expandable <details> row (no JS required); the rails hero diagram is a
 * static translation of the "Protocol Rails" artboard with build-time
 * waveforms; use-cases carries the REVOKED example and the recipe grid.
 */
import { ENTITY_CARD_URL, MCP_REPO_URL, REPO_URL, REVOKED_TREE_URL } from "./constants.mjs";
import { interopByCategory } from "./data.mjs";
import { esc, interopStatusChip, promptBlock } from "./html.mjs";
import { waveformLockup } from "./waveform.mjs";

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

// The rails that carry or produce proof material get the signed-proof lockup
// in their expanded row (the design's proof-bearing set, on hub slugs).
const PROOF_BEARING = new Set([
  "di-eddsa-jcs-2022",
  "w3c-vc-2-0",
  "zcap-ld",
  "bitstring-status-list",
  "cheqd-dlr",
  "statuslist2021",
  "rfc-9162",
  "rfc-8785",
  "rfc-9421",
]);

function standardsRow(entry) {
  const lockup = PROOF_BEARING.has(entry.slug)
    ? `\n            ${waveformLockup(`kya-os:${entry.slug}`, { label: "proof-bearing rail", bars: 14, trackHeight: 10, small: true })}`
    : "";
  const evidence = entry.evidence ? `<a href="${esc(entry.evidence)}">evidence -&gt;</a>\n            ` : "";
  const notes = entry.notes ? `\n            <p class="srow-notes">${esc(entry.notes)}</p>` : "";
  const name =
    // Never an anchor: the name sits inside the row's <summary>, and a link
    // nested in a disclosure trigger fights it for the click (same rule as
    // the directory chips). Like .dtitle, the name is a disclosure-row label
    // - one style for every row; the expanded row carries the evidence link.
    `<span class="sname">${esc(entry.standard)}</span>`;
  return `        <details class="srow" id="std-${esc(entry.slug)}">
          <summary class="sgrid">
            ${name}
            <span class="sshort">${esc(entry.relationship)}</span>
            <span>${interopStatusChip(entry.status)}</span>
            <span class="slisted">${esc(entry.listedAt)}</span>
            <span class="caret" aria-hidden="true"></span>
          </summary>
          <div class="sexpand">${lockup}${notes}
            <div class="dlinks">${evidence}<a class="quiet" href="${REPO_URL}/edit/main/registry/interop/${esc(entry.slug)}.json">edit this row -&gt;</a></div>
          </div>
        </details>`;
}

export function sectionsStandards(interopSorted) {
  const categories = interopByCategory(interopSorted)
    .map(
      ([category, entries]) => `    <section class="scat fx">
      <div class="scat-label">${esc(CATEGORY_LABELS[category])}</div>
      <div class="stable">
${entries.map(standardsRow).join("\n")}
      </div>
    </section>`,
    )
    .join("\n");
  return `  <div class="legend fx fxd-10">
    <span><span class="chip st-shipping">shipping</span> code at the current release</span>
    <span><span class="chip st-specified">specified</span> normative spec text</span>
    <span><span class="chip st-planned">planned</span> on the roadmap</span>
    <span><span class="chip st-none">none</span> exactly that — listed so nobody has to guess</span>
  </div>
  <p class="section-lede fx fxd-15">Click a row for the full relationship and evidence. Disputes and updates are one pull request: every row is one file in <code>registry/interop/</code>; the machine-readable matrix is <a href="/interop.json">interop.json</a>.</p>
${categories}`;
}

export function sectionsRails(interopSorted) {
  const outBox = (label, sub = "") =>
    `<div class="rd-out">${esc(label)}${sub ? ` <span class="rd-sub">&middot; ${esc(sub)}</span>` : ""}</div>`;
  return `  <section class="fx fxd-15">
    <div class="rails-diagram">
      <div class="rd-grid">
        <div class="rd-col rd-agents">
          <div class="rd-label">AGENTS</div>
          <div class="rd-box">agent</div>
          <div class="rd-box">orchestrator</div>
          <div class="rd-box">human principal</div>
        </div>
        <div class="rd-wires rd-wires-in">
          <div class="wire"><span class="wire-dot"></span></div>
          <div class="wire"><span class="wire-dot wd-d1"></span></div>
          <div class="wire"><span class="wire-dot wd-d2"></span></div>
        </div>
        <div class="rd-core">
          <div class="rd-core-title">KYA-OS</div>
          <div class="rd-core-cells">
            <span>identity</span>
            <span>credentials</span>
            <span>delegation</span>
            <span>consent</span>
            <span>proof</span>
            <span>audit</span>
          </div>
          <div class="rd-core-wf">${waveformLockup("kya-os:signed-proof:v1.14", { bars: 16, trackHeight: 11 })}</div>
        </div>
        <div class="rd-wires rd-wires-out">
          <div class="wire"><span class="wire-dot wd-d04"></span></div>
          <div class="wire"><span class="wire-dot wd-d14"></span></div>
          <div class="wire"><span class="wire-dot wd-d24"></span></div>
        </div>
        <div class="rd-col rd-projections">
          <div class="rd-label">PROJECTS ONTO</div>
          <div>
            <div class="rd-cap">DISCOVERY — where agents are found</div>
            <div class="rd-outs">${outBox("A2A AgentExtension")}${outBox("MCP catalog / server.json")}${outBox("NANDA AgentFacts")}</div>
          </div>
          <div>
            <div class="rd-cap">TRUST — what the proof is made of</div>
            <div class="rd-outs">${outBox("W3C DIDs + VC 2.0", "identity")}${outBox("Bitstring + cheqd DLR", "revocation")}</div>
          </div>
          <div>
            <div class="rd-cap">TRANSPORT — how the proof travels</div>
            <div class="rd-outs">${outBox("OAuth 2.1 + DPoP")}</div>
          </div>
        </div>
      </div>
    </div>
    <p class="rails-caption">one identity in &middot; one signed proof &middot; every surface out</p>
  </section>
  <section class="fx fxd-30">
    <h2>Write once, project everywhere</h2>
    <div class="rule"></div>
    <p class="lede-lg">KYA-OS does not ask ecosystems to migrate. Write the Entity Card once - the single source of truth - and each downstream protocol gets a projection of it, emitted by the same code path and gated by the same proof posture. Update the card and every projection stays consistent.</p>
    <p class="lede-muted">A peer that does not speak KYA-OS ignores the extra metadata and loses nothing; a compatible peer gains cryptographic certainty about who it is talking to. All four discovery projections carry that graceful-degradation contract.</p>
  </section>
  <section class="fx fxd-40 sec-70">
    <div class="grid-3">
      <div class="panel-card">
        <a class="pc-title" href="${ENTITY_CARD_URL}#62-a2a-agentextension">project onto A2A</a>
        <p>Emits an AgentCard capability extension, scoped to agent entities. Activated via the A2A-Extensions header; unaware peers ignore it.</p>
      </div>
      <div class="panel-card">
        <a class="pc-title" href="${ENTITY_CARD_URL}#61-mcp-serverjson--catalogjson-_metaorgkya-oscard">project onto MCP</a>
        <p>An always-by-ref catalog index row plus Entity Card metadata in the MCP Registry _meta extension point — the index stays cheap, the card lazy-fetches.</p>
      </div>
      <div class="panel-card">
        <a class="pc-title" href="${ENTITY_CARD_URL}#63-nanda-agentfacts">project onto NANDA</a>
        <p>An AgentFacts JSON-LD projection populating NANDA's shipped owner slot; namespaced kya:* keys degrade gracefully.</p>
      </div>
    </div>
    <p class="see-all"><a href="/standards/">see all ${interopSorted.length} standards rows, with evidence -&gt;</a></p>
  </section>`;
}

export function sectionsUseCases() {
  const recipe = (title, body, tags) => `      <div class="panel-card">
        <div class="pc-title t-static">${esc(title)}</div>
        <p>${esc(body)}</p>
        <div class="tag-row">${tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</div>
      </div>`;
  return `  <section class="fx fxd-15">
    <div class="scat-label">USE CASE <span class="chip st-shipping">shipping</span></div>
    <div class="showcase">
      <div>
        <div class="flag-title">REVOKED</div>
        <p class="flag-lede">An on-chain kill switch for AI agents with wallet access. Agents spend under scoped, verifiable delegations - and that authority is revocable on a public chain (cheqd testnet), where every verifier reads the same refusal.</p>
        <p class="flag-sub">Built solo in a weekend at DEF CON 34 - 2nd place in the Cryptocurrency Village hackathon. The agent was Claude Desktop; a local gateway wallet held the keys, so the LLM never touched key material. A hardware kill switch flipped a StatusList2021 bit in a did:cheqd DID-Linked Resource, and the agent's next transaction was refused in 828ms - measured, not asserted (the repo's own elapsedMs). Funds never moved.</p>
        <p class="flag-sub">The revocation path was upstreamed into the protocol itself (cheqd DID-Linked Resources, v1.14.0), and the actual DEF CON stage credential ships in the repo, now expired - fail-closed has layers. Accountability is not a theory here; it is a circuit breaker.</p>
        <div class="dlinks">
          <a href="${REVOKED_TREE_URL}">repo -&gt;</a>
          <a href="${MCP_REPO_URL}">spec repo -&gt;</a>
          <a class="quiet" href="/standards/#std-cheqd-dlr">standards: cheqd-dlr</a>
        </div>
      </div>
      <div class="flag-console">
        <div class="fc-line"><span class="kill-dot" aria-hidden="true"></span><span>delegation <b>scoped: spend &le; 10 CHEQ</b></span></div>
        <div class="wire fc-wire"><span class="wire-dot"></span></div>
        <div class="fc-line fc-wrap">agent spends under ${waveformLockup("revoked:delegation:spend<=10cheq", { bars: 14, trackHeight: 10, small: true })}</div>
        <div class="fc-hr"></div>
        <div class="fc-line">principal revokes <span class="tone-alert">on-chain</span></div>
        <div class="fc-line">agent authority <span class="tone-alert">= 0, everywhere</span></div>
      </div>
    </div>
    ${promptBlock("prompt-run-revoked")}
  </section>
  <section class="fx fxd-30">
    <h2>Recipes</h2>
    <div class="rule"></div>
    <p class="section-lede">Patterns the primitives were designed for. No listed example yet — each one is a chance to <a href="/builders/#submit">be the first</a>.</p>
    <div class="grid-3">
${[
    recipe("gated MCP tools", "Human consent-gating before the tool ever runs: an ungated call gets a signed needs_authorization challenge, approval mints a scoped credential, and the server enforces it pre-execution. Consent is signed, not assumed.", ["consent", "proof"]),
    recipe("delegated spend budgets", "Budget-bound capability tokens: a principal delegates a spend ceiling, the chain attenuates, nothing rounds up.", ["delegation", "credentials"]),
    recipe("directories that verify", "Agent registries (A2A, MCP, NANDA) that carry proof posture in their listings — discovery you can actually trust.", ["identity", "rails"]),
    recipe("audit-ready agents", "Every action leaves a trace in a tamper-evident RFC 9162 Merkle ledger - inclusion and consistency proofs, not log files.", ["proof", "audit"]),
    recipe("one card, every registry", "Maintain one Entity Card; project it onto A2A, MCP, and NANDA from the same code path. Update once, consistent everywhere.", ["identity", "rails"]),
    recipe("revocable everything", "Fail-closed revocation for cards and delegations — unreachable or malformed status lists count as revoked, on-chain optional.", ["credentials", "revocation"]),
  ].join("\n")}
    </div>
  </section>`;
}
