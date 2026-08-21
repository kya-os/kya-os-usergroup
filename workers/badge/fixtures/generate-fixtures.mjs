#!/usr/bin/env node
/**
 * Regenerate the badge worker's DEV FIXTURES. NON-PRODUCTION, ON PURPOSE:
 * the Ed25519 keys generated here are throwaways minted fresh on every run,
 * exist only inside these fixture files, and are NOT the worker's pinned
 * keys - production verification against these fixtures fails by
 * construction. The fixtures exist so `node --test workers/badge/` can
 * exercise the full verify/render pipeline offline.
 *
 * Two throwaway keys, mirroring the program's key separation: the ISSUER key
 * signs the claim credential, a distinct STATUS key signs the status list
 * credentials, so tests can prove a list signed by the issuer key alone is
 * rejected (a stolen issuer key must not clear its own revocation bits).
 *
 * Emits (committed):
 *   dev-issuer.json         the throwaway issuer: public key only, multibase
 *   dev-status-issuer.json  the throwaway status signer: public key only
 *   dev-credential.json     a signed eddsa-jcs-2022 conformance claim
 *                           credential for the fictional slug "fixture-impl"
 *                           (L1 subset (signed-proof) - subset on purpose so
 *                           tests can assert the no-bare-level rule)
 *   dev-credentials-invalid.json
 *                           correctly signed credentials that must fail the
 *                           worker's schema/temporal checks: wrong
 *                           proofPurpose, future validFrom, unexpected
 *                           validUntil
 *   dev-status-lists.json   signed Bitstring status list credentials, per
 *                           purpose (revocation/suspension/withdrawal), each
 *                           in two variants: allZero (no bit set) and bit3Set
 *                           (index 3 set, the index the claim credential's
 *                           status entries use) - plus issuerSigned, a
 *                           revocation/allZero list signed by the ISSUER key
 *                           so tests can prove key separation
 *   dev-manifest.json       a suite manifest matching the credential's pin
 *
 * Run: node workers/badge/fixtures/generate-fixtures.mjs
 */
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  base64urlDecode,
  base64urlEncode,
  base58btcEncode,
  ed25519KeyToMultibase,
  eddsaJcs2022HashData,
  gzip,
} from "../verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const SUITE = {
  suiteVersion: "1.0.0",
  vectorSetHash: "sha256:81d537d4574d3f66d651a03ca41c0b18493b67ea6f3e61aba47d1bda4f3cf49b",
};

/** Mint a throwaway Ed25519 keypair; the private key never leaves this process. */
function throwawayKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const multibase = ed25519KeyToMultibase(base64urlDecode(publicKey.export({ format: "jwk" }).x));
  return { privateKey, multibase, did: `did:key:${multibase}` };
}

const issuer = throwawayKey();
const statusIssuer = throwawayKey();

/** Attach an eddsa-jcs-2022 DataIntegrityProof signed by `key` to `document`. */
async function signDocument(document, key, proofPurpose = "assertionMethod") {
  const proofOptions = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: "2026-01-01T00:00:00Z",
    verificationMethod: `${key.did}#${key.multibase}`,
    proofPurpose,
  };
  const hashData = await eddsaJcs2022HashData(document, proofOptions);
  const signature = edSign(null, hashData, key.privateKey);
  return { ...document, proof: { ...proofOptions, proofValue: `z${base58btcEncode(new Uint8Array(signature))}` } };
}

const credential = {
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  type: ["VerifiableCredential", "KyaOsConformanceAttestation"],
  issuer: issuer.did,
  validFrom: "2026-01-01T00:00:00Z",
  credentialSubject: {
    registrySlug: "fixture-impl",
    implementation: { name: "Fixture Implementation", repo: "https://example.invalid/fixture-impl" },
    level: "L1",
    scope: "subset",
    categories: ["signed-proof"],
    suite: SUITE,
  },
  credentialStatus: [
    {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "3",
      statusListCredential: "https://fixtures.invalid/status-revocation.json",
    },
    {
      type: "BitstringStatusListEntry",
      statusPurpose: "suspension",
      statusListIndex: "3",
      statusListCredential: "https://fixtures.invalid/status-suspension.json",
    },
    {
      type: "BitstringStatusListEntry",
      statusPurpose: "withdrawal",
      statusListIndex: "3",
      statusListCredential: "https://fixtures.invalid/status-withdrawal.json",
    },
  ],
};

const signed = await signDocument(credential, issuer);

// Correctly SIGNED credentials that must still fail the worker's schema and
// temporal checks - signatures verify, policy rejects, so the tests prove
// the checks themselves rather than a broken signature:
//   wrongPurpose    proof.proofPurpose is not assertionMethod
//   futureValidFrom validFrom a century in the future (beyond any skew)
//   withValidUntil  carries validUntil, which the credential design forbids
//                   (no expiry; freshness lives in suite supersession)
const invalidCredentials = {
  wrongPurpose: await signDocument(credential, issuer, "authentication"),
  futureValidFrom: await signDocument({ ...credential, validFrom: "2126-01-01T00:00:00Z" }, issuer),
  withValidUntil: await signDocument({ ...credential, validUntil: "2126-01-01T00:00:00Z" }, issuer),
};

// Status list bitstrings: 16 KiB of zeros (the spec's minimum size), and the
// same with bit 3 set MSB-first (byte 0 = 0b00010000).
const zeroBits = new Uint8Array(16384);
const bit3Bits = new Uint8Array(16384);
bit3Bits[0] = 0b00010000;
const encoded = {
  allZero: `u${base64urlEncode(await gzip(zeroBits))}`,
  bit3Set: `u${base64urlEncode(await gzip(bit3Bits))}`,
};

/** A W3C Bitstring Status List credential, unsigned. */
function statusListDocument(purpose, encodedList) {
  const id = `https://fixtures.invalid/status-${purpose}.json`;
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id,
    type: ["VerifiableCredential", "BitstringStatusListCredential"],
    issuer: statusIssuer.did,
    validFrom: "2026-01-01T00:00:00Z",
    credentialSubject: { id: `${id}#list`, type: "BitstringStatusList", statusPurpose: purpose, encodedList },
  };
}

const lists = {};
for (const purpose of ["revocation", "suspension", "withdrawal"]) {
  lists[purpose] = {
    allZero: await signDocument(statusListDocument(purpose, encoded.allZero), statusIssuer),
    bit3Set: await signDocument(statusListDocument(purpose, encoded.bit3Set), statusIssuer),
  };
}
// Key-separation fixture: a revocation list validly signed by the ISSUER key.
// The worker must reject it - only the status keys may vouch for a list.
const issuerSigned = await signDocument(statusListDocument("revocation", encoded.allZero), issuer);

const banner = { WARNING: "DEV FIXTURE - throwaway key, NON-PRODUCTION. Regenerate with generate-fixtures.mjs." };

writeFileSync(
  join(here, "dev-issuer.json"),
  JSON.stringify({ ...banner, id: issuer.did, publicKeyMultibase: issuer.multibase }, null, 2) + "\n",
);
writeFileSync(
  join(here, "dev-status-issuer.json"),
  JSON.stringify({ ...banner, id: statusIssuer.did, publicKeyMultibase: statusIssuer.multibase }, null, 2) + "\n",
);
writeFileSync(join(here, "dev-credential.json"), JSON.stringify(signed, null, 2) + "\n");
writeFileSync(
  join(here, "dev-credentials-invalid.json"),
  JSON.stringify({ ...banner, ...invalidCredentials }, null, 2) + "\n",
);
writeFileSync(join(here, "dev-status-lists.json"), JSON.stringify({ ...banner, lists, issuerSigned }, null, 2) + "\n");
writeFileSync(join(here, "dev-manifest.json"), JSON.stringify({ ...banner, ...SUITE }, null, 2) + "\n");

console.log(`Fixtures regenerated with throwaway issuer ${issuer.did} and status signer ${statusIssuer.did}`);
