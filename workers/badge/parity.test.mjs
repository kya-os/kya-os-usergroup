/**
 * Cross-implementation parity: the DELIBERATE REDUNDANCY RULE's enforcement.
 *
 * workers/badge/{verify,worker}.mjs (WebCrypto, Cloudflare-bundlable) and
 * scripts/lib/{jcs,keys,attest}.mjs (node:crypto, issuance/build side) are
 * independent implementations of the same primitives and may never import
 * each other - THIS test file is where both sides meet, proving:
 *
 *   - RFC 8785 JCS: identical bytes on shared edge vectors, and both equal
 *     the hardcoded expectation (so both being wrong together still fails)
 *   - the worker's self-contained program identity constants and clock
 *     skew equal the scripts side's (neither copy can drift alone)
 *   - a credential signed by the scripts side VERIFIES under the worker's
 *     verifyEddsaJcs2022, through the worker's own multikey decoder
 *   - a status list built and signed by the scripts side is readable by the
 *     worker's bitstring reader and verifies under the worker's crypto
 *   - THE CROSS-STACK E2E: a credential and both status lists minted
 *     entirely by scripts/lib/attest.mjs render the verified badge through
 *     the worker's full HTTP handler, flip to under-appeal and revoked as
 *     the scripts side re-signs the lists, and fail closed on tamper - with
 *     the badge's signature wave drawn from that scripts-minted proofValue,
 *     one pattern across the credential's three states, redrawn by a reissue
 *   - tampering (subject byte, proofValue, wrong key, bit flip without
 *     re-signing) rejects on BOTH sides
 *   - the committed generated-keys module fail-closes the worker in the
 *     sentinel era (PROVISIONED false, empty pins, unverified everywhere,
 *     no fetch attempted) and never trusts a throwaway key in any era
 *
 *   node --test workers/badge/parity.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { base58btcDecode as workerB58Decode, bitstringStatusAt, ed25519KeyFromMultibase, jcsCanonicalize, verifyEddsaJcs2022 } from "./verify.mjs";
import { BARS, credentialWaveSeed, waveRects } from "./wave.mjs";
import {
  CLOCK_SKEW_MS as WORKER_CLOCK_SKEW_MS,
  CREDENTIALS_BASE as WORKER_CREDENTIALS_BASE,
  ISSUER_DID as WORKER_ISSUER_DID,
  PROGRAM_CONTEXT as WORKER_PROGRAM_CONTEXT,
  STATUS_LIST_URLS as WORKER_STATUS_LIST_URLS,
  createBadgeHandler,
} from "./worker.mjs";
import { PINNED_ISSUER_KEYS, PINNED_STATUS_KEYS, PROVISIONED } from "./generated-keys.mjs";
import { CLOCK_SKEW_MS } from "../../scripts/lib/datetime.mjs";
import { canonicalize } from "../../scripts/lib/jcs.mjs";
import { base58btcEncode, encodePublicKeyMultibase } from "../../scripts/lib/keys.mjs";
import {
  CREDENTIALS_BASE,
  ISSUER_DID,
  PROGRAM_CONTEXT,
  STATUS_LIST_BYTES,
  STATUS_LIST_URLS,
  buildCredential,
  buildStatusListCredential,
  decodeStatusList,
  encodeStatusList,
  setStatusBit,
  signCredential,
  statusBitAt,
  verifyCredential,
} from "../../scripts/lib/attest.mjs";

function throwawayKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = (key, field) => new Uint8Array(Buffer.from(key.export({ format: "jwk" })[field], "base64url"));
  return { seed: raw(privateKey, "d"), public: raw(publicKey, "x") };
}

const issuer = throwawayKey();
const statusSigner = throwawayKey();
const ISSUER_VM = `${ISSUER_DID}#conformance-issuer-1`;
const STATUS_VM = `${ISSUER_DID}#conformance-status-1`;

// `options` reaches signCredential, so a reissue (a fresh `created`, hence a
// fresh signature over the same claim) is one argument away.
function signedSample(options) {
  const credential = buildCredential({
    subjectId: "https://example.com/impl",
    implementation: { name: "Parity Fixture", version: "1.2.3", repo: "https://example.com/repo", digest: { gitCommit: "b".repeat(40) } },
    level: "L1",
    scope: "subset",
    categories: ["signed-proof"],
    packageVersion: "1.14.0",
    statusIndex: 7,
    validFrom: "2026-01-01T00:00:00Z",
  });
  return signCredential(credential, issuer.seed, ISSUER_VM, options);
}

// ── JCS and codec parity ────────────────────────────────────────────────────

test("JCS parity: both implementations byte-agree on edge vectors AND the pinned expectation", () => {
  const vectors = [
    [{ b: 1e21, a: [0.000001, 1e-7, -0, 9007199254740991] }, '{"a":[0.000001,1e-7,0,9007199254740991],"b":1e+21}'],
    [{ "é": 1, e: 2, "€": 3, Z: 4, a: 5, "😀": 6, "ﬀ": 7 }, '{"Z":4,"a":5,"e":2,"é":1,"€":3,"😀":6,"ﬀ":7}'],
    [{ "a\u0000b\"\\\n\t\u001f": ["\b\f\r", null, true, false] }, '{"a\\u0000b\\"\\\\\\n\\t\\u001f":["\\b\\f\\r",null,true,false]}'],
    [{ nested: { deep: [{ z: null }, [], {}] }, "": 0 }, '{"":0,"nested":{"deep":[{"z":null},[],{}]}}'],
  ];
  for (const [value, expected] of vectors) {
    const scriptsOut = canonicalize(value);
    const workerOut = jcsCanonicalize(value);
    assert.equal(scriptsOut, workerOut, "the two JCS implementations diverged");
    assert.equal(scriptsOut, expected, "both implementations drifted from the pinned vector together");
  }
});

test("base58btc parity: worker decodes what scripts encode, across widths", () => {
  for (const bytes of [new Uint8Array(0), new Uint8Array([0, 0, 5]), new Uint8Array(randomBytes(64)), new Uint8Array(randomBytes(33))]) {
    assert.deepEqual(workerB58Decode(base58btcEncode(bytes)), bytes);
  }
});

test("program identity constants and the clock skew: the worker's self-contained copies equal the scripts side's", () => {
  assert.equal(WORKER_CLOCK_SKEW_MS, CLOCK_SKEW_MS);
  assert.equal(WORKER_ISSUER_DID, ISSUER_DID);
  assert.equal(WORKER_CREDENTIALS_BASE, CREDENTIALS_BASE);
  assert.deepEqual(WORKER_STATUS_LIST_URLS, STATUS_LIST_URLS);
  assert.deepEqual(WORKER_PROGRAM_CONTEXT, PROGRAM_CONTEXT);
  assert.deepEqual(PROGRAM_CONTEXT, ["https://www.w3.org/ns/credentials/v2"]);
});

// ── credential parity: scripts sign -> worker verify ────────────────────────

test("a credential signed by scripts/lib verifies under the worker's verifyEddsaJcs2022", async () => {
  const signed = signedSample();
  const workerKeyBytes = ed25519KeyFromMultibase(encodePublicKeyMultibase(issuer.public));
  const result = await verifyEddsaJcs2022(signed, workerKeyBytes);
  assert.equal(result.ok, true, result.reason);
  // And the scripts side agrees with itself (roundtrip on this exact object).
  assert.equal(verifyCredential(signed, issuer.public).ok, true);
});

test("tamper rejects on BOTH sides: subject, proofValue, wrong key", async () => {
  const signed = signedSample();
  const workerKey = ed25519KeyFromMultibase(encodePublicKeyMultibase(issuer.public));

  const promoted = structuredClone(signed);
  promoted.credentialSubject.level = "L3";
  assert.equal((await verifyEddsaJcs2022(promoted, workerKey)).ok, false);
  assert.equal(verifyCredential(promoted, issuer.public).ok, false);

  const flipped = structuredClone(signed);
  flipped.proof.proofValue = flipped.proof.proofValue.replace(/.$/, (last) => (last === "2" ? "3" : "2"));
  assert.equal((await verifyEddsaJcs2022(flipped, workerKey)).ok, false);
  assert.equal(verifyCredential(flipped, issuer.public).ok, false);

  const stranger = throwawayKey();
  assert.equal((await verifyEddsaJcs2022(signed, stranger.public)).ok, false);
  assert.equal(verifyCredential(signed, stranger.public).ok, false);
});

// ── status list parity ──────────────────────────────────────────────────────

test("a status list built by scripts/lib reads identically through the worker's bitstring reader", async () => {
  const bytes = new Uint8Array(STATUS_LIST_BYTES);
  for (const index of [0, 7, 8, 42, 131071]) setStatusBit(bytes, index, true);
  const encoded = encodeStatusList(bytes);
  const unsigned = buildStatusListCredential({ purpose: "revocation", encodedList: encoded, validFrom: "2026-01-01T00:00:00Z" });
  const signed = signCredential(unsigned, statusSigner.seed, STATUS_VM);

  // The worker verifies the list's proof, then reads bits - both must agree,
  // and the scripts-side decoder must roundtrip its own encoding.
  const workerKey = ed25519KeyFromMultibase(encodePublicKeyMultibase(statusSigner.public));
  assert.equal((await verifyEddsaJcs2022(signed, workerKey)).ok, true);
  const scriptsBytes = decodeStatusList(encoded);
  for (const index of [0, 7, 8, 42, 131071]) {
    assert.equal(await bitstringStatusAt(encoded, String(index)), true, `worker bit ${index}`);
    assert.equal(statusBitAt(scriptsBytes, index), true, `scripts bit ${index}`);
  }
  for (const index of [1, 6, 9, 43, 131070]) {
    assert.equal(await bitstringStatusAt(encoded, String(index)), false, `worker bit ${index}`);
    assert.equal(statusBitAt(scriptsBytes, index), false, `scripts bit ${index}`);
  }
});

test("a bit flipped WITHOUT re-signing rejects on both sides (the stale-proof attack)", async () => {
  const clean = new Uint8Array(STATUS_LIST_BYTES);
  const unsigned = buildStatusListCredential({ purpose: "revocation", encodedList: encodeStatusList(clean), validFrom: "2026-01-01T00:00:00Z" });
  const signed = signCredential(unsigned, statusSigner.seed, STATUS_VM);

  const dirty = new Uint8Array(STATUS_LIST_BYTES);
  setStatusBit(dirty, 3, true);
  const tampered = structuredClone(signed);
  tampered.credentialSubject.encodedList = encodeStatusList(dirty);

  const workerKey = ed25519KeyFromMultibase(encodePublicKeyMultibase(statusSigner.public));
  assert.equal((await verifyEddsaJcs2022(tampered, workerKey)).ok, false, "worker must reject the swapped bitstring");
  assert.equal(verifyCredential(tampered, statusSigner.public).ok, false, "scripts side must reject the swapped bitstring");
});

// ── THE CROSS-STACK E2E: scripts mint -> worker HTTP handler ────────────────

test("e2e: a credential and lists minted by scripts/lib/attest.mjs verify through the worker handler end to end", async () => {
  const signed = signedSample();
  const id32 = signed.id.slice(-32);
  const credentialUrl = `${CREDENTIALS_BASE}/${id32}.json`;
  const allowlist = {
    "parity-impl": { name: "Parity Fixture", claim: "L1 subset (signed-proof)", status: "verified", credentialUrl },
  };
  const issuerKeys = [{ id: "conformance-issuer-1", publicKeyMultibase: encodePublicKeyMultibase(issuer.public) }];
  const statusKeys = [{ id: "conformance-status-1", publicKeyMultibase: encodePublicKeyMultibase(statusSigner.public) }];

  const signedList = (purpose, bytes) =>
    signCredential(
      buildStatusListCredential({ purpose, encodedList: encodeStatusList(bytes), validFrom: "2026-01-01T00:00:00Z" }),
      statusSigner.seed,
      STATUS_VM,
    );
  const zero = new Uint8Array(STATUS_LIST_BYTES);
  const bit7 = new Uint8Array(STATUS_LIST_BYTES);
  setStatusBit(bit7, 7, true); // the sample credential's allocated index

  const serve = (map) => async (url) =>
    url in map
      ? new Response(JSON.stringify(map[url]), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("not found", { status: 404 });
  const handle = (map, overrides = {}) =>
    createBadgeHandler({ allowlist, issuerKeys, statusKeys, provisioned: true, fetchImpl: serve(map), ...overrides });
  const cleanMap = {
    [credentialUrl]: signed,
    [STATUS_LIST_URLS.revocation]: signedList("revocation", zero),
    [STATUS_LIST_URLS.suspension]: signedList("suspension", zero),
  };
  const badge = async (map, format = "svg", overrides = {}) => {
    const response = await handle(map, overrides)(new Request(`https://builders.kya-os.org/badge/parity-impl.${format}`));
    assert.equal(response.status, 200);
    return response.text();
  };

  // Verified, with the honest subset label - through the worker's full pipeline.
  const svg = await badge(cleanMap);
  assert.ok(svg.includes("✓ L1 subset verified"), `expected the verified badge, got: ${svg.slice(0, 300)}`);
  assert.ok(svg.includes("#00c86e"));
  const shields = JSON.parse(await badge(cleanMap, "json"));
  assert.deepEqual(shields, { schemaVersion: 1, label: "KYA-OS", message: "✓ L1 subset verified", color: "00c86e" });

  // The scripts side re-signs the suspension list -> the worker renders under appeal.
  const suspended = await badge({ ...cleanMap, [STATUS_LIST_URLS.suspension]: signedList("suspension", bit7) });
  assert.ok(suspended.includes("◌ under appeal") && suspended.includes("#ffb340"), "suspension must render under appeal");

  // Revocation wins over suspension.
  const revoked = await badge({
    ...cleanMap,
    [STATUS_LIST_URLS.revocation]: signedList("revocation", bit7),
    [STATUS_LIST_URLS.suspension]: signedList("suspension", bit7),
  });
  assert.ok(revoked.includes(">revoked</text>") && revoked.includes("#6e7681"), "revocation must render the dark badge");
  assert.ok(!revoked.includes("✓"), "a revoked badge never renders the verified tier");

  // THE SIGNATURE WAVE, cross-stack: the bars the worker draws must be the
  // ones this scripts-minted signature seeds. x0 is the KYA-OS label cell
  // (72.6: pad, mark, gap, text, pad) plus one cell pad (9) - the geometry
  // the static tier asserts.
  assert.ok(svg.includes(waveRects(credentialWaveSeed(signed), 81.6, "00c86e")), "the verified badge must draw the scripts-minted signature's wave");
  // The wave rides the credential, not the state: one credential, one
  // pattern, through all three of its states.
  const bars = (body) => [...body.matchAll(/<rect ([^>]*)fill="#[0-9a-f]{6}"([^>]*)\/>/g)].map((m) => m[1] + m[2]).filter((attrs) => attrs.includes("fill-opacity"));
  assert.equal(bars(svg).length, BARS);
  assert.deepEqual(bars(suspended), bars(svg), "under appeal draws the same credential's wave");
  assert.deepEqual(bars(revoked), bars(svg), "revoked draws the same credential's wave");

  // A REISSUE redraws it: the same credential re-signed carries a fresh
  // signature, so the badge that resolves to it is visually different.
  const reissued = signedSample({ created: "2026-06-01T00:00:00Z" });
  assert.notEqual(reissued.proof.proofValue, signed.proof.proofValue, "the reissue must carry a fresh signature");
  const redrawn = await badge({ ...cleanMap, [credentialUrl]: reissued });
  assert.ok(redrawn.includes("✓ L1 subset verified"), "the reissue still verifies");
  assert.notDeepEqual(bars(redrawn), bars(svg), "a reissued credential must redraw the wave");

  // Tamper anywhere in the minted artifacts -> unverified through the handler.
  const promoted = structuredClone(signed);
  promoted.credentialSubject.level = "L3";
  const tampered = await badge({ ...cleanMap, [credentialUrl]: promoted });
  assert.ok(tampered.includes(">unverified</text>"), "a tampered scripts-minted credential must fail closed");

  // The same clean world under sentinel-era pins renders unverified everywhere.
  const sentinel = await badge(cleanMap, "svg", { provisioned: false, issuerKeys: [], statusKeys: [] });
  assert.ok(sentinel.includes(">unverified</text>"), "unprovisioned pins must fail closed even on a verifiable world");
});

// ── the committed generated-keys module, proven in its current era ──────────

test("sentinel era: the committed generated-keys module fail-closes the production handler (no fetch, no 500)", async (t) => {
  if (PROVISIONED) {
    t.skip("program keys are provisioned - the sentinel-era proof no longer applies");
    return;
  }
  assert.deepEqual(PINNED_ISSUER_KEYS, [], "sentinel era must pin zero issuer keys");
  assert.deepEqual(PINNED_STATUS_KEYS, [], "sentinel era must pin zero status keys");
  // The production handler (committed allowlist + committed pins), with a
  // fetch that refuses to be called: every committed slug must render the
  // grey unverified badge without a single network request.
  const { BADGE_ALLOWLIST } = await import("./generated-allowlist.mjs");
  const handler = createBadgeHandler({
    fetchImpl: () => {
      throw new Error("the sentinel-era worker must not fetch");
    },
  });
  for (const slug of Object.keys(BADGE_ALLOWLIST)) {
    const response = await handler(new Request(`https://builders.kya-os.org/badge/${slug}.svg`));
    assert.equal(response.status, 200, `${slug} must render, never 500`);
    const body = await response.text();
    assert.ok(body.includes(">unverified</text>"), `${slug} must render unverified in the sentinel era`);
    assert.ok(!body.includes("✓"), `${slug} must not render the verified tier in the sentinel era`);
  }
});

test("no era ever trusts a throwaway key: the pinned sets never verify this run's signatures", async () => {
  const signed = signedSample();
  for (const { id, publicKeyMultibase } of [...PINNED_ISSUER_KEYS, ...PINNED_STATUS_KEYS]) {
    const result = await verifyEddsaJcs2022(signed, ed25519KeyFromMultibase(publicKeyMultibase));
    assert.equal(result.ok, false, `pinned key ${id} must never verify a throwaway-signed credential`);
  }
});
