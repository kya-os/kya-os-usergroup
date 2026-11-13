# KYA-OS conformance badge worker

Serves live conformance badges on the builders host at `builders.kya-os.org/badge/*` (Phase B of the conformance program):

```text
GET /badge/<slug>.svg     the badge SVG
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
   The proof is checked as section 3.3.2 of [VC Data Integrity EdDSA Cryptosuites v1.0](https://www.w3.org/TR/vc-di-eddsa/#eddsa-jcs-2022) defines it.
   The signed proof configuration is the stored proof minus its `proofValue`, including the `@context` the signer stored there, and the credential's `@context` must start with the proof's.
   The signature binds only that prefix, so once the proof verifies, the credential's `@context` and its proof's must each be exactly the program's, `["https://www.w3.org/ns/credentials/v2"]`.
   A context appended after signing, a list turned into a bare string, or a proof signed with no `@context` renders `unverified`.
   That is the program's policy: every document it signs carries its one context, in the document and in the proof.
3. Schema and temporal checks: `proof.proofPurpose` must be `assertionMethod`, and `proof.created` must be present (the cryptosuite checks it only when set, and the program sets it on every proof).
   `validFrom` must be the program's own timestamp, `YYYY-MM-DDThh:mm:ssZ` on a day its month has, and must be less than 300s in the future (the clock skew).
   **Any** `validUntil` is a schema violation: the credential design deliberately has no expiry (currency lives in suite supersession, recorded in its `termsOfUse`), so no "expired" state exists.
4. Binding checks: the credential `id` must recompute from the URL's `<id32>`, and the subject's claim must reproduce the allowlist's honest label - a subset never renders as a bare level, and a credential for some other claim cannot ride this slug.
5. Read the revocation and suspension bits from the two Bitstring status lists at `https://builders.kya-os.org/credentials/status/{revocation,suspension}-1.json` (which the credential's own status entries must name).
   Each list is a signed credential, verified against the pinned **status** key its proof names and held to the same policy before any bit is read.
   That is the same `@context`, purpose and `created` rules, a `validFrom` in the program's timestamp form less than the same clock skew in the future, and no `validUntil`.
   Gzip inflation is capped mid-stream.

States, precedence top to bottom, in the static tier's exact rendering grammar:

| state | color | meaning |
| --- | --- | --- |
| `revoked` | dark grey | revocation bit set - terminal |
| `◌ under appeal` | amber | suspension bit set - contested, not withdrawn |
| `✓ <claim> verified` | green | proof valid, both bits clear |
| `unverified` | grey | unprovisioned keys, or any failure anywhere (worker-only: the static build refuses instead of rendering it) |

Honesty rules: the label cell is always `KYA-OS`; a subset claim renders its categories (`L1 subset (signed-proof)`) and never a bare level - the allowlist ships the precomputed honest label and the worker cross-checks the credential against it.

The three credential-backed states also carry the **signature wave**: bars seeded by the `proof.proofValue` this request just verified (`wave.mjs`), so a verified badge is a fingerprint of the signature behind it, and a reissued credential redraws it.
The rungs below the credential boundary, and `unverified`, stay flat - there is no signature to fingerprint.
A credential with no `proofValue` throws like any other failure, so a verified badge never renders without its wave.

Caching: the cache key is the path only (query string stripped), `s-maxage=300`; failure responses cache for 60s so an outage cannot pin a stale answer.

## Deploy runbook

Deployment is a `workflow_dispatch` of `.github/workflows/deploy-worker.yml` from `main` - never automatic.
The workflow refuses while the program keys are unprovisioned, refuses stale generated modules, and refuses on any test failure, so the steps below cannot be run out of order by accident.
What it checks about the order of the worker and the documents it verifies is under "Deploy order".

1. **Provision the program keys** (once, Phase A ceremony): run `node scripts/generate-program-keys.mjs`, paste the private halves into the `conformance-issuance` environment secrets, and open the provisioning PR committing `registry/keys/program-keys.json` plus the regenerated `workers/badge/generated-keys.mjs` (run `npm test` before pushing; the build regenerates the module and CI gates its freshness).
   The merge arms the worker with zero hand edits.
2. **Create the deploy token** (at deploy time, not before): in the DIF Cloudflare account, My Profile -> API Tokens -> Create Token -> Custom token, with exactly two permissions: `Account > Workers Scripts > Edit` and `Zone > Workers Routes > Edit`, zone-scoped to `kya-os.org`.
   This is a separate token from the Pages deploy token on purpose - each token can do only its own tier's job.
3. **Set up the `production` environment and protect `main`** (a repository admin, once: both deploy jobs run in the environment, once this step is done its secrets are the only Cloudflare secrets the repository holds, and `main` is what every deploy trusts):
   1. Settings -> Environments -> New environment, name it exactly `production`, then Configure environment.
      If a deploy run already created it (a run that names a missing environment creates it, with no rules and no secrets), open it instead.
   2. Under Deployment branches and tags, choose Selected branches and tags, then Add deployment branch or tag rule: Ref type Branch, name pattern `main`, Add rule.
      Add no other rule.
   3. Deselect Allow administrators to bypass configured protection rules (`can_admins_bypass: false` in the REST API), then Save protection rules.
   4. Under Environment secrets, Add secret for `CLOUDFLARE_API_TOKEN` (the Pages deploy token, "Cloudflare Pages: Edit") and `CLOUDFLARE_ACCOUNT_ID`, and at deploy time `CLOUDFLARE_API_TOKEN_WORKER` (the token above).
      GitHub never shows a stored secret again: if the Pages token's value is not to hand, create a new token with the same permission, and revoke the old one in Cloudflare once the move is done.
   5. Once the deploy workflows on `main` run in `production`, delete the repository-level copies: Settings -> Secrets and variables -> Actions -> Repository secrets, remove `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN_WORKER` if it was ever set there.
      Deleting them sooner fails main's deploys until then, since a workflow that does not run in the environment cannot read its secrets.
   6. Protect `main`: Settings -> Rulesets -> New ruleset -> New branch ruleset; Ruleset name `main`; Enforcement status Active; under Target branches, Add a target -> Include default branch.
      Select Restrict deletions, Block force pushes, Require a pull request before merging, and Require status checks to pass before merging with the check `validate` (the Validate workflow's one job, listed on a pull request as `Validate / validate (pull_request)`).
      Select GitHub Actions as that check's source rather than any source, and leave its Require branches to be up to date before merging off (deselect it if it shows selected), then Create.
      Anyone with write access can set a status named `validate`; with GitHub Actions as its source, only a check run from GitHub Actions satisfies it.
      Branches may fall behind `main` because the probe pushes to it every day (sub-step 7): requiring them up to date would hold every bot pull request, a revocation's included, until a person updated its branch.
      Add no role, team or app to its bypass list: an admin can still change the ruleset, visibly, and sub-step 7 adds the one bypass the probe needs.
      The ruleset requires a pull request and a passing `validate` check, not an approving review, so one person with write access can still merge any change alone.
      An admin who wants a second person on every change can also set Required approvals to 1 and select Dismiss stale pull request approvals when new commits are pushed and Require approval of the most recent reviewable push.
      The issuance and revocation workflows open their pull requests with the job's `GITHUB_TOKEN`, so GitHub holds the Validate run of each for approval, and the check stays pending until a person with write access selects Approve workflows to run in the pull request's merge box.
      A revocation is time-critical, since the credential shows verified until its pull request merges and deploys: approve its run as soon as the pull request opens, and if no approval prompt shows, close and reopen the pull request as a person, which starts the run.
      No other run can stand in for that one: the Validate workflow runs only on a pull request to `main` and on a push to `main`, and GitHub evaluates a pull request's checks only from runs started by `pull_request`, `push` and a few other events.
      A pending issuance pull request blocks a revocation dispatch, since the workflow's one-in-flight guard fails it while any issuance or revocation pull request is open: close or merge that pull request first.
      If the Validate run fails on a network error or a known flaky test, re-run it from the pull request.
      A run left awaiting approval expires after 30 days and is marked failed.
   7. Keep the probe updating: `.github/workflows/probe.yml` pushes its daily commit straight to `main` with the job's `GITHUB_TOKEN`, which the ruleset now refuses.
      From the moment the ruleset exists until the follow-up pull request below merges, the probe's daily run fails at its push: that is visible, as a failed run and as the site's "checked" date ageing, and harmless, since `registry/probes.json` keeps its last results.
      Do not add GitHub Actions to the bypass list for it: every workflow run in the repository, on any branch, could then push to `main` past the ruleset.
      Give the probe a key that only runs on `main` can read instead: add a deploy key with write access (Settings -> Deploy keys -> Add deploy key, Allow write access).
      Store its private half as the secret `PROBE_DEPLOY_KEY` of a new environment `probe` whose only deployment branch is `main`, set up as in sub-steps 1 to 3.
      Add deploy keys to the ruleset's bypass list (the bypass actor type `DeployKey` in the REST API); that covers every deploy key of the repository, so keep this one its only key with write access.
      Then, in a follow-up pull request, split the probe into two jobs: one with no credentials runs `scripts/probe-live.mjs` and hands `registry/probes.json` on as an artifact.
      The other, a push job in the `probe` environment, checks that the artifact changes only that file, commits it and pushes with `PROBE_DEPLOY_KEY`.
      The key is then never on a runner that parses third-party responses; the same pull request updates `deploy-guards.test.mjs`, which pins the probe's job, to match.
      A push made with the deploy key starts the Pages deploy itself, as the `GITHUB_TOKEN` push never did, so the probe's explicit dispatch of `deploy.yml` becomes redundant; left in, the two runs share one concurrency group and the later cancels the earlier.
   8. Check, read-only: `gh api repos/kya-os/kya-os-usergroup/environments/production/deployment-branch-policies` lists exactly one policy, `main` of type `branch`.
      `gh api repos/kya-os/kya-os-usergroup/environments/production` shows `"can_admins_bypass": false`, and `gh api repos/kya-os/kya-os-usergroup/environments/production/secrets` lists the secrets above.
      Neither `gh api repos/kya-os/kya-os-usergroup/actions/secrets` nor `gh api repos/kya-os/kya-os-usergroup/actions/organization-secrets` lists any `CLOUDFLARE_` name.
      Then read the ruleset itself: `gh api repos/kya-os/kya-os-usergroup/rulesets` lists the ruleset `main` with its `id`.
      `gh api repos/kya-os/kya-os-usergroup/rulesets/<id>` shows `"enforcement": "active"` and the rules `deletion`, `non_fast_forward`, `pull_request` and `required_status_checks`.
      The last has `strict_required_status_checks_policy` false and one check, `"context": "validate"` with `"integration_id": 15368`, the GitHub Actions app (`gh api /apps/github-actions` shows that `id`).
      The ruleset's `bypass_actors` lists one actor, of `actor_type` `DeployKey` (sub-step 7), and no other; GitHub returns `bypass_actors` only to someone with write access to the ruleset, so a repository admin runs this check.
4. **Run the workflow**: Actions -> "Deploy badge worker" -> Run workflow (from `main`, in the order below).
   Once step 3 is done, a run on any other ref whose workflow file names the `production` environment fails before its job starts, and a dispatch from an older branch runs that branch's workflow file, which names no environment, so it starts and cannot deploy for lack of secrets.
   Until then, only a ref whose workflow file carries the main-only first step fails there, naming the ref, and a dispatch from an older branch can still deploy (see "What they do not check").
   On `main` it builds, freshness-checks the generated modules, verifies `PROVISIONED` and runs the full test suite.
   It then checks that both status lists and the credential of each allowlist entry at `verified` or `revoked`, as production serves them, verify under this worker (`node workers/badge/preflight.mjs`).
   Last, it runs the locked toolchain's `wrangler deploy` (see "What the workflows check") from `workers/badge/` onto the `builders.kya-os.org/badge/*` zone route.
5. **Verify the first deploy**:

   ```bash
   curl -sI https://builders.kya-os.org/badge/kya-os-mcp.svg
   ```

   Confirm the worker serves it: the `CF-Worker` header where Cloudflare emits it, and definitively the worker's own header signature - `cache-control: public, s-maxage=300` with `x-content-type-options: nosniff` (the static Pages tier serves its own cache headers on these paths).
   Then fetch the body and confirm it is byte-identical to `dist/badge/kya-os-mcp.svg` from a local build of the same commit - the parity assertion guarantees it, the curl proves it live.
6. **Remove the worker**: install the locked toolchain from the repository root, on Node 24, with `npm ci --ignore-scripts --prefix tools/deploy`.
   Then `../../tools/deploy/node_modules/.bin/wrangler delete` from `workers/badge/` removes the worker; requests on its route then go to the Pages site, which serves the static badge tier on the same paths.
   It needs `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` with step 2's two permissions in its environment.
   The deploy token lives only in the `production` environment, and GitHub never shows a stored secret again, so during an incident create a fresh token as in step 2 and revoke it in Cloudflare once the worker is gone.
   Without a token, remove the worker in the Cloudflare dashboard instead: Workers & Pages -> `kya-os-badge` -> Settings -> Delete, at the bottom, typing the worker's name to confirm.
   No embed ever changes in either direction.

### Deploy order

The worker and the documents it verifies ship separately: Cloudflare Pages deploys the credentials and status lists when a change merges to `main` (`.github/workflows/deploy.yml`), while the worker deploys only when this workflow is dispatched.
A worker that refuses the form the live documents are in renders every credential-backed badge `unverified`.
Since November 2026 (issue #52) the worker requires each proof to store the `@context` it was signed over, which documents issued before then did not, so the order is load-bearing:

- **Forward**: merge first, wait for the merge's Pages deploy to succeed, then dispatch from `main`.
  Merge only when no Pages deploy is in flight: the Pages concurrency group's name now carries the ref, so the merge's deploy does not cancel one still running under the old name, which could finish last and serve the older documents.
  Never dispatch while the merge's Pages deploy is still running, has failed or was cancelled: wait for it, or rerun it first.
  A preflight that fails just after a merge may be reading cached documents, which a cache rule on the `kya-os.org` zone could still serve after the Pages deploy, so re-run it later.
  Right after a Pages deploy, a Cloudflare location other than the one the preflight read from may still serve the earlier documents until its cache expires, so badges served there may show `unverified` for that time although the preflight passed.
- **Rollback**: roll back what failed, never the deploy guards with it.
  Do not revert a commit that changed the deploy workflows, the preflight (`preflight.mjs`, `preflight-checks.mjs`) or `deploy-guards.test.mjs` as a whole: that would drop the guards during the very rollback they protect.
  - A worker that misbehaves: remove it (step 6), and requests for the badges go to the static Pages tier again.
  - The documents: the operator must remove the worker first (step 6), since the live worker refuses older documents.
    Then restore the documents, with whatever code must accept them, in a pull request to `main` that leaves the deploy workflows, the preflight and `deploy-guards.test.mjs` as they are.
    Wait for its Pages deploy to succeed, then dispatch the worker from `main`; its preflight refuses the deploy unless the restored documents verify under it.
  - Rolling the Pages project back in Cloudflare's dashboard, or re-running an older Pages deploy run, brings older documents back too: the operator must remove the worker first.

What the workflows check:

- Both deploy jobs run in the `production` environment.
  Once a repository admin has set it up (step 3), its branch policy is what enforces `main` only: GitHub fails a job on any other ref before it starts, so it never reads the environment's secrets.
  A workflow that does not name the environment, such as the copy on an older branch, gets no Cloudflare secret at all and cannot deploy.
- The first step of each deploy job fails a run on any other ref, naming it, which stops an accidental dispatch.
  The probe's job (`.github/workflows/probe.yml`), which pushes its commit to `main`, opens with the same step, so a run dispatched on another ref fails there instead of pushing that ref's tree to `main`; its scheduled run starts on `main` and goes on as before.
- The Pages deploy runs on a push to `main` and on dispatch, the worker deploy on dispatch alone, and the probe on its schedule and on dispatch.
- Each deploy workflow's token can read the repository's contents and metadata, read-only, and nothing more.
  The probe's token can read the repository's metadata and has `contents: write` and `actions: write`, for its push and its dispatch of the Pages deploy, and nothing more.
  No job of the three sets permissions of its own.
- Each deploy workflow's concurrency group is scoped to the ref, so a run of these workflows on another ref cannot cancel a deploy from `main`, and within a group a later run cancels an earlier one.
  The probe's group is scoped to the ref too, so a run on another ref cannot take the place of a run from `main` waiting in it; within it a later run waits for the run in progress, taking the place of any run already waiting.
- Before the worker deploys, the step right before `wrangler deploy` runs `node workers/badge/preflight.mjs`.
  It fetches both status lists and the credential of each allowlist entry at `verified` or `revoked` as production serves them at that moment, checks them with this worker's own code, and refuses the deploy unless all of them verify.
  Those are the documents the worker fetches; a superseded credential that no entry names is not checked.
  A dispatch made while production still serves documents this worker refuses fails there, and the worker does not deploy.
  The preflight is a step of its own, whose environment holds no token, and it refuses when no check ran.
- Each deploy job runs on Node 24 and installs its toolchain from `tools/deploy/package-lock.json`, which pins wrangler 4.156.0 and every package it pulls in, for every platform, by integrity hash.
  `npm ci --ignore-scripts --prefix tools/deploy` installs exactly those bytes or fails, in a step with no secret in its environment and with install scripts off, so no package code runs while it installs.
  `setup-node`'s package-manager cache is off, so no npm cache saved by another run reaches the install, even once the root `package.json` names npm as its package manager, which would turn the cache on.
  The job deploys in one step, which runs the installed `wrangler` and installs nothing, so a new release of wrangler or of any package it pulls in reaches that step only through a change to the lockfile on `main`.
  The lockfile does not fix the Node that runs it, the Node 24.x `setup-node` resolves on the day, or GitHub's runner image (see "What they do not check").
  Its checkout keeps no token in the working copy (`persist-credentials: false`), since no later step pushes or calls GitHub.
- The deploy step is the only step whose environment holds the Cloudflare token.
  `.github/workflows/deploy.yml` and `.github/workflows/deploy-worker.yml` each set only `name`, `on`, `permissions`, `concurrency` and `jobs`, and their job only `runs-on`, `environment` and `steps`.
  Neither file sets an `env`, which would reach every step, or a `defaults`, which would set the shell or working directory of every `run` step, or any other key.
  The deploy step alone sets an `env`, and no `run` line in either file names `GITHUB_ENV` or `GITHUB_PATH`, the files through which a step sets the environment or the `PATH` of the steps after it, or names them as `github.env` or `github.path`, in any letter case.
  Every other step of the job runs this repository's own code, npm installing the locked toolchain with its scripts off, or `actions/checkout` or `actions/setup-node`, each pinned by full commit SHA with its release named beside it.
  Every step runs on GitHub's `ubuntu-latest` runner, in no job container and with no service container, and every step after `setup-node` runs on the Node 24 it installs.
  That is not isolation: the runner holds every secret the job references, so code in any step of the job could still read the token from it, or write those two files without naming them.
- `deploy-guards.test.mjs` pins these guards in `.github/workflows/deploy.yml` and `.github/workflows/deploy-worker.yml` themselves.
  For each deploy job it pins the environment, the triggers, the read-only token, the ref-scoped concurrency group in which a later run cancels an earlier one, and the workflow's and the job's keys, exactly those listed above.
  It pins the `ubuntu-latest` runner, Node 24 with no package-manager cache, the checkout that keeps no token, and the main-only first step with no `if` or `continue-on-error` on any later step.
  It pins one install with no secret before the deploy, and no `run` line that names `GITHUB_ENV` or `GITHUB_PATH` as above.
  It pins one deploy step, the only step that sets an `env`, which runs the locked `wrangler` from its directory with exactly its arguments.
  Those are `deploy` from `workers/badge/`, and `pages deploy dist --project-name=kya-os-usergroup --branch=main` from the repository root.
  No line outside the deploy step names a secret, a `#` line inside another step included, since GitHub reads the lines of a `run` script and of a step's name; only the YAML comments outside every step are passed over.
  It pins the worker's preflight in the step right before its deploy, and the probe's triggers, token permissions, ref-scoped concurrency group, main-only first step and one push.
  `preflight.test.mjs` pins the preflight's verdict.
  `deploy-guards.test.mjs` also holds the lockfile to `tools/deploy/package.json`, this runbook's commands to the same toolchain and its lockfile rewrite to the two commands under "Updating the pins", step 3's required check to the Validate workflow's job, and every workflow in the repository to those two actions at those commits.

What they do not check:

- Who can change `main`.
  Every guard above trusts `main`: the Pages deploy publishes whatever reaches it, and the worker deploys only from it, so `main` is the trust boundary.
  Until step 3's ruleset is in place, `main` has no branch protection, so anyone with write access can push to it directly, a change to the deploy toolchain's lockfile included, and that push deploys.
  The ruleset then requires a pull request and a passing `validate` check for every change, but no approving review, so one person with write access, an admin included, can still merge any change on their own, the lockfile and the workflows included.
- Dispatches from other refs, until step 3 is done.
  A dispatch runs the workflow file of the ref it names, and older branches carry deploy workflows without the main-only step, so until the repository-level Cloudflare secrets are gone, a dispatch from one of them deploys from that branch.
- A branch whose workflow names `main`'s concurrency group: its run can cancel a deploy from `main` in progress, so dispatch again from `main`.
  Once step 3 is done it cannot deploy itself; until then it can, as the item above says.
- What the locked packages do with the token: the lockfile fixes which package bytes the deploy step runs, not what they do, and a change to it merges like any other change to `main`, on a passing `validate` check, with no approving review required.
  No test checks the two-week rule ("Updating the pins") either, since only the npm registry knows when a package was published: the command there does.
- The Node and the runner image the deploy step runs on: `setup-node` sets up the Node 24.x it resolves on the day, on the image GitHub then serves as `ubuntu-latest`, and the lockfile fixes neither.
  Neither is pinned, on purpose: an exact Node version would hold back Node's security releases, and GitHub updates its runner images on its own schedule, whatever label a job names.
- Anything once the worker is live: a later rollback of the documents must follow the rollback order above.

### Updating the pins

Nothing updates the deploy toolchain or the actions on its own: each moves only with a change to `main` that moves its pin, made in a pull request once step 3's ruleset is in place.

- wrangler 4.156.0 is the newest release that had been public for two weeks when `tools/deploy/package-lock.json` was made: it was published on 2026-10-29.
  The two-week rule covers every package the lockfile holds, not wrangler alone: each was published at least two weeks before the lockfile was made.
  Two weeks give a broken or compromised release time to be found and pulled before a deploy runs it.
  To check it, list when each locked package was published, from the repository root, with one npm registry request for each package:

  ```bash
  node -p 'Object.entries(require("./tools/deploy/package-lock.json").packages).filter(([path]) => path).map(([path, { version }]) => path.split("node_modules/").at(-1) + " " + version).join("\n")' |
    while read -r name version; do echo "$(npm view "$name@$version" "time[$version]") $name@$version"; done | sort
  ```

  The last line, the newest package, must be at least two weeks older than the commit that last changed the lockfile (`git log -1 --format=%cI -- tools/deploy/package-lock.json`).
  Move to a later wrangler when a deploy needs a fix it carries, or for a security release, under the same rule.
  Set its version in `tools/deploy/package.json`, then, on Node 24 like the deploy jobs, delete the lockfile and write it afresh, from the repository root:

  ```bash
  rm tools/deploy/package-lock.json
  npm install --package-lock-only --ignore-scripts --before "$(node -p 'new Date(Date.now() - 14 * 86400000).toISOString()')" --prefix tools/deploy
  ```

  `node -p` gives the UTC instant 14 days before the command runs, the same way on macOS and Linux, and with `--before` npm resolves every package only among the releases published before that instant, so a wrangler version published after it fails the command.
  The command writes the lockfile without installing a package or running a script.
  Delete the old lockfile first: npm keeps every version a lockfile holds that still satisfies its range, however new, so `--before` would not reach those.
  Install the result as the deploy jobs do, with `npm ci --ignore-scripts --prefix tools/deploy`, and run `../../tools/deploy/node_modules/.bin/wrangler deploy --dry-run` from `workers/badge/`, which bundles the worker and uploads nothing.
  `deploy-guards.test.mjs` must pass: it holds the lockfile to `package.json`, this runbook's lockfile commands to the two above, and every wrangler version this runbook names to the one `package.json` pins, so the version above changes in the same pull request.
- `actions/checkout` and `actions/setup-node` are pinned by full commit SHA, the same in every workflow, with the release's tag in a comment beside it.
  To move one, take the commit the new release's tag points to (`gh api repos/actions/checkout/commits/<tag> --jq .sha` for checkout), and put its full SHA, with the tag beside it, in every workflow that runs the action.
  `deploy-guards.test.mjs` must pass: it holds each action to one full commit SHA across the workflows, its tag beside it, and the inputs the deploy jobs give each action to what they are now, so a release that renames an input changes the test too.

## Layout

```text
worker.mjs               routes, state resolution, the program context
                         policy, rendering (byte-identical to
                         site/lib/badge.mjs - build-asserted)
verify.mjs               JCS, base58btc/base64url, eddsa-jcs-2022 verify,
                         bitstring decode with capped inflation
preflight.mjs            the deploy preflight's command line: runs the
                         checks whenever it is loaded, by any path, and
                         exits 1 unless they ran and all verified
preflight-checks.mjs     the deploy preflight's checks and verdict: this
                         worker's own checks against the live documents,
                         before every deploy, no I/O of their own
wave.mjs                 the signature wave: seed from proof.proofValue,
                         badge bars (self-contained copy of the math in
                         site/lib/waveform.mjs - build-asserted)
generated-allowlist.mjs  GENERATED by site/build-pages.mjs - do not edit
generated-keys.mjs       GENERATED by site/build-pages.mjs - do not edit
fixtures/mint.mjs        in-test fixture mint: throwaway keys and Phase A
                         shaped documents, minted fresh per run, never
                         committed, never trusted
fixtures/vc-di-eddsa-b3.mjs
                         the specification's eddsa-jcs-2022 test vector
                         (VC Data Integrity EdDSA Cryptosuites v1.0,
                         Appendix B.3), verbatim; its key is published, so
                         nothing ever trusts it
fixtures/full-verifiers.mjs
                         both full verifiers on one world: the public
                         verifier run offline as a reader runs it, and this
                         worker's handler, each answering accepted, or
                         refused with its reason, at this machine's clock or
                         at a time the test gives them; a test that expects
                         a refusal holds each verifier to its reason
worker.test.mjs          node --test coverage: verify accept/reject, every
                         render state, rotation, purpose separation,
                         fail-close, routing
wave.test.mjs            the signature wave through the handler: drawn only
                         for the credential-backed states, one pattern per
                         credential, redrawn by a reissue
parity.test.mjs          cross-implementation parity vs scripts/lib/* (the
                         deliberate redundancy rule's enforcement): the
                         program constants, the program context and the
                         clock skew among them, equal on both sides, and
                         the scripts-mint -> worker-handler e2e
spec-conformance.test.mjs
                         both implementations against VC Data Integrity
                         EdDSA Cryptosuites v1.0, section 3.3: the Appendix
                         B.3 vector for both signers (signCredential and the
                         fixture's createProof), each listed section 3.3.2
                         case for both verifiers (the program's reading
                         marked where another implementation reads the text
                         differently), proof.created in both cryptosuite
                         implementations, signing and verifying (VC Data
                         Integrity 1.0 section 2.1, EdDSA Cryptosuites v1.0
                         section 3.3.5 step 3, marked the same way), and
                         every committed credential and status list on both
                         sides
context-policy.test.mjs  the public verifier and this worker reaching the
                         same verdict on committed documents with their
                         @context changed, and on documents signed with no
                         proof @context, with a bare-string @context in the
                         document and the proof, or for another purpose
created-rule.test.mjs    the public verifier and this worker both accepting
                         proof.created in every dateTimeStamp form, and both
                         refusing a proof without one, on a credential and
                         on a status list
validity-rule.test.mjs   the public verifier and this worker both holding
                         validFrom to the program's timestamp and the clock
                         skew, and refusing any validUntil, on a credential
                         and on each status list; each side's skew rule at
                         the boundary, and both verifiers at it to the
                         millisecond
full-verifiers.test.mjs  assertVerdicts (fixtures/full-verifiers.mjs), the
                         check the three tests above make on both verifiers'
                         verdicts: each passes only as expected, a refusal
                         only for the reason expected
preflight.test.mjs       the deploy preflight, offline: passes a live site
                         this worker verifies, refuses one it does not or
                         where no check ran, and its command line exits 1 on
                         any failure, a single one included, naming only
                         what failed, however it is started
fixtures/workflow-reader.mjs
                         the line reader deploy-guards.test.mjs reads the
                         workflow files with, which names any line it
                         cannot place
deploy-guards.test.mjs   the guards "What the workflows check" lists, read
                         from the workflow files; the lockfile against its
                         package.json, and the runbook against both
```

Independence note (deliberate redundancy rule): this worker never imports `scripts/` or `site/` code - it must stay self-contained for Cloudflare bundling, and the repo's house style is independent implementations cross-proving each other.
`parity.test.mjs`, `spec-conformance.test.mjs`, `context-policy.test.mjs`, `created-rule.test.mjs` and `validity-rule.test.mjs` are where the two crypto implementations meet, and the build's render checks import this worker's renderer read-only to assert badge-byte parity with the static tier.

## Tests

```bash
node --test workers/badge/*.test.mjs
```

Runs fully offline: fetch, cache, and keys are injected, and every signed fixture is minted in-test under throwaway keys that are not (and can never become) pinned production keys.
They are minted by `fixtures/mint.mjs` from this worker's own primitives, or, in the tests that hold both full verifiers to one verdict, by the scripts side's signer (`scripts/__tests__/fixtures/signed-documents.mjs`).
The one committed signed fixture is the specification's own test vector (`fixtures/vc-di-eddsa-b3.mjs`), which pins both implementations to the specification's bytes rather than to each other.
The tests that check the committed credentials and status lists read them from `registry/credentials/` and verify them against the committed pins.
