# KYA-OS conformance badge worker

Serves live conformance badges on the builders host at `builders.kya-os.org/badge/*` (Phase B of the conformance program):

```text
GET /badge/<slug>.svg     flat SVG badge
GET /badge/<slug>.json    shields.io endpoint JSON
```

Until this worker deploys, the site build emits every badge tier on the same `/badge/<slug>.{svg,json}` path space (`site/lib/badge.mjs`), including the `verified` tier.
That static boundary is honest but different from live verification: a static `verified` badge is backed by **build-time cryptographic verification of in-repo state** (`site/lib/credentials.mjs` refuses the whole build on any failure), and then goes stale-able until the next deploy - a revocation updates it when its PR merges, not the moment the bit flips.
This worker is the Phase B upgrade: the same URLs move to **request-time** verification, so a revocation propagates in one cache TTL instead of one deploy.

The two tiers render **byte-identical badges for the same state** - the build asserts the worker's renderer against the shipped `dist/badge/` bytes and against the static renderer across the whole state space (`site/lib/badge.mjs`), so the handover changes freshness, never pixels.

## The trust root: generated-keys.mjs

The worker's pinned program keys live in `generated-keys.mjs`, which `site/build-pages.mjs` emits from `registry/keys/program-keys.json` (the same contract as `generated-allowlist.mjs`: generated, committed, freshness-gated by CI and by the build's own regenerate-and-compare assertion).
It exports `PINNED_ISSUER_KEYS` and `PINNED_STATUS_KEYS` (arrays of `{id, publicKeyMultibase}`) plus `PROVISIONED`.

Two eras:

- **Sentinel era** (now): `registry/keys/program-keys.json` is the pre-ceremony unprovisioned sentinel, so the module exports `PROVISIONED = false` and empty key arrays, and the worker fail-closes **every** badge request to the grey `unverified` rendering - never a 500, never anything green.
  The deploy workflow refuses to deploy in this era at all.
- **Provisioned era**: the maintainer runs the key ceremony (`scripts/generate-program-keys.mjs`) and opens the provisioning PR committing the public keys.
  When the maintainer's provisioning PR merges, the next build regenerates this module automatically - **the merge arms the worker with zero hand edits**.
  Issuer and status publics are pinned as separate sets (so a stolen issuer key can never clear its own revocation bits); the reserved Phase C log key is never pinned.

Key resolution is rotation-aware and purpose-restricted, the same rule as the scripts side: a proof verifies against exactly the pinned key its `verificationMethod` fragment **names** (`did:web:builders.kya-os.org#conformance-issuer-1` and successors), never by trying every key, and issuer proofs resolve only in the issuer set, status proofs only in the status set.

## How a badge is computed

The slug must be in `generated-allowlist.mjs` (emitted by the build from the rendered registry entries); an unlisted slug is a 404.
The allowlist carries each entry's honest claim label, registry status, and credential URL.

Entries below the credential rungs render straight from the allowlist, with no fetch at all, exactly as the static tier renders them: `· listed`, `· <claim> self-reported`, `◌ <claim> in verification`.

For an entry at status `verified` or `revoked`, the worker re-verifies at request time, fail-closed at every step (any failure renders `unverified`, never a green badge):

1. Fetch the credential from its canonical URL, `https://builders.kya-os.org/credentials/<id32>.json` (the entry's `attestationUrl`, carried by the allowlist).
2. Verify its Ed25519 `DataIntegrityProof` / `eddsa-jcs-2022` proof with `crypto.subtle` against the pinned issuer key its proof names - keys the credential brings along are never trusted.
3. Schema and temporal checks: `proof.proofPurpose` must be `assertionMethod`; `validFrom` must exist and not sit in the future beyond a 300s clock skew; **any** `validUntil` is a schema violation - the credential design deliberately has no expiry (currency lives in suite supersession, recorded in its `termsOfUse`), so no "expired" state exists.
4. Binding checks: the credential `id` must recompute from the URL's `<id32>`, and the subject's claim must reproduce the allowlist's honest label - a subset never renders as a bare level, and a credential for some other claim cannot ride this slug.
5. Read the revocation and suspension bits from the two Bitstring status lists at `https://builders.kya-os.org/credentials/status/{revocation,suspension}-1.json` (which the credential's own status entries must name).
   Each list is a signed credential verified against the pinned **status** key its proof names before any bit is read; gzip inflation is capped mid-stream.

States, precedence top to bottom, in the static tier's exact rendering grammar:

| state | color | meaning |
| --- | --- | --- |
| `revoked` | dark grey | revocation bit set - terminal |
| `◌ under appeal` | amber | suspension bit set - contested, not withdrawn |
| `✓ <claim> verified` | green | proof valid, both bits clear |
| `unverified` | grey | unprovisioned keys, or any failure anywhere (worker-only: the static build refuses instead of rendering it) |

Honesty rules: the label cell is always `KYA-OS`; a subset claim renders its categories (`L1 subset (signed-proof)`) and never a bare level - the allowlist ships the precomputed honest label and the worker cross-checks the credential against it.

Caching: the cache key is the path only (query string stripped), `s-maxage=300`; failure responses cache for 60s so an outage cannot pin a stale answer.

## Deploy runbook

Deployment is a `workflow_dispatch` of `.github/workflows/deploy-worker.yml` - never automatic.
The workflow refuses while the program keys are unprovisioned, refuses stale generated modules, and refuses on any test failure, so the order below cannot be run out of order by accident.

1. **Provision the program keys** (once, Phase A ceremony): run `node scripts/generate-program-keys.mjs`, paste the private halves into the `conformance-issuance` environment secrets, and open the provisioning PR committing `registry/keys/program-keys.json` plus the regenerated `workers/badge/generated-keys.mjs` (run `npm test` before pushing; the build regenerates the module and CI gates its freshness).
   The merge arms the worker with zero hand edits.
2. **Create the deploy token** (at deploy time, not before): in the DIF Cloudflare account, My Profile -> API Tokens -> Create Token -> Custom token, with exactly two permissions: `Account > Workers Scripts > Edit` and `Zone > Workers Routes > Edit`, zone-scoped to `kya-os.org`.
   This is a separate token from the Pages deploy token on purpose - each token can do only its own tier's job.
3. **Set the repository secrets**: `CLOUDFLARE_API_TOKEN_WORKER` (the token above) and `CLOUDFLARE_ACCOUNT_ID` (already set for the Pages deploy).
4. **Run the workflow**: Actions -> "Deploy badge worker" -> Run workflow (from `main`).
   It builds, freshness-checks the generated modules, verifies `PROVISIONED`, runs the full test suite, then `npx --yes wrangler@4 deploy` from `workers/badge/` onto the `builders.kya-os.org/badge/*` zone route.
5. **Verify the first deploy**:

   ```bash
   curl -sI https://builders.kya-os.org/badge/kya-os-mcp.svg
   ```

   Confirm the worker serves it: the `CF-Worker` header where Cloudflare emits it, and definitively the worker's own header signature - `cache-control: public, s-maxage=300` with `x-content-type-options: nosniff` (the static Pages tier serves its own cache headers on these paths).
   Then fetch the body and confirm it is byte-identical to `dist/badge/kya-os-mcp.svg` from a local build of the same commit - the parity assertion guarantees it, the curl proves it live.
6. **Rollback**: `npx --yes wrangler@4 delete` from `workers/badge/` (same env vars) removes the worker and its route, and Cloudflare Pages serves the static badge tier on the same paths again, instantly.
   No embed ever changes in either direction.

## Layout

```text
worker.mjs               routes, state resolution, rendering (byte-identical
                         to site/lib/badge.mjs - build-asserted)
verify.mjs               JCS, base58btc/base64url, eddsa-jcs-2022 verify,
                         bitstring decode with capped inflation
generated-allowlist.mjs  GENERATED by site/build-pages.mjs - do not edit
generated-keys.mjs       GENERATED by site/build-pages.mjs - do not edit
fixtures/mint.mjs        in-test fixture mint: throwaway keys and Phase A
                         shaped documents, minted fresh per run, never
                         committed, never trusted
worker.test.mjs          node --test coverage: verify accept/reject, every
                         render state, rotation, purpose separation,
                         fail-close, routing
parity.test.mjs          cross-implementation parity vs scripts/lib/* (the
                         deliberate redundancy rule's enforcement) incl. the
                         scripts-mint -> worker-handler e2e
```

Independence note (deliberate redundancy rule): this worker never imports `scripts/` or `site/` code - it must stay self-contained for Cloudflare bundling, and the repo's house style is independent implementations cross-proving each other.
`parity.test.mjs` is where the two crypto implementations meet, and the build's render checks import this worker's renderer read-only to assert badge-byte parity with the static tier.

## Tests

```bash
node --test workers/badge/*.test.mjs
```

Runs fully offline: fetch, cache, and keys are injected, and every signed fixture is minted in-test by `fixtures/mint.mjs` under throwaway keys that are not (and can never become) pinned production keys.
