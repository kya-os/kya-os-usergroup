#!/usr/bin/env node
/**
 * Generate the /verify/ page's sample files with the vendored verifier
 * (scripts/lib/vendored-imports.mjs - the same bytes the page runs):
 *
 *   site/assets/verify-samples/bundle.json           a signed replay bundle
 *   site/assets/verify-samples/bundle.tampered.json  the same bundle with one
 *                                                    entry's outcome edited
 *   site/assets/verify-samples/policy.json           the verification policy
 *   site/assets/verify-samples/keys.json             the recorder's public key,
 *                                                    in the kya-audit key-file shape
 *
 * The ledger is a short, made-up agent session: a catalog search, an order
 * that went through, and an order the authorization layer denied. The
 * tampered copy rewrites that denial as a success without re-signing,
 * which is the edit an insider with database access would make.
 *
 * Each run signs with a fresh Ed25519 key whose private half is never
 * written anywhere, so the committed samples are the reference and a rerun
 * produces different (equally valid) bytes. The script refuses to write
 * unless the honest bundle passes every integrity dimension and the
 * tampered one fails, which is also what the tests re-check.
 *
 * Run: node scripts/generate-verify-samples.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerVendoredImports } from "./lib/vendored-imports.mjs";

registerVendoredImports();
const audit = await import("@kya-os/mcp/audit");
const { WebCryptoProvider } = await import("@kya-os/mcp/providers");
const { exportJWK, generateKeyPair } = await import("jose");

const SAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "assets", "verify-samples");
const INTEGRITY_DIMENSIONS = ["cryptographicIntegrity", "chainIntegrity", "checkpointIntegrity", "scopeEvidenceCompleteness"];

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58btc(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** did:key for an Ed25519 public JWK: multicodec 0xed01 + the raw key, base58btc. */
function didKey(publicJwk) {
  const multibase = `z${base58btc(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(publicJwk.x, "base64url")]))}`;
  return { did: `did:key:${multibase}`, kid: `did:key:${multibase}#${multibase}` };
}

const T0 = Date.UTC(2026, 9, 26, 9, 0, 0);
let tick = 0;
const clock = { now: () => T0 + 60_000 + 1_000 * (tick += 1) };

const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
const publicJwk = await exportJWK(publicKey);
const signerRef = { ...didKey(publicJwk), alg: "EdDSA" };
const hasher = new audit.CryptoProviderAuditHasher(new WebCryptoProvider());
const signer = new audit.CompactJwsAuditSigner(signerRef, privateKey);
const ledger = { ledgerId: "kya:sample:audit:primary", ledgerEpochId: "epoch_1" };

const events = [
  audit.sampleAuditEvent(1, { occurredAt: T0 + 1_000, action: { category: "tool.call", name: "catalog.search" } }),
  audit.sampleAuditEvent(2, { occurredAt: T0 + 2_000, action: { category: "tool.call", name: "orders.create" } }),
  audit.sampleAuditEvent(3, {
    occurredAt: T0 + 3_000,
    eventType: "authorization.denied",
    action: { category: "authorization", name: "orders.create" },
    outcome: "denied",
    details: { family: "authorization", phase: "denied" },
  }),
];
const { tenantRef, binding } = events[0];
const journal = new audit.MemoryAuditJournal();
const recorder = new audit.AuditRecorderService({
  ...ledger, tenantRef, binding, sourceId: events[0].source.sourceId, journal, signer, hasher, clock,
});
for (const producerEvent of events) {
  await recorder.submitAuthenticated(
    { ledgerId: ledger.ledgerId, producerEvent, encryptedEvidence: [] },
    { producerAuthority: producerEvent.source.producer.did, tenantAuthority: "reference-tenant", tenantRef },
  );
}

const checkpoints = new audit.AuditCheckpointBuilder({ journal, store: new audit.MemoryAuditCheckpointStore(), signer, hasher, clock });
const checkpoint = await checkpoints.createCheckpoint(ledger);
const entries = await journal.snapshot(ledger);
const covered = entries.filter((entry) => BigInt(entry.core.sequence) < BigInt(checkpoint.core.treeSize));
const inclusionProofs = [];
for (const entry of covered) {
  inclusionProofs.push({
    ...ledger,
    sequence: entry.core.sequence,
    entryDigest: entry.entryDigest,
    checkpointDigest: checkpoint.checkpointDigest,
    proof: await checkpoints.inclusionProof(ledger, entry.core.sequence, checkpoint),
  });
}

const policy = {
  policyId: "urn:kya-os:builders:verify:sample-policy",
  trustedLedgerEpochs: [{ ...ledger, recorderKeys: [{ signer: signerRef }] }],
  trustedObservers: [],
  authorizedExporters: [{ signerKeys: [{ signer: signerRef }], allowedLedgerIds: [ledger.ledgerId], allowedPurposes: ["regulatory-review"] }],
  acceptedIntegritySuites: ["KYA-AUDIT-JCS-SHA256-JWS-2026", "KYA-AUDIT-RFC9162-SHA256-JWS-2026", "KYA-AUDIT-BUNDLE-JCS-SHA256-JWS-2026"],
  acceptedAlgorithms: ["EdDSA"],
  keyRevocationMode: "as_observed",
};
const bundle = await new audit.AuditReplayBundleExporter({ hasher, signer, clock }).export({
  bundleId: "urn:kya-os:builders:verify:sample-bundle",
  purpose: "regulatory-review",
  verificationPolicyDigest: await audit.hashAuditValue(hasher, "org.kya-os.audit.verification-policy.v1", policy),
  selections: [{
    ...ledger,
    firstSequence: entries[0].core.sequence,
    lastSequence: entries.at(-1).core.sequence,
    expectedHeadDigest: entries.at(-1).entryDigest,
    checkpointTreeSizes: [checkpoint.core.treeSize],
  }],
  components: [
    { path: "ledger/entries.json", mediaType: audit.AUDIT_BUNDLE_MEDIA_TYPES.entries, disposition: "included", content: entries },
    { path: "ledger/checkpoints.json", mediaType: audit.AUDIT_BUNDLE_MEDIA_TYPES.checkpoints, disposition: "included", content: [checkpoint] },
    { path: "ledger/inclusion-proofs.json", mediaType: audit.AUDIT_BUNDLE_MEDIA_TYPES.inclusionProofs, disposition: "included", content: inclusionProofs },
  ],
});

// The insider edit: the denied order becomes a success; nothing is re-signed.
const tampered = structuredClone(bundle);
const tamperedEntries = tampered.components.find((component) => component.path === "ledger/entries.json").content;
const denied = tamperedEntries.find((entry) => entry.core.event.outcome === "denied");
denied.core.event.outcome = "succeeded";

const keys = { keys: [{ kid: signerRef.kid, jwk: publicJwk }] };
const verify = (candidate) =>
  audit.verifyAuditBundle(candidate, audit.parseAuditVerificationPolicy(policy), {
    hasher,
    signatures: new audit.CompactJwsAuditSignatureVerifier({ resolve: async (ref) => (ref.kid === signerRef.kid ? publicJwk : null) }),
  });
const summary = (report) => Object.fromEntries(INTEGRITY_DIMENSIONS.map((name) => [name, `${report[name].verdict} ${report[name].reasonCodes.join(",")}`.trim()]));
const honestReport = await verify(bundle);
const tamperedReport = await verify(tampered);
if (!INTEGRITY_DIMENSIONS.every((name) => honestReport[name].verdict === "valid")) {
  throw new Error(`the honest sample does not verify: ${JSON.stringify(summary(honestReport))}`);
}
if (!INTEGRITY_DIMENSIONS.some((name) => tamperedReport[name].verdict === "invalid")) {
  throw new Error(`the tampered sample was not caught: ${JSON.stringify(summary(tamperedReport))}`);
}

mkdirSync(SAMPLES_DIR, { recursive: true });
const write = (name, value) => writeFileSync(join(SAMPLES_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
write("bundle.json", bundle);
write("bundle.tampered.json", tampered);
write("policy.json", policy);
write("keys.json", keys);
console.log(`Signed by ${signerRef.kid}: ${entries.length} entries, checkpoint over ${checkpoint.core.treeSize}`);
console.log(`honest:   ${JSON.stringify(summary(honestReport))}`);
console.log(`tampered: ${JSON.stringify(summary(tamperedReport))}`);
