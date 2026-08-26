/**
 * The overview (home) page body: the migration hook hero (the value line and
 * the verbatim Before / After pair from the reference README) and the "How
 * it works" section that explains it. The sections after that - the path in
 * order, define-once with THE RAILS panel, and the explore grid with the
 * live stats strip - live in lib/home-sections.mjs (split for the lib LOC
 * cap). Pure function of the shaped registry data from lib/data.mjs; markup
 * primitives come from lib/html.mjs and lib/highlight.mjs.
 */
import { CONSENT_GUIDE_URL, CONTEXT7_EXAMPLE_URL, DOCS_QUICKSTART_URL, MIGRATE_README_URL } from "./constants.mjs";
import { codeBlock } from "./highlight.mjs";
import { sectionDefineOnce, sectionExplore, sectionPath } from "./home-sections.mjs";
import { MIGRATE_AFTER, MIGRATE_BEFORE } from "./snippets.mjs";

/**
 * The hero IS the two-line hook: the three-beat subtitle, the value line
 * (what the two lines buy), then the Before / After pair verbatim from the
 * reference README ("Migrate any MCP server in 2 lines"). The After block
 * carries the copy button; the Before block is read-only. The keyphrases
 * are asserted on the dist bytes (lib/checks.mjs assertHomePolish).
 */
function heroMigrate() {
  return `  <header class="hero fx">
    <div class="kicker">BUILDERS.KYA-OS.ORG</div>
    <h1 class="h1-home"><span data-title-reveal>BUILD ON KYA-OS</span><span class="cursor" aria-hidden="true">_</span></h1>
    <p class="sub">Verifiable identity. Signed receipts. Revocable authority.</p>
    <p class="lede">Two lines of code give your MCP server a <strong>verifiable cryptographic identity</strong> and a <strong>signed receipt for every tool call</strong>. The identity is a <code>did:key</code> generated in-process and never shared. The receipt binds each request to its response, so any client or auditor can verify what your server did: <strong>no logs to trust, nothing to impersonate.</strong></p>
    <div class="diff-pair">
      <div>
        <div class="diff-label">before &middot; a standard MCP server, no identity or proofs</div>
        ${codeBlock(MIGRATE_BEFORE, { copy: false })}
      </div>
      <div>
        <div class="diff-label">after &middot; every tool response carries a signed proof</div>
        ${codeBlock(MIGRATE_AFTER, { copyLabel: "[ copy integration code ]" })}
      </div>
    </div>
  </header>`;
}

/**
 * How it works: the README's own one-sentence explanation (verbatim), the
 * two next wrappers, and the real migrated server plus the reference links.
 */
function sectionHowItWorks() {
  return `  <section class="fx fxd-10">
    <h2>How it works</h2>
    <div class="rule"></div>
    <p class="lede-lg">That&#39;s it. <code>withKyaOs</code> auto-generates an Ed25519 identity, registers the <code>_kyaos</code> protocol tool, and wraps the transport so every tool response includes a detached JWS proof in <code>_meta</code>. Invisible to the LLM, verifiable by anyone.</p>
    <p class="lede-muted">From there, one wrapper at a time:</p>
    <ul class="bullets">
      <li><strong>Gate tools</strong> behind explicit human consent and scoped, revocable authority (<a href="${CONSENT_GUIDE_URL}"><code>wrapWithDelegation</code></a>).</li>
      <li><strong>Publish an Entity Card</strong> so MCP <code>server.json</code>, A2A AgentCards, and NANDA AgentFacts all project the same verifiable identity (<a href="/rails/">the rails</a>).</li>
    </ul>
    <div class="dlinks next-strip">
      <a href="${CONTEXT7_EXAMPLE_URL}">See a real server migrated with exactly 2 lines: examples/context7-with-kya-os -&gt;</a>
      <a class="quiet" href="${MIGRATE_README_URL}">reference README -&gt;</a>
      <a class="quiet" href="${DOCS_QUICKSTART_URL}">docs quickstart -&gt;</a>
    </div>
  </section>`;
}

/** The overview (home) page body. */
export function sectionsHome({ rendered, interopSorted }) {
  return [heroMigrate(), sectionHowItWorks(), sectionPath(), sectionDefineOnce(), sectionExplore({ rendered, interopSorted })].join("\n");
}
