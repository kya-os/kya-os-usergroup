#!/usr/bin/env node
/**
 * The live enforcement probe: for every registry entry of kind "service"
 * that names a probeUrl, send ONE bare JSON-RPC request - no proof, no
 * capability declaration - and record what the wire answers:
 *
 *   enforcing    the protocol's own refusal: JSON-RPC error -32021
 *                (MissingRequiredClientCapabilityError, MCP 2026-07-28), or
 *                any error carrying data.requiredCapabilities - the typed-
 *                reconstruction fallback per SPEC-MCP-EXTENSION §4.2.
 *                Matched conservatively: nothing else ever counts.
 *   open         a successful answer (a JSON-RPC result): the server served
 *                the bare request without requiring proof. Recorded
 *                honestly, not punitively.
 *   unreachable  network failure, the 8s timeout, or an answer that is
 *                neither a result nor the refusal - fail-closed: what cannot
 *                be classified never upgrades to a claim.
 *
 * The bare request is tools/list, not initialize: required mode must leave
 * discovery reachable (SPEC-MCP-EXTENSION §4.2 exempts server/discover and
 * liveness), so a serving method is the falsifiable one.
 *
 * Also fetched per endpoint, same-origin: /health (liveness, logged only)
 * and /provenance (the deployment's reported package version, recorded as
 * provenanceVersion when present).
 *
 * Writes registry/probes.json - COMMITTED data validated by
 * scripts/validate-probes.mjs, so the site build stays a deterministic pure
 * function of the repo. The Probe workflow runs this daily and commits the
 * diff; the Deploy workflow picks it up via its registry/** path filter.
 *
 * Zero dependencies: Node builtins plus global fetch.
 * Run: node scripts/probe-live.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRegistry } from "./validate.mjs";

const TIMEOUT_MS = 8000;
const here = dirname(fileURLToPath(import.meta.url));
const probesPath = join(here, "..", "registry", "probes.json");

const BARE_REQUEST = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

function fetchWithTimeout(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
}

/** Parse a JSON or SSE (first data: event) JSON-RPC body; null when neither parses. */
function parseRpc(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Not plain JSON - fall through to the SSE framing below.
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      try {
        return JSON.parse(line.slice(5));
      } catch {
        return null; // an SSE data frame that is not JSON classifies as unreachable
      }
    }
  }
  return null;
}

/** Conservative classification of the wire's answer - see the header. */
function classify(rpc) {
  const error = rpc?.error;
  if (error !== null && typeof error === "object") {
    const hasRequiredCapabilities =
      error.data !== null && typeof error.data === "object" && error.data.requiredCapabilities !== undefined;
    if (error.code === -32021 || hasRequiredCapabilities) return "enforcing";
  }
  if (rpc !== null && typeof rpc === "object" && rpc.result !== undefined) return "open";
  return "unreachable";
}

async function probeEndpoint(probeUrl) {
  let status = "unreachable";
  try {
    const response = await fetchWithTimeout(probeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: BARE_REQUEST,
    });
    status = classify(parseRpc(await response.text()));
  } catch {
    status = "unreachable"; // network failure or timeout - the explicit third bucket
  }

  const origin = new URL(probeUrl).origin;
  let health = null;
  try {
    health = (await fetchWithTimeout(`${origin}/health`)).ok;
  } catch {
    health = null; // no /health endpoint - liveness is informational, logged only
  }

  let provenanceVersion;
  try {
    const response = await fetchWithTimeout(`${origin}/provenance`);
    if (response.ok) {
      const provenance = await response.json();
      if (typeof provenance?.version === "string" && provenance.version.length >= 1 && provenance.version.length <= 40) {
        provenanceVersion = provenance.version;
      }
    }
  } catch {
    provenanceVersion = undefined; // no /provenance endpoint - version capture is best-effort
  }

  return { status, health, provenanceVersion };
}

const { entries, errors } = validateRegistry();
if (errors.length > 0) {
  console.error(`Refusing to probe: registry validation failed (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const targets = entries
  .filter((entry) => (entry.kind === "service" || entry.kind === "implementation") && entry.probeUrl !== undefined)
  .sort((a, b) => a.slug.localeCompare(b.slug, "en"));

const results = {};
for (const entry of targets) {
  const { status, health, provenanceVersion } = await probeEndpoint(entry.probeUrl);
  results[entry.slug] = provenanceVersion === undefined ? { status } : { status, provenanceVersion };
  const healthNote = health === null ? "no /health" : health ? "/health ok" : "/health failing";
  const versionNote = provenanceVersion === undefined ? "" : `, provenance ${provenanceVersion}`;
  console.log(`${entry.slug}: ${status} (${healthNote}${versionNote}) - ${entry.probeUrl}`);
}

const probes = { probedAt: new Date().toISOString().slice(0, 10), results };
writeFileSync(probesPath, JSON.stringify(probes, null, 2) + "\n");
console.log(`Wrote registry/probes.json: ${targets.length} endpoint${targets.length === 1 ? "" : "s"} probed at ${probes.probedAt}.`);
