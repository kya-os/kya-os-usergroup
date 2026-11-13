/**
 * The deploy preflight, offline: its checks (preflight-checks.mjs) against
 * documents minted by fixtures/mint.mjs under throwaway keys, with an
 * injected fetch standing in for the live site. Covers: a live site this
 * worker verifies passes; a live credential or status list in a form this
 * worker refuses (the proof without the @context it was signed over), an
 * unreachable document, or unprovisioned keys each refuse the deploy, naming
 * what failed; every credential-backed entry is checked, so one that fails
 * after another has passed still refuses; revoked entries are checked like
 * verified ones; entries below
 * the credential rungs fetch nothing; the verdict refuses when any check
 * failed or when none ran. The command line (preflight.mjs), with the global
 * fetch replaced before it loads: it exits 1 while the live site fails,
 * naming each failure, and when exactly one live document fails, naming that
 * one and no other; it runs its checks however it is started, through a
 * symlink or imported by a wrapper; and it exits 0 when the live site serves
 * this checkout's committed documents.
 *
 *   node --test workers/badge/preflight.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BADGE_ALLOWLIST } from "./generated-allowlist.mjs";
import { PROVISIONED } from "./generated-keys.mjs";
import { preflight, verdict } from "./preflight-checks.mjs";
import {
  CREDENTIALS_BASE,
  STATUS_LIST_URLS,
  credentialDocument,
  encodedListWithBits,
  signDocument,
  statusListDocument,
  throwawayKey,
  withoutProofContext,
} from "./fixtures/mint.mjs";

const issuer = throwawayKey();
const statusSigner = throwawayKey();
const KEYS = {
  issuerKeys: [{ id: "conformance-issuer-1", publicKeyMultibase: issuer.publicKeyMultibase }],
  statusKeys: [{ id: "conformance-status-1", publicKeyMultibase: statusSigner.publicKeyMultibase }],
  provisioned: true,
};

const ID32 = "0123456789abcdef0123456789abcdef";
const CREDENTIAL_URL = `${CREDENTIALS_BASE}/${ID32}.json`;
const SUBJECT = { id32: ID32, subjectId: "https://example.com/impl", level: "L1", scope: "subset", categories: ["signed-proof"], statusIndex: 3 };
const credential = await signDocument(credentialDocument(SUBJECT), issuer, "conformance-issuer-1");
const signList = async (purpose, bits) => signDocument(statusListDocument(purpose, await encodedListWithBits(bits)), statusSigner, "conformance-status-1");
const LIVE = {
  [CREDENTIAL_URL]: credential,
  [STATUS_LIST_URLS.revocation]: await signList("revocation", []),
  [STATUS_LIST_URLS.suspension]: await signList("suspension", []),
};

const ALLOWLIST = {
  "fixture-impl": { name: "Fixture Implementation", claim: "L1 subset (signed-proof)", status: "verified", credentialUrl: CREDENTIAL_URL },
  "mid-rung": { name: "Mid Rung", claim: "L3 full", status: "in-verification", credentialUrl: null },
  "just-listed": { name: "Just Listed", claim: null, status: null, credentialUrl: null },
};

/** Run the preflight against a live site given as a URL->document map; records every URL fetched. */
async function runAgainst(documents, { allowlist = ALLOWLIST, keys = KEYS } = {}) {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return url in documents ? new Response(JSON.stringify(documents[url]), { status: 200 }) : new Response("not found", { status: 404 });
  };
  return { ...(await preflight({ allowlist, ...keys, fetchImpl })), fetched };
}

test("passes when both live status lists and every credential-backed entry verify under this worker", async () => {
  const { checked, failures, fetched } = await runAgainst(LIVE);
  assert.deepEqual(failures, []);
  assert.deepEqual(checked, ["revocation list: verified", "suspension list: verified", "fixture-impl: ✓ L1 subset verified"]);
  assert.deepEqual([...new Set(fetched)].sort(), Object.keys(LIVE).sort(), "entries below the credential rungs fetch nothing");
});

test("checks every credential-backed entry: one this worker refuses fails the preflight after another has passed", async () => {
  const later = { ...SUBJECT, id32: "fedcba9876543210fedcba9876543210" };
  const laterUrl = `${CREDENTIALS_BASE}/${later.id32}.json`;
  const refused = withoutProofContext(await signDocument(credentialDocument(later), issuer, "conformance-issuer-1"));
  const allowlist = { first: ALLOWLIST["fixture-impl"], second: { ...ALLOWLIST["fixture-impl"], credentialUrl: laterUrl } };
  const { checked, failures } = await runAgainst({ ...LIVE, [laterUrl]: refused }, { allowlist });
  assert.deepEqual(checked, ["revocation list: verified", "suspension list: verified", "first: ✓ L1 subset verified"]);
  assert.equal(failures.length, 1, failures.join("; "));
  assert.ok(failures[0].startsWith("second: ") && failures[0].includes("did not verify"), failures[0]);
});

test("refuses while the live site serves a credential or status list this worker refuses, naming it", async () => {
  for (const [url, name] of [
    [CREDENTIAL_URL, "fixture-impl"],
    [STATUS_LIST_URLS.revocation, "revocation list"],
    [STATUS_LIST_URLS.suspension, "suspension list"],
  ]) {
    const { failures } = await runAgainst({ ...LIVE, [url]: withoutProofContext(LIVE[url]) });
    assert.ok(failures.some((failure) => failure.startsWith(`${name}: `) && failure.includes("did not verify")), `${name}:\n  ${failures.join("\n  ")}`);
  }
});

test("refuses when a live document cannot be fetched", async () => {
  const unreachable = { ...LIVE };
  delete unreachable[STATUS_LIST_URLS.suspension];
  const { failures } = await runAgainst(unreachable);
  assert.ok(failures.some((failure) => failure.startsWith("suspension list: ") && failure.includes("404")), failures.join("; "));
  assert.ok(failures.some((failure) => failure.startsWith("fixture-impl: ")), failures.join("; "));
});

test("checks a revoked entry like a verified one: it passes as revoked, and fails on a credential this worker refuses", async () => {
  const allowlist = { "was-verified": { ...ALLOWLIST["fixture-impl"], status: "revoked" } };
  const revoked = { ...LIVE, [STATUS_LIST_URLS.revocation]: await signList("revocation", [3]) };
  const passing = await runAgainst(revoked, { allowlist });
  assert.deepEqual(passing.failures, []);
  assert.ok(passing.checked.includes("was-verified: revoked"), passing.checked.join("; "));
  const failing = await runAgainst({ ...revoked, [CREDENTIAL_URL]: withoutProofContext(credential) }, { allowlist });
  assert.ok(failing.failures.some((failure) => failure.startsWith("was-verified: ")), failing.failures.join("; "));
});

test("refuses on unprovisioned keys", async () => {
  const { failures } = await runAgainst(LIVE, { keys: { ...KEYS, provisioned: false } });
  assert.ok(failures.some((failure) => failure.startsWith("fixture-impl: ") && failure.includes("unprovisioned")), failures.join("; "));
  const { failures: unpinned } = await runAgainst(LIVE, { keys: { ...KEYS, statusKeys: [] } });
  assert.ok(unpinned.some((failure) => failure.startsWith("revocation list: ")), unpinned.join("; "));
});

test("the verdict refuses when any check failed, and when no check ran at all", () => {
  const passed = verdict({ checked: ["revocation list: verified"], failures: [] });
  assert.equal(passed.code, 0);
  assert.deepEqual(passed.out, ["ok    revocation list: verified", "Both status lists and every allowlist entry at verified or revoked verify under this worker (1 check)."]);
  const failed = verdict({ checked: ["revocation list: verified"], failures: ["fixture-impl: credential fetch 404"] });
  assert.equal(failed.code, 1);
  assert.equal(failed.err[0], "FAIL  fixture-impl: credential fetch 404");
  assert.match(failed.err.at(-1), /refusing to deploy/);
  const none = verdict({ checked: [], failures: [] });
  assert.equal(none.code, 1, "a preflight that checked nothing has verified nothing");
  assert.match(none.err.join("\n"), /^No check ran\b.*refusing to deploy/m);
});

// ── the command line ────────────────────────────────────────────────────────

const PREFLIGHT = fileURLToPath(new URL("./preflight.mjs", import.meta.url));
const COMMITTED = fileURLToPath(new URL("../../registry/credentials/", import.meta.url));
const NOTHING_SERVED = 'globalThis.fetch = async () => new Response("not found", { status: 404 });';

/** Run preflight.mjs as the workflow does, with the module `fetchSource` loaded first to replace the global fetch; `entry` is how it is started. */
function runCli(fetchSource, entry = [PREFLIGHT]) {
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(fetchSource)}`, ...entry], { encoding: "utf8" });
}

/** A fetch module for runCli: the live site serves this checkout's committed documents, with `overrides` (URL -> document) in their place. */
function servingCommitted(overrides = {}) {
  return `
    import { readFileSync } from "node:fs";
    const base = "https://builders.kya-os.org/credentials/";
    const overrides = ${JSON.stringify(overrides)};
    globalThis.fetch = async (url) => {
      if (Object.hasOwn(overrides, url)) return new Response(JSON.stringify(overrides[url]), { status: 200 });
      try {
        return new Response(readFileSync(${JSON.stringify(COMMITTED)} + url.slice(base.length), "utf8"), { status: 200 });
      } catch {
        return new Response("not found", { status: 404 });
      }
    };
  `;
}

test("the command line exits 1, naming each failure, while the live documents do not verify", () => {
  const { status, stdout, stderr } = runCli(NOTHING_SERVED);
  assert.equal(status, 1, stdout + stderr);
  assert.match(stderr, /^FAIL {2}revocation list: .*404$/m);
  assert.match(stderr, /^FAIL {2}suspension list: .*404$/m);
  assert.match(stderr, /refusing to deploy/);
});

test("the command line runs its checks however it is started: through a symlinked file or directory, or imported by a wrapper", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "kya-preflight-"));
  const links = [join(temp, "preflight.mjs"), join(temp, "badge")];
  symlinkSync(PREFLIGHT, links[0], "file");
  symlinkSync(dirname(PREFLIGHT), links[1], "dir");
  // Unlink the links before removing the folder, so nothing can follow them.
  t.after(() => {
    for (const link of links) unlinkSync(link);
    rmSync(temp, { recursive: true, force: true });
  });
  const ways = {
    "a symlinked file": [links[0]],
    "a symlinked directory": [join(links[1], "preflight.mjs")],
    "a wrapper that imports it": ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(PREFLIGHT).href)});`],
  };
  for (const [way, entry] of Object.entries(ways)) {
    const { status, stdout, stderr } = runCli(NOTHING_SERVED, entry);
    assert.equal(status, 1, `${way}:\n${stdout}${stderr}`);
    assert.match(stderr, /^FAIL {2}revocation list: .*404$/m, way);
    assert.match(stderr, /refusing to deploy/, way);
  }
});

test("the command line exits 1 when exactly one live document does not verify, naming that one and no other", (t) => {
  const [slug, entry] = Object.entries(BADGE_ALLOWLIST).find(([, candidate]) => candidate.status === "verified" || candidate.status === "revoked") ?? [];
  if (!PROVISIONED || slug === undefined) {
    t.skip("nothing signed is committed for an allowlist entry to fail on");
    return;
  }
  const committed = JSON.parse(readFileSync(COMMITTED + entry.credentialUrl.split("/").at(-1), "utf8"));
  const { status, stdout, stderr } = runCli(servingCommitted({ [entry.credentialUrl]: withoutProofContext(committed) }));
  assert.equal(status, 1, stdout + stderr);
  const failed = stderr.match(/^FAIL .*$/gm) ?? [];
  assert.equal(failed.length, 1, stderr);
  assert.ok(failed[0].startsWith(`FAIL  ${slug}: `) && failed[0].includes("did not verify"), failed[0]);
  assert.match(stderr, /refusing to deploy/);
  assert.match(stdout, /^ok {4}revocation list: verified$/m);
  assert.doesNotMatch(stdout, /verify under this worker/);
});

test("the command line exits 0 when the live site serves this checkout's committed documents", (t) => {
  if (!PROVISIONED) {
    t.skip("program keys are unprovisioned - nothing signed is committed");
    return;
  }
  const { status, stdout, stderr } = runCli(servingCommitted());
  assert.equal(status, 0, stdout + stderr);
  assert.match(stdout, /^ok {4}revocation list: verified$/m);
  assert.match(stdout, /^Both status lists and every allowlist entry at verified or revoked verify under this worker \(\d+ checks\)\.$/m);
});
