/**
 * KYA-OS conformance badge worker (Phase B scaffold).
 *
 * NOT DEPLOYABLE until Phase A of the conformance program issues real
 * credentials and the Cloudflare project exists - see README.md. The pinned
 * issuer keys and manifest URL below are clearly marked placeholders.
 *
 * Routes (GET only):
 *   /v1/badge/<slug>.svg    flat SVG badge
 *   /v1/badge/<slug>.json   shields.io endpoint JSON
 *
 * Pipeline, fail-closed at every step (any failure renders "unverified"):
 *   1. slug must be in the generated allowlist (emitted by
 *      site/build-pages.mjs from the rendered registry entries) - else 404
 *   2. fetch the claim credential from its canonical URL
 *   3. verify its Ed25519 eddsa-jcs-2022 DataIntegrityProof (JCS of the
 *      credential minus proof, per the W3C DI cryptosuite; Workers and Node
 *      20+ both support Ed25519 in crypto.subtle) against the PINNED issuer
 *      keys - never against keys the credential brings along
 *   4. check the revocation / suspension / withdrawal Bitstring status lists,
 *      each a signed credential verified against the PINNED status keys (a
 *      key set separate from the issuer keys) before any bit is read
 *   5. compare the credential's suite pin against the signed suite manifest
 *   6. render one of six states:
 *        verified    green   proof valid, no status bit set, suite current
 *        superseded  blue    proof valid but the suite pin is no longer the
 *                            manifest's current suite
 *        contested   amber   suspension bit set
 *        withdrawn   grey    withdrawal bit set
 *        revoked     red     revocation bit set
 *        unknown     grey    no credential yet, or any verification failure
 *                            (badge text: "unverified")
 *
 * State precedence: revoked > withdrawn > contested > superseded > verified.
 * The withdrawal-purpose status list is scaffold semantics; final badge
 * semantics belong to the working group (see GOVERNANCE.md - anything that
 * changes what a listing MEANS goes there first).
 *
 * Honesty rules carried through: the label is always "KYA-OS conformance",
 * a subset claim never renders as a bare level (the allowlist ships the
 * full claim label, e.g. "L1 subset (signed-proof)"), and the word
 * "certified" appears nowhere.
 *
 * Caching: path-only cache key (query string stripped), s-maxage 300.
 */
import { verifyEddsaJcs2022, ed25519KeyFromMultibase, bitstringStatusAt } from "./verify.mjs";
import { BADGE_ALLOWLIST } from "./generated-allowlist.mjs";

// ── PLACEHOLDERS - Phase A does not exist yet ───────────────────────────────
// The conformance program's issuer keys. THESE KEYS DO NOT EXIST YET; the
// values below are syntactically valid multibase placeholders that verify
// nothing. Replace with the real pinned keys at Phase A key ceremony.
export const PINNED_ISSUER_KEYS = [
  // PLACEHOLDER: all-zero Ed25519 key. Verifies nothing by construction.
  "z6MkeTG3bFFSLYVU7VqhgZxqr6YzpaGrQtFMh1uvqGy1vDnP",
];
// The conformance program's status-list keys. THREE-KEY DESIGN, ON PURPOSE:
// K-issuer signs credentials, K-status signs status lists, so a stolen
// issuer key can never clear (or set) its own revocation bits. These MUST
// stay a separate key set from PINNED_ISSUER_KEYS at the Phase A ceremony.
export const PINNED_STATUS_KEYS = [
  // PLACEHOLDER: Ed25519 key 0x01 then 31 zero bytes. Verifies nothing by construction.
  "z6MkeXATEjyXENzBXBxgC5EHk2JE5aqd7qMGGtDpLUH1e2Sj",
];
// The signed suite manifest published per Phase A release. DOES NOT EXIST
// YET; the URL is the planned canonical location.
export const SUITE_MANIFEST_URL =
  "https://raw.githubusercontent.com/decentralized-identity/kya-os-mcp/main/conformance/SUITE-MANIFEST.json";
// ────────────────────────────────────────────────────────────────────────────

const LABEL = "KYA-OS conformance";

const STATE_STYLE = {
  verified: { color: "#3fb950" },
  superseded: { color: "#58a6ff" },
  contested: { color: "#d29922" },
  withdrawn: { color: "#6e7681" },
  revoked: { color: "#f85149" },
  unknown: { color: "#6e7681" },
};

/** Badge message per state. The claim label already encodes subset honesty. */
function stateMessage(state, claim) {
  if (state === "verified") return claim ? `${claim} verified` : "verified";
  if (state === "unknown") return "unverified";
  return claim ? `${claim} ${state}` : state;
}

// ── SVG rendering (deterministic, no font metrics service) ─────────────────

function textWidth(text) {
  // Verdana-ish 11px approximation: good enough for a flat badge.
  let width = 0;
  for (const char of text) width += /[mwMW]/.test(char) ? 10 : /[ijlt.,:;'()\[\]|!1]/.test(char) ? 4 : 7;
  return width + 10;
}

function renderSvg(state, claim) {
  const message = stateMessage(state, claim);
  const { color } = STATE_STYLE[state];
  const lw = textWidth(LABEL);
  const mw = textWidth(message);
  const w = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${LABEL}: ${message}">
  <title>${LABEL}: ${message}</title>
  <rect width="${lw}" height="20" fill="#24292f"/>
  <rect x="${lw}" width="${mw}" height="20" fill="${color}"/>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14">${LABEL}</text>
    <text x="${lw + mw / 2}" y="14">${message}</text>
  </g>
</svg>
`;
}

function renderShieldsJson(state, claim) {
  return JSON.stringify({
    schemaVersion: 1,
    label: LABEL,
    message: stateMessage(state, claim),
    color: STATE_STYLE[state].color.slice(1),
    isError: state !== "verified",
  });
}

// ── state resolution ────────────────────────────────────────────────────────

async function statusBitSet(credential, purpose, fetchImpl, statusKeys) {
  const statuses = [credential.credentialStatus ?? []].flat();
  const entry = statuses.find((status) => status?.statusPurpose === purpose);
  if (!entry) return false; // no list for this purpose = nothing asserted
  const response = await fetchImpl(entry.statusListCredential);
  if (!response.ok) throw new Error(`status list fetch ${response.status}`);
  const list = await response.json();
  // The status list is a signed credential in its own right. Verify its
  // proof against the PINNED status keys - a key set deliberately separate
  // from the issuer keys - BEFORE reading any bit, so neither the list host
  // nor a stolen issuer key can clear (or set) revocation bits.
  let listProofOk = false;
  for (const multibase of statusKeys) {
    const { ok } = await verifyEddsaJcs2022(list, ed25519KeyFromMultibase(multibase));
    if (ok) {
      listProofOk = true;
      break;
    }
  }
  if (!listProofOk) throw new Error("status list proof did not verify against any pinned status key");
  const subject = list.credentialSubject ?? {};
  if (subject.statusPurpose !== purpose) throw new Error("status list purpose mismatch");
  return bitstringStatusAt(subject.encodedList, entry.statusListIndex);
}

/**
 * Resolve the badge state for one allowlist entry. Throws on anything
 * unexpected; the caller maps every throw to "unknown" (fail-closed).
 */
export async function resolveBadgeState(slug, entry, { fetchImpl, issuerKeys, statusKeys, manifestUrl }) {
  if (!entry.credentialUrl) return "unknown"; // no credential issued yet

  const credentialResponse = await fetchImpl(entry.credentialUrl);
  if (!credentialResponse.ok) throw new Error(`credential fetch ${credentialResponse.status}`);
  const credential = await credentialResponse.json();

  // Verify against the PINNED issuer keys only.
  let proofOk = false;
  for (const multibase of issuerKeys) {
    const { ok } = await verifyEddsaJcs2022(credential, ed25519KeyFromMultibase(multibase));
    if (ok) {
      proofOk = true;
      break;
    }
  }
  if (!proofOk) throw new Error("credential proof did not verify against any pinned issuer key");

  // The credential must be about this registry slug.
  const subject = credential.credentialSubject ?? {};
  if (subject.registrySlug !== slug) throw new Error("credential subject slug mismatch");

  if (await statusBitSet(credential, "revocation", fetchImpl, statusKeys)) return "revoked";
  if (await statusBitSet(credential, "withdrawal", fetchImpl, statusKeys)) return "withdrawn";
  if (await statusBitSet(credential, "suspension", fetchImpl, statusKeys)) return "contested";

  // Suite currency: compare the credential's suite pin to the signed manifest.
  const manifestResponse = await fetchImpl(manifestUrl);
  if (!manifestResponse.ok) throw new Error(`suite manifest fetch ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  const suite = subject.suite ?? {};
  if (suite.suiteVersion !== manifest.suiteVersion || suite.vectorSetHash !== manifest.vectorSetHash) {
    return "superseded";
  }

  return "verified";
}

// ── HTTP handler ────────────────────────────────────────────────────────────

const ROUTE_RE = /^\/v1\/badge\/([a-z0-9-]{2,40})\.(svg|json)$/;

function badgeResponse(state, claim, format, maxAge = 300) {
  const body = format === "svg" ? renderSvg(state, claim) : renderShieldsJson(state, claim);
  return new Response(body, {
    headers: {
      "content-type": format === "svg" ? "image/svg+xml; charset=utf-8" : "application/json; charset=utf-8",
      "cache-control": `public, s-maxage=${maxAge}`,
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Build the fetch handler with injectable dependencies (tests inject their
 * own allowlist, keys, fetch, and cache; production uses the real ones).
 */
export function createBadgeHandler({
  allowlist = BADGE_ALLOWLIST,
  issuerKeys = PINNED_ISSUER_KEYS,
  statusKeys = PINNED_STATUS_KEYS,
  manifestUrl = SUITE_MANIFEST_URL,
  fetchImpl = fetch,
  cache = null,
} = {}) {
  return async function handle(request) {
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
    const url = new URL(request.url);
    const match = ROUTE_RE.exec(url.pathname);
    if (!match) return new Response("not found", { status: 404 });
    const [, slug, format] = match;

    const entry = allowlist[slug];
    if (!entry) return new Response("unknown badge slug", { status: 404 });

    // Path-only cache key: the query string is stripped so cache poisoning
    // via junk parameters is off the table.
    const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    let response;
    try {
      const state = await resolveBadgeState(slug, entry, { fetchImpl, issuerKeys, statusKeys, manifestUrl });
      response = badgeResponse(state, entry.claim, format);
    } catch {
      // Fail closed: any failure anywhere renders the unverified badge,
      // cached briefly so an outage cannot pin a stale answer for long.
      response = badgeResponse("unknown", entry.claim, format, 60);
    }

    if (cache) await cache.put(cacheKey, response.clone());
    return response;
  };
}

export default {
  async fetch(request, env, ctx) {
    const handler = createBadgeHandler({ cache: caches.default });
    return handler(request);
  },
};
