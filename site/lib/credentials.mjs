/**
 * The site build as cryptographic verifier - the Phase A flagship. Every
 * committed credential in registry/credentials/ is verified HERE, on every
 * build, against the committed program public keys:
 *
 *   - both status lists' eddsa-jcs-2022 proofs verify against a committed
 *     STATUS key (the key set separate from the issuer keys, so a stolen
 *     issuer key can never clear its own revocation bits), and their
 *     bitstrings decode to exactly the pinned list size
 *   - each credential's proof verifies against the committed ISSUER key its
 *     verificationMethod names, its shape already passed the schema-lite
 *     check (scripts/validate-credentials.mjs), and its status bits are
 *     readable
 *   - the credential state (verified / suspended / revoked, revocation
 *     winning) must agree with the registry entry that links it: a verified
 *     entry may sit on no revocation bit, a revoked entry must, and a
 *     credential no entry links must be revoked (a retired record) - any
 *     other combination refuses the build naming the credential
 *
 * ANY failure is a build refusal. Only after this passes may a chip or badge
 * render green, which is what makes the static "verified" tier honest: it is
 * backed by build-time cryptographic verification of in-repo state, and the
 * Phase B worker upgrades the same URLs to request-time verification.
 *
 * Also renders /.well-known/did.json for did:web:builders.kya-os.org from
 * the committed public keys - never emitted on the unprovisioned sentinel.
 *
 * Verification runs through scripts/lib/attest.mjs (node:crypto, sync). The
 * badge worker's independent implementation never imports this code or vice
 * versa (deliberate redundancy rule - see workers/badge/verify.mjs);
 * workers/badge/parity.test.mjs proves the two agree.
 */
import { CREDENTIALS_BASE, ISSUER_DID, decodeStatusList, statusBitAt, verifyCredential } from "../../scripts/lib/attest.mjs";

/** The committed key a proof's verificationMethod names, bound to a purpose:
 * did:web fragment -> program-keys entry, refusing cross-purpose use. */
function keyForProof(programKeys, verificationMethod, purpose, fail, label) {
  const prefix = `${ISSUER_DID}#`;
  if (typeof verificationMethod !== "string" || !verificationMethod.startsWith(prefix)) {
    fail(`${label}: proof.verificationMethod is not a ${ISSUER_DID} key`);
    return null;
  }
  const fragment = verificationMethod.slice(prefix.length);
  const key = programKeys.keys.find((candidate) => candidate.id === fragment);
  if (key === undefined) {
    fail(`${label}: proof.verificationMethod names unknown key "${fragment}" (not in registry/keys/program-keys.json)`);
    return null;
  }
  if (key.purpose !== purpose) {
    fail(`${label}: key "${fragment}" has purpose "${key.purpose}", not "${purpose}" - cross-purpose proofs are refused`);
    return null;
  }
  return key;
}

/**
 * Cryptographically verify every committed credential artifact. Returns the
 * per-slug verdicts the renderers consume and every failure as a named
 * error; the build must refuse on any error.
 * @returns {{ verdicts: Map<string, {state: string, attestationUrl: string}>, errors: string[] }}
 */
export function verifyCredentialArtifacts({ programKeys, credentials, statusLists, allocations, entries }) {
  const errors = [];
  const fail = (message) => errors.push(message);
  const verdicts = new Map();
  // Unprovisioned sentinel: validate-credentials.mjs already refuses any
  // credential, list, allocation, or verified/revoked entry, so there is
  // nothing to verify and nothing may render green.
  if (!programKeys.provisioned) return { verdicts, errors };

  // ── status lists first: bits are only readable off a verified list ────────
  const bits = {};
  for (const purpose of ["revocation", "suspension"]) {
    const record = statusLists[purpose];
    if (record === null) {
      if (credentials.length > 0) fail(`registry/credentials/status/${purpose}-1.json: missing - status bits are unreadable (fail closed)`);
      continue;
    }
    const key = keyForProof(programKeys, record.list.proof?.verificationMethod, "status", fail, record.rel);
    if (key === null) continue;
    const { ok, reason } = verifyCredential(record.list, key.publicKeyMultibase);
    if (!ok) {
      fail(`${record.rel}: status list proof did not verify against ${key.id} (${reason}) - bits cannot be trusted`);
      continue;
    }
    try {
      bits[purpose] = decodeStatusList(record.list.credentialSubject.encodedList);
    } catch (err) {
      fail(`${record.rel}: ${err.message}`);
    }
  }

  // ── each credential: proof, bits, and entry agreement ─────────────────────
  const entryByUrl = new Map();
  for (const entry of entries) {
    const url = entry.conformance?.attestationUrl;
    if (typeof url === "string") entryByUrl.set(url, entry);
  }
  for (const { id32, rel, credential } of credentials) {
    const key = keyForProof(programKeys, credential.proof?.verificationMethod, "issuer", fail, rel);
    if (key === null) continue;
    const { ok, reason } = verifyCredential(credential, key.publicKeyMultibase);
    if (!ok) {
      fail(`${rel}: credential proof did not verify against ${key.id} (${reason})`);
      continue;
    }
    if (bits.revocation === undefined || bits.suspension === undefined) continue; // already failed above
    const index = Number(credential.credentialStatus[0].statusListIndex);
    let revoked;
    let suspended;
    try {
      revoked = statusBitAt(bits.revocation, index);
      suspended = statusBitAt(bits.suspension, index);
    } catch (err) {
      fail(`${rel}: ${err.message}`);
      continue;
    }
    const state = revoked ? "revoked" : suspended ? "suspended" : "verified";

    const attestationUrl = `${CREDENTIALS_BASE}/${id32}.json`;
    const entry = entryByUrl.get(attestationUrl);
    if (entry === undefined) {
      // A credential no entry links is only legitimate as a retired record:
      // superseded by reissue AND revoked. A live orphan is a refusal.
      if (state !== "revoked") {
        fail(`${rel}: no registry entry links this credential and its revocation bit is not set - a live orphan credential is refused`);
      }
      continue;
    }
    const entryStatus = entry.conformance.status;
    if (entryStatus === "verified" && state === "revoked") {
      fail(`${rel}: revocation bit is set but registry/builders/${entry.slug}.json still claims "verified" - the revocation PR must update the entry`);
      continue;
    }
    if (entryStatus === "revoked" && state !== "revoked") {
      fail(`${rel}: registry/builders/${entry.slug}.json claims "revoked" but the revocation bit is not set`);
      continue;
    }
    verdicts.set(entry.slug, { state, attestationUrl });
  }

  // Every verified/revoked entry must have earned a verdict (its credential
  // exists per the validator; here its proof and bits must also have passed).
  for (const entry of entries) {
    const status = entry.conformance?.status;
    if ((status === "verified" || status === "revoked") && !verdicts.has(entry.slug)) {
      fail(`registry/builders/${entry.slug}.json: status "${status}" but the linked credential failed cryptographic verification`);
    }
  }
  return { verdicts, errors };
}

/**
 * The did:web:builders.kya-os.org DID document, rendered from the committed
 * program public keys: one Multikey verification method per issuer/status
 * key (fragment = the key id), assertionMethod listing the issuer keys. The
 * reserved log keys carry no DID fragment yet. Returns null (nothing to
 * emit) on the unprovisioned sentinel - asserted by the render checks.
 */
export function renderDidJson(programKeys) {
  if (!programKeys.provisioned) return null;
  const published = programKeys.keys.filter((key) => key.purpose === "issuer" || key.purpose === "status");
  return (
    JSON.stringify(
      {
        "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
        id: ISSUER_DID,
        verificationMethod: published.map((key) => ({
          id: `${ISSUER_DID}#${key.id}`,
          type: "Multikey",
          controller: ISSUER_DID,
          publicKeyMultibase: key.publicKeyMultibase,
        })),
        assertionMethod: published.filter((key) => key.purpose === "issuer").map((key) => `${ISSUER_DID}#${key.id}`),
      },
      null,
      2,
    ) + "\n"
  );
}
