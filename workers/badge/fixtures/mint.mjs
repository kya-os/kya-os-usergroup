/**
 * In-test fixture mint for the badge worker suite: throwaway Ed25519 keys
 * and Phase A shaped documents (KyaOsConformanceAttestation credential +
 * Bitstring status list credentials), created fresh on every test run and
 * NEVER COMMITTED - so no fixture can ever go stale against the live
 * shapes, and no fixture key can ever be mistaken for a trusted one
 * (production verification against these fails by construction).
 *
 * DELIBERATE REDUNDANCY RULE: built from the worker's OWN primitives
 * (verify.mjs) plus node:crypto for the signing half the worker deliberately
 * lacks - never from scripts/lib/*. The scripts-side issuance meeting the
 * worker end to end is parity.test.mjs's job, not this file's.
 *
 * The document shapes mirror scripts/lib/attest.mjs's builders field for
 * field; parity.test.mjs proves the real builders' output verifies under
 * the worker, so a drift here fails tests rather than hiding one.
 */
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { base64urlDecode, base64urlEncode, base58btcEncode, ed25519KeyToMultibase, eddsaJcs2022HashData, gzip } from "../verify.mjs";

export const ISSUER_DID = "did:web:builders.kya-os.org";
export const CREDENTIALS_BASE = "https://builders.kya-os.org/credentials";
export const STATUS_LIST_URLS = {
  revocation: `${CREDENTIALS_BASE}/status/revocation-1.json`,
  suspension: `${CREDENTIALS_BASE}/status/suspension-1.json`,
};
export const STATUS_LIST_BYTES = 16384; // W3C Bitstring Status List minimum

/** Mint a throwaway Ed25519 keypair; the private key never leaves the test process. */
export function throwawayKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKeyMultibase: ed25519KeyToMultibase(base64urlDecode(publicKey.export({ format: "jwk" }).x)),
  };
}

/**
 * Attach an eddsa-jcs-2022 DataIntegrityProof to `document`, signed by a
 * throwaway key under a did:web:builders.kya-os.org#<fragment> method (the
 * Phase A verification-method shape the worker resolves pinned keys by).
 */
export async function signDocument(document, key, fragment, { proofPurpose = "assertionMethod" } = {}) {
  const proofOptions = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: document.validFrom ?? "2026-01-01T00:00:00Z",
    verificationMethod: `${ISSUER_DID}#${fragment}`,
    proofPurpose,
  };
  const hashData = await eddsaJcs2022HashData(document, proofOptions);
  const signature = edSign(null, hashData, key.privateKey);
  return { ...document, proof: { ...proofOptions, proofValue: `z${base58btcEncode(new Uint8Array(signature))}` } };
}

/**
 * An unsigned Phase A conformance credential. `id32` is the 32-hex tail the
 * canonical URL and the credential id share; the worker checks that binding,
 * not the deterministic derivation (that is the scripts side's job).
 */
export function credentialDocument({ id32, subjectId, level, scope, categories, statusIndex, validFrom = "2026-01-01T00:00:00Z" }) {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: `urn:kya:conf:${id32}`,
    type: ["VerifiableCredential", "KyaOsConformanceAttestation"],
    issuer: ISSUER_DID,
    validFrom,
    credentialSchema: { id: `${CREDENTIALS_BASE}/schema/attestation-v1.json`, type: "JsonSchema" },
    credentialSubject: {
      id: subjectId,
      implementation: { name: "Fixture Implementation", version: "1.0.0", digest: { gitCommit: "a".repeat(40) } },
      level,
      scope,
      ...(categories !== undefined ? { categories } : {}),
      suite: {
        package: "@kya-os/mcp",
        packageVersion: "1.14.0",
        suiteVersion: "1.0.0",
        vectorSetHash: "sha256:81d537d4574d3f66d651a03ca41c0b18493b67ea6f3e61aba47d1bda4f3cf49b",
        vectorCount: 44,
      },
    },
    credentialStatus: ["revocation", "suspension"].map((statusPurpose) => ({
      type: "BitstringStatusListEntry",
      statusPurpose,
      statusListIndex: String(statusIndex),
      statusListCredential: STATUS_LIST_URLS[statusPurpose],
    })),
    termsOfUse: [{ type: "KyaOsConformanceTerms", statement: "Test fixture terms - not the pinned program statement." }],
  };
}

/** A 16 KiB status bitstring with the given MSB-first bit indexes set, as a multibase encodedList. */
export async function encodedListWithBits(indexes = []) {
  const bytes = new Uint8Array(STATUS_LIST_BYTES);
  for (const index of indexes) bytes[index >> 3] |= 0x80 >> (index & 7);
  return `u${base64urlEncode(await gzip(bytes))}`;
}

/** An unsigned Phase A BitstringStatusListCredential for one purpose. */
export function statusListDocument(purpose, encodedList, validFrom = "2026-01-01T00:00:00Z") {
  const id = STATUS_LIST_URLS[purpose];
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id,
    type: ["VerifiableCredential", "BitstringStatusListCredential"],
    issuer: ISSUER_DID,
    validFrom,
    credentialSubject: { id: `${id}#list`, type: "BitstringStatusList", statusPurpose: purpose, encodedList },
  };
}
