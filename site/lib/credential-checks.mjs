/**
 * Render checks for the credential artifacts, on the finished dist/ bytes -
 * split from lib/assertions.mjs to keep both files under the lib LOC cap,
 * same philosophy: read the shipped files back and re-verify, never trust
 * the emit step.
 *
 * Sentinel era (registry/keys unprovisioned): dist/.well-known must NOT
 * exist, dist/credentials/ holds ONLY the published schema, no entry sits at
 * a credential-backed status, and nothing on any page or badge says
 * verified - the sentinel provably renders nothing green.
 *
 * Provisioned era: dist/.well-known/did.json must exist and carry exactly
 * the committed public keys (recomputed here from the registry file bytes,
 * never from the renderer); every committed credential and status list must
 * ship as an exact byte copy under dist/credentials/; and each SHIPPED
 * credential is re-verified cryptographically from its dist bytes - proof
 * against the shipped did.json keys, status bits against the shipped lists -
 * so what actually deploys is what was proven.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { decodeStatusList, statusBitAt, verifyCredential } from "../../scripts/lib/attest.mjs";
import { assertBuild } from "./checks.mjs";

const SCHEMA_REL = join("schema", "attestation-v1.json");

function assertByteCopy(distDir, repoRoot, relFromCredentials, label) {
  const built = readFileSync(join(distDir, "credentials", relFromCredentials));
  const committed = readFileSync(join(repoRoot, "registry", "credentials", relFromCredentials));
  assertBuild(built.equals(committed), `dist/credentials/${label} is not a byte copy of registry/credentials/${label}`);
}

export function assertCredentialArtifacts({ distDir, rendered, credentialData, verdicts }) {
  const repoRoot = join(distDir, "..");
  const { programKeys, credentials, statusLists } = credentialData;

  // The published schema ships in both eras, byte-identical, with the proof
  // type and cryptosuite pinned as literal consts.
  assertByteCopy(distDir, repoRoot, SCHEMA_REL, "schema/attestation-v1.json");
  const schemaBytes = readFileSync(join(distDir, "credentials", SCHEMA_REL), "utf8");
  for (const literal of ['"const": "DataIntegrityProof"', '"const": "eddsa-jcs-2022"']) {
    assertBuild(schemaBytes.includes(literal), `dist/credentials/schema/attestation-v1.json lost its pinned ${literal} literal`);
  }

  if (!programKeys.provisioned) {
    assertBuild(!existsSync(join(distDir, ".well-known")), "unprovisioned keys must emit no dist/.well-known (no did.json on the sentinel)");
    const files = readdirSync(join(distDir, "credentials"), { recursive: true }).map(String).filter((name) => name.endsWith(".json")).sort();
    assertBuild(
      files.join(",") === SCHEMA_REL,
      `unprovisioned keys must ship only the schema under dist/credentials/ (found: ${files.join(", ")})`,
    );
    for (const entry of rendered) {
      const status = entry.conformance?.status;
      assertBuild(
        status !== "verified" && status !== "revoked",
        `entry "${entry.slug}" sits at credential-backed status "${status}" while the program keys are the unprovisioned sentinel`,
      );
    }
    assertBuild(verdicts.size === 0, "unprovisioned keys must yield zero credential verdicts");
    return;
  }

  // ── did.json: exactly the committed public keys ───────────────────────────
  const didPath = join(distDir, ".well-known", "did.json");
  assertBuild(existsSync(didPath), "provisioned keys must emit dist/.well-known/did.json");
  const did = JSON.parse(readFileSync(didPath, "utf8"));
  const committedKeys = JSON.parse(readFileSync(join(repoRoot, "registry", "keys", "program-keys.json"), "utf8")).keys;
  const publishable = committedKeys.filter((key) => key.purpose === "issuer" || key.purpose === "status");
  assertBuild(did.id === "did:web:builders.kya-os.org", `did.json id drifted (${did.id})`);
  const methods = did.verificationMethod ?? [];
  assertBuild(
    methods.map((m) => `${m.id}|${m.publicKeyMultibase}`).sort().join(",") ===
      publishable.map((k) => `${did.id}#${k.id}|${k.publicKeyMultibase}`).sort().join(","),
    "did.json verificationMethod does not match the committed program public keys",
  );
  assertBuild(
    methods.every((m) => m.type === "Multikey" && m.controller === did.id),
    "did.json verification methods must be Multikey entries controlled by the issuer DID",
  );
  assertBuild(
    (did.assertionMethod ?? []).sort().join(",") ===
      publishable.filter((k) => k.purpose === "issuer").map((k) => `${did.id}#${k.id}`).sort().join(","),
    "did.json assertionMethod must list exactly the issuer keys",
  );
  assertBuild(
    !committedKeys.some((key) => key.purpose === "log" && methods.some((m) => m.id.endsWith(`#${key.id}`))),
    "the reserved log key must not appear in did.json",
  );

  // ── credentials and status lists ship byte-identical ──────────────────────
  for (const { id32 } of credentials) {
    assertByteCopy(distDir, repoRoot, `${id32}.json`, `${id32}.json`);
  }
  for (const purpose of ["revocation", "suspension"]) {
    if (statusLists[purpose] !== null) {
      assertByteCopy(distDir, repoRoot, join("status", `${purpose}-1.json`), `status/${purpose}-1.json`);
    }
  }

  // ── re-verify every SHIPPED credential from dist bytes ────────────────────
  const keyByFragment = new Map(publishable.map((key) => [key.id, key]));
  const bits = {};
  for (const purpose of ["revocation", "suspension"]) {
    if (statusLists[purpose] === null) continue;
    const list = JSON.parse(readFileSync(join(distDir, "credentials", "status", `${purpose}-1.json`), "utf8"));
    const fragment = String(list.proof?.verificationMethod ?? "").split("#")[1];
    const key = keyByFragment.get(fragment);
    assertBuild(key?.purpose === "status", `shipped ${purpose} list must be signed by a committed status key (got "${fragment}")`);
    assertBuild(verifyCredential(list, key.publicKeyMultibase).ok, `shipped ${purpose} list proof does not verify`);
    bits[purpose] = decodeStatusList(list.credentialSubject.encodedList);
  }
  for (const { id32 } of credentials) {
    const credential = JSON.parse(readFileSync(join(distDir, "credentials", `${id32}.json`), "utf8"));
    const fragment = String(credential.proof?.verificationMethod ?? "").split("#")[1];
    const key = keyByFragment.get(fragment);
    assertBuild(key?.purpose === "issuer", `shipped credential ${id32} must be signed by a committed issuer key (got "${fragment}")`);
    assertBuild(verifyCredential(credential, key.publicKeyMultibase).ok, `shipped credential ${id32} proof does not verify`);
    const index = Number(credential.credentialStatus[0].statusListIndex);
    const state = statusBitAt(bits.revocation, index) ? "revoked" : statusBitAt(bits.suspension, index) ? "suspended" : "verified";
    const entry = rendered.find((candidate) => candidate.conformance?.attestationUrl?.endsWith(`/credentials/${id32}.json`));
    if (entry !== undefined) {
      assertBuild(
        verdicts.get(entry.slug)?.state === state,
        `shipped credential ${id32}: dist-recomputed state "${state}" disagrees with the build verdict for "${entry.slug}"`,
      );
    } else {
      assertBuild(state === "revoked", `shipped credential ${id32} is linked by no entry and must therefore be revoked`);
    }
  }

  // ── page honesty: chips agree with the verdicts ───────────────────────────
  const buildersHtml = readFileSync(join(distDir, "builders", "index.html"), "utf8");
  const conformanceHtml = readFileSync(join(distDir, "conformance", "index.html"), "utf8");
  for (const [name, html] of [["builders/index.html", buildersHtml], ["conformance/index.html", conformanceHtml]]) {
    const greenChips = [...html.matchAll(/class="[^"]*\bst-verified\b[^"]*"/g)].filter((m) => !m[0].includes("demo")).length;
    const expected = rendered.filter((entry) => verdicts.get(entry.slug)?.state === "verified").length;
    assertBuild(
      greenChips === expected,
      `${name}: ${greenChips} non-demo verified chips rendered, expected ${expected} (one per build-verified credential)`,
    );
    for (const entry of rendered) {
      const state = verdicts.get(entry.slug)?.state;
      if (state === "suspended") {
        assertBuild(html.includes("under appeal"), `${name}: suspended credential for "${entry.slug}" must render "under appeal"`);
      }
      if (state === "revoked") {
        assertBuild(html.includes('class="chip st-revoked"'), `${name}: revoked credential for "${entry.slug}" must render the dark revoked chip`);
      }
    }
  }
}
