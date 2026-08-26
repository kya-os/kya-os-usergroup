/**
 * The overview (home) page body: the migration hook hero (the value line and
 * the verbatim Before / After pair from the reference README), the live
 * stats strip, THE RAILS panel, and the four nav cards. Pure function of the
 * shaped registry data from lib/data.mjs; markup primitives come from
 * lib/html.mjs and lib/highlight.mjs; waveforms are computed at build time
 * by lib/waveform.mjs.
 */
import {
  ADD_PROJECT_URL,
  CONTEXT7_EXAMPLE_URL, CONSENT_GUIDE_URL,
  DOCS_QUICKSTART_URL,
  MIGRATE_README_URL,
  STARTER_URL,
  SUITE,
} from "./constants.mjs";
import { codeBlock } from "./highlight.mjs";
import { esc } from "./html.mjs";
import { MIGRATE_AFTER, MIGRATE_BEFORE } from "./snippets.mjs";
import { waveformLockup } from "./waveform.mjs";

/**
 * The hero IS the two-line hook: value line, then the Before / After pair
 * verbatim from the reference README ("Migrate any MCP server in 2 lines"),
 * the README's one-sentence explanation, and the real migrated server. The
 * After block carries the copy button; the Before block is read-only.
 */
function heroMigrate() {
  return `  <header class="hero fx">
    <div class="kicker">BUILDERS.KYA-OS.ORG</div>
    <h1 class="h1-home"><span data-title-reveal>BUILD ON KYA-OS</span><span class="cursor" aria-hidden="true">_</span></h1>
    <p class="lede"><strong>Two lines give your MCP server a cryptographic identity and a signed receipt for every tool call.</strong> The identity is a <code>did:key</code> generated in your process and never shared. The receipt binds each request to its response, so anyone can verify what your server did: no logs to trust, nothing to impersonate.</p>
    <div class="diff-pair">
      <div>
        <div class="diff-label">before &middot; a standard MCP server, no identity or proofs</div>
        ${codeBlock(MIGRATE_BEFORE, { copy: false })}
      </div>
      <div>
        <div class="diff-label">after &middot; every tool response carries a signed proof</div>
        ${codeBlock(MIGRATE_AFTER)}
      </div>
    </div>
    <p class="note">That&#39;s it. <code>withKyaOs</code> auto-generates an Ed25519 identity, registers the <code>_kyaos</code> protocol tool, and wraps the transport so every tool response includes a detached JWS proof in <code>_meta</code>. Invisible to the LLM, verifiable by anyone.</p>
    <p class="note"><strong>From there, one wrapper at a time:</strong> gate any tool behind human consent and scoped, revocable authority (<a href="${CONSENT_GUIDE_URL}"><code>wrapWithDelegation</code></a>), and publish an <a href="/rails/">Entity Card</a> so MCP <code>server.json</code>, A2A, and NANDA all carry the same identity.</p>
    <p class="note"><a href="${CONTEXT7_EXAMPLE_URL}">See a real server migrated with exactly 2 lines: examples/context7-with-kya-os -&gt;</a></p>
    <p class="note">Then get listed here, prove conformance against the pinned suite, and ship on the rails that carry the standards you already speak.</p>
    <div class="dlinks next-strip">
      <span class="next-label">what next:</span>
      <a href="${STARTER_URL}">run the suite against it -&gt;</a>
      <a href="/conformance/">claim conformance -&gt;</a>
      <a href="${esc(ADD_PROJECT_URL)}">get listed -&gt;</a>
      <a class="quiet" href="${MIGRATE_README_URL}">reference README -&gt;</a>
      <a class="quiet" href="${DOCS_QUICKSTART_URL}">docs quickstart -&gt;</a>
    </div>
  </header>`;
}

/** The overview (home) page body. */
export function sectionsHome({ rendered, interopSorted }) {
  const stat = (href, html) => `    <a href="${href}">${html}</a>`;
  return `${heroMigrate()}
  <div class="stats fx fxd-15">
${[
    stat("/conformance/", `suite <b>${esc(SUITE.version)}</b>`),
    stat("/conformance/", `<b>${SUITE.vectors}</b> vectors`),
    stat("/conformance/#levels", `levels <b>L1–L3</b>`),
    stat("/standards/", `<b>${interopSorted.length}</b> standards mapped`),
    stat("/builders/", `<b>${rendered.length}</b> projects listed`),
    stat(
      "/builders/",
      `<b>${rendered.filter((entry) => entry.conformance?.status === "in-verification").length}</b> in verification &middot; <b>${rendered.filter((entry) => entry.conformance?.status === "verified").length}</b> verified`,
    ),
  ].join("\n")}
  </div>
  <a href="/rails/" class="rails-panel fx fxd-25" aria-label="The rails: AI agents send signed requests through KYA-OS to MCP servers, A2A peers, and any API - verified before they run. Read how one proof reaches every protocol.">
    <div class="rails-head">
      <div class="rails-title">THE RAILS</div>
      <div class="rails-sub">how one proof reaches every protocol -&gt;</div>
    </div>
    <div class="rails-mini" aria-hidden="true">
      <div class="rm-box rm-c1">AI</div>
      <div class="wire rm-w2"><span class="wire-dot"></span></div>
      <div class="rm-box rm-core rm-c3">KYA-OS</div>
      <div class="wire rm-w4"><span class="wire-dot wd-late"></span></div>
      <div class="rm-outs rm-c5">
        <span class="rm-out"><span>MCP server</span><span class="ok">&check;</span></span>
        <span class="rm-out"><span>A2A peer</span><span class="ok">&check;</span></span>
        <span class="rm-out"><span>any API</span><span class="ok">&check;</span></span>
      </div>
      <div class="rm-cap rm-u1">agents &middot; orchestrators &middot; autonomous</div>
      <div class="rm-under rm-u3">
        <div class="rm-wf">${waveformLockup("kya-os:signed-proof:v1.14", { bars: 18, trackHeight: 12 })}</div>
        <div class="rm-cap">who acts &middot; for whom &middot; with what authority</div>
      </div>
      <div class="rm-cap rm-u5">verified before it runs</div>
    </div>
  </a>
  <div class="home-cards fx fxd-35">
    <a href="/builders/" class="panel-card">
      <div class="pc-head"><span class="pc-title">builders -&gt;</span></div>
      <p>Who is building on KYA-OS - implementations, services, templates, and the examples to start from. Listing is one JSON file and one pull request.</p>
    </a>
    <a href="/conformance/" class="panel-card">
      <div class="pc-head"><span class="pc-title">conformance -&gt;</span><span class="chip st-shipping pulse">verifiable</span></div>
      <p>Measured, not asserted. Run the pinned vector suite, submit a claim, and the program independently re-runs your bytes and attests what it observes.</p>
    </a>
    <a href="/standards/" class="panel-card">
      <div class="pc-head"><span class="pc-title">standards -&gt;</span></div>
      <p>Every standard KYA-OS provides, carries, or projects onto - ${interopSorted.length} rows, each grounded in evidence and dated. Disputes are one pull request.</p>
    </a>
    <a href="/use-cases/" class="panel-card">
      <div class="pc-head"><span class="pc-title">use-cases -&gt;</span></div>
      <p>What people actually build: on-chain kill switches, consent-gated tools, delegated spend ceilings. Read them before you build, steal from them while you build.</p>
    </a>
  </div>`;
}
