/**
 * The badge's signature wave, through the worker's HTTP handler:
 * node --test workers/badge/*.test.mjs
 *
 * The bars are seeded by the credential's proof.proofValue - the signature
 * the request just verified - so they are a fingerprint of that signature.
 * Every assertion here reads the EMITTED rect geometry, never the seed: a
 * badge that draws the wrong bars is the failure, whatever the seed says.
 *
 * Offline, like the rest of the suite: fixtures are minted fresh per run by
 * fixtures/mint.mjs with throwaway keys, and fetch is an injected map.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createBadgeHandler } from "./worker.mjs";
import { BARS, credentialWaveSeed } from "./wave.mjs";
import { CREDENTIALS_BASE, STATUS_LIST_URLS, credentialDocument, encodedListWithBits, signDocument, statusListDocument, throwawayKey } from "./fixtures/mint.mjs";

const issuer = throwawayKey();
const statusSigner = throwawayKey();
const ISSUER_KEYS = [{ id: "conformance-issuer-1", publicKeyMultibase: issuer.publicKeyMultibase }];
const STATUS_KEYS = [{ id: "conformance-status-1", publicKeyMultibase: statusSigner.publicKeyMultibase }];

const ID32 = "0123456789abcdef0123456789abcdef";
const CREDENTIAL_URL = `${CREDENTIALS_BASE}/${ID32}.json`;
const SUBJECT = { id32: ID32, subjectId: "https://example.com/impl", level: "L1", scope: "subset", categories: ["signed-proof"], statusIndex: 3 };

const credential = await signDocument(credentialDocument(SUBJECT), issuer, "conformance-issuer-1");
// The reissue: the same claim signed again over a different validFrom, so it
// carries a fresh signature - exactly what a reissued credential is.
const reissued = await signDocument(credentialDocument({ ...SUBJECT, validFrom: "2026-02-02T00:00:00Z" }), issuer, "conformance-issuer-1");
const signList = (purpose, encoded) => signDocument(statusListDocument(purpose, encoded), statusSigner, "conformance-status-1");
const allZero = await encodedListWithBits([]);
const bit3 = await encodedListWithBits([3]);
const lists = {
  revocation: { allZero: await signList("revocation", allZero), bit3Set: await signList("revocation", bit3) },
  suspension: { allZero: await signList("suspension", allZero), bit3Set: await signList("suspension", bit3) },
};

const ALLOWLIST = {
  "fixture-impl": { name: "Fixture Implementation", claim: "L1 subset (signed-proof)", status: "verified", credentialUrl: CREDENTIAL_URL },
  "mid-rung": { name: "Mid Rung", claim: "L3 full", status: "in-verification", credentialUrl: null },
  "self-rep": { name: "Self Reported", claim: "L1 subset (signed-proof)", status: "self-reported", credentialUrl: null },
  "just-listed": { name: "Just Listed", claim: null, status: null, credentialUrl: null },
};

const happyMap = (overrides = {}) => ({
  [CREDENTIAL_URL]: credential,
  [STATUS_LIST_URLS.revocation]: lists.revocation.allZero,
  [STATUS_LIST_URLS.suspension]: lists.suspension.allZero,
  ...overrides,
});

function badge(map, slug = "fixture-impl", overrides = {}) {
  const handler = createBadgeHandler({
    allowlist: ALLOWLIST,
    issuerKeys: ISSUER_KEYS,
    statusKeys: STATUS_KEYS,
    provisioned: true,
    fetchImpl: async (url) =>
      url in map ? new Response(JSON.stringify(map[url]), { status: 200, headers: { "content-type": "application/json" } }) : new Response("nope", { status: 404 }),
    ...overrides,
  });
  return handler(new Request(`https://builders.kya-os.org/badge/${slug}.svg`)).then((response) => response.text());
}

/** The wave bars in a badge SVG: the rects that carry a fill-opacity. */
const waveBars = (svg) => [...svg.matchAll(/<rect [^>]*fill-opacity="[^"]*"\/>/g)].map((m) => m[0]);

test("the credential-backed states carry the wave, in the state tier's color", async () => {
  const verified = await badge(happyMap());
  assert.ok(verified.includes("✓ L1 subset (signed-proof) verified"), verified.slice(0, 200));
  assert.equal(waveBars(verified).length, BARS, "a verified badge carries the credential's signature wave");
  assert.ok(waveBars(verified).every((bar) => bar.includes('fill="#00c86e"')), "the bars take the state tier's color");

  const suspended = await badge(happyMap({ [STATUS_LIST_URLS.suspension]: lists.suspension.bit3Set }));
  assert.ok(suspended.includes("◌ under appeal"));
  assert.equal(waveBars(suspended).length, BARS, "under appeal is minted from a verified credential and keeps its wave");
  assert.ok(waveBars(suspended).every((bar) => bar.includes('fill="#ffb340"')));

  const revoked = await badge(happyMap({ [STATUS_LIST_URLS.revocation]: lists.revocation.bit3Set }));
  assert.ok(revoked.includes(">revoked</text>"));
  assert.equal(waveBars(revoked).length, BARS, "revoked still fingerprints the credential it revokes");

  // One credential, one pattern: the wave rides the signature, not the state.
  const geometry = (svg) => waveBars(svg).map((bar) => bar.replace(/fill="#[0-9a-f]{6}"/, ""));
  assert.deepEqual(geometry(suspended), geometry(verified));
  assert.deepEqual(geometry(revoked), geometry(verified));
});

test("the rungs below the credential boundary, and the fail-closed badge, stay flat", async () => {
  for (const slug of ["just-listed", "self-rep", "mid-rung"]) {
    assert.equal(waveBars(await badge(happyMap(), slug)).length, 0, `${slug} has no signature to fingerprint`);
  }
  const unverified = await badge(happyMap(), "fixture-impl", { provisioned: false });
  assert.ok(unverified.includes("unverified"));
  assert.equal(waveBars(unverified).length, 0, "the fail-closed badge draws no wave");

  const noCredential = happyMap();
  delete noCredential[CREDENTIAL_URL];
  assert.equal(waveBars(await badge(noCredential)).length, 0, "an unfetchable credential draws no wave");
});

test("same credential, same bars; a reissued credential redraws them", async () => {
  const first = await badge(happyMap());
  assert.equal(await badge(happyMap()), first, "the same credential must draw the same wave on every request");

  // Same claim, same message, same color - so any difference in the emitted
  // bars is the signature and nothing else.
  assert.notEqual(reissued.proof.proofValue, credential.proof.proofValue, "the fixture reissue must carry a fresh signature");
  const redrawn = await badge(happyMap({ [CREDENTIAL_URL]: reissued }));
  assert.ok(redrawn.includes("✓ L1 subset (signed-proof) verified"), "the reissue still verifies");
  assert.equal(waveBars(redrawn).length, BARS);
  assert.notDeepEqual(waveBars(redrawn), waveBars(first), "a reissued credential must redraw the wave");
});

test("a credential with no proofValue fails closed rather than drawing a blank wave", () => {
  for (const empty of [{}, { proof: {} }, { proof: { proofValue: "" } }]) {
    assert.throws(() => credentialWaveSeed(empty), /signature/);
  }
  assert.equal(credentialWaveSeed(credential), credentialWaveSeed(structuredClone(credential)), "the seed is a pure function of the proofValue");
});
