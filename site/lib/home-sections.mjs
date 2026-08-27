/**
 * The overview (home) page's sections after the hook (split from
 * lib/home.mjs for the lib LOC cap): the path in order (listed -> claim ->
 * credential), define-once with THE RAILS panel, and the explore grid with
 * the live stats strip. Every in-site anchor these link must exist as an id
 * in the built target page - lib/checks.mjs assertHomePolish parses the
 * dist bytes for it, so a renamed section elsewhere fails the build here.
 */
import { SUITE } from "./constants.mjs";
import { esc } from "./html.mjs";
import { waveformLockup } from "./waveform.mjs";

/**
 * The three steps, in order. Each links a real section: the builders page's
 * entry-builder section, and the conformance page's pipeline and badge
 * sections. Step 3 is earned - a credential is issued by an independent
 * re-run, never generated.
 */
export function sectionPath() {
  const step = (title, sentence, href, label) =>
    `      <li><div class="path-body"><strong>${title}</strong> ${sentence} <a href="${href}">${label} -&gt;</a></div></li>`;
  return `  <section class="fx fxd-15">
    <h2>Your path, in order</h2>
    <div class="rule"></div>
    <ol class="path">
${[
    step("Get listed", "One JSON file and one pull request; the entry builder writes the file for you.", "/builders/#build-entry", "build your entry"),
    step(
      "Run the suite and submit your claim",
      "The starter takes you from clone to report in under an hour; the claim is one issue.",
      "/conformance/#how-verification-works",
      "how verification works",
    ),
    step(
      "Earn the credential and the badge",
      "An independent re-run issues a signed, revocable credential; the badge re-verifies it on every render.",
      "/conformance/#the-badge",
      "the badge",
    ),
  ].join("\n")}
    </ol>
  </section>`;
}

/** THE RAILS panel: one proof reaching every protocol, as a mini diagram linking the rails page. */
function railsPanel() {
  return `    <a href="/rails/" class="rails-panel fx fxd-25" aria-label="The rails: AI agents send signed requests through KYA-OS to MCP servers, A2A peers, and any API - verified before they run. Read how one proof reaches every protocol.">
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
    </a>`;
}

/** Define once, project anywhere: the Entity Card sentence, the three rail chips, two guarantees, THE RAILS panel. */
export function sectionDefineOnce() {
  const chip = (label) => `      <a class="chip-link" href="/rails/"><span class="chip st-rail">${label}</span></a>`;
  return `  <section class="fx fxd-20">
    <h2>Define once, project anywhere</h2>
    <div class="rule"></div>
    <p class="lede-lg">Your Entity Card is written once. KYA-OS projects it onto every discovery rail your agent needs, so the same identity appears wherever it is looked up. It does not ask the ecosystems you already speak to migrate: it projects your identity onto them.</p>
    <div class="chip-row">
${[chip("MCP server.json / catalog"), chip("A2A AgentCard extension"), chip("NANDA AgentFacts")].join("\n")}
    </div>
    <ul class="bullets">
      <li><strong>Verified before it runs:</strong> the receiving server checks the proof and delegation constraints in-process, before the tool executes.</li>
      <li><strong>No migration:</strong> it wraps the transport you already have.</li>
    </ul>
${railsPanel()}
  </section>`;
}

/** Explore: the live stats strip (every number recomputed and asserted in lib/assertions.mjs) and the five page cards. */
export function sectionExplore({ rendered, interopSorted }) {
  const stat = (href, html) => `      <a href="${href}">${html}</a>`;
  const card = (href, title, copy, chip = "") => `      <div class="panel-card">
        <div class="pc-head"><a class="pc-title" href="${href}">${title} -&gt;</a>${chip}</div>
        <p>${copy}</p>
      </div>`;
  const inVerification = rendered.filter((entry) => entry.conformance?.status === "in-verification").length;
  const verified = rendered.filter((entry) => entry.conformance?.status === "verified").length;
  return `  <section class="fx fxd-30">
    <h2>Explore</h2>
    <div class="rule"></div>
    <div class="stats">
${[
    stat("/conformance/", `suite <b>${esc(SUITE.version)}</b>`),
    stat("/conformance/", `<b>${SUITE.vectors}</b> vectors`),
    stat("/conformance/#levels", `levels <b>L1–L3</b>`),
    stat("/standards/", `<b>${interopSorted.length}</b> standards mapped`),
    stat("/builders/", `<b>${rendered.length}</b> projects listed`),
    stat("/builders/", `<b>${inVerification}</b> in verification &middot; <b>${verified}</b> verified`),
  ].join("\n")}
    </div>
    <div class="grid-3">
${[
    card("/builders/", "builders", "Who is building on KYA-OS: implementations, services, templates, examples. One JSON file and one pull request to be listed."),
    card(
      "/conformance/",
      "conformance",
      "Verified, not self-asserted. Run the pinned vector suite, submit your claim, and an independent re-run attests exactly the bytes it observed.",
      `<span class="chip st-shipping pulse">verifiable</span>`,
    ),
    card("/rails/", "rails", "Define your Entity Card once; it projects onto MCP, A2A, and NANDA."),
    card(
      "/standards/",
      "standards rails",
      `Every standard KYA-OS provides, carries, or projects: ${interopSorted.length} rows with evidence, and an impl link into the reference implementation for everything shipping. Each row is dated, grounded in a W3C or IETF specification, and open to correction.`,
    ),
    card(
      "/use-cases/",
      "use-cases",
      "What people build: the on-chain kill switch (REVOKED), consent-gated tools, delegated spend budgets. Every recipe opens a real example.",
    ),
  ].join("\n")}
    </div>
  </section>`;
}
