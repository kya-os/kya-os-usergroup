#!/usr/bin/env node
/**
 * Regenerate the badge worker's DEV FIXTURES. NON-PRODUCTION, ON PURPOSE:
 * the Ed25519 key generated here is a throwaway minted fresh on every run,
 * exists only inside these fixture files, and is NOT one of the worker's
 * pinned issuer keys - production verification against these fixtures fails
 * by construction. The fixtures exist so `node --test workers/badge/` can
 * exercise the full verify/render pipeline offline.
 *
 * Emits (committed):
 *   dev-issuer.json        the throwaway issuer: public key only, multibase
 *   dev-credential.json    a signed eddsa-jcs-2022 conformance claim
 *                          credential for the fictional slug "fixture-impl"
 *                          (L1 subset (signed-proof) - subset on purpose so
 *                          tests can assert the no-bare-level rule)
 *   encoded-lists.json     two Bitstring status lists (gzip+multibase):
 *                          allZero (no bit set) and bit3Set (index 3 set,
 *                          the index the credential's status entries use)
 *   dev-manifest.json      a suite manifest matching the credential's pin
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

// Throwaway keypair. The private key never leaves this process.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicRaw = base64urlDecode(publicKey.export({ format: "jwk" }).x);
const issuerMultibase = ed25519KeyToMultibase(publicRaw);
const issuerDid = `did:key:${issuerMultibase}`;

const credential = {
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  type: ["VerifiableCredential", "KyaOsConformanceAttestation"],
  issuer: issuerDid,
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

const proofOptions = {
  type: "DataIntegrityProof",
  cryptosuite: "eddsa-jcs-2022",
  created: "2026-01-01T00:00:00Z",
  verificationMethod: `${issuerDid}#${issuerMultibase}`,
  proofPurpose: "assertionMethod",
};

const hashData = await eddsaJcs2022HashData(credential, proofOptions);
const signature = edSign(null, hashData, privateKey);
const signed = { ...credential, proof: { ...proofOptions, proofValue: `z${base58btcEncode(new Uint8Array(signature))}` } };

// Status list bitstrings: 16 KiB of zeros (the spec's minimum size), and the
// same with bit 3 set MSB-first (byte 0 = 0b00010000).
const zeroBits = new Uint8Array(16384);
const bit3Bits = new Uint8Array(16384);
bit3Bits[0] = 0b00010000;
const encodedLists = {
  allZero: `u${base64urlEncode(await gzip(zeroBits))}`,
  bit3Set: `u${base64urlEncode(await gzip(bit3Bits))}`,
};

const banner = { WARNING: "DEV FIXTURE - throwaway key, NON-PRODUCTION. Regenerate with generate-fixtures.mjs." };

writeFileSync(
  join(here, "dev-issuer.json"),
  JSON.stringify({ ...banner, id: issuerDid, publicKeyMultibase: issuerMultibase }, null, 2) + "\n",
);
writeFileSync(join(here, "dev-credential.json"), JSON.stringify(signed, null, 2) + "\n");
writeFileSync(join(here, "encoded-lists.json"), JSON.stringify({ ...banner, ...encodedLists }, null, 2) + "\n");
writeFileSync(join(here, "dev-manifest.json"), JSON.stringify({ ...banner, ...SUITE }, null, 2) + "\n");

console.log(`Fixtures regenerated with throwaway issuer ${issuerDid}`);
