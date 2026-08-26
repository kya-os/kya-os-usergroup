/**
 * The use-cases page body: REVOKED step by step (the shipping example as a
 * runnable blueprint: the before / after walkthrough of the participants
 * strip from lib/revoked-walkthrough.mjs, the beats, the 60-second verify
 * path with its copyable commands, the tiered full demo) and the
 * recipe grid, each recipe with a target, an "Open the example" button (the
 * site's .btn-solid) into the real example in kya-os-mcp/examples, and a
 * reference line naming the
 * exact file or npm subpath it comes from (they are examples to read and
 * steal from, not GitHub templates - only conformance/starter is a
 * template), plus the proof playground on the protocol site. The consent
 * card also carries the authorization-methods row: the five requirement
 * types a ToolProtection can bind to a tool, one glyph each.
 *
 * PARITY: every REVOKED fact, number, command, and option below is taken
 * from examples/revoked/README.md at decentralized-identity/kya-os-mcp
 * origin/main (line numbers cited inline); the requirement types and their
 * glosses are src/authz/requirement.ts (AuthorizationRequirementSchema and
 * its doc comment) and the "8 auth modes" sentence is
 * examples/consent-full/README.md line 73; every reference path is in the
 * verified allowlist in lib/copy-checks.mjs, which the build re-checks on
 * the dist bytes.
 */
import { CONSENT_GUIDE_URL, MCP_REPO_URL, PLAYGROUND_PROOF_URL, REVOKED_README_URL, REVOKED_TREE_URL, REVOKED_VIDEO_URL } from "./constants.mjs";
import { codeBlock } from "./highlight.mjs";
import { esc, promptBlock } from "./html.mjs";
import { icon } from "./icons.mjs";
import { revokedWalkthrough } from "./revoked-walkthrough.mjs";
import { CONSENT_GATE, CONSENT_PROTECTION, REVOKED_VERDICT, REVOKED_VERIFY } from "./snippets.mjs";
import { waveformLockup } from "./waveform.mjs";

const example = (path) => `${MCP_REPO_URL}/${path.includes(".") ? "blob" : "tree"}/main/examples/${path}`;
const source = (path) => `${MCP_REPO_URL}/blob/main/${path}`;
const ref = (label, href) => `<a href="${href}"><code>${esc(label)}</code></a>`;

// ── REVOKED ─────────────────────────────────────────────────────────────────

// The beats, README lines 69-72, in the README's order and words.
const BEATS = [
  [
    "The agent spends, safely.",
    "It presents its W3C Delegation Credential (scope <code>payments.transfer</code>, capped at 10 CHEQ per transfer; the cap lives in the signed credential, not in app code) plus a per-request holder proof signed by its own did:key. The server runs <code>holderBinding: 'enforce'</code>, so the credential is subject-bound, not bearer. Real CHEQ moves on testnet, and every response carries a detached-JWS receipt.",
  ],
  [
    "Attack theater.",
    "An over-cap send fails with <code>SCOPE_CONSTRAINT_VIOLATED</code>, read from the credential. A thief replaying the stolen credential with their own key fails <code>holder_binding_failed</code> before the handler is entered.",
  ],
  [
    "The kill.",
    "A FIDO2 touch authorizes the revocation. The WebAuthn challenge is the SHA-256 of the canonical revocation intent, so the assertion is bound to this exact revocation, not a generic login. A new status-list version publishes as an append-only DID-Linked Resource: the issuer cannot quietly un-revoke, and every verifier reads the same chain.",
  ],
  [
    "After the kill.",
    "The agent can still read the public balance. It cannot move a token: <code>CREDENTIAL_REVOKED</code>, refused before the handler runs. The README's video caption puts the next transaction at about half a second; the bundled verify run below reports <code>elapsedMs: 828</code>.",
  ],
];

// Run the full demo, README lines 74-106: three tiers, each standing alone.
const TIERS = [
  {
    n: "TIER 1",
    title: "the console (your own issuer, testnet)",
    lines: [
      "One-time setup, then the show: <code>cp .env.example .env.local</code>, then <code>npm run gen:accounts</code>, <code>npm run create:did</code>, <code>npm run publish:statuslist</code>, <code>npm run issue:delegation</code>, <code>npm run serve</code>.",
      "In the console: <code>[1]</code> send, <code>[2]</code> over-cap, <code>[5]</code> theft, <code>[3]</code> revoke, <code>[4]</code> retry. Presenter mode is <code>P</code>, high-contrast is <code>C</code>.",
    ],
  },
  {
    n: "TIER 2",
    title: "a Claude Desktop agent",
    lines: [
      "Copy <code>docs/claude_desktop_config.json</code> into your Claude Desktop config and edit the two absolute paths. Claude gets a clean <code>wallet_send</code> / <code>check_balance</code> tool surface; the gateway holds the did:key and signs every call.",
      "No Claude Desktop on hand? <code>npm run agent</code> and the console's simulated-agent buttons drive the exact same path.",
    ],
  },
  {
    n: "TIER 3",
    title: "the hardware kill switch",
    lines: [
      "Any FIDO2 authenticator works; the DEF CON badge was the stage prop, a YubiKey does the same job. <code>BADGE_SETUP=1 npm run serve</code>, then open <code>/badge-setup.html</code> and register the key; <code>BADGE_WEBAUTHN=1 npm run serve</code> makes revocation require a physical touch.",
      "No valid touch, no revocation: the endpoint two-phases through an intent-bound WebAuthn assertion and refuses everything else.",
    ],
  },
];

function sectionRevoked() {
  const beats = BEATS.map(([title, body]) => `      <li><div class="path-body"><strong>${title}</strong> ${body}</div></li>`).join("\n");
  const tiers = TIERS.map(
    ({ n, title, lines }) => `      <div class="panel-card step tier">
        <div class="step-n">${n}</div>
        <div class="pc-title t-static">${esc(title)}</div>
        ${lines.map((line) => `<p>${line}</p>`).join("\n        ")}
      </div>`,
  ).join("\n");
  return `  <section id="revoked" class="fx fxd-15">
    <div class="scat-label">USE CASE <span class="chip st-shipping">shipping</span></div>
    <div class="showcase">
      <div>
        <div class="flag-title">REVOKED</div>
        <p class="flag-lede">An on-chain kill switch for AI agents with wallet access. Agents spend under cryptographically scoped, verifiable delegations, and that spending authority can be revoked on a public chain. A rogue or hijacked agent is stopped before it drains a wallet, with no server anyone has to trust.</p>
        <p class="flag-sub">Built solo in a weekend at DEF CON 34 (2nd place, Cryptocurrency Village hackathon), now the flagship example of the reference implementation. The agent is Claude Desktop, the same MCP client thousands of people use, plugged into a local <code>kya-wallet</code> gateway that holds the agent's key and signs each call; the LLM never touches key material. In the 3-minute video an agent pays an invoice, gets caught misbehaving, and loses its spending authority on-chain. Its next transaction is refused in about half a second.</p>
        <p class="flag-sub">The four things the hackathon build had to invent now ship in <code>@kya-os/mcp</code>: <code>CheqdStatusListResolver</code> from <code>@kya-os/mcp/cheqd</code>, <code>prepareCheqdDlrResource</code> for publishing status lists as DID-Linked Resources, <code>verificationMethodJwk</code> inside the verifier, and revocation checked on every call since 1.13.0, which deleted a 60-second blind spot the demo used to work around. Rehearsing it surfaced a real fail-open upstream; fixing it made the demo simpler.</p>
        <div class="dlinks">
          <a href="${REVOKED_README_URL}">the README -&gt;</a>
          <a href="${REVOKED_VIDEO_URL}">3-minute video -&gt;</a>
          <a href="${REVOKED_TREE_URL}">examples/revoked -&gt;</a>
          <a class="quiet" href="/standards/#std-cheqd-dlr">standards: cheqd-dlr</a>
        </div>
      </div>
      <div class="flag-console">
        <div class="fc-line"><span class="kill-dot" aria-hidden="true"></span><span>delegation <b>payments.transfer, cap 10 CHEQ per transfer</b></span></div>
        <div class="wire fc-wire"><span class="wire-dot"></span></div>
        <div class="fc-line fc-wrap">agent spends under ${waveformLockup("revoked:delegation:spend<=10cheq", { bars: 14, trackHeight: 10, small: true })}</div>
        <div class="fc-hr"></div>
        <div class="fc-line">FIDO2 touch <span class="tone-alert">new status-list version, append-only</span></div>
        <div class="fc-line">next call <span class="tone-alert">DENIED (CREDENTIAL_REVOKED)</span></div>
        <div class="fc-line">verify:once <span class="tone-alert">elapsedMs: 828</span></div>
      </div>
    </div>
    ${revokedWalkthrough()}
    <div class="uc-block">
      <div class="scat-label">the beats</div>
      <ol class="path">
${beats}
      </ol>
    </div>
    <div class="uc-block">
      <div class="scat-label">try it in 60 seconds (zero configuration)</div>
      <p class="try-note">A genuinely revoked credential is anchored on cheqd testnet right now. Verify it yourself: no keys, no environment variables, no trusting the repo's word for it. The shipped <code>DelegationCredentialVerifier</code> resolves the issuer's DID document from the chain, verifies the status list's Ed25519 signature against it, checks purpose parity, and reads the revocation bit.</p>
      ${codeBlock(REVOKED_VERIFY)}
      <p class="try-note">Expected output, as the README prints it:</p>
      ${codeBlock(REVOKED_VERDICT, { copy: false })}
      <p class="try-note">The signature is real, the credential is unexpired, and the chain still refuses it. That refusal is the product. Also bundled: <code>samples/delegation-94.json</code>, the actual credential from the DEF CON stage. Its 48-hour validity is long gone, so <code>npm run verify:once -- --index 94</code> shows expiry beating revocation to the refusal. Fail-closed has layers.</p>
    </div>
    <div class="uc-block">
      <div class="scat-label">run the full demo</div>
      <p class="section-lede">Tiered on purpose. Each tier stands alone; all of it runs from <code>examples/revoked</code>.</p>
      <div class="grid-3">
${tiers}
      </div>
    </div>
    ${promptBlock("prompt-run-revoked")}
  </section>`;
}

// ── Recipes ─────────────────────────────────────────────────────────────────

// The authorization requirement types a ToolProtection binds to a tool:
// [type, label, glyph], in the order src/authz/requirement.ts declares the
// discriminated union (oauth, mdl, idv, credential, none).
const AUTHZ_TYPES = [
  ["oauth", "OAuth / OIDC", "key"],
  ["mdl", "mDL", "id-card"],
  ["idv", "Identity verification", "person-check"],
  ["credential", "Verifiable credential", "seal"],
  ["none", "Consent only", "check-square"],
];
const AUTHZ_URL = source("src/authz");
const REQUIREMENT_URL = source("src/authz/requirement.ts");

/** The authorization-methods row: label, the five typed items, the adapter note, and the real protection shape. */
function authzRow() {
  const items = AUTHZ_TYPES.map(
    ([type, label, glyph]) => `<li class="authz-item">${icon(glyph)}<span>${esc(label)}</span><span class="chip authz-type">${type}</span></li>`,
  ).join("");
  return `<div class="authz-row">
          <span class="authz-label">Bind a requirement to the tool</span>
          <ul class="authz-list">${items}</ul>
          <p class="authz-note">Only <code>oauth</code> ships with a <a href="${AUTHZ_URL}">reference adapter</a> (generic OIDC); the other types are protocol vocabulary that downstream adapters implement. The consent page itself supports 8 sign-in modes including OAuth, magic-link, OTP, passkey, and IDV.</p>
          <p class="authz-cap">A <a href="${REQUIREMENT_URL}"><code>ToolProtection</code></a>, as consent-persistence binds one:</p>
          ${codeBlock(CONSENT_PROTECTION)}
        </div>`;
}

// title, body (trusted literal HTML), target, references [label, href],
// tags, the example that demonstrates it (the primary action), an optional
// secondary link [label, href], `wide` for the card that carries a code
// sample beside its copy, and `authz` for the card that carries the
// authorization-methods row between its references and its tags.
const RECIPES = [
  {
    title: "gated MCP tools",
    body: "Human consent before the tool ever runs. An agent that calls <code>checkout</code> without a delegation credential gets back a <code>needs_authorization</code> response with a consent URL; the human approves, a scoped credential is issued, and the agent retries, now authorized. Consent is signed, not assumed.",
    target: "A checkout, transfer, or delete tool an agent may only run after a person says yes.",
    refs: [
      ["wrapWithDelegation, from @kya-os/mcp", CONSENT_GUIDE_URL],
      ["examples/consent-basic", example("consent-basic")],
      ["examples/consent-full", example("consent-full")],
    ],
    tags: ["consent", "proof"],
    path: "consent-basic",
    also: ["durable grants: consent-persistence", example("consent-persistence")],
    wide: true,
    authz: true,
  },
  {
    title: "delegated spend budgets",
    body: "The ceiling lives in the signed credential, not in app code: REVOKED's delegation carries scope <code>payments.transfer</code> capped at 10 CHEQ per transfer, and an over-cap send fails <code>SCOPE_CONSTRAINT_VIOLATED</code>. A chain only narrows (child <code>MaxAmount</code> and <code>ValidUntil</code> at or below the parent, fail-closed), and a server calling downstream forwards the delegation as <code>KYA-OS-*</code> headers with a signed proof JWT, so the next hop verifies the original agent's authority instead of trusting the middle.",
    target: "An agent that pays invoices or buys compute under a ceiling its operator signed, across more than one service.",
    refs: [
      ["@kya-os/mcp/delegation", source("src/delegation/index.ts")],
      ["src/card/delegation.ts", source("src/card/delegation.ts")],
      ["examples/revoked", example("revoked")],
    ],
    tags: ["delegation", "credentials"],
    path: "outbound-delegation",
    also: ["the 10 CHEQ cap: revoked", example("revoked")],
  },
  {
    title: "directories that verify",
    body: "Agent registries that carry proof posture in their listings. The walkthrough builds a card, resolves it, and verifies it, showing that <code>verifyCard</code> recomputes the conformance level from evidence and ignores whatever the card claims about itself.",
    target: "A registry or marketplace that lists agents and wants the row to say what was verified, not what was self-described.",
    refs: [
      ["@kya-os/mcp/card", source("src/card/index.ts")],
      ["examples/entity-card/walkthrough.ts", example("entity-card/walkthrough.ts")],
    ],
    tags: ["identity", "rails"],
    path: "entity-card/walkthrough.ts",
  },
  {
    title: "audit-ready agents",
    body: "Detached proofs establish origin; the audit service composes them with the full authorization lifecycle into an atomically ordered, signed ledger. <code>AuditCheckpointBuilder</code> derives an RFC 9162 tree over entry digests, signs an immutable checkpoint, and produces and verifies inclusion and consistency proofs. Evidence for audit, incident-response, and regulatory-control workflows; it does not itself make an application compliant.",
    target: "An agent whose every tool call must be replayable later, offline, from signed evidence rather than log files.",
    refs: [
      ["@kya-os/mcp/audit", source("src/audit/index.ts")],
      ["AUDITABILITY.md", source("AUDITABILITY.md")],
      ["examples/audit-trail", example("audit-trail")],
    ],
    tags: ["proof", "audit"],
    path: "audit-trail",
  },
  {
    title: "one card, every registry",
    body: "One canonical Entity Card, projected onto every rail the ecosystem already indexes: <code>toServerCardMeta</code> (MCP server.json <code>_meta</code>), <code>toCatalogEntry</code> (the catalog index row, by-ref), <code>toA2AExtension</code> (an A2A AgentCard extension, <code>required: false</code>), <code>toAgentFacts</code> (NANDA AgentFacts JSON-LD). Pure, deterministic projections, each pointing back at the same <code>card.json</code> on the did:web document.",
    target: "An agent that has to show up in MCP server.json, an A2A AgentCard, and NANDA AgentFacts from one source of truth.",
    refs: [
      ["@kya-os/mcp/card", source("src/card/index.ts")],
      ["src/card/emit.ts", source("src/card/emit.ts")],
      ["examples/entity-card/server.ts", example("entity-card/server.ts")],
    ],
    tags: ["identity", "rails"],
    path: "entity-card/server.ts",
    also: ["the projections, explained", "/rails/"],
  },
  {
    title: "revocable everything",
    body: "From the revocation seam itself: &ldquo;FAIL-CLOSED is the invariant: an unreachable status list, a malformed credential, a mismatched <code>statusPurpose</code>, or an out-of-range index all resolve to <code>{ revoked: true }</code>. The absence of proof-of-liveness is treated as revoked, never as &lsquo;probably fine&rsquo;.&rdquo; On-chain, <code>CheqdStatusListResolver</code> pins the issuer, verifies the list's own signature against the on-chain DID document, and throws on anything unprovable.",
    target: "Any credential an operator must be able to withdraw: a delegation, a card attestation, an agent's spending authority.",
    refs: [
      ["src/card/revocation.ts", source("src/card/revocation.ts")],
      ["@kya-os/mcp/cheqd", source("src/integrations/cheqd/index.ts")],
      ["examples/statuslist", example("statuslist")],
    ],
    tags: ["credentials", "revocation"],
    path: "statuslist",
    also: ["publishing to cheqd: cheqd-dlr", example("cheqd-dlr")],
  },
];

function recipeCard({ title, body, target, refs, tags, path, also, wide, authz }) {
  const secondary = also ? `\n          <a class="pc-link quiet" href="${esc(also[1])}">${esc(also[0])} -&gt;</a>` : "";
  const copy = `<div class="pc-title t-static">${esc(title)}</div>
        <p>${body}</p>
        <p class="recipe-kv"><strong>Target</strong> ${esc(target)}</p>
        <p class="recipe-kv"><strong>Reference</strong> ${refs.map(([label, href]) => ref(label, href)).join(" &middot; ")}</p>${authz ? `\n        ${authzRow()}` : ""}
        <div class="tag-row">${tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</div>
        <div class="dlinks pc-actions">
          <a class="btn-solid" href="${example(path)}">Open the example -&gt;</a>${secondary}
        </div>
        <span class="micro">examples/${esc(path)}</span>`;
  if (!wide) return `      <div class="panel-card recipe">\n        ${copy}\n      </div>`;
  return `      <div class="panel-card recipe recipe-wide">
        <div class="recipe">
        ${copy}
        </div>
        ${codeBlock(CONSENT_GATE)}
      </div>`;
}

export function sectionsUseCases() {
  return `${sectionRevoked()}
  <section id="recipes" class="fx fxd-30">
    <h2>Recipes</h2>
    <div class="rule"></div>
    <p class="section-lede">Patterns the primitives were designed for. Each names a target, the runnable example in the reference repository that demonstrates it, and the file or npm subpath it comes from. No listed builder ships one yet - every recipe is a chance to <a href="/builders/#build-entry">be the first</a>.</p>
    <div class="dlinks next-strip recipes-try">
      <span class="next-label">before you build:</span>
      <a href="${PLAYGROUND_PROOF_URL}">Try a signed request against the demo server -&gt;</a>
    </div>
    <div class="grid-3">
${RECIPES.map(recipeCard).join("\n")}
    </div>
  </section>`;
}
