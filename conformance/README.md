# The KYA-OS conformance program

Conformance to KYA-OS is measured, not asserted.
The program attests exactly the bytes it re-runs: your claim pins your git commit and the suite it ran, and an independent re-run of that pin is what earns the credential.
Nothing here hands out titles and nothing here is gatekept - the suite is public, the claim format is public, and every step happens in public issues and pull requests.
What you get is an attestation of an observed re-run, no more and no less.

## What conformance means

The requirements live in [CONFORMANCE.md](https://github.com/decentralized-identity/kya-os-mcp/blob/main/CONFORMANCE.md) on the spec repo, split into three levels:

- **L1 - core crypto**: Ed25519/`did:key`, RFC 8785 JCS hashing, EdDSA JWS sign and verify.
- **L2 - full session**: handshake, nonce and skew rules, detached proofs over request/response hashes.
- **L3 - full delegation**: delegation chains, attenuation invariants, revocation.

The measurement instrument is the published vector suite: suite `1.0.0`, 44 vectors across nine categories, pinned by vector-set hash

```text
sha256:81d537d4574d3f66d651a03ca41c0b18493b67ea6f3e61aba47d1bda4f3cf49b
```

The hash recipe and the per-release pin live in [`starter/scripts/fetch-suite.mjs`](./starter/scripts/fetch-suite.mjs), which verifies the fetched bytes against it and fails loudly on drift.
The signed per-release suite manifest (the durable home for that pin) is published with each Phase A release; until then the pin above, committed in this repo and in the starter, is the source of truth.

## The claim flow

1. **Run the suite.**
   Wire your implementation to the 44 vectors and produce a `report.json`.
   The [starter](./starter/) automates fetch, hash-verify, run, and report through either door: the TypeScript adapter, or bring-your-own-harness in any language.
2. **Submit the claim.**
   `npm run claim` merges your report, package metadata, git commit, and the verified suite pin into a `claim.json`.
   Open a [conformance submission issue](https://github.com/kya-os/kya-os-usergroup/issues/new?template=conformance_submission.yml) on this repository - the registry your claim ends up in - and attach it.
   Claims already in flight on the spec repo (such as [kya-os-mcp#149](https://github.com/decentralized-identity/kya-os-mcp/issues/149)) remain valid: the program reads both, new submissions come here.
3. **Independent re-run.**
   The program re-runs your suite at the pinned commit and attests what it observes - not what the claim says.
4. **Credential + badge.**
   A verified claim gets a signed W3C VC 2.0 credential at a canonical URL (`https://builders.kya-os.org/credentials/<id>.json`); your registry entry's `conformance.attestationUrl` points at it, the site build cryptographically re-verifies it on every deploy, and only then renders the claim green.
   The issuance mechanics and key custody live in [Issuance and custody (v1.5)](#issuance-and-custody-v15) below.
   Phase B upgrades the badge URLs from build-time to request-time verification (see [`workers/badge/`](../workers/badge/)).

Honesty rules, enforced by the registry validator and the site build:

- A subset run is always labeled a subset with its categories; it never renders as a bare level.
- `verified` renders only with the credential link.
- Everything else renders as what it is: `in-verification` amber, `self-reported` grey.

## Issuance and custody (v1.5)

### The model

Issuance is a locked workflow behind a human gate.
The program's three Ed25519 keys live only as GitHub **environment secrets** in a protected environment named `conformance-issuance`: K-issuer signs credentials, K-status signs the revocation and suspension status lists (a separate key on purpose, so a stolen issuer key can never clear its own revocation bits), and K-log is reserved for the Phase C transparency log.
Their public halves are committed at [`registry/keys/program-keys.json`](../registry/keys/program-keys.json) and published as `did:web:builders.kya-os.org` at `/.well-known/did.json`.
After the one-time setup below, the private keys never touch a laptop again.

Approving the workflow run is the human act of issuance.
Running [`issue-credential.yml`](../.github/workflows/issue-credential.yml) blocks until the environment's required reviewer(s) approve it; the locked script then validates every input against the registry entry, signs the credential and both status lists, re-verifies everything (including a full site build, which is itself a cryptographic verifier), and opens a PR.
That PR is the auditable issuance record; merging deploys.
The script refuses to sign on any mismatch: unprovisioned keys, a private key whose public half is not committed, an entry that is not `in-verification`, or a claim that differs from the entry in level, scope, or categories.
[`revoke-credential.yml`](../.github/workflows/revoke-credential.yml) runs the same gate for revocation (terminal), suspension (renders "under appeal"), and unsuspension.

Until real keys exist, `program-keys.json` carries an `unprovisioned` sentinel and everything fails closed on it: the build refuses any credential or verified entry, no `did.json` is emitted, the verifier answers `INVALID`, and nothing anywhere renders green.

### Maintainer setup (one time)

1. Create the environment: repo Settings -> Environments -> New environment -> name it exactly `conformance-issuance`.
2. Add required reviewers: start with one (yourself is fine - it is an auditable pause, honestly described in the threat note below).
   At charter, add a second reviewer and enable "Prevent self-review": that is the settings-only upgrade to true two-person control, zero code changes.
3. On a trusted machine, run the offline ceremony: `node scripts/generate-program-keys.mjs` (no network I/O; generates all three keypairs).
4. Paste the three printed private keys into the environment's secrets (Environment secrets, not repository secrets): `K_ISSUER_PRIVATE`, `K_STATUS_PRIVATE`, `K_LOG_PRIVATE`.
5. Delete your terminal scrollback and shell history.
   The private keys now exist only inside the environment.
6. Commit the public key file the ceremony wrote (`registry/keys/program-keys.json`) via PR.
   When it merges, the site starts serving `/.well-known/did.json` and issuance is live.
7. Sanity check: `npm test` is green, and `node scripts/verify-credential.mjs` on any later credential answers `VERIFIED`.

### Upgrade path

- **Reviewers**: one required reviewer today; two plus prevent-self-review at charter (settings only, see step 2).
- **Custody**: the environment-secret model is deliberately the simplest thing that keeps keys out of laptops and puts a human approval and a public PR around every signature.
  A chartered working group can move the same public keys to WG-held custody or an HSM without changing the credential format: the verification method is `did:web`, so custody is an implementation detail behind the DID document.
- **Rotation**: supported by design - generate a new keypair, append its public half to `program-keys.json` with the next id (`conformance-<purpose>-2`) and a fresh `createdAt`, swap the environment secret, and keep the old public key in the file until every credential signed under it is reissued.
  `node scripts/generate-program-keys.mjs --rotate` prints the full procedure.

### Verify it yourself

Every credential is verifiable offline against the public keys committed in this repo - you trust git history and the review gates around it, not the site:

```bash
git clone --depth 1 https://github.com/kya-os/kya-os-usergroup && cd kya-os-usergroup
curl -s https://builders.kya-os.org/credentials/<id>.json | node scripts/verify-credential.mjs -
```

The verdict JSON reports `VERIFIED`, `SUSPENDED`, `REVOKED`, or `INVALID` (exit codes 0, 2, 3, 1) with per-check detail: schema (including the deliberate absence of `validUntil` - a credential asserts a test result at a pinned suite version and code digest, and currency is judged against the suite manifest, not a clock), proof (against the committed issuer key), and status (both signed lists, verified before any bit is read).

### Threat note, honestly

A GitHub org admin who compromises the org can add themselves as an environment reviewer, or remove the protection, and trigger a signing run.
The design does not pretend otherwise; it bounds the blast radius instead:

- **Publication in git**: a signature only reaches anyone through a public PR on this repository, every issuance names its verdict thread, and the workflow approval log records who approved what.
  A forged credential that never lands on `main` verifies against the keys but is served nowhere and linked by no entry; the build refuses orphan credentials that are not revoked.
- **Revocation**: the status lists are signed by a separate key and re-signed through the same gated workflow, so a discovered forgery is revocable in one PR.
- **Semantics**: a credential asserts one observed test result, nothing more - not an endorsement, not an audit, not a warranty.
  The worst a stolen key can mint is a false test report with a public paper trail.
- **What one reviewer does and does not give you**: with a single required reviewer, the gate is an auditable pause plus GitHub's approval record, not two-person control; the settings-only upgrade at charter closes that gap.

## Quickstart

```bash
git clone --depth 1 https://github.com/kya-os/kya-os-usergroup
cp -r kya-os-usergroup/conformance/starter my-kya-conformance
cd my-kya-conformance && npm install && npm run fetch-suite
```

Then follow [starter/README.md](./starter/README.md) - the budget from existing implementation to submission-ready `claim.json` is under an hour.

## About the nested workflow

`starter/.github/workflows/conformance.yml` is part of the template you copy.
Inside this repository it is **inert**: GitHub Actions only reads workflows from the repo-root `.github/` directory, so a workflow file nested under `conformance/starter/` never runs here.
It activates in your copy, where it sits at the repo root.
