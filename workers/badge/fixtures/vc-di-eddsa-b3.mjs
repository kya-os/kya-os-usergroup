/**
 * The eddsa-jcs-2022 test vector of VC Data Integrity EdDSA Cryptosuites
 * v1.0 (W3C Recommendation, 15 May 2025), Appendix B.3, copied verbatim from
 * https://www.w3.org/TR/vc-di-eddsa/#representation-eddsa-jcs-2022 - so both
 * implementations are pinned to the specification's own bytes, not to each
 * other.
 *
 * The secret key is published in the specification: nothing may ever trust
 * this key pair, and nothing here is a program key.
 */

// Example 29: the key pair.
export const KEY_PAIR = {
  publicKeyMultibase: "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2",
  secretKeyMultibase: "z3u2en7t5LR2WtQH5PfFqMqwVHBeXouLzo6haApm8XHqvjxq",
};

// A fresh array per use, so no two @context values alias each other.
const context = () => ["https://www.w3.org/ns/credentials/v2", "https://www.w3.org/ns/credentials/examples/v2"];

// Example 30: the credential without a proof.
export const UNSECURED_DOCUMENT = {
  "@context": context(),
  id: "urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33",
  type: ["VerifiableCredential", "AlumniCredential"],
  name: "Alumni Credential",
  description: "A minimum viable example of an Alumni Credential.",
  issuer: "https://vc.example/issuers/5678",
  validFrom: "2023-01-01T00:00:00Z",
  credentialSubject: { id: "did:example:abcdefgh", alumniOf: "The School of Examples" },
};

// The proof options a signer starts from (section 3.3.1): Example 33 before
// step 2 adds the document's @context.
export const PROOF_OPTIONS = {
  type: "DataIntegrityProof",
  cryptosuite: "eddsa-jcs-2022",
  created: "2023-02-24T23:36:38Z",
  verificationMethod: "did:key:z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2#z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2",
  proofPurpose: "assertionMethod",
};

// Example 33: the proof options document the signature covers.
export const PROOF_CONFIGURATION = { ...PROOF_OPTIONS, "@context": context() };

// Examples 31 and 34: the canonical (RFC 8785) forms.
export const CANONICAL_DOCUMENT =
  '{"@context":["https://www.w3.org/ns/credentials/v2","https://www.w3.org/ns/credentials/examples/v2"],"credentialSubject":{"alumniOf":"The School of Examples","id":"did:example:abcdefgh"},"description":"A minimum viable example of an Alumni Credential.","id":"urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33","issuer":"https://vc.example/issuers/5678","name":"Alumni Credential","type":["VerifiableCredential","AlumniCredential"],"validFrom":"2023-01-01T00:00:00Z"}';
export const CANONICAL_PROOF_CONFIGURATION =
  '{"@context":["https://www.w3.org/ns/credentials/v2","https://www.w3.org/ns/credentials/examples/v2"],"created":"2023-02-24T23:36:38Z","cryptosuite":"eddsa-jcs-2022","proofPurpose":"assertionMethod","type":"DataIntegrityProof","verificationMethod":"did:key:z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2#z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2"}';

// Example 36: hashData, the proof configuration hash (Example 35) followed
// by the document hash (Example 32).
export const HASH_DATA_HEX =
  "66ab154f5c2890a140cb8388a22a160454f80575f6eae09e5a097cabe539a1db" + "59b7cb6251b8991add1ce0bc83107e3db9dbbab5bd2c28f687db1a03abc92f19";

// Examples 37 and 38: the signature, raw and as the base58-btc proofValue.
export const SIGNATURE_HEX =
  "407cd12654b33d718ecbb99179a1506daaa849450bf3fc523cce3e1c96f8b80351da3f253d725c6f00b07c9e5448d50b3ef78012b9ab54255116d069c6dd2808";
export const PROOF_VALUE = "z2HnFSSPPBzR36zdDgK8PbEHeXbR56YF24jwMpt3R1eHXQzJDMWS93FCzpvJpwTWd3GAVFuUfjoJdcnTMuVor51aX";

// Example 39: the signed credential, its proof carrying the document's
// @context, in the specification's key order.
export const SIGNED_DOCUMENT = {
  ...UNSECURED_DOCUMENT,
  "@context": context(),
  proof: { ...PROOF_OPTIONS, "@context": context(), proofValue: PROOF_VALUE },
};
