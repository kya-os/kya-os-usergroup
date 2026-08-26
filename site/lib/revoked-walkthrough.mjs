/**
 * The REVOKED before / after walkthrough on the use-cases page: the README's
 * sequence diagram as one participants strip shown in two states. A
 * walkthrough of the README's beats, not a network connection - nothing
 * here talks to a chain; the verify run further down the page does.
 *
 * PARITY: every word is taken from examples/revoked/README.md at
 * decentralized-identity/kya-os-mcp origin/main. The participants are the
 * diagram's own (lines 43-49, boxes only, the server-held wallet omitted:
 * the strip is the authority path, not the funds path). The states differ
 * only in tone and in one status line: BEFORE lights the authority path
 * (agent -> gateway -> server -> resolver, lines 51-57) and reports bit 0,
 * ALLOWED; AFTER lights the operator and the resolver (the revocation
 * lands on-chain, lines 58-59), cuts the agent -> gateway -> server wires
 * (lines 60-64), and reports bit 1, DENIED. The captions are the README's
 * beats 1 and 3-4 (lines 69, 71-72); the closing line is its line 33.
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
import { esc } from "./html.mjs";

// [name, caption] per participant, README lines 43-49, in wire order.
const PARTICIPANTS = [
  ["Operator / Issuer", "did:cheqd + FIDO2 key"],
  ["Claude Desktop", "the brain, no keys"],
  ["kya-wallet gateway", "agent key + VC"],
  ["Protected MCP server", "withKyaOs, the verifier"],
  ["cheqd resolver", "Cosmos testnet"],
];

// A state is a tone per box and a tone per wire into that box (the first
// box has no wire), in PARTICIPANTS order: "on" = the authority path,
// "kill" = where the revocation lands, "cut" = a broken wire, "" = quiet.
const BEFORE = { boxes: ["", "on", "on", "on", "on"], wires: ["", "", "on", "on", "on"] };
const AFTER = { boxes: ["kill", "", "", "", "kill"], wires: ["", "", "cut", "cut", ""] };

function strip({ boxes, wires }) {
  const cls = (base, tone) => (tone ? `${base} ${tone}` : base);
  return `<div class="walk-scroll"><div class="flow-strip">${PARTICIPANTS.map(([name, cap], i) => {
    const wire = i === 0 ? "" : `<div class="${cls("wire", wires[i])}"></div>`;
    return `${wire}<div class="${cls("flow-box", boxes[i])}">${esc(name)}<span class="flow-cap">${esc(cap)}</span></div>`;
  }).join("")}</div></div>`;
}

const state = (id, title, body) => `<div class="walk-state" id="walk-${id}">
        <h3 class="walk-title">${esc(title)}</h3>
        ${body}
      </div>`;

export function revokedWalkthrough() {
  const before = `${strip(BEFORE)}
        <p class="walk-status">bit 0 (active) &middot; <b class="tone-signal">ALLOWED</b> &middot; tx hash + signed receipt (detached JWS)</p>
        <p class="walk-cap">Claude Desktop asks the gateway to pay; the gateway sends <code>wallet_send</code> + VC + holder proof; the server verifies the issuer signature against the on-chain DID document and the status bit. The credential is a W3C Delegation Credential, scope <code>payments.transfer</code>, capped at 10 CHEQ per transfer, and the cap lives in the signed credential, not in app code. The holder proof is signed by the agent's own did:key, and the server runs <code>holderBinding: 'enforce'</code>, so the credential is subject-bound, not bearer.</p>`;
  const after = `${strip(AFTER)}
        <p class="walk-status">FIDO2 touch -&gt; new status-list version (append-only DLR, cheqd testnet) &middot; bit 1 (REVOKED) &middot; <b class="tone-alert">DENIED (CREDENTIAL_REVOKED)</b>, handler never entered</p>
        <p class="walk-cap">The operator touches the FIDO2 key: a WebAuthn assertion whose challenge is the SHA-256 of the canonical revocation intent, so it is bound to this exact revocation, not a generic login. The new status-list version publishes as an append-only DID-Linked Resource; the issuer cannot quietly un-revoke, and every verifier reads the same chain. The next call's fresh lookup reads bit 1. The agent can still read the public balance. It cannot move a token.</p>
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
