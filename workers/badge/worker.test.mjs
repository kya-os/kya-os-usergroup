/**
 * Badge worker tests: node --test workers/badge/
 *
 * Runs entirely offline against Phase A shaped fixtures minted fresh each
 * run by fixtures/mint.mjs (throwaway keys, never committed, never
 * trusted): fetch is injected as a URL->payload map, the cache is omitted,
 * and the throwaway issuer/status keys stand in for the pinned sets in the
 * generated-keys shape ({id, publicKeyMultibase}). Covers: proof verify
 * accept and reject-on-tamper, rotation-aware key resolution by the id the
 * proof NAMES, issuer/status purpose separation, status list proof
 * enforcement before any bit is read, every render state through the HTTP
 * handler (the non-credential rungs provably fetch nothing), the
 * unprovisioned fail-close, allowlist rejection, and the honesty rules
 * (KYA-OS label, subset never bare, no expired state). The badge's signature
 * wave has its own file: wave.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { base64urlEncode, bitstringStatusAt, ed25519KeyFromMultibase, gzip, MAX_INFLATED_BYTES, verifyEddsaJcs2022 } from "./verify.mjs";
import { createBadgeHandler } from "./worker.mjs";
import {
  CREDENTIALS_BASE,
  STATUS_LIST_URLS,
  credentialDocument,
  encodedListWithBits,
  signDocument,
  statusListDocument,
  throwawayKey,
} from "./fixtures/mint.mjs";

// ── minted fixtures (throwaway keys, this run only) ─────────────────────────

const issuer = throwawayKey();
const statusSigner = throwawayKey();
const ISSUER_KEYS = [{ id: "conformance-issuer-1", publicKeyMultibase: issuer.publicKeyMultibase }];
const STATUS_KEYS = [{ id: "conformance-status-1", publicKeyMultibase: statusSigner.publicKeyMultibase }];
const issuerKeyBytes = ed25519KeyFromMultibase(issuer.publicKeyMultibase);

const ID32 = "0123456789abcdef0123456789abcdef";
const CREDENTIAL_URL = `${CREDENTIALS_BASE}/${ID32}.json`;
const SUBJECT = { id32: ID32, subjectId: "https://example.com/impl", level: "L1", scope: "subset", categories: ["signed-proof"], statusIndex: 3 };

const credential = await signDocument(credentialDocument(SUBJECT), issuer, "conformance-issuer-1");
const signList = (purpose, encoded) => signDocument(statusListDocument(purpose, encoded), statusSigner, "conformance-status-1");
const allZero = await encodedListWithBits([]);
const bit3 = await encodedListWithBits([3]);
const lists = {
  revocation: { allZero: await signList("revocation", allZero), bit3Set: await signList("revocation", bit3) },
  suspension: { allZero: await signList("suspension", allZero), bit3Set: await signList("suspension", bit3) },
};
// Key-separation fixture: a revocation list validly signed by the ISSUER key
// under an issuer fragment - only the status set may vouch for a list.
const issuerSignedList = await signDocument(statusListDocument("revocation", allZero), issuer, "conformance-issuer-1");

const ALLOWLIST = {
  "fixture-impl": { name: "Fixture Implementation", claim: "L1 subset (signed-proof)", status: "verified", credentialUrl: CREDENTIAL_URL },
  "was-verified": { name: "Was Verified", claim: "L1 subset (signed-proof)", status: "revoked", credentialUrl: CREDENTIAL_URL },
  "mid-rung": { name: "Mid Rung", claim: "L3 full", status: "in-verification", credentialUrl: null },
  "self-rep": { name: "Self Reported", claim: "L1 subset (signed-proof)", status: "self-reported", credentialUrl: null },
  "just-listed": { name: "Just Listed", claim: null, status: null, credentialUrl: null },
};

/** Injected fetch: a plain URL->JSON-value map; anything else 404s. */
function fakeFetch(map) {
  return async (url) => {
    if (url in map) return new Response(JSON.stringify(map[url]), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("not found", { status: 404 });
  };
}

/** The happy-path fetch map: valid credential, signed all-zero lists. */
function happyMap(overrides = {}) {
  return {
    [CREDENTIAL_URL]: credential,
    [STATUS_LIST_URLS.revocation]: lists.revocation.allZero,
    [STATUS_LIST_URLS.suspension]: lists.suspension.allZero,
    ...overrides,
  };
}

function handlerWith(map, overrides = {}) {
  return createBadgeHandler({
    allowlist: ALLOWLIST,
    issuerKeys: ISSUER_KEYS,
    statusKeys: STATUS_KEYS,
    provisioned: true,
    fetchImpl: fakeFetch(map),
    ...overrides,
  });
}

const get = (handler, path) => handler(new Request(`https://builders.kya-os.org${path}`));

async function expectBadge(map, path, { message, color, status = 200 }, overrides = {}) {
  const response = await get(handlerWith(map, overrides), path);
  assert.equal(response.status, status);
  const body = await response.text();
  if (path.endsWith(".svg")) {
    assert.ok(body.includes(">KYA-OS</text>"), "label cell must always be KYA-OS");
    assert.ok(body.includes(message), `SVG should contain "${message}", got: ${body.slice(0, 300)}`);
    if (color) assert.ok(body.includes(`#${color}`), `SVG should use #${color}`);
  } else {
    const json = JSON.parse(body);
    assert.equal(json.label, "KYA-OS");
    assert.equal(json.message, message);
    if (color) assert.equal(json.color, color);
  }
  return body;
}

// ── proof verification ──────────────────────────────────────────────────────

test("verify accepts the minted credential against the minted issuer key", async () => {
  const result = await verifyEddsaJcs2022(credential, issuerKeyBytes);
  assert.equal(result.ok, true, result.reason);
});

test("verify rejects on tampered subject, tampered proofValue, wrong key", async () => {
  const promoted = structuredClone(credential);
  promoted.credentialSubject.level = "L3"; // promote yourself, get caught
  assert.equal((await verifyEddsaJcs2022(promoted, issuerKeyBytes)).ok, false);

  const flipped = structuredClone(credential);
  flipped.proof.proofValue = `z1${flipped.proof.proofValue.slice(2)}`;
  assert.equal((await verifyEddsaJcs2022(flipped, issuerKeyBytes)).ok, false);

  assert.equal((await verifyEddsaJcs2022(credential, new Uint8Array(32))).ok, false);
});

// ── render states through the HTTP handler ─────────────────────────────────

test("state: verified (subset claim renders categories, never a bare level)", async () => {
  const svg = await expectBadge(happyMap(), "/badge/fixture-impl.svg", { message: "✓ L1 subset (signed-proof) verified", color: "00c86e" });
  assert.ok(!/>✓ L1 verified</.test(svg), "subset must never render as a bare level");
  await expectBadge(happyMap(), "/badge/fixture-impl.json", { message: "✓ L1 subset (signed-proof) verified", color: "00c86e" });
});

test("state: revoked (and precedence over a set suspension bit)", async () => {
  const revokedMap = happyMap({ [STATUS_LIST_URLS.revocation]: lists.revocation.bit3Set });
  await expectBadge(revokedMap, "/badge/fixture-impl.svg", { message: ">revoked</text>", color: "6e7681" });
  await expectBadge(
    happyMap({ [STATUS_LIST_URLS.revocation]: lists.revocation.bit3Set, [STATUS_LIST_URLS.suspension]: lists.suspension.bit3Set }),
    "/badge/fixture-impl.json",
    { message: "revoked", color: "6e7681" },
  );
});

test("state: suspension bit renders under appeal", async () => {
  await expectBadge(happyMap({ [STATUS_LIST_URLS.suspension]: lists.suspension.bit3Set }), "/badge/fixture-impl.svg", {
    message: "◌ under appeal",
    color: "ffb340",
  });
});

test("a revoked-status entry re-verifies at request time like any other", async () => {
  await expectBadge(happyMap({ [STATUS_LIST_URLS.revocation]: lists.revocation.bit3Set }), "/badge/was-verified.svg", {
    message: ">revoked</text>",
  });
});

test("non-credential rungs render from the allowlist with NO fetch at all", async () => {
  const neverFetch = () => {
    throw new Error("the non-credential rungs must not fetch");
  };
  const handler = createBadgeHandler({ allowlist: ALLOWLIST, issuerKeys: ISSUER_KEYS, statusKeys: STATUS_KEYS, provisioned: true, fetchImpl: neverFetch });
  const cases = [
    ["/badge/just-listed.svg", "· listed", "999999"],
    ["/badge/self-rep.svg", "· L1 subset (signed-proof) self-reported", "999999"],
    ["/badge/mid-rung.svg", "◌ L3 full in verification", "ffb340"],
  ];
  for (const [path, message, color] of cases) {
    const response = await get(handler, path);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes(message) && body.includes(`#${color}`), `${path} should render "${message}", got: ${body.slice(0, 300)}`);
  }
});

test("fail-closed: fetch failures and bad proofs render unverified, never verified", async () => {
  const noCred = happyMap();
  delete noCred[CREDENTIAL_URL];
  await expectBadge(noCred, "/badge/fixture-impl.svg", { message: "unverified", color: "999999" });

  const tampered = structuredClone(credential);
  tampered.credentialSubject.scope = "full";
  await expectBadge(happyMap({ [CREDENTIAL_URL]: tampered }), "/badge/fixture-impl.svg", { message: "unverified" });

  const noList = happyMap();
  delete noList[STATUS_LIST_URLS.revocation];
  const body = await expectBadge(noList, "/badge/fixture-impl.svg", { message: "unverified" });
  assert.ok(!body.includes("✓"), "an unreadable status list must never render the verified tier");
});

// ── the unprovisioned fail-close (sentinel era, proven) ─────────────────────

test("unprovisioned keys fail-close EVERY slug to unverified - even the fetch-free rungs, never a 500", async () => {
  for (const overrides of [{ provisioned: false }, { issuerKeys: [] }, { statusKeys: [] }]) {
    for (const slug of Object.keys(ALLOWLIST)) {
      for (const format of ["svg", "json"]) {
        await expectBadge(happyMap(), `/badge/${slug}.${format}`, { message: "unverified", color: "999999" }, overrides);
      }
    }
  }
});

// ── rotation-aware, purpose-restricted key resolution ───────────────────────

test("rotation: a proof naming conformance-issuer-2 verifies against exactly that pinned key", async () => {
  const issuer2 = throwawayKey();
  const rotated = [...ISSUER_KEYS, { id: "conformance-issuer-2", publicKeyMultibase: issuer2.publicKeyMultibase }];
  const signedBy2 = await signDocument(credentialDocument(SUBJECT), issuer2, "conformance-issuer-2");
  await expectBadge(happyMap({ [CREDENTIAL_URL]: signedBy2 }), "/badge/fixture-impl.svg", { message: "✓ L1 subset (signed-proof) verified" }, { issuerKeys: rotated });
  // Resolution is by the id the proof NAMES, never try-every-key: the same
  // signature under a proof naming issuer-1 must fail.
  const misattributed = await signDocument(credentialDocument(SUBJECT), issuer2, "conformance-issuer-1");
  await expectBadge(happyMap({ [CREDENTIAL_URL]: misattributed }), "/badge/fixture-impl.svg", { message: "unverified" }, { issuerKeys: rotated });
});

test("purpose separation: an issuer-key proof cannot vouch for a status list, nor a status key for a credential", async () => {
  await expectBadge(happyMap({ [STATUS_LIST_URLS.revocation]: issuerSignedList }), "/badge/fixture-impl.svg", { message: "unverified" });
  const statusSignedCredential = await signDocument(credentialDocument(SUBJECT), statusSigner, "conformance-status-1");
  await expectBadge(happyMap({ [CREDENTIAL_URL]: statusSignedCredential }), "/badge/fixture-impl.svg", { message: "unverified" });
});

// ── status list proof enforcement ───────────────────────────────────────────

test("unsigned or tampered status lists render unverified (bits are unreadable without a valid status proof)", async () => {
  const unsigned = structuredClone(lists.revocation.allZero);
  delete unsigned.proof;
  await expectBadge(happyMap({ [STATUS_LIST_URLS.revocation]: unsigned }), "/badge/fixture-impl.svg", { message: "unverified" });

  // The stale-proof attack: swap the revoked list's bitstring for all-zero
  // without re-signing - the attack that clears a revocation.
  const cleared = structuredClone(lists.revocation.bit3Set);
  cleared.credentialSubject.encodedList = allZero;
  await expectBadge(happyMap({ [STATUS_LIST_URLS.revocation]: cleared }), "/badge/fixture-impl.svg", { message: "unverified" });
});

test("a list whose subject purpose mismatches its slot renders unverified", async () => {
  await expectBadge(happyMap({ [STATUS_LIST_URLS.suspension]: lists.revocation.allZero }), "/badge/fixture-impl.svg", { message: "unverified" });
});

test("a credential whose status entry repoints away from the canonical list URL renders unverified", async () => {
  const repointed = credentialDocument(SUBJECT);
  repointed.credentialStatus[0].statusListCredential = "https://attacker.example/list.json";
  const signed = await signDocument(repointed, issuer, "conformance-issuer-1");
  await expectBadge(happyMap({ [CREDENTIAL_URL]: signed }), "/badge/fixture-impl.svg", { message: "unverified" });
});

// ── schema + binding checks (correctly signed, policy-rejected) ─────────────
// Every fixture here carries a VALID signature, so the unverified badge can
// only come from the check under test, never from a broken proof.

test("proofPurpose other than assertionMethod renders unverified", async () => {
  const wrongPurpose = await signDocument(credentialDocument(SUBJECT), issuer, "conformance-issuer-1", { proofPurpose: "authentication" });
  assert.equal((await verifyEddsaJcs2022(wrongPurpose, issuerKeyBytes)).ok, true, "fixture must be validly signed so the purpose check is what rejects");
  await expectBadge(happyMap({ [CREDENTIAL_URL]: wrongPurpose }), "/badge/fixture-impl.svg", { message: "unverified" });
});

test("validFrom in the future beyond the 300s skew renders unverified", async () => {
  const future = await signDocument(credentialDocument({ ...SUBJECT, validFrom: "2126-01-01T00:00:00Z" }), issuer, "conformance-issuer-1");
  await expectBadge(happyMap({ [CREDENTIAL_URL]: future }), "/badge/fixture-impl.svg", { message: "unverified" });
});

test("an unexpected validUntil is a schema violation rendering unverified, never an expired state", async () => {
  const expiring = await signDocument({ ...credentialDocument(SUBJECT), validUntil: "2126-01-01T00:00:00Z" }, issuer, "conformance-issuer-1");
  const body = await expectBadge(happyMap({ [CREDENTIAL_URL]: expiring }), "/badge/fixture-impl.svg", { message: "unverified" });
  assert.ok(!body.includes("expired"), "no expired state exists - the credential design has no expiry");
});

test("binding: a credential whose id or claim disagrees with the allowlist renders unverified", async () => {
  // Right signature, wrong document: the id does not recompute from the URL.
  const foreign = await signDocument(credentialDocument({ ...SUBJECT, id32: "f".repeat(32) }), issuer, "conformance-issuer-1");
  await expectBadge(happyMap({ [CREDENTIAL_URL]: foreign }), "/badge/fixture-impl.svg", { message: "unverified" });
  // A validly signed FULL L3 credential served on a subset L1 slug.
  const inflated = await signDocument(credentialDocument({ ...SUBJECT, level: "L3", scope: "full", categories: undefined }), issuer, "conformance-issuer-1");
  const body = await expectBadge(happyMap({ [CREDENTIAL_URL]: inflated }), "/badge/fixture-impl.svg", { message: "unverified" });
  assert.ok(!body.includes("L3"), "a mismatched claim must not leak into the badge");
});

// ── inflation cap (streaming, aborts mid-decompress) ────────────────────────

test("gzip bomb: inflating past the cap throws mid-stream, normal lists still read", async () => {
  // Highly compressible bomb: 4x the cap of zeros gzips to a few tens of KiB
  // but would inflate to 64 MiB. The capped streaming reader must abort the
  // moment the running total crosses MAX_INFLATED_BYTES instead of
  // materializing the full payload and checking after the fact.
  const bomb = `u${base64urlEncode(await gzip(new Uint8Array(MAX_INFLATED_BYTES * 4)))}`;
  await assert.rejects(() => bitstringStatusAt(bomb, "3"), /inflation cap/);

  assert.equal(await bitstringStatusAt(allZero, "3"), false);
  assert.equal(await bitstringStatusAt(bit3, "3"), true);
  assert.equal(await bitstringStatusAt(bit3, "2"), false);
});

// ── routing and allowlist ───────────────────────────────────────────────────

test("allowlist rejection: unlisted slug is a 404, not an unverified badge", async () => {
  const response = await get(handlerWith(happyMap()), "/badge/not-in-registry.svg");
  assert.equal(response.status, 404);
});

test("routing: bad paths 404, non-GET 405, query strings do not change the route", async () => {
  const handler = handlerWith(happyMap());
  assert.equal((await get(handler, "/badge/fixture-impl.png")).status, 404);
  assert.equal((await get(handler, "/nope")).status, 404);
  assert.equal((await handler(new Request("https://builders.kya-os.org/badge/fixture-impl.svg", { method: "POST" }))).status, 405);
  assert.equal((await get(handler, "/badge/fixture-impl.svg?cachebust=1")).status, 200);
});

test("shields JSON carries exactly the static tier's endpoint keys", async () => {
  const response = await get(handlerWith(happyMap()), "/badge/fixture-impl.json");
  const json = await response.json();
  assert.deepEqual(Object.keys(json).sort(), ["color", "label", "message", "schemaVersion"]);
  assert.equal(json.schemaVersion, 1);
});
