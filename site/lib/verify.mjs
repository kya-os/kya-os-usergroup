/**
 * The /verify/ page body: check a KYA-OS audit bundle in the browser with
 * the protocol's reference verifier, or run the same check as a command.
 *
 * Sections: the checker (a form that ships hidden - /ui/verify.js reveals
 * it - with a visible no-JS line pointing at the command), run it yourself
 * (the kya-audit command at the vendored version, the exit codes, the
 * sample files), what the report means (the seven dimensions from the
 * shared scripts/lib/audit-dimensions.mjs and the three verdicts), where the
 * keys come from (a pass is relative to the policy and keys supplied), and
 * what runs on the page (the vendored packages with their registry
 * integrity, the manifest, the source tag, and how to link to a check).
 *
 * Honesty rules, asserted on the dist bytes in lib/verify-checks.mjs: the
 * page never says the page itself is the proof (the command is the
 * independent check), every vendored package it names is in the manifest,
 * and the version it quotes is the one it runs.
 */
import { AUDIT_DIMENSIONS, VERDICTS } from "../../scripts/lib/audit-dimensions.mjs";
import { MCP_REPO_URL } from "./constants.mjs";
import { codeBlock } from "./highlight.mjs";
import { esc } from "./html.mjs";
import { AUDIT_VERIFY_CLI } from "./snippets.mjs";
import { VENDOR_MANIFEST, VERIFIER_PACKAGE } from "./vendor.mjs";

export const SAMPLE_FILES = ["bundle.json", "bundle.tampered.json", "policy.json", "keys.json"];
const TAG_URL = `${MCP_REPO_URL}/tree/v${VERIFIER_PACKAGE.version}`;
const AUDITABILITY_URL = `${MCP_REPO_URL}/blob/v${VERIFIER_PACKAGE.version}/AUDITABILITY.md`;
const SAMPLE_LINK = "/verify/?bundle=/verify/samples/bundle.json&amp;policy=/verify/samples/policy.json&amp;keys=/verify/samples/keys.json";

// The native file input is visually hidden (it stays focusable and is still
// the control); the label shows a button and, under it, the one status line
// the checker updates, so the browser's own "No file chosen" never contradicts
// a file that arrived by link or by drop.
const fileField = (name, label, hint) => `<label class="vf-file">
          <span class="vf-label">${label}</span>
          <input type="file" name="${name}" accept=".json,application/json" />
          <span class="vf-pick" aria-hidden="true">Choose file</span>
          <span class="vf-source" data-source="${name}">${hint}</span>
        </label>`;

function sectionCheck() {
  return `  <section class="fx" id="check">
    <h2>Check a bundle</h2>
    <p class="section-lede">A verifier needs three files: the bundle, the policy that says which ledgers and signers to trust, and those signers' public keys. Load your own, or start with the sample and its tampered copy.</p>
    <p class="vf-nojs" id="vf-nojs">The checker needs JavaScript. The command under <a href="#cli">run it yourself</a> runs the same verifier without it.</p>
    <form id="vf-form" class="vf-form" data-verifier="@kya-os/mcp@${esc(VERIFIER_PACKAGE.version)}" hidden>
      <div class="vf-files">
        ${fileField("bundle", "Bundle", "the replay bundle")}
        ${fileField("policy", "Policy", "the verification policy")}
        ${fileField("keys", "Keys", "the kya-audit key file")}
      </div>
      <p class="vf-hint">Or drop all three files onto this box. Nothing is uploaded: the files stay in this tab.</p>
      <div class="vf-actions">
        <button type="submit" class="vf-run">Verify</button>
        <button type="button" class="vf-sample" data-sample="bundle.json">Load the sample</button>
        <button type="button" class="vf-sample" data-sample="bundle.tampered.json">Load the tampered sample</button>
      </div>
    </form>
    <div id="vf-result" class="vf-result" aria-live="polite" hidden></div>
  </section>`;
}

function sectionCli() {
  const samples = SAMPLE_FILES.map((name) => `<a href="/verify/samples/${name}">${name}</a>`).join(", ");
  return `  <section class="fx" id="cli">
    <h2>Run it yourself</h2>
    <p class="section-lede">The same verifier as a command, on your own machine. When the result matters, prefer this: it does not depend on this page or this site.</p>
    ${codeBlock(AUDIT_VERIFY_CLI)}
    <p class="vf-note">Exit <code>0</code>: no dimension is invalid. Exit <code>1</code>: at least one is. Exit <code>2</code>: the files could not be read. The sample files to try it with: ${samples}.</p>
  </section>`;
}

function sectionDimensions() {
  const rows = AUDIT_DIMENSIONS.map(
    ({ key, name, means }) => `
      <div class="vf-dim"><dt>${esc(name)} <code>${esc(key)}</code></dt><dd>${esc(means)}</dd></div>`,
  ).join("");
  const verdicts = Object.entries(VERDICTS)
    .map(([verdict, meaning]) => `<li><b class="vf-v-${verdict}">${verdict}</b>: ${esc(meaning)}</li>`)
    .join("");
  return `  <section class="fx" id="dimensions">
    <h2>What the report means</h2>
    <p class="section-lede">The report keeps seven dimensions separate, so one failure cannot hide behind another. Each is <code>valid</code>, <code>invalid</code> or <code>indeterminate</code>.</p>
    <ul class="vf-verdicts">${verdicts}</ul>
    <dl class="vf-dims">${rows}
    </dl>
    <p class="vf-note">A relying party decides what an indeterminate dimension means for it. The definitions are in <a href="${AUDITABILITY_URL}">AUDITABILITY.md</a>.</p>
  </section>`;
}

function sectionTrust() {
  return `  <section class="fx" id="trust">
    <h2>Where the keys come from</h2>
    <p class="lede-muted">A pass means the bundle agrees with the policy and keys you supplied. It does not say who holds those keys: anyone can sign a bundle with keys of their own. KYA-OS never lets a bundle vouch for itself, so take the policy and keys from a source you already trust, such as the signer's published DID document, not from the same place as the bundle. When files arrive by link, the result names the site each one came from.</p>
  </section>`;
}

function sectionProvenance() {
  const packages = VENDOR_MANIFEST.packages
    .map(
      (p) => `
      <li><code>${esc(p.name)}@${esc(p.version)}</code> <span class="vf-pkg-meta">${esc(p.license)} &middot; ${p.modules} modules &middot; <a href="${esc(p.tarball)}">tarball</a> <code class="vf-int">${esc(p.integrity)}</code></span></li>`,
    )
    .join("");
  return `  <section class="fx" id="provenance">
    <h2>What runs on this page</h2>
    <p class="lede-muted">The reference verifier from the protocol repository, <a href="${TAG_URL}"><code>@kya-os/mcp</code> ${esc(VERIFIER_PACKAGE.version)}</a>, with its own dependencies. These are the files npm publishes, byte for byte: copied from the registry tarballs after checking each against the registry's integrity hash, re-checked on every build, and served from this site. Nothing loads from a CDN. The only difference from the command is the crypto provider: the browser's Web Crypto instead of Node's.</p>
    <ul class="vf-pkgs">${packages}
    </ul>
    <p class="vf-note">Every vendored file and its sha256: <a href="/vendor/manifest.json">/vendor/manifest.json</a>. To link straight to a check, give this page the three file URLs, for example <a href="${SAMPLE_LINK}">the sample</a>. Files on another site must be served over HTTPS with CORS open.</p>
  </section>`;
}

/** The page sections, in order. */
export function sectionsVerify() {
  return [sectionCheck(), sectionCli(), sectionDimensions(), sectionTrust(), sectionProvenance()].join("\n");
}
