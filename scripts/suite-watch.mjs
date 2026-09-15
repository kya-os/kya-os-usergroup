#!/usr/bin/env node
/**
 * suite-watch.mjs — daily drift check between the upstream conformance suite
 * and everything this repo pins against it.
 *
 * Upstream truth: conformance/SUITE-MANIFEST.json on main in
 * decentralized-identity/kya-os-mcp (suiteVersion + vectorSetHash, themselves
 * gated upstream by the suite-immutability tests).
 *
 * Local claims checked:
 *   1. The starter pin — EXPECTED_VECTOR_SET_HASH in
 *      conformance/starter/scripts/fetch-suite.mjs. Stale pin => exit 1.
 *   2. Registry conformance claims — registry/builders/*.json entries whose
 *      `conformance.suiteVersion` is behind the current suite. These are NOT
 *      failures (a claim verified at 1.0.0 stays true), but they are listed so
 *      re-verification is a visible decision, not silent rot.
 *
 * A pin is an attestation, so this script never rewrites one. It makes
 * staleness loud (same philosophy as probe.yml: the site must never invent
 * freshness) and prints a ready-to-file markdown report on drift; the CI
 * workflow turns that into a single deduplicated issue for a human to act on.
 *
 * Exit codes: 0 in sync, 1 starter pin drifted, 2 cannot reach upstream
 * (transient - the workflow warns and passes), 3 local parse/contract
 * failure (the watcher itself is broken - the workflow MUST fail, or a
 * regex miss would wear an outage's disguise and rot silently).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_URL =
  "https://raw.githubusercontent.com/decentralized-identity/kya-os-mcp/main/conformance/SUITE-MANIFEST.json";
const FETCH_SUITE = join(ROOT, "conformance/starter/scripts/fetch-suite.mjs");
const BUILDERS_DIR = join(ROOT, "registry/builders");

function semverLt(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

async function main() {
  let manifest;
  try {
    const res = await fetch(MANIFEST_URL, {
      headers: { "user-agent": "kya-os-usergroup-suite-watch" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    console.error(`Cannot reach upstream SUITE-MANIFEST (${err.message}).`);
    process.exit(2);
  }
  const { suiteVersion, vectorSetHash } = manifest;
  if (!suiteVersion || !vectorSetHash) {
    // Reachable but contract-broken is a signal, not an outage: fail hard.
    console.error("Upstream manifest is missing suiteVersion/vectorSetHash.");
    process.exit(3);
  }

  const starterSrc = readFileSync(FETCH_SUITE, "utf8");
  const pinnedHash = starterSrc.match(
    /EXPECTED_VECTOR_SET_HASH\s*=\s*\n?\s*'([^']+)'/
  )?.[1];
  const pinnedRef = starterSrc.match(/PINNED_REF = '([^']+)'/)?.[1];
  if (!pinnedHash || !pinnedRef) {
    console.error("Could not parse the starter pin out of fetch-suite.mjs.");
    process.exit(3);
  }

  const staleClaims = [];
  for (const file of readdirSync(BUILDERS_DIR).filter((f) => f.endsWith(".json"))) {
    const entry = JSON.parse(readFileSync(join(BUILDERS_DIR, file), "utf8"));
    const claimed = entry?.conformance?.suiteVersion;
    if (claimed && semverLt(claimed, suiteVersion)) {
      staleClaims.push({ file, claimed });
    }
  }

  const pinFresh = pinnedHash === vectorSetHash;
  if (pinFresh && staleClaims.length === 0) {
    console.log(
      `OK — starter pin (${pinnedRef}) matches suite ${suiteVersion} (${vectorSetHash}); all registry claims current.`
    );
    return;
  }

  // Markdown report, consumed verbatim as the issue body by suite-watch.yml.
  const lines = [
    `Upstream suite moved: **${suiteVersion}** (\`${vectorSetHash}\`).`,
    "",
  ];
  if (!pinFresh) {
    lines.push(
      `- [ ] **Starter pin is stale** — \`fetch-suite.mjs\` pins \`${pinnedRef}\` (\`${pinnedHash}\`). Bump \`PINNED_REF\`, \`PINNED_COMMIT\`, \`EXPECTED_VECTOR_SET_HASH\`, and \`EXPECTED_HARNESS_HASHES\` together, run \`npm run fetch-suite\` to verify, and update the vector counts in the two READMEs.`
    );
  }
  for (const { file, claimed } of staleClaims) {
    lines.push(
      `- [ ] \`registry/builders/${file}\` verified at suite **${claimed}** — still true, but behind ${suiteVersion}; re-run the starter and re-attest (issue-credential flow) to advance the claim.`
    );
  }
  lines.push(
    "",
    "Pins are attestations: nothing here is auto-bumped. Check items off as the human path (verify → attest → pin) completes them."
  );
  console.log(lines.join("\n"));
  process.exit(pinFresh ? 0 : 1);
}

await main();
