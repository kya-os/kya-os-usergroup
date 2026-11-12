#!/usr/bin/env node
/**
 * Deploy preflight for the badge worker, the command line: before the worker
 * deploys, run its own checks (preflight-checks.mjs, over worker.mjs and
 * verify.mjs, with the pinned keys and the allowlist this checkout
 * generated) against the LIVE documents it is about to serve, and refuse the
 * deploy unless both status lists and the credential of every allowlist
 * entry at verified or revoked verify.
 *
 * Why: the worker and the documents it verifies ship separately. Cloudflare
 * Pages deploys the credentials and status lists when a change merges; the
 * worker deploys by workflow_dispatch; both deploy jobs run in the
 * `production` environment, held to main. A worker that refuses the form
 * the live documents are in would turn every credential-backed badge
 * unverified, so .github/workflows/deploy-worker.yml runs this in the step
 * right before `wrangler deploy`, against what production serves at that
 * moment. Nothing runs it again once the worker is live, so a later
 * rollback of the documents follows the rollback order (README.md, "Deploy
 * order").
 *
 * This file is only the command line, and it runs its checks whenever it
 * is loaded, by whatever path: directly, through a symlink, or imported by
 * a wrapper. It has no "am I the main module" test that could be false and
 * skip them, and it exits 1 when no check ran.
 *
 *   node workers/badge/preflight.mjs    exit 0 when all verify, 1 otherwise
 */
import { BADGE_ALLOWLIST } from "./generated-allowlist.mjs";
import { PINNED_ISSUER_KEYS, PINNED_STATUS_KEYS, PROVISIONED } from "./generated-keys.mjs";
import { preflight, verdict } from "./preflight-checks.mjs";

const { code, out, err } = verdict(
  await preflight({
    allowlist: BADGE_ALLOWLIST,
    issuerKeys: PINNED_ISSUER_KEYS,
    statusKeys: PINNED_STATUS_KEYS,
    provisioned: PROVISIONED,
    fetchImpl: fetch,
  }),
);
for (const line of out) console.log(line);
for (const line of err) console.error(line);
process.exitCode = code;
