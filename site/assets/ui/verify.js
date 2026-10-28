// verify - the /verify/ page's checker. Runs the reference audit verifier
// (@kya-os/mcp, vendored byte for byte under /vendor/ and resolved through
// the page's import map) on three JSON files: a replay bundle, a
// verification policy, and a kya-audit key file. It mirrors `kya-audit
// verify` (src/audit/cli.ts at the vendored version): the same key-file
// schema, the same policy parser, the same verifyAuditBundle call and the
// same exit-code rule. Only the crypto provider differs: WebCryptoProvider,
// the SDK's browser provider, where the CLI uses NodeCryptoProvider.
//
// Files come from the visitor's disk, a drop, the samples, or a link
// (?bundle=&policy=&keys=); nothing is uploaded. Every string from a file
// or a link reaches the page as text, never as markup. The form ships
// hidden and is revealed here, which also hides the no-JS line.
import {
  CompactJwsAuditSignatureVerifier,
  CryptoProviderAuditHasher,
  parseAuditVerificationPolicy,
  verifyAuditBundle,
} from "@kya-os/mcp/audit";
import { WebCryptoProvider } from "@kya-os/mcp/providers";
import { z } from "zod";
import { AUDIT_DIMENSIONS, auditExitCode } from "./audit-dimensions.js";

// The CLI's key-file schema, as src/audit/cli.ts declares it.
const keyFileSchema = z.object({
  keys: z.array(z.object({
    kid: z.string().min(1).max(2304),
    jwk: z.record(z.string(), z.unknown()),
  }).strict()).max(10_000),
}).strict().superRefine((value, context) => {
  const kids = value.keys.map((item) => item.kid);
  if (new Set(kids).size !== kids.length) {
    context.addIssue({ code: "custom", path: ["keys"], message: "Key IDs must be unique" });
  }
  for (const [index, item] of value.keys.entries()) {
    if (typeof item.jwk["kid"] === "string" && item.jwk["kid"] !== item.kid) {
      context.addIssue({ code: "custom", path: ["keys", index, "jwk", "kid"], message: "JWK kid must match the key-file kid" });
    }
  }
});

const FILES = ["bundle", "policy", "keys"];
const MAX_BYTES = 16 * 1024 * 1024;

const form = document.getElementById("vf-form");
if (form) init(form);

/** Build an element from a tag, attributes and children (strings become text nodes). */
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** Which of the three files a JSON text is, from its shape; null when it is none of them. */
function classify(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value.keys)) return "keys";
  if (typeof value.policyId === "string") return "policy";
  if (value.manifest && Array.isArray(value.components)) return "bundle";
  return null;
}

/** An error as one readable line: schema issues as "path: message", anything else as its message. */
function describe(error) {
  if (Array.isArray(error?.issues) && error.issues.length > 0) {
    return error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function init(form) {
  const result = document.getElementById("vf-result");
  const verifier = form.dataset.verifier;
  const loaded = {};
  const sourceLabel = (name) => form.querySelector(`[data-source="${name}"]`);
  const buttons = form.querySelectorAll("button");

  function setFile(name, text, source, origin) {
    loaded[name] = { text, source, origin };
    sourceLabel(name).textContent = source;
    sourceLabel(name).classList.add("vf-loaded");
  }

  function show(...children) {
    result.replaceChildren(...children);
    result.hidden = false;
  }

  function showFailure(message) {
    show(
      el("p", { class: "vf-headline vf-v-invalid" }, "Could not verify."),
      el("p", { class: "vf-sub" }, `${message} kya-audit would exit 2.`),
    );
  }

  async function readLocal(file) {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 16 MB.`);
    return file.text();
  }

  /** Fetch a file by URL: same-origin, or another site over HTTPS. */
  async function readRemote(raw) {
    const url = new URL(raw, location.href);
    const sameOrigin = url.origin === location.origin;
    if (!sameOrigin && url.protocol !== "https:") throw new Error(`${url.href} is not HTTPS.`);
    let response;
    try {
      response = await fetch(url, { credentials: "omit" });
    } catch {
      // The browser hides why (CORS, DNS, offline); name what the site must do.
      throw new Error(`${url.href} could not be fetched.${sameOrigin ? "" : " Another site has to serve it over HTTPS with CORS open."}`);
    }
    if (!response.ok) throw new Error(`${url.href} answered HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error(`${url.href} is larger than 16 MB.`);
    const name = url.pathname.split("/").pop() || url.pathname;
    return { text, origin: url.origin, source: sameOrigin ? `${name}, from this site` : `${name}, from ${url.host}` };
  }

  async function loadUrls(urls) {
    const files = await Promise.all(FILES.map((name) => readRemote(urls[name])));
    FILES.forEach((name, index) => setFile(name, files[index].text, files[index].source, files[index].origin));
  }

  async function run() {
    const missing = FILES.filter((name) => loaded[name] === undefined);
    if (missing.length > 0) {
      showFailure(`Load the ${missing.join(" and ")} file${missing.length > 1 ? "s" : ""} first.`);
      return;
    }
    for (const button of buttons) button.disabled = true;
    show(el("p", { class: "vf-sub" }, "Verifying..."));
    try {
      const bundle = JSON.parse(loaded.bundle.text);
      const policy = parseAuditVerificationPolicy(JSON.parse(loaded.policy.text));
      const keyFile = keyFileSchema.parse(JSON.parse(loaded.keys.text));
      const keys = new Map(keyFile.keys.map((item) => [item.kid, item.jwk]));
      const signatures = new CompactJwsAuditSignatureVerifier({
        async resolve(signer) {
          return keys.get(signer.kid) ?? null;
        },
      });
      const report = await verifyAuditBundle(bundle, policy, {
        hasher: new CryptoProviderAuditHasher(new WebCryptoProvider()),
        signatures,
      });
      showReport(report);
    } catch (error) {
      showFailure(`${describe(error)}.`.replace(/\.\.$/, "."));
    } finally {
      for (const button of buttons) button.disabled = false;
    }
  }

  function showReport(report) {
    const exit = auditExitCode(report);
    const dimensions = Object.entries(report).filter(([, value]) => value !== null && typeof value === "object" && "verdict" in value);
    const invalid = dimensions.filter(([, value]) => value.verdict === "invalid").length;
    const headline = exit === 0 ? "No dimension is invalid." : `${invalid} dimension${invalid === 1 ? " is" : "s are"} invalid.`;
    const known = new Map(AUDIT_DIMENSIONS.map((dimension) => [dimension.key, dimension.name]));
    const rows = dimensions.map(([key, value]) =>
      el(
        "li",
        { class: "vf-row", "data-verdict": value.verdict },
        el("span", { class: "vf-row-name" }, known.get(key) ?? key),
        el("span", { class: `vf-row-verdict vf-v-${value.verdict}` }, value.verdict),
        el("code", { class: "vf-row-codes" }, value.reasonCodes.length > 0 ? value.reasonCodes.join(", ") : "no reason codes"),
      ),
    );
    const sameSource = loaded.keys.origin !== undefined && loaded.keys.origin === loaded.bundle.origin;
    const trust = sameSource
      ? "The keys came from the same place as the bundle, so this shows the files agree with each other, not who signed them."
      : "A pass is only as good as the keys: check you trust where they came from.";
    show(
      el("p", { class: `vf-headline vf-v-${exit === 0 ? "valid" : "invalid"}` }, headline),
      el("p", { class: "vf-sub" }, `kya-audit would exit ${exit}. Checked in this tab with ${verifier}.`),
      el("ul", { class: "vf-rows" }, ...rows),
      el("p", { class: "vf-sources" }, FILES.map((name) => `${name[0].toUpperCase()}${name.slice(1)}: ${loaded[name].source}.`).join(" ")),
      el("p", { class: "vf-sources" }, trust),
      el("details", { class: "vf-raw" }, el("summary", {}, "The report as JSON"), el("pre", {}, JSON.stringify(report, null, 2))),
    );
  }

  form.addEventListener("change", async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !FILES.includes(input.name) || input.files.length === 0) return;
    const file = input.files[0];
    try {
      setFile(input.name, await readLocal(file), `${file.name}, from your disk`, undefined);
    } catch (error) {
      showFailure(describe(error));
    }
  });

  form.addEventListener("dragover", (event) => {
    event.preventDefault();
    form.classList.add("vf-drop");
  });
  form.addEventListener("dragleave", () => form.classList.remove("vf-drop"));
  form.addEventListener("drop", async (event) => {
    event.preventDefault();
    form.classList.remove("vf-drop");
    for (const file of event.dataTransfer.files) {
      try {
        const text = await readLocal(file);
        const kind = classify(text);
        if (kind === null) throw new Error(`${file.name} is not a bundle, a policy or a key file.`);
        setFile(kind, text, `${file.name}, from your disk`, undefined);
      } catch (error) {
        showFailure(describe(error));
      }
    }
  });

  for (const button of form.querySelectorAll("[data-sample]")) {
    button.addEventListener("click", async () => {
      try {
        await loadUrls({ bundle: `/verify/samples/${button.dataset.sample}`, policy: "/verify/samples/policy.json", keys: "/verify/samples/keys.json" });
      } catch (error) {
        showFailure(describe(error));
        return;
      }
      await run();
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });

  form.hidden = false;
  document.getElementById("vf-nojs").hidden = true;

  // A link to a check: all three URLs, or an explanation of what is missing.
  const params = new URLSearchParams(location.search);
  const linked = FILES.filter((name) => params.get(name));
  if (linked.length > 0) {
    if (linked.length < FILES.length) {
      showFailure(`A link to a check needs bundle, policy and keys; this one has only ${linked.join(" and ")}.`);
      return;
    }
    loadUrls(Object.fromEntries(FILES.map((name) => [name, params.get(name)])))
      .then(run, (error) => showFailure(describe(error)))
      .then(() => document.getElementById("check").scrollIntoView({ block: "start" }));
  }
}
