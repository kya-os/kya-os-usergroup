/**
 * Page bodies for the standards matrix and the protocol rails page
 * (use-cases lives in lib/use-cases.mjs), translated from the Builders Site design handoff
 * artboards. The standards matrix renders every registry/interop/ row as an
 * expandable <details> row (no JS required); the rails page is a static
 * translation of the "Protocol Rails" artboard with build-time waveforms,
 * read code-first: the four-projection block (parity-asserted against
 * lib/snippets.mjs), the claim-minimalism callout, the rail-by-rail cards,
 * and the projection flow, every row grounded in the reference tree's
 * src/card/emit.ts and SPEC-ENTITY-CARD sections 4.2, 6, 9, and 10.
 */
import { ENTITY_CARD_URL, REPO_URL } from "./constants.mjs";
import { interopByCategory } from "./data.mjs";
import { codeBlock } from "./highlight.mjs";
import { esc, interopStatusChip } from "./html.mjs";
import { CARD_PROJECTIONS } from "./snippets.mjs";
import { waveformLockup } from "./waveform.mjs";

// Where each projection is specified (SPEC-ENTITY-CARD section 6) and which
// standards row grounds it - one link pair per export in the snippet.
const PROJECTIONS = [
  ["toServerCardMeta", "6.1 MCP server.json _meta", `${ENTITY_CARD_URL}#61-mcp-serverjson--catalogjson-_metaorgkya-oscard`, "mcp-server-json-meta"],
  ["toCatalogEntry", "6.4 MCP catalog.json index entry", `${ENTITY_CARD_URL}#64-mcp-catalogjson-index-entry`, "mcp-catalog-entry"],
  ["toA2AExtension", "6.2 A2A AgentExtension", `${ENTITY_CARD_URL}#62-a2a-agentextension`, "a2a-agentextension"],
  ["toAgentFacts", "6.3 NANDA AgentFacts", `${ENTITY_CARD_URL}#63-nanda-agentfacts`, "nanda-agentfacts"],
];

// Rail by rail: what each projection emits (output), how its rail carries it
// (mechanic), and where it is specified (spec). Every export, key, URI, and
// field named here exists in src/card/emit.ts at origin/main of the
// reference tree; the identifiers render as code chips, one item per line.
// `projections` keys into PROJECTIONS for the spec-section and standards-row
// links.
const RAIL_CARDS = [
  {
    rail: "MCP",
    projections: ["toServerCardMeta", "toCatalogEntry"],
    output: [
      `<code>toServerCardMeta</code> -&gt; <code>_meta["org.kya-os/card"]</code> on <code>server.json</code>: an inline claim-minimal summary, or <code>{ byRef: true }</code> for an <code>org.kya-os/cardRef</code> pointer`,
      `<code>toCatalogEntry</code> -&gt; the <code>catalog.json</code> index row, always by-ref`,
    ],
    mechanic: [
      `the card rides MCP's own <code>_meta</code> extension point, so core MCP is unchanged`,
      `unaware clients ignore the key; a registry that strips it degrades to a fetch of the canonical card, never a failure`,
    ],
  },
  {
    rail: "A2A",
    projections: ["toA2AExtension"],
    output: [
      `<code>toA2AExtension</code> -&gt; one <code>AgentCard.capabilities.extensions[]</code> item, <code>required: false</code>`,
      `<code>https://kya-os.org/a2a/ext/entity-card/v1</code> is its uri; the extension version is pinned in it`,
      `params carry the card's <code>id</code>, its <code>cardUrl</code>, and its <code>proofProfile</code> when the card declares one`,
    ],
    mechanic: [
      `peers read the DID-anchored identity from the AgentCard they already fetch`,
      `<code>required: false</code>: an unaware peer skips the item without rejecting the card; the <code>A2A-Extensions</code> header activates it, per spec`,
      `rule: <code>entityType: 'agent'</code> only; any other type fails closed`,
    ],
  },
  {
    rail: "NANDA",
    projections: ["toAgentFacts"],
    output: [
      `<code>toAgentFacts</code> -&gt; an AgentFacts JSON-LD document: <code>id</code> from the card DID, <code>agent_name</code> from its name, <code>owner</code> from <code>responsibleParty</code> (populated, never re-claimed)`,
      `<code>@context</code> declares <code>kya:</code> as <code>https://kya-os.org/ns/agentfacts/v1#</code>`,
    ],
    mechanic: [
      `the card's identity fills AgentFacts' own slots; the KYA-OS-only axes ride as <code>kya:entityType</code>, <code>kya:proofProfile</code>, and <code>kya:delegationRef</code>`,
      `conforming NANDA parsers preserve unknown keys, so the <code>kya:</code> axes survive`,
    ],
  },
];

// The projection flow: one card, three rails, and the degradation contract
// each output carries (SPEC-ENTITY-CARD 6.1, 6.2, 6.3).
const FLOW = [
  ["MCP", ["toServerCardMeta", "toCatalogEntry"], ["server.json _meta", "catalog.json"], "by-ref or inline"],
  ["A2A", ["toA2AExtension"], ["AgentCard extensions[]"], "required: false"],
  ["NANDA", ["toAgentFacts"], ["AgentFacts JSON-LD"], "kya: context"],
];

function railCard({ rail, projections, output, mechanic }) {
  const items = (list) => list.map((item) => `<span class="rail-item">${item}</span>`).join("");
  const row = (label, list) => `        <div class="rail-row">
          <span class="rail-kv">${label}</span>
          <div class="rail-val">${items(list)}</div>
        </div>`;
  const spec = projections.map((fn) => {
    const [, label, specUrl, slug] = PROJECTIONS.find(([name]) => name === fn);
    return `<span class="proj-link"><a class="pc-link" href="${specUrl}">${esc(label)} -&gt;</a> <a class="pc-link quiet" href="/standards/#std-${slug}">row</a></span>`;
  });
  return `      <div class="panel-card">
        <div class="pc-title t-static">${rail}</div>
${row("output", output)}
${row("mechanic", mechanic)}
${row("spec", spec)}
      </div>`;
}

/** Entity Card -> three projection boxes -> three output boxes, on the flow-box grammar. */
function projectionFlow() {
  const lines = (list) => list.map((line) => `<span class="pf-line">${esc(line)}</span>`).join("");
  const rows = FLOW.map(
    ([rail, fns, outs, degrade]) => `        <div class="wire"></div>
        <div class="flow-box">${lines(fns)}<span class="flow-cap">${rail}</span></div>
        <div class="wire"></div>
        <div class="flow-box">${lines(outs)}<span class="flow-line">${esc(degrade)}</span></div>`,
  );
  return `<div class="walk-scroll"><div class="proj-flow">
        <div class="flow-box pf-src">Entity Card<span class="flow-cap">card.json on the did:web document</span></div>
${rows.join("\n")}
      </div></div>`;
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
  // evidence grounds the status; implementation is where the reference
  // implementation does it. When both name the same file, one link says so.
  const links = [];
  if (entry.evidence && entry.evidence === entry.implementation) links.push(`<a href="${esc(entry.evidence)}">evidence &middot; impl -&gt;</a>`);
  else {
    if (entry.evidence) links.push(`<a href="${esc(entry.evidence)}">evidence -&gt;</a>`);
    if (entry.implementation) links.push(`<a href="${esc(entry.implementation)}">impl -&gt;</a>`);
  }
  const evidence = links.length ? `${links.join("\n            ")}\n            ` : "";
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
    <p class="lede-lg">Do I have to rewrite my agent's identity for every registry? No. Define the Entity Card once and call one function per rail - the same code path emits every projection, gated by the same proof posture, so updating the card updates all of them. Think of it as a passport: one document, stamped for every border. KYA-OS does not ask existing ecosystems or protocols to migrate: it projects your identity onto them.</p>
  </section>
  <section id="sdk-integration" class="fx fxd-35">
    <h2>The SDK integration</h2>
    <div class="rule"></div>
    <p class="section-lede">The <code>@kya-os/mcp/card</code> subpath provides the translators: no hand-formatted schemas, no duplicate identity files.</p>
    ${codeBlock(CARD_PROJECTIONS, { copyLabel: "[ copy projection code ]" })}
  </section>
  <section id="claim-minimalism" class="fx fxd-40">
    <h2>Claim minimalism</h2>
    <div class="rule"></div>
    <div class="panel-card">
      <p>The card asserts identity, type, declared capabilities, and accountability locators. Everything trust-bearing is proven by referenced, signed credentials that the verifier resolves and checks.</p>
      <ul class="bullets">
        <li><strong>Delegations are out of band.</strong> The card carries a <code>delegationRef</code> locator, never the credentials: the delegation chain travels as separate signed W3C VC 2.0 credentials, and verifiers resolve and evaluate those credentials themselves.</li>
        <li><strong>Levels are recomputed.</strong> A self-declared <code>conformanceLevel</code> is never trusted: the verifier recomputes L1, L2, or L3 in-process from the signatures, proofs, and status lists it resolves itself, and the card builder omits the field on emit.</li>
      </ul>
    </div>
    <p class="note">What the card does not carry, in the spec's own words (<a href="${ENTITY_CARD_URL}#42-claim-minimalism">section 4.2</a>): "A Card ASSERTS only identity + type + declared capabilities + accountability locators." Delegations are not on the card: <code>delegationRef</code> is a locator, and the delegation chain it points at travels as separate signed credentials (W3C VC 2.0) that a verifier resolves and checks (<a href="${ENTITY_CARD_URL}#10-delegation--accountability-normative">section 10</a>). The trust level is likewise recomputed by the verifier, never self-claimed (<a href="${ENTITY_CARD_URL}#9-capabilities--conformance-ladder-normative">section 9</a>): "the Card's self-declared <code>conformanceLevel</code> is NEVER trusted."</p>
  </section>
  <section id="rail-by-rail" class="fx fxd-50">
    <h2>Rail by rail</h2>
    <div class="rule"></div>
    <p class="section-lede">What each projection emits, how its rail carries it, and where it is specified. Every export, key, and URI below is the reference implementation's (<code>src/card/emit.ts</code>); the standards row grounds each rail's status with evidence.</p>
    <div class="grid-3">
${RAIL_CARDS.map(railCard).join("\n")}
    </div>
  </section>
  <section id="resolution" class="fx fxd-50">
    <h2>How the projections resolve</h2>
    <div class="rule"></div>
    ${projectionFlow()}
    <ul class="bullets">
      <li><strong>One source of truth.</strong> Every projection references the same canonical <code>card.json</code> on the entity's <code>did:web</code> DID document (the <code>KyaOsEntityCard</code> service entry anchors it), so a verifier always lands back on one card.</li>
      <li><strong>Each rail degrades, none fails.</strong> A stripped <code>_meta</code> degrades to a fetch of the canonical card; <code>required: false</code> lets an unaware A2A peer skip the item; conforming NANDA consumers preserve the unknown <code>kya:</code> keys.</li>
      <li><strong>The proof is never projected.</strong> The per-request holder-of-key proof rides per-request <code>_meta</code> only; <code>proofProfile</code> merely names the profile a verifier should expect, and a stripped <code>proofProfile</code> is not a failure.</li>
    </ul>
    <details class="disclosure">
      <summary>how the projections work</summary>
      <p class="note">Every projection references the same canonical <code>card.json</code> on the entity's <code>did:web</code> DID document (the <code>KyaOsEntityCard</code> service entry anchors it), so a verifier always lands back on one source of truth. The MCP <code>_meta["org.kya-os/card"]</code> value is either an inline summary that carries the identity axes plus the trust-bearing pointers (<code>delegationRef</code>, <code>revocation</code>) or a by-ref <code>org.kya-os/cardRef</code>; the catalog index row is always by-ref so the index stays cheap. The A2A entry is an <code>AgentCard.capabilities.extensions[]</code> item with <code>required: false</code> - that flag is the graceful-degradation contract: an unaware peer ignores it instead of rejecting the card. The NANDA projection is JSON-LD: it populates NANDA's shipped <code>owner</code> slot from <code>responsibleParty</code> (never re-claiming it) and keeps the uniquely-ours axes under the <code>kya:</code> <code>@context</code> namespace, so unknown keys degrade the same way. The per-request holder-of-key proof is never projected - it rides per-request <code>_meta</code>, and a stripped <code>_meta</code> degrades to a fetch, never a failure.</p>
    </details>
    <p class="see-all"><a href="/standards/">see all ${interopSorted.length} standards rows, with evidence -&gt;</a></p>
  </section>`;
}
