/**
 * The program's documents, signed in-test by the scripts side's own signer
 * (scripts/lib/attest.mjs) under throwaway keys made fresh on every run and
 * never committed: the conformance credential, its status lists, and the
 * badge that shows the credential. For the scripts side's tests, and for the
 * tests in workers/badge that hold both full verifiers to one verdict
 * (workers/badge/fixtures/full-verifiers.mjs). The badge worker's own
 * fixtures are workers/badge/fixtures/mint.mjs, built from its own
 * primitives.
 */
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import {
  CREDENTIALS_BASE,
  ISSUER_DID,
  STATUS_LIST_BYTES,
  buildCredential,
  buildStatusListCredential,
  encodeStatusList,
  signCredential,
  signingInput,
} from "../../lib/attest.mjs";
import { base58btcEncode, encodePublicKeyMultibase, privateKeyObject, publicRawFromSeed } from "../../lib/keys.mjs";
import { credentialVerdict } from "../../lib/verdict.mjs";

/** When these documents are issued, in the form the program writes it; their proofs are created then too, as the program signs. */
export const VALID_FROM = "2026-01-01T00:00:00Z";

const throwawaySeed = () => new Uint8Array(Buffer.from(generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }).d, "base64url"));
const SEEDS = { issuer: throwawaySeed(), status: throwawaySeed() };
const METHODS = { issuer: `${ISSUER_DID}#conformance-issuer-1`, status: `${ISSUER_DID}#conformance-status-1` };
const SEED_FOR_METHOD = { [METHODS.issuer]: SEEDS.issuer, [METHODS.status]: SEEDS.status };

/** The throwaway keys, as a program key file lists them (scripts/verify-credential.mjs --keys). */
export const PROGRAM_KEYS = Object.entries(SEEDS).map(([purpose, seed]) => ({
  id: `conformance-${purpose}-1`,
  purpose,
  publicKeyMultibase: encodePublicKeyMultibase(publicRawFromSeed(seed)),
  createdAt: "2026-01-01",
}));

/** The publicKeyMultibase of the throwaway key whose method `document`'s proof names. */
export const signerKey = (document) => PROGRAM_KEYS.find((key) => document.proof.verificationMethod === `${ISSUER_DID}#${key.id}`).publicKeyMultibase;

// The options of the two builders below, over their defaults: a validFrom
// given as undefined is left out of the document, and a created left
// undefined is the document's validFrom, as the program signs.
const withDefaults = (options) => ({ validFrom: VALID_FROM, ...options });

const unsignedCredential = (validFrom) =>
  buildCredential({
    subjectId: "https://example.com/impl",
    implementation: { name: "Fixture", version: "1.2.3", digest: { gitCommit: "a".repeat(40) } },
    level: "L1",
    scope: "subset",
    categories: ["signed-proof"],
    packageVersion: "1.14.0",
    statusIndex: 3,
    validFrom,
  });

/** The program's credential, signed by the throwaway issuer key. */
export function signedCredential(options = {}) {
  const { validFrom, created } = withDefaults(options);
  return signCredential(unsignedCredential(validFrom), SEEDS.issuer, METHODS.issuer, { created });
}

/** One purpose's status list, every bit clear, signed by the throwaway status key. */
export function signedList(purpose, options = {}) {
  const { validFrom, created } = withDefaults(options);
  const list = buildStatusListCredential({ purpose, encodedList: encodeStatusList(new Uint8Array(STATUS_LIST_BYTES)), validFrom });
  return signCredential(list, SEEDS.status, METHODS.status, { created });
}

/**
 * The documents a reader of signedCredential() meets: the credential and
 * both status lists, as the program signs them, with `changes` (credential,
 * revocation or suspension -> document) in their place.
 */
export const signedWorld = (changes = {}) => ({
  credential: signedCredential(),
  revocation: signedList("revocation"),
  suspension: signedList("suspension"),
  ...changes,
});

/**
 * The public verifier's verdict on `world` at `now`, in milliseconds since
 * the epoch, through the function scripts/verify-credential.mjs calls
 * (scripts/lib/verdict.mjs): `programKeys` as readProgramKeys reads a key
 * file, the throwaway keys' unless given, and each status list as `world`
 * holds it for the purpose its credentialStatus entry names.
 */
export const verdictOnWorld = (world, { now, programKeys = { provisioned: true, keys: PROGRAM_KEYS, errors: [] } }) =>
  credentialVerdict({
    loadCredential: async () => world.credential,
    programKeys,
    loadStatusList: async (entry) => world[entry.statusPurpose],
    now,
  });

/** The badge that shows signedCredential(): its slug, and its allowlist entry as the build generates one. */
export const BADGE = {
  slug: "fixture-impl",
  entry: {
    name: "Fixture",
    claim: "L1 subset (signed-proof)",
    status: "verified",
    credentialUrl: `${CREDENTIALS_BASE}/${unsignedCredential(VALID_FROM).id.split(":").at(-1)}.json`,
  },
};

/**
 * `document` signed again, by the throwaway key its proof names, once
 * `change(configuration, unsecured)` has changed copies of its proof
 * configuration (the proof without its proofValue) and of the document
 * without its proof: a proof whose signature verifies, whatever the two
 * then hold or lack.
 */
export function resigned(document, change) {
  const unsecured = structuredClone(document);
  delete unsecured.proof;
  const configuration = structuredClone(document.proof);
  delete configuration.proofValue;
  change(configuration, unsecured);
  const signature = edSign(null, signingInput(unsecured, configuration), privateKeyObject(SEED_FOR_METHOD[document.proof.verificationMethod]));
  return { ...unsecured, proof: { ...configuration, proofValue: `z${base58btcEncode(new Uint8Array(signature))}` } };
}

/**
 * The form a verifier must refuse: the same signature, the proof without the
 * @context it was signed over. The badge worker's own fixtures,
 * workers/badge/fixtures/mint.mjs, keep a copy of their own, since they
 * import nothing from this side.
 */
export function withoutProofContext(document) {
  const copy = structuredClone(document);
  delete copy.proof["@context"];
  return copy;
}
