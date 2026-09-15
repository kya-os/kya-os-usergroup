/**
 * KYA-OS conformance badge worker (Phase B): request-time verification of
 * the Phase A credentials, on the same /badge/ paths the static tier serves.
 *
 * Routes (GET only):
 *   /badge/<slug>.svg    flat SVG badge
 *   /badge/<slug>.json   shields.io endpoint JSON
 *
 * TRUST ROOT: the pinned program public keys in generated-keys.mjs, which
 * the site build emits from registry/keys/program-keys.json. On the
 * pre-ceremony sentinel that module exports PROVISIONED false and empty key
 * arrays, and this worker fail-closes EVERY badge request to the grey
 * "unverified" rendering (never a 500, never anything green). When the
 * provisioning PR commits real publics, the next build regenerates the
 * module - the merge arms the worker with zero hand edits.
 *
 * Pipeline for a credential-backed entry (status verified/revoked in the
 * allowlist), fail-closed at every step:
 *   1. slug must be in the generated allowlist - else 404
 *   2. fetch the credential from its canonical URL
 *      (https://builders.kya-os.org/credentials/<id32>.json, carried by the
 *      allowlist from the entry's attestationUrl)
 *   3. verify its Ed25519 eddsa-jcs-2022 DataIntegrityProof against the
 *      pinned issuer key its proof NAMES (did:web fragment -> pinned id;
 *      rotation-aware, purpose-restricted: issuer proofs resolve only in
 *      PINNED_ISSUER_KEYS) - never against keys the credential brings along
 *   4. schema + binding checks: proofPurpose must be assertionMethod;
 *      validFrom must exist and not sit in the future beyond 300s skew; any
 *      validUntil is a schema violation (the credential design has no
 *      expiry - currency lives in suite supersession, per its termsOfUse);
 *      the credential id must recompute from the fetched URL's id32; the
 *      subject's claim must reproduce the allowlist's honest label (a
 *      subset never renders as a bare level)
 *   5. read the revocation and suspension bits: both Bitstring status lists
 *      (https://builders.kya-os.org/credentials/status/{purpose}-1.json,
 *      which the credential's own status entries must name) are signed
 *      credentials, each verified against the pinned STATUS key its proof
 *      names - a key set separate from the issuer keys, so a stolen issuer
 *      key can never clear its own revocation bits - before any bit is read
 *   6. render: revoked > suspended ("under appeal") > verified, each with
 *      the credential's SIGNATURE WAVE - bars seeded by the proofValue this
 *      request just verified (wave.mjs), so the badge carries a fingerprint
 *      of the signature behind it and a reissue redraws it
 *
 * Entries below the credential rungs (listed / self-reported /
 * in-verification) render straight from the allowlist with no fetch at all.
 * Every rendering is byte-identical to the static tier's dist/badge/ files
 * (site/lib/badge.mjs) for the same state - asserted by the build's render
 * checks, which compare this module's renderer against the shipped bytes.
 *
 * DELIBERATE REDUNDANCY RULE: this worker never imports scripts/ or site/
 * code (it must stay self-contained for Cloudflare bundling); the scripts
 * side implements the same cryptosuite independently. parity.test.mjs is
 * where the two implementations cross-prove, and the build's render checks
 * import THIS module's renderer read-only to assert badge-byte parity.
 *
 * Caching: path-only cache key (query string stripped), s-maxage 300;
 * failure responses cache 60s so an outage cannot pin a stale answer.
 */
import { verifyEddsaJcs2022, ed25519KeyFromMultibase, bitstringStatusAt } from "./verify.mjs";
import { WAVE_WIDTH, credentialWaveSeed, waveRects } from "./wave.mjs";
import { BADGE_ALLOWLIST } from "./generated-allowlist.mjs";
import { PINNED_ISSUER_KEYS, PINNED_STATUS_KEYS, PROVISIONED } from "./generated-keys.mjs";

// Program identity and canonical URLs, self-contained on purpose (the
// deliberate redundancy rule); parity.test.mjs asserts these equal the
// scripts side's constants so neither copy can drift alone.
export const ISSUER_DID = "did:web:builders.kya-os.org";
export const CREDENTIALS_BASE = "https://builders.kya-os.org/credentials";
export const STATUS_LIST_URLS = {
  revocation: `${CREDENTIALS_BASE}/status/revocation-1.json`,
  suspension: `${CREDENTIALS_BASE}/status/suspension-1.json`,
};
const CREDENTIAL_URL_RE = /^https:\/\/builders\.kya-os\.org\/credentials\/([0-9a-f]{32})\.json$/;

/** Allowed clock skew for validFrom: 300s, mirroring the protocol's skew rules. */
const CLOCK_SKEW_MS = 300_000;

// ── rendering: byte-identical to site/lib/badge.mjs (build-asserted) ────────

const LABEL = "KYA-OS";
const FONT = "JetBrains Mono,SFMono-Regular,Consolas,monospace";
const CELL_LABEL = "#0a0a0a";
const CELL_MESSAGE = "#1a1a1a";
const TEXT_LABEL = "#ffffff";

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (value) => value.toFixed(1).replace(/\.0$/, "");
const CELL_PAD = 9;
const cellWidth = (text) => [...text].length * 6.6 + CELL_PAD * 2;

/**
 * The KYA-OS mark, inlined so the artifact carries the brand without any
 * external fetch (a README badge loads nothing). Source
 * site/assets/img/kya-mark-white.svg (viewBox 0 0 197 227), drawn 11px tall
 * in the label cell; the label text shifts right to make room.
 */
const MARK_D = "M85.807 0.190363C96.416 -0.0168199 107.047 -0.143695 117.645 0.291926C134.724 0.998586 147.873 9.07309 157.611 22.9492C157.866 23.3103 158.094 23.6932 158.301 24.081C158.37 24.2138 158.333 24.4052 158.349 24.6708C154.784 25.5474 151.167 26.2912 147.634 27.3271C113.453 37.3199 90.5985 70.3001 93.9134 105.671C96.5803 134.157 111.264 154.573 137.136 166.877C140.249 168.359 143.437 169.107 146.89 168.141C151.873 166.749 155.252 162.844 155.773 157.744C156.256 152.995 153.626 148.203 148.967 146.195C142.991 143.619 137.386 140.516 132.653 136.006C105.097 109.773 115.35 63.6591 151.714 50.7656C156.965 48.902 162.598 48.1099 169.033 46.5868C169.819 54.4646 171.275 61.3225 171.02 68.122C170.568 80.3992 173.527 91.5764 179.483 102.101C184.227 110.478 189.018 118.83 194.023 127.054C198.023 133.625 196.466 138.699 189.209 141.435C187.313 142.152 185.364 142.748 183.504 143.55C178.638 145.653 177.172 149.722 179.753 154.365C181.05 156.692 183.089 158.934 181.352 161.617C179.981 163.731 177.9 165.39 175.897 167.504C175.983 167.632 176.497 168.312 176.932 169.033C179.179 172.768 178.51 177.055 175.052 179.653C171.078 182.634 170.143 186.501 170.313 191.293C170.488 196.356 170.499 201.652 169.235 206.492C166.308 217.707 157.627 222.769 146.996 225.234C135.984 227.79 125.502 226.303 115.786 220.65C102.122 212.703 91.3686 202.141 87.8304 186.06C86.837 181.55 86.97 176.758 86.8744 172.094C86.5609 156.39 82.7148 141.7 74.5335 128.249C65.906 114.07 54.3559 102.68 39.2152 95.9911C24.2926 89.4034 14.4545 72.7434 19.6341 52.7314C27.619 21.8764 53.9585 0.811927 85.807 0.190363ZM14.4857 111.658C15.681 111.977 17.381 112.365 19.0384 112.875C44.8254 120.828 62.208 144.065 63.058 171.053C63.637 189.577 60.3325 207.247 53.0384 224.247C52.2044 226.186 51.2644 226.685 49.3255 226.335C42.3238 225.06 35.4866 223.423 29.7279 218.897C23.5122 214.015 21.2808 207.645 22.3646 199.899C22.7046 197.482 22.8426 194.969 22.5345 192.562C22.3485 191.123 21.4025 189.534 20.3294 188.493C14.6028 182.915 14.3688 181.927 17.8431 175.6C16.2017 173.847 14.3531 172.402 13.2269 170.521C12.021 168.503 12.4833 166.467 14.3001 164.528C15.7344 163.004 16.8446 160.926 17.4183 158.902C18.4594 155.263 16.8659 152.453 13.3597 151.066C10.7353 150.03 7.97805 149.329 5.38023 148.24C0.264303 146.094 -1.36161 141.69 1.1937 136.76C5.49146 128.472 9.92764 120.254 14.4857 111.664V111.658ZM63.9505 39.4452C53.825 39.4773 45.8567 47.5041 45.8832 57.6562C45.9044 67.5746 54.0216 75.6022 64.0091 75.581C74.1028 75.5597 82.2472 67.4581 82.2474 57.4335H82.2416C82.2416 47.3769 74.14 39.4134 63.9505 39.4452ZM169.043 46.5849C169.04 46.5857 169.036 46.586 169.033 46.5868V46.5849H169.043Z";
const MARK_SCALE = "0.0485"; // 227 * 0.0485 = 11.0px tall
const MARK_W = 9.6; // 197 * 0.0485, rounded to the num() grid
const MARK_GAP = 5.4;

export function renderSvg({ message, color, wave = null }) {
  const labelTextW = [...LABEL].length * 6.6;
  const lw = CELL_PAD + MARK_W + MARK_GAP + labelTextW + CELL_PAD;
  const ww = wave === null ? 0 : CELL_PAD + WAVE_WIDTH;
  const mw = cellWidth(message) + ww;
  const bars = wave === null ? "" : `\n  ${waveRects(wave, lw + CELL_PAD, color)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(lw + mw)}" height="20" role="img" aria-label="${LABEL}: ${esc(message)}">
  <title>${LABEL}: ${esc(message)}</title>
  <rect width="${num(lw)}" height="20" fill="${CELL_LABEL}"/>\n  <path transform="translate(${num(CELL_PAD)} 4.5) scale(${MARK_SCALE})" d="${MARK_D}" fill="${TEXT_LABEL}"/>
  <rect x="${num(lw)}" width="${num(mw)}" height="20" fill="${CELL_MESSAGE}"/>${bars}
  <g font-family="${FONT}" font-size="11" text-anchor="middle">
    <text x="${num(CELL_PAD + MARK_W + MARK_GAP + labelTextW / 2)}" y="14" fill="${TEXT_LABEL}">${LABEL}</text>
    <text x="${num(lw + ww + cellWidth(message) / 2)}" y="14" fill="#${color}">${esc(message)}</text>
  </g>
</svg>
`;
}

export function renderJson({ message, color }) {
  return JSON.stringify({ schemaVersion: 1, label: LABEL, message, color }) + "\n";
}

// The badge states, in the static tier's exact grammar (site/lib/badge.mjs).
// "unverified" is the one worker-only state: the static build REFUSES on any
// verification failure, while this worker must answer the request - grey,
// claim-free, fail-closed.
// Only the states minted from a VERIFIED credential carry a wave (`wave` is
// the seed, from that credential's signature): there is nothing to
// fingerprint below the credential rungs, and nothing verified behind an
// unverified answer, so those stay the flat two-cell badge.
/**
 * The display form of an allowlist claim label: "L3 full" -> "L3",
 * "L3 subset (a, b)" -> "L3 subset". Integrity checks compare the RAW
 * claim string; only the printed message is trimmed.
 */
const claimDisplay = (claim) => claim.replace(/ \(.*\)$/, "").replace(/ full$/, "");

const UNVERIFIED = { message: "unverified", color: "999999" };
const STATE = {
  listed: () => ({ message: "· listed", color: "999999" }),
  "self-reported": (claim) => ({ message: `· ${claimDisplay(claim)} self-reported`, color: "999999" }),
  "in-verification": (claim) => ({ message: `◌ ${claimDisplay(claim)} in verification`, color: "ffb340" }),
  verified: (claim, wave) => ({ message: `✓ ${claimDisplay(claim)} verified`, color: "00c86e", wave }),
  suspended: (wave) => ({ message: "◌ under appeal", color: "ffb340", wave }),
  revoked: (wave) => ({ message: "revoked", color: "6e7681", wave }),
};

// ── pinned key resolution (rotation-aware, purpose-restricted) ──────────────

/**
 * The pinned key a proof's verificationMethod NAMES: did:web fragment ->
 * {id, publicKeyMultibase} within ONE purpose's pinned set. Rotation-aware
 * the same way as the scripts side: after a rotation both conformance-x-1
 * and conformance-x-2 sit in the set, and each document verifies against
 * exactly the key its own proof names - never try-every-key, so a proof
 * naming key 1 but signed by key 2 fails. Purpose restriction is the set
 * itself: issuer proofs resolve only in PINNED_ISSUER_KEYS, status proofs
 * only in PINNED_STATUS_KEYS. Throws on anything else - callers fail closed.
 */
function pinnedKeyBytes(document, pinnedKeys) {
  const method = document?.proof?.verificationMethod;
  const prefix = `${ISSUER_DID}#`;
  if (typeof method !== "string" || !method.startsWith(prefix)) {
    throw new Error(`proof.verificationMethod is not a ${ISSUER_DID} key`);
  }
  const fragment = method.slice(prefix.length);
  const key = pinnedKeys.find((candidate) => candidate.id === fragment);
  if (key === undefined) throw new Error(`proof names unpinned key "${fragment}"`);
  return ed25519KeyFromMultibase(key.publicKeyMultibase);
}

async function verifyAgainstPinned(document, pinnedKeys, what) {
  const { ok, reason } = await verifyEddsaJcs2022(document, pinnedKeyBytes(document, pinnedKeys));
  if (!ok) throw new Error(`${what} proof did not verify against the pinned key it names (${reason})`);
  if (document.proof.proofPurpose !== "assertionMethod") {
    throw new Error(`${what} proof purpose must be assertionMethod, got ${document.proof.proofPurpose}`);
  }
}

// ── state resolution ────────────────────────────────────────────────────────

async function fetchJson(url, fetchImpl, what) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${what} fetch ${response.status}`);
  return response.json();
}

async function statusBit(credential, purpose, fetchImpl, statusKeys) {
  // Phase A credentials carry BOTH purposes, pinned to the canonical list
  // URLs; a missing or repointed entry is malformed, never "nothing
  // asserted" - bits that cannot be read fail closed.
  const statuses = [credential.credentialStatus ?? []].flat();
  const entry = statuses.find((status) => status?.statusPurpose === purpose);
  if (!entry) throw new Error(`credential carries no ${purpose} status entry`);
  if (entry.statusListCredential !== STATUS_LIST_URLS[purpose]) {
    throw new Error(`${purpose} status entry does not name the canonical list URL`);
  }
  const list = await fetchJson(STATUS_LIST_URLS[purpose], fetchImpl, `${purpose} list`);
  // The status list is a signed credential in its own right, verified
  // against the pinned STATUS key its proof names BEFORE any bit is read,
  // so neither the list host nor a stolen issuer key can clear (or set)
  // revocation bits.
  await verifyAgainstPinned(list, statusKeys, `${purpose} list`);
  const subject = list.credentialSubject ?? {};
  if (subject.statusPurpose !== purpose) throw new Error("status list purpose mismatch");
  return bitstringStatusAt(subject.encodedList, entry.statusListIndex);
}

/**
 * Resolve the badge state for one allowlist entry. Throws on anything
 * unexpected; the caller maps every throw to "unverified" (fail-closed).
 */
export async function resolveBadgeState(entry, { fetchImpl, issuerKeys, statusKeys, provisioned }) {
  // Unprovisioned program keys fail-close EVERY badge - even the rungs that
  // need no crypto. An unprovisioned deployment is a misconfiguration (the
  // deploy workflow refuses it); nothing may look normal on top of it.
  if (!provisioned || issuerKeys.length === 0 || statusKeys.length === 0) {
    throw new Error("program keys unprovisioned - every badge fails closed to unverified");
  }

  // The non-credential rungs render straight from the committed allowlist,
  // exactly as the static tier does - no fetch, nothing to verify.
  const status = entry.status ?? null;
  if (status === null) return STATE.listed();
  if (status === "self-reported" || status === "in-verification") {
    if (typeof entry.claim !== "string") throw new Error(`allowlist entry at status ${status} carries no claim label`);
    return STATE[status](entry.claim);
  }
  if (status !== "verified" && status !== "revoked") throw new Error(`unknown allowlist status ${status}`);

  // Credential-backed rungs: request-time verification.
  const urlMatch = CREDENTIAL_URL_RE.exec(entry.credentialUrl ?? "");
  if (urlMatch === null) throw new Error("allowlist credentialUrl is not a canonical credential URL");
  const credential = await fetchJson(entry.credentialUrl, fetchImpl, "credential");
  await verifyAgainstPinned(credential, issuerKeys, "credential");

  // Schema + temporal checks, fail closed. The credential must not claim to
  // be from the future beyond clock skew, and validUntil must not exist -
  // the design deliberately has no expiry (currency lives in suite
  // supersession, recorded in termsOfUse), so an unexpected validUntil is a
  // schema violation, never an "expired" state.
  const validFrom = Date.parse(credential.validFrom);
  if (!Number.isFinite(validFrom)) throw new Error("credential validFrom is missing or malformed");
  if (validFrom > Date.now() + CLOCK_SKEW_MS) throw new Error("credential validFrom is in the future beyond clock skew");
  if (credential.validUntil !== undefined) throw new Error("unexpected validUntil: the credential design has no expiry");

  // Binding: the served document must BE the credential the allowlist names
  // (deterministic id = the URL's id32), and its subject must reproduce the
  // allowlist's honest claim label - a subset never renders as a bare level,
  // and a credential for some other claim cannot ride this slug.
  if (credential.id !== `urn:kya:conf:${urlMatch[1]}`) throw new Error("credential id does not match its canonical URL");
  const subject = credential.credentialSubject ?? {};
  let label;
  if (subject.scope === "subset") {
    if (!Array.isArray(subject.categories) || subject.categories.length === 0) {
      throw new Error("subset credential carries no categories - a subset never renders as a bare level");
    }
    label = `${subject.level} subset (${subject.categories.join(", ")})`;
  } else if (subject.scope === "full") {
    label = `${subject.level} full`;
  } else {
    throw new Error(`credential scope must be full or subset, got ${subject.scope}`);
  }
  if (label !== entry.claim) throw new Error(`credential claim "${label}" does not match the registry claim "${entry.claim}"`);

  // The wave seed, from the signature this request just verified. Throwing
  // here (a credential with no proofValue) fails closed like every other
  // step: a verified badge never renders without its fingerprint.
  const wave = credentialWaveSeed(credential);

  if (await statusBit(credential, "revocation", fetchImpl, statusKeys)) return STATE.revoked(wave);
  if (await statusBit(credential, "suspension", fetchImpl, statusKeys)) return STATE.suspended(wave);
  return STATE.verified(entry.claim, wave);
}

// ── HTTP handler ────────────────────────────────────────────────────────────

const ROUTE_RE = /^\/badge\/([a-z0-9-]{2,40})\.(svg|json)$/;

function badgeResponse(state, format, maxAge = 300) {
  const body = format === "svg" ? renderSvg(state) : renderJson(state);
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
 * own allowlist, keys, fetch, and cache; production uses the generated
 * modules and the real fetch/cache).
 */
export function createBadgeHandler({
  allowlist = BADGE_ALLOWLIST,
  issuerKeys = PINNED_ISSUER_KEYS,
  statusKeys = PINNED_STATUS_KEYS,
  provisioned = PROVISIONED,
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
      const state = await resolveBadgeState(entry, { fetchImpl, issuerKeys, statusKeys, provisioned });
      response = badgeResponse(state, format);
    } catch {
      // Fail closed: any failure anywhere renders the unverified badge,
      // cached briefly so an outage cannot pin a stale answer for long.
      response = badgeResponse(UNVERIFIED, format, 60);
    }

    if (cache) await cache.put(cacheKey, response.clone());
    return response;
  };
}

export default {
  async fetch(request) {
    const handler = createBadgeHandler({ cache: caches.default });
    return handler(request);
  },
};
