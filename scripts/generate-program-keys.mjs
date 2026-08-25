#!/usr/bin/env node
/**
 * One-time key ceremony for the conformance program: generates the three
 * Ed25519 program keypairs -
 *
 *   K-issuer (conformance-issuer-1)  signs attestation credentials
 *   K-status (conformance-status-1)  signs the Bitstring status lists - a
 *                                    SEPARATE key so a stolen issuer key can
 *                                    never clear its own revocation bits
 *   K-log    (conformance-log-1)     reserved for the Phase C transparency
 *                                    log; provisioned now so the custody
 *                                    ceremony never has to repeat
 *
 * - writes the PUBLIC halves to registry/keys/program-keys.json (commit
 * that file), and prints the PRIVATE halves exactly once for pasting into
 * the GitHub environment secrets. The private keys exist only in this
 * process and in your terminal scrollback: paste them, then delete the
 * scrollback and shell history. They must never touch the repo, a laptop
 * keychain, or any workflow outside the protected environment.
 *
 * Runs fully offline (node:crypto only; no network I/O of any kind).
 *
 * Refuses to overwrite a provisioned key file. Rotation (--rotate) is
 * documented below but deliberately not automated yet: rotation = generate
 * a new keypair, APPEND it to program-keys.json with a fresh id
 * (conformance-<purpose>-<n+1>) and createdAt, update the environment
 * secret, and RETAIN the old public key in the file so existing credentials
 * keep verifying until they are reissued under the new key.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePrivateKeyMultibase, encodePublicKeyMultibase, readProgramKeys } from "./lib/keys.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const keysPath = join(here, "..", "registry", "keys", "program-keys.json");

if (process.argv.includes("--rotate")) {
  console.log(
    [
      "--rotate is a documented procedure, not an automated mode (deliberately - rotation is rare",
      "and each step is a human decision):",
      "  1. Run this script's key generation for the ONE purpose being rotated (or generate with",
      "     `node -e` using scripts/lib/keys.mjs helpers).",
      "  2. APPEND the new public key to registry/keys/program-keys.json with the next id",
      "     (conformance-<purpose>-<n+1>) and today's createdAt. KEEP the old entry: committed",
      "     credentials signed by it must keep verifying until reissued.",
      "  3. Replace the matching environment secret (K_ISSUER_PRIVATE / K_STATUS_PRIVATE /",
      "     K_LOG_PRIVATE) in the conformance-issuance environment; delete terminal history.",
      "  4. Open the PR committing the public key file; new issuances sign under the new key.",
      "  5. Reissue credentials at your own pace, then retire the old public key in a later PR",
      "     once nothing verifies against it.",
    ].join("\n"),
  );
  process.exit(0);
}

const existing = readProgramKeys(keysPath);
if (existing.provisioned) {
  console.error("Refusing: registry/keys/program-keys.json already carries provisioned keys.");
  console.error("Rotation never overwrites - see `node scripts/generate-program-keys.mjs --rotate`.");
  process.exit(1);
}

const PURPOSES = [
  ["issuer", "K_ISSUER_PRIVATE"],
  ["status", "K_STATUS_PRIVATE"],
  ["log", "K_LOG_PRIVATE"],
];
const createdAt = new Date().toISOString().slice(0, 10);
const publicEntries = [];
const secretLines = [];

for (const [purpose, secretName] of PURPOSES) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = new Uint8Array(Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url"));
  const rawSeed = new Uint8Array(Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url"));
  publicEntries.push({
    id: `conformance-${purpose}-1`,
    purpose,
    publicKeyMultibase: encodePublicKeyMultibase(rawPublic),
    createdAt,
  });
  secretLines.push(`${secretName}=${encodePrivateKeyMultibase(rawSeed)}`);
}

mkdirSync(dirname(keysPath), { recursive: true });
writeFileSync(keysPath, JSON.stringify({ version: 1, keys: publicEntries }, null, 2) + "\n");

console.log("Wrote PUBLIC keys to registry/keys/program-keys.json - commit that file via PR.");
console.log("");
console.log("================================================================================");
console.log("  PRIVATE KEYS - SHOWN ONCE. Paste each into the `conformance-issuance`");
console.log("  GitHub ENVIRONMENT secrets (Settings -> Environments -> conformance-issuance");
console.log("  -> Environment secrets), THEN DELETE YOUR TERMINAL SCROLLBACK AND SHELL");
console.log("  HISTORY. Never commit these, never store them on this machine.");
console.log("================================================================================");
for (const line of secretLines) console.log(line);
console.log("================================================================================");
console.log("Next: conformance/README.md > \"Issuance and custody (v1.5)\" for the full setup.");
