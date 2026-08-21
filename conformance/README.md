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
   A verified claim gets a credential at a canonical URL; your registry entry's `conformance.attestationUrl` points at it and the site renders the claim green.
   Live verified badges take over `builders.kya-os.org/badge/*` at Phase B of the program (see [`workers/badge/`](../workers/badge/) once it lands).

Honesty rules, enforced by the registry validator and the site build:

- A subset run is always labeled a subset with its categories; it never renders as a bare level.
- `verified` renders only with the credential link.
- Everything else renders as what it is: `in-verification` amber, `self-reported` grey.

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
