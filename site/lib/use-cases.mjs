/**
 * The use-cases page body: the REVOKED showcase and the recipe grid, each
 * recipe with a primary action into the real example in kya-os-mcp/examples
 * that demonstrates it (they are examples to read and steal from, not
 * GitHub templates - only conformance/starter is a template) plus the live
 * playground for trying a proof against the demo server. PARITY: every
 * example path below exists at decentralized-identity/kya-os-mcp origin/main.
 */
import { MCP_REPO_URL, PLAYGROUND_PROOF_URL, REVOKED_TREE_URL } from "./constants.mjs";
import { esc, promptBlock } from "./html.mjs";
import { waveformLockup } from "./waveform.mjs";

const example = (path) => `${MCP_REPO_URL}/${path.includes(".") ? "blob" : "tree"}/main/examples/${path}`;

// title, body, tags, the example that demonstrates it, an optional
// secondary link [label, href].
const RECIPES = [
  {
    title: "gated MCP tools",
    body: "Human consent-gating before the tool ever runs: an ungated call gets a signed needs_authorization challenge, approval mints a scoped credential, and the server enforces it pre-execution. Consent is signed, not assumed.",
    tags: ["consent", "proof"],
    path: "consent-basic",
    also: ["persistent consent: consent-persistence", example("consent-persistence")],
  },
  {
    title: "delegated spend budgets",
    body: "Budget-bound capability tokens: a principal delegates a spend ceiling, the chain attenuates, nothing rounds up.",
    tags: ["delegation", "credentials"],
    path: "revoked",
    also: ["across services: outbound-delegation", example("outbound-delegation")],
  },
  {
    title: "directories that verify",
    body: "Agent registries (A2A, MCP, NANDA) that carry proof posture in their listings - discovery you can actually trust: resolve the card, recompute its level from evidence, ignore what it claims about itself.",
    tags: ["identity", "rails"],
    path: "entity-card/walkthrough.ts",
  },
  {
    title: "audit-ready agents",
    body: "Every action leaves a trace in a tamper-evident RFC 9162 Merkle ledger - inclusion and consistency proofs, not log files.",
    tags: ["proof", "audit"],
    path: "audit-trail",
  },
  {
    title: "one card, every registry",
    body: "Maintain one Entity Card; project it onto A2A, MCP, and NANDA from the same code path. Update once, consistent everywhere.",
    tags: ["identity", "rails"],
    path: "entity-card/server.ts",
    also: ["the projections, explained", "/rails/"],
  },
  {
    title: "revocable everything",
    body: "Fail-closed revocation for cards and delegations - unreachable or malformed status lists count as revoked, on-chain optional.",
    tags: ["credentials", "revocation"],
    path: "statuslist",
    also: ["on-chain: cheqd-dlr", example("cheqd-dlr")],
  },
];

function recipeCard({ title, body, tags, path, also }) {
  const secondary = also ? `<a class="pc-link quiet" href="${esc(also[1])}">${esc(also[0])} -&gt;</a>` : "";
  return `      <div class="panel-card recipe">
        <div class="pc-title t-static">${esc(title)}</div>
        <p>${esc(body)}</p>
        <div class="tag-row">${tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</div>
        <div class="dlinks pc-actions">
          <a class="pc-link" href="${example(path)}">Open the example -&gt;</a>
          ${secondary}
        </div>
        <span class="micro">examples/${esc(path)}</span>
      </div>`;
}

export function sectionsUseCases() {
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
    <p class="section-lede">Patterns the primitives were designed for, each with the runnable example in the reference repository that demonstrates it. No listed builder ships one yet - every recipe is a chance to <a href="/builders/#build-entry">be the first</a>.</p>
    <div class="dlinks next-strip recipes-try">
      <span class="next-label">before you build:</span>
      <a href="${PLAYGROUND_PROOF_URL}">Try it against the live demo server -&gt;</a>
    </div>
    <div class="grid-3">
${RECIPES.map(recipeCard).join("\n")}
    </div>
  </section>`;
}
