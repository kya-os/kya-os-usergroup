/**
 * Badge worker tests: node --test workers/badge/
 *
 * Runs entirely offline against the committed dev fixtures (throwaway keys,
 * NON-PRODUCTION): fetch is injected as a URL->payload map, the cache is
 * omitted, and the fixture issuer/status keys stand in for the (placeholder)
 * pinned production key sets. Covers: proof verify accept, reject-on-tamper,
 * status list proof enforcement (unsigned/tampered/wrong-key lists rejected,
 * key separation between issuer and status keys), all six render states
 * through the HTTP handler, allowlist rejection, and the honesty rules
 * (label constant, subset never bare).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  base64urlEncode,
  bitstringStatusAt,
  ed25519KeyFromMultibase,
  gzip,
  MAX_INFLATED_BYTES,
  verifyEddsaJcs2022,
} from "./verify.mjs";
import { createBadgeHandler } from "./worker.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

const issuer = fixture("dev-issuer.json");
const statusIssuer = fixture("dev-status-issuer.json");
const credential = fixture("dev-credential.json");
const statusLists = fixture("dev-status-lists.json");
const manifest = fixture("dev-manifest.json");
const issuerKeyBytes = ed25519KeyFromMultibase(issuer.publicKeyMultibase);

const CREDENTIAL_URL = "https://fixtures.invalid/credential.json";
const MANIFEST_URL = "https://fixtures.invalid/SUITE-MANIFEST.json";
const LIST_URLS = {
  revocation: "https://fixtures.invalid/status-revocation.json",
  suspension: "https://fixtures.invalid/status-suspension.json",
  withdrawal: "https://fixtures.invalid/status-withdrawal.json",
};

const ALLOWLIST = {
  "fixture-impl": { name: "Fixture Implementation", claim: "L1 subset (signed-proof)", credentialUrl: CREDENTIAL_URL },
  "no-claim-yet": { name: "No Claim Yet", claim: null, credentialUrl: null },
};

/** Injected fetch: a plain URL->JSON-value map; anything else 404s. */
function fakeFetch(map) {
  return async (url) => {
    if (url in map) {
      return new Response(JSON.stringify(map[url]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
}

/** The happy-path fetch map: valid credential, signed all-zero lists, matching manifest. */
function happyMap(overrides = {}) {
  return {
    [CREDENTIAL_URL]: credential,
    [LIST_URLS.revocation]: statusLists.lists.revocation.allZero,
    [LIST_URLS.suspension]: statusLists.lists.suspension.allZero,
    [LIST_URLS.withdrawal]: statusLists.lists.withdrawal.allZero,
    [MANIFEST_URL]: { suiteVersion: manifest.suiteVersion, vectorSetHash: manifest.vectorSetHash },
    ...overrides,
  };
}

function handlerWith(map, allowlist = ALLOWLIST) {
  return createBadgeHandler({
    allowlist,
    issuerKeys: [issuer.publicKeyMultibase],
    statusKeys: [statusIssuer.publicKeyMultibase],
    manifestUrl: MANIFEST_URL,
    fetchImpl: fakeFetch(map),
  });
}

const get = (handler, path) => handler(new Request(`https://badge.kya-os.org${path}`));

// ── proof verification ──────────────────────────────────────────────────────

test("verify accepts the fixture credential against the fixture issuer key", async () => {
  const result = await verifyEddsaJcs2022(credential, issuerKeyBytes);
  assert.equal(result.ok, true, result.reason);
});

test("verify rejects on tampered credential subject", async () => {
  const tampered = structuredClone(credential);
  tampered.credentialSubject.level = "L3"; // promote yourself, get caught
  const result = await verifyEddsaJcs2022(tampered, issuerKeyBytes);
  assert.equal(result.ok, false);
});

test("verify rejects on tampered proofValue and on wrong key", async () => {
  const tampered = structuredClone(credential);
  tampered.proof.proofValue = `z1${tampered.proof.proofValue.slice(2)}`;
  assert.equal((await verifyEddsaJcs2022(tampered, issuerKeyBytes)).ok, false);

  const wrongKey = new Uint8Array(32); // the all-zero non-key
  assert.equal((await verifyEddsaJcs2022(credential, wrongKey)).ok, false);
});

test("verify rejects unknown proof types and cryptosuites", async () => {
  const wrongType = structuredClone(credential);
  wrongType.proof.type = "Ed25519Signature2020";
  assert.equal((await verifyEddsaJcs2022(wrongType, issuerKeyBytes)).ok, false);

  const wrongSuite = structuredClone(credential);
  wrongSuite.proof.cryptosuite = "eddsa-rdfc-2022";
  assert.equal((await verifyEddsaJcs2022(wrongSuite, issuerKeyBytes)).ok, false);
});

// ── render states through the HTTP handler ─────────────────────────────────

async function expectBadge(map, path, { message, color, status = 200 }) {
  const response = await get(handlerWith(map), path);
  assert.equal(response.status, status);
  const body = await response.text();
  if (path.endsWith(".svg")) {
    assert.ok(body.includes("KYA-OS conformance"), "label must always be KYA-OS conformance");
    assert.ok(body.includes(message), `SVG should contain "${message}", got: ${body.slice(0, 300)}`);
    if (color) assert.ok(body.includes(color), `SVG should use ${color}`);
  } else {
    const json = JSON.parse(body);
    assert.equal(json.label, "KYA-OS conformance");
    assert.equal(json.message, message);
  }
  return body;
}

test("state: verified (subset claim renders categories, never a bare level)", async () => {
  const svg = await expectBadge(happyMap(), "/v1/badge/fixture-impl.svg", {
    message: "L1 subset (signed-proof) verified",
    color: "#3fb950",
  });
  assert.ok(!/>L1 verified</.test(svg), "subset must never render as a bare level");
  await expectBadge(happyMap(), "/v1/badge/fixture-impl.json", { message: "L1 subset (signed-proof) verified" });
});

test("state: revoked", async () => {
  await expectBadge(happyMap({ [LIST_URLS.revocation]: statusLists.lists.revocation.bit3Set }), "/v1/badge/fixture-impl.svg", {
    message: "revoked",
    color: "#f85149",
  });
});

test("state: contested (suspension bit)", async () => {
  await expectBadge(happyMap({ [LIST_URLS.suspension]: statusLists.lists.suspension.bit3Set }), "/v1/badge/fixture-impl.svg", {
    message: "contested",
    color: "#d29922",
  });
});

test("state: withdrawn", async () => {
  await expectBadge(happyMap({ [LIST_URLS.withdrawal]: statusLists.lists.withdrawal.bit3Set }), "/v1/badge/fixture-impl.svg", {
    message: "withdrawn",
    color: "#6e7681",
  });
});

test("state: superseded when the manifest moved past the credential's pin", async () => {
  await expectBadge(
    happyMap({ [MANIFEST_URL]: { suiteVersion: "1.1.0", vectorSetHash: "sha256:different" } }),
    "/v1/badge/fixture-impl.svg",
    { message: "superseded", color: "#58a6ff" },
  );
});

test("state: unknown renders as unverified when no credential exists yet", async () => {
  await expectBadge(happyMap(), "/v1/badge/no-claim-yet.svg", { message: "unverified", color: "#6e7681" });
});

test("fail-closed: fetch failures and bad proofs render unverified, never verified", async () => {
  // Credential URL 404s.
  const noCred = happyMap();
  delete noCred[CREDENTIAL_URL];
  await expectBadge(noCred, "/v1/badge/fixture-impl.svg", { message: "unverified" });
  // Tampered credential served.
  const tampered = structuredClone(credential);
  tampered.credentialSubject.scope = "full";
  await expectBadge(happyMap({ [CREDENTIAL_URL]: tampered }), "/v1/badge/fixture-impl.svg", { message: "unverified" });
  // Status list unreachable.
  const noList = happyMap();
  delete noList[LIST_URLS.revocation];
  await expectBadge(noList, "/v1/badge/fixture-impl.svg", { message: "unverified" });
});

test("revocation precedence beats a stale manifest (revoked, not superseded)", async () => {
  await expectBadge(
    happyMap({
      [LIST_URLS.revocation]: statusLists.lists.revocation.bit3Set,
      [MANIFEST_URL]: { suiteVersion: "9.9.9", vectorSetHash: "sha256:moved" },
    }),
    "/v1/badge/fixture-impl.svg",
    { message: "revoked", color: "#f85149" },
  );
});

// ── status list proof enforcement (three-key design) ────────────────────────

test("status list without a proof renders unverified, never verified", async () => {
  const unsigned = structuredClone(statusLists.lists.revocation.allZero);
  delete unsigned.proof;
  await expectBadge(happyMap({ [LIST_URLS.revocation]: unsigned }), "/v1/badge/fixture-impl.svg", {
    message: "unverified",
  });
});

test("tampered signed status list renders unverified (bits cannot be cleared without re-signing)", async () => {
  // Take the signed revoked list and swap in the all-zero bitstring: the
  // attack that clears a revocation. The stale proof must not carry it.
  const tampered = structuredClone(statusLists.lists.revocation.bit3Set);
  tampered.credentialSubject.encodedList = statusLists.lists.revocation.allZero.credentialSubject.encodedList;
  await expectBadge(happyMap({ [LIST_URLS.revocation]: tampered }), "/v1/badge/fixture-impl.svg", {
    message: "unverified",
  });
});

test("key separation: a status list signed by the ISSUER key renders unverified", async () => {
  // statusLists.issuerSigned is a validly signed all-zero revocation list,
  // but signed with the issuer key. A stolen issuer key must not be able to
  // clear its own revocation bits, so only the status keys may vouch for it.
  await expectBadge(happyMap({ [LIST_URLS.revocation]: statusLists.issuerSigned }), "/v1/badge/fixture-impl.svg", {
    message: "unverified",
  });
});

// ── inflation cap (streaming, aborts mid-decompress) ────────────────────────

test("gzip bomb: inflating past the cap throws mid-stream, normal lists still read", async () => {
  // Highly compressible bomb: 4x the cap of zeros gzips to a few tens of KiB
  // but would inflate to 64 MiB. The capped streaming reader must abort the
  // moment the running total crosses MAX_INFLATED_BYTES instead of
  // materializing the full payload and checking after the fact.
  const bomb = `u${base64urlEncode(await gzip(new Uint8Array(MAX_INFLATED_BYTES * 4)))}`;
  await assert.rejects(() => bitstringStatusAt(bomb, "3"), /inflation cap/);

  // Normal, under-cap lists still decode and read correctly.
  const normal = statusLists.lists.revocation;
  assert.equal(await bitstringStatusAt(normal.allZero.credentialSubject.encodedList, "3"), false);
  assert.equal(await bitstringStatusAt(normal.bit3Set.credentialSubject.encodedList, "3"), true);
});

// ── routing and allowlist ───────────────────────────────────────────────────

test("allowlist rejection: unlisted slug is a 404, not an unverified badge", async () => {
  const response = await get(handlerWith(happyMap()), "/v1/badge/not-in-registry.svg");
  assert.equal(response.status, 404);
});

test("routing: bad paths 404, non-GET 405, query strings do not change the route", async () => {
  const handler = handlerWith(happyMap());
  assert.equal((await get(handler, "/v1/badge/fixture-impl.png")).status, 404);
  assert.equal((await get(handler, "/nope")).status, 404);
  assert.equal((await handler(new Request("https://badge.kya-os.org/v1/badge/fixture-impl.svg", { method: "POST" }))).status, 405);
  const withQuery = await get(handler, "/v1/badge/fixture-impl.svg?cachebust=1");
  assert.equal(withQuery.status, 200);
});

test("shields JSON shape", async () => {
  const response = await get(handlerWith(happyMap()), "/v1/badge/fixture-impl.json");
  const json = await response.json();
  assert.deepEqual(Object.keys(json).sort(), ["color", "isError", "label", "message", "schemaVersion"]);
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.isError, false);
});
