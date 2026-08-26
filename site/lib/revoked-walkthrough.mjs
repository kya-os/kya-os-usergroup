/**
 * The REVOKED before / after walkthrough on the use-cases page: the README's
 * sequence diagram rendered as two states of the same participants strip.
 * A walkthrough of the README's beats, not a network connection - nothing
 * here talks to a chain; the verify run below the beats does.
 *
 * PARITY: every word is taken from examples/revoked/README.md at
 * decentralized-identity/kya-os-mcp origin/main. The participants are the
 * diagram's own (lines 43-49, boxes only, the server-held wallet omitted:
 * the strip is the authority path, not the funds path). BEFORE highlights
 * the authority path (agent -> gateway -> server -> resolver) with each
 * participant's message in the diagram's words (lines 51-57) and captions
 * from beat 1 (line 69). AFTER highlights the revocation path (operator +
 * FIDO2 key -> new status-list version, an append-only DLR -> resolver;
 * lines 58-59), breaks the authority path (lines 60-64), captions from
 * beats 3-4 (lines 71-72), and shows the verify run's real verdict (lines
 * 26-30) under the README's own line 33.
 *
 * The switch is CSS-only, no module: two visually-hidden radios
 * (name="walk-state", BEFORE checked) sit first inside .walk, their labels
 * are the segmented control, and hub.css hides the unchecked state with a
 * general-sibling rule (#walk-pick-before:checked~#walk-after and the
 * mirror), the same mechanism as the builders directory filter. Radios are
 * natively arrow-key navigable; each carries aria-controls for its state.
 * Without CSS both states stand stacked under their headings.
 * lib/copy-checks.mjs asserts the headings and the facts on the dist
 * bytes; lib/module-checks.mjs asserts the radios and the sibling rules.
 */
import { codeBlock } from "./highlight.mjs";
import { esc } from "./html.mjs";
import { REVOKED_VERDICT } from "./snippets.mjs";

// [name, caption] per participant, README lines 43-49, in wire order.
const OPERATOR = ["Operator / Issuer", "did:cheqd + FIDO2 key"];
const AGENT = ["Claude Desktop", "the brain, no keys"];
const GATEWAY = ["kya-wallet gateway", "agent key + VC"];
const SERVER = ["Protected MCP server", "withKyaOs, the verifier"];
const RESOLVER = ["cheqd resolver", "Cosmos testnet"];
const STATUS_LIST = ["new status-list version", "append-only DLR, cheqd testnet"];

// A box in one state: the participant, its tone ("on" = the highlighted
// authority path, "kill" = the revocation path, "cut" = the broken
// authority path, "" = quiet), the tone of the wire into it, and its
// message in this state (trusted literal HTML, the README's words).
const box = ([name, cap], tone, wire, line) => ({ name, cap, tone, wire, line });

// The spend, README lines 51-57.
const BEFORE = [
  box(OPERATOR, "", "", "issues the scoped delegation VC (cap 10 CHEQ, status entry on-chain)"),
  box(AGENT, "on", "", "&ldquo;Pay 1 CHEQ to the vendor&rdquo; -&gt; wallet_send"),
  box(GATEWAY, "on", "on", "wallet_send + VC + holder proof (signed by agent&#39;s did:key)"),
  box(SERVER, "on", "on", 'verifies issuer signature (on-chain DID doc) + status bit<b class="tone-signal">ALLOWED + tx hash + signed receipt (detached JWS)</b>'),
  box(RESOLVER, "on", "on", "bit 0 (active)"),
];

// The kill, README lines 58-59 and 71.
const KILL = [
  box(OPERATOR, "kill", "", "revoke -&gt; touch the key (WebAuthn assertion, intent-bound)"),
  box(STATUS_LIST, "kill", "kill", "assertion verified -&gt; published; the issuer cannot quietly un-revoke"),
  box(RESOLVER, "kill", "kill", "every verifier reads the same chain"),
];

// The next call, README lines 60-64.
const AFTER = [
  box(OPERATOR, "", "", ""),
  box(AGENT, "cut", "", "&ldquo;Pay again&rdquo; -&gt; wallet_send"),
  box(GATEWAY, "cut", "cut", "fresh signed call"),
  box(SERVER, "cut", "cut", 'fresh status lookup<b class="tone-alert">DENIED (CREDENTIAL_REVOKED)</b>handler never entered'),
  box(RESOLVER, "cut", "cut", '<b class="tone-alert">bit 1 (REVOKED)</b>'),
];

function strip(boxes) {
  const cls = (base, tone) => (tone ? `${base} ${tone}` : base);
  return `<div class="walk-scroll"><div class="flow-strip walk-strip">${boxes
    .map(({ name, cap, tone, wire, line }, i) => {
      const wireBefore = i === 0 ? "" : `<div class="${cls("wire", wire)}"></div>`;
      const message = line ? `<span class="flow-line">${line}</span>` : "";
      return `${wireBefore}<div class="${cls("flow-box", tone)}">${esc(name)}<span class="flow-cap">${esc(cap)}</span>${message}</div>`;
    })
    .join("")}</div></div>`;
}

const state = (id, title, body) => `<div class="walk-state" id="walk-${id}">
        <h3 class="walk-title">${esc(title)}</h3>
        ${body}
      </div>`;

export function revokedWalkthrough() {
  const before = `${strip(BEFORE)}
        <p class="walk-cap">The agent presents its W3C Delegation Credential: scope <code>payments.transfer</code>, capped at 10 CHEQ per transfer, and the cap lives in the signed credential, not in app code. With it goes a per-request holder proof signed by its own did:key; the server runs <code>holderBinding: 'enforce'</code>, so the credential is subject-bound, not bearer. Every response carries a detached-JWS receipt.</p>`;
  const after = `<div class="walk-row">the kill</div>
        ${strip(KILL)}
        <div class="walk-row">the next call</div>
        ${strip(AFTER)}
        <p class="walk-cap">The WebAuthn challenge is the SHA-256 of the canonical revocation intent, so the assertion is bound to this exact revocation, not a generic login. The new status-list version is an append-only DID-Linked Resource: the issuer cannot quietly un-revoke, and every verifier reads the same chain. The agent can still read the public balance. It cannot move a token: <code>CREDENTIAL_REVOKED</code>, refused before the handler runs.</p>
        <div class="walk-row walk-row-verdict">verify:once, as the README prints it</div>
        ${codeBlock(REVOKED_VERDICT, { copy: false })}
        <p class="walk-line">That refusal is the product.</p>`;
  return `<div class="walk" id="revoked-walkthrough">
      <input type="radio" name="walk-state" id="walk-pick-before" aria-controls="walk-before" checked />
      <input type="radio" name="walk-state" id="walk-pick-after" aria-controls="walk-after" />
      <div class="walk-head">
        <div class="walk-switch">
          <label class="walk-btn" for="walk-pick-before">[ before: spending under a cap ]</label>
          <label class="walk-btn" for="walk-pick-after">[ after: the kill ]</label>
        </div>
        <p class="walk-note">A walkthrough of the README's beats, not a network connection.</p>
      </div>
      ${state("before", "The agent spends, safely", before)}
      ${state("after", "After the kill", after)}
    </div>`;
}
