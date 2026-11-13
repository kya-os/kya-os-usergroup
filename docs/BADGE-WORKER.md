# How the badge worker serves a badge

The conformance page shows what a badge is and what it says.
This document carries the operating detail behind it: where a badge is served, which tier answers today, what makes one green, the states, how fast a change propagates, and what the README badge does and does not carry.
Everything here is taken from [`workers/badge/worker.mjs`](../workers/badge/worker.mjs) and its [README](../workers/badge/README.md), which is the deploy runbook; where they disagree with this page, they win.

## Where it is served

A badge is served at `/badge/<slug>.svg` (the flat SVG) and `/badge/<slug>.json` (the shields.io endpoint schema) on `builders.kya-os.org`.
Two tiers share those exact paths:

- The **static tier**: the site build emits every badge as a static file ([`site/lib/badge.mjs`](../site/lib/badge.mjs)), including the `verified` tier, and Cloudflare Pages serves it.
- The **badge worker**: on deploy it takes over `builders.kya-os.org/badge/*` with request-time verification of the same credentials.

The two tiers render byte-identical badges for the same state.
The build asserts the worker's renderer against the shipped `dist/badge/` bytes and against the static renderer across the whole state space, so the handover changes freshness, never pixels, and no embed changes in either direction.

## Deploy status

The worker is armed and waits on a manual deploy.

- **Keys.** The program's public keys are provisioned in [`registry/keys/program-keys.json`](../registry/keys/program-keys.json), and the build regenerates [`workers/badge/generated-keys.mjs`](../workers/badge/generated-keys.mjs) from them: `PROVISIONED` is `true`, with the issuer key and the status key pinned as separate sets (so a stolen issuer key can never clear its own revocation bits); the reserved log key is never pinned.
- **Deployment.** Deploying is a `workflow_dispatch` of [`deploy-worker.yml`](../.github/workflows/deploy-worker.yml) from `main`, never automatic: handing the `/badge/` paths from the static tier to request-time verification is a human decision.
  What it refuses before it deploys, the guards it carries and what they do not check are listed once, in the runbook: its step 4, and "What the workflows check" in its [Deploy order](../workers/badge/README.md#deploy-order) section.
- **Until it runs**, the static tier answers on these paths.
  The [workflow's run history](https://github.com/kya-os/kya-os-usergroup/actions/workflows/deploy-worker.yml) is the record of whether it has.

The step-by-step runbook (the dedicated Cloudflare token, the `production` environment, the first-deploy check, removing the worker, and the deploy and rollback order) is in [`workers/badge/README.md`](../workers/badge/README.md#deploy-runbook).

## What makes a badge green

Only a verified credential, on either tier.

1. The slug must be in the generated allowlist ([`workers/badge/generated-allowlist.mjs`](../workers/badge/generated-allowlist.mjs), emitted by the build from the rendered registry entries); an unlisted slug is a 404.
2. For an entry at status `verified` or `revoked`, the worker fetches the credential from its canonical URL, `https://builders.kya-os.org/credentials/<id32>.json` (the build reads the committed copy instead).
3. Its Ed25519 `eddsa-jcs-2022` proof is checked against the pinned issuer key the proof names, never a key the credential carries.
   The check is section 3.3.2 of [VC Data Integrity EdDSA Cryptosuites v1.0](https://www.w3.org/TR/vc-di-eddsa/#eddsa-jcs-2022): the proof carries the `@context` it was signed over, and the credential's `@context` must start with it.
   Once the proof verifies, the credential's `@context` and its proof's must each be exactly the program's, `["https://www.w3.org/ns/credentials/v2"]`, since the signature binds only the proof's.
4. Schema and binding checks: `proofPurpose` must be `assertionMethod`, and `proof.created` must be present.
   `validFrom` must be the program's own timestamp, `YYYY-MM-DDThh:mm:ssZ` on a day its month has, and be less than 300 seconds in the future (the clock skew).
   Any `validUntil` is a schema violation, because the credential has no expiry (currency lives in suite supersession, recorded in its `termsOfUse`).
   The credential `id` must recompute from the URL, and the subject's claim must reproduce the allowlist's honest label, so a subset never renders as a bare level.
5. The revocation and suspension bits are read from the two signed Bitstring status lists, each verified against a separate pinned status key and held to the same policy before any bit is read.
   That is the same `@context`, purpose and `created` rules, a `validFrom` in the program's timestamp form less than the same clock skew in the future, and no `validUntil`.

Entries below the credential rungs (`listed`, `self-reported`, `in verification`) render straight from the allowlist, with no fetch at all, exactly as the static tier renders them.

## The states

Precedence top to bottom, in the static tier's exact rendering grammar:

| state | color | meaning |
| --- | --- | --- |
| `revoked` | dark grey | revocation bit set; terminal |
| `◌ under appeal` | amber | suspension bit set; contested, not withdrawn |
| `✓ <claim> verified` | green | proof valid, both bits clear |
| `◌ <claim> in verification` | amber | from the registry entry alone, no fetch |
| `· <claim> self-reported` | grey | from the registry entry alone, no fetch |
| `· listed` | grey | from the registry entry alone, no fetch |
| `unverified` | grey | worker only: unprovisioned keys, or any failure anywhere; never a 500 and never anything green (the static build refuses instead of rendering it) |

The label cell always says `KYA-OS`.

## How fast it changes

- On the static tier a revocation lands when its PR merges and the site redeploys.
- On the worker it propagates in one cache TTL: `s-maxage=300`, about five minutes, before any caching by the page that embeds the image.
  The cache key is the path only (the query string is stripped).
- Failure responses cache for 60 seconds, so an outage cannot pin a stale answer.

## The waveform on the badge

The waveform lockups on the site are drawn at build time from a seed, not from the badge.

Once an entry has a credential, that seed **is the credential's signature**: `proof.proofValue`, the multibase Ed25519 signature both tiers verify against the pinned issuer key, hashed with the same FNV-1a the wave has always used ([`site/lib/waveform.mjs`](../site/lib/waveform.mjs), and the worker's own copy in [`workers/badge/wave.mjs`](../workers/badge/wave.mjs)).
So the wave is the credential's signature fingerprint: the same credential always draws the same wave, a reissued credential redraws it completely, and no two credentials draw alike.
The entry's directory row and its badge draw from that one seed, so the row and the badge carry the same wave.

The badge you embed in a README carries it too: the three credential-backed states (`verified`, `◌ under appeal`, `revoked`) lead their message cell with 14 bars in the state color, byte-identical between the tiers.
A claim below the credential boundary has no signature to fingerprint yet, so its wave is still seeded by `<slug>#<claim label>` (the badge preview on the conformance page shows the seed it draws from) and its badge stays flat: a `KYA-OS` label cell and a state cell, no bars.
