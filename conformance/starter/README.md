# KYA-OS conformance starter

Prove your KYA-OS implementation against the published conformance vector suite and emit a submission-ready claim.
Clone to `report.json` in under an hour if your implementation already exists.

## What conformance means here (language-neutral)

Conformance is two things and nothing more:

1. Verify the committed vector files: run every vector in `suite/vectors/*.json` through your implementation and record accept/reject.
2. Emit the published report contract: write a `report.json` matching [examples/report.contract.md](./examples/report.contract.md) exactly.

Any language that can read JSON and do Ed25519 + SHA-256 can do this.
The TypeScript adapter in this template is one door, not the door.
The upstream repo's [`conformance/verify.py`](https://github.com/decentralized-identity/kya-os-mcp/blob/v1.14.1/conformance/verify.py) is the precedent: a pure-stdlib Python verifier that reads the same vector files and shares zero code with the reference implementation.

## What a claim is (read this before submitting)

- The conformance program attests exactly the bytes it re-runs at your pinned commit.
  Your `claim.json` is the input to that re-run, not a badge.
- A subset run is always labeled a subset.
  `scripts/make-claim.mjs` refuses to stamp `scope: full` on a report that did not run every category.
- The suite is fetched at a pinned ref and hash-verified.
  If the bytes drift, the fetch fails loudly instead of quietly testing against something else.

## The under-an-hour path

The hour budgets wiring an existing implementation to the vectors.
It does not budget building a KYA-OS implementation; if you do not have one yet, start with the [spec and reference implementation](https://github.com/decentralized-identity/kya-os-mcp).

### 0:00 - Copy and install

This starter lives at `conformance/starter/` inside [kya-os/kya-os-usergroup](https://github.com/kya-os/kya-os-usergroup).
Copy the directory into a repo of your own (the claim pins YOUR git commit, so it has to live in your history):

```bash
git clone --depth 1 https://github.com/kya-os/kya-os-usergroup
cp -r kya-os-usergroup/conformance/starter my-kya-conformance
cd my-kya-conformance
git init && git add -A && git commit -s -m "chore: seed from kya-os-usergroup conformance/starter"
npm install
```

Set `name`, `version`, and your repo URL in `package.json` to your implementation's.
`make-claim` refuses the template placeholder name on purpose.
The copied `.github/workflows/conformance.yml` activates as soon as the copy is a repo root; inside `kya-os-usergroup` it is inert (Actions only reads the repo-root `.github/`).

### 0:05 - Fetch the pinned suite

```bash
npm run fetch-suite
```

The `@kya-os/mcp` npm tarball does not ship `conformance/` (its files allowlist is `dist`, `schemas`, and docs), so the suite is fetched from GitHub at the pinned ref `v1.14.1` into `suite/`:
the `ConformanceAdapter` contract (`types.ts`), the loader and runner, `verify.py`, and all nine vector files (44 vectors).
The script computes the vector-set hash with the exact published recipe and verifies it against the pinned expectation:

```text
vectorSetHash: sha256:81d537d4574d3f66d651a03ca41c0b18493b67ea6f3e61aba47d1bda4f3cf49b
```

Compare that hash against the signed suite manifest for the release you pin.
To pin a newer release, update `PINNED_REF` and `EXPECTED_VECTOR_SET_HASH` together in `scripts/fetch-suite.mjs`.

### 0:10 - Wire your implementation (pick a door)

**Door A - TypeScript adapter.**
Implement the nine methods in [`src/adapter.ts`](./src/adapter.ts).
Each stub's TODO cites what the reference adapter does with the same input; wire your own primitives, do not port the reference logic.
Implemented methods must be fail-closed: return `{ outcome: 'fail' }` on any error, never throw.
Then:

```bash
npm run conformance   # typechecks, compiles, runs all 44 vectors, writes report.json
```

**Door B - bring your own harness, any language.**
Read `suite/vectors/*.json` directly (the file shape is documented at the bottom of the report contract), run each vector's `input` through your implementation, and emit `report.json` matching [examples/report.contract.md](./examples/report.contract.md) exactly.
`verify.py` in the upstream repo is the working precedent for this door.
Everything downstream (`npm run claim`, CI, submission) treats both doors identically.

### 0:50 - Generate the claim

```bash
npm run claim -- --subject https://your-org.example --level L2
```

Merges `report.json`, your package metadata, `git rev-parse HEAD`, and the verified suite hash into `claim.json`.
It refuses a failing or malformed report, a dirty working tree, `scope: full` without full category coverage, and placeholder metadata.
Levels (`L1` core crypto, `L2` full session, `L3` full delegation) are defined in [CONFORMANCE.md](https://github.com/decentralized-identity/kya-os-mcp/blob/v1.14.1/CONFORMANCE.md); claim the level whose requirements you meet.

### 0:55 - Submit

Open a submission issue on [decentralized-identity/kya-os-mcp](https://github.com/decentralized-identity/kya-os-mcp/issues/new) titled `Conformance claim: <name> <version>` and attach `claim.json`.
The program re-runs your suite at `implementation.digest.gitCommit` and attests what it observes.

## The claim shape

```json
{
  "claim": "kya-os-conformance-claim@v1",
  "subject": "<https-url-or-did>",
  "implementation": {
    "name": "acme-kya",
    "version": "0.3.0",
    "repo": "https://github.com/acme/acme-kya",
    "digest": { "gitCommit": "<40-hex>" }
  },
  "level": "L1 | L2 | L3",
  "scope": "full | subset",
  "categories": ["..."],
  "suite": {
    "package": "@kya-os/mcp",
    "packageVersion": "1.14.1",
    "suiteVersion": "1.0.0",
    "vectorSetHash": "sha256:..."
  },
  "report": { "...": "the full report, embedded verbatim" },
  "ranAt": "ISO 8601"
}
```

The vector-set hash recipe, exactly:
per vector file, SHA-256 of the raw committed bytes; build the array of `[filename, hexdigest]` pairs sorted by filename; canonicalize that array with RFC 8785 JCS; SHA-256 the JCS bytes; prefix `sha256:`.

## The suite at v1.14.1

| category | vectors | adapter method |
| --- | --- | --- |
| `signed-proof` | 5 | `verifySignedProof` |
| `delegation-chain` | 6 | `verifyDelegationChain` |
| `status-list` | 2 | `verifyStatusList` |
| `did-key-resolution` | 3 | `resolveDidKey` |
| `did-web-resolution` | 3 | `resolveDidWeb` |
| `card-proof` | 7 | `verifyCardProof` |
| `entity-card` | 7 | `verifyEntityCard` |
| `audit-integrity` | 3 | `verifyAuditIntegrity` |
| `negotiation` | 8 | `evaluateNegotiation` |

Vectors carry fully-formed, pre-signed artifacts, so every vector reproduces against any implementation without re-signing, and `fail` vectors (tampered proofs, broken chains, revoked credentials) pass the suite only when you correctly reject them.

## CI

[.github/workflows/conformance.yml](./.github/workflows/conformance.yml) runs on push and manual dispatch: fetch and hash-verify the suite, typecheck, run the adapter, upload `report.json` and `claim.json` as artifacts, and print the claim summary in the job summary.
While `src/adapter.ts` still contains `NotImplementedError` stubs the conformance run is informational; once the stubs are gone (or the repo variable `REPORT_EXPECTED` is `true`) the run gates the job.
Set repo variables `CLAIM_SUBJECT` and `CLAIM_LEVEL` (optionally `CLAIM_SCOPE`) to have CI generate `claim.json`.

## Layout

```text
scripts/fetch-suite.mjs     fetch + hash-verify the pinned suite (node builtins only)
scripts/make-claim.mjs      report + git + suite manifest -> claim.json, with refusals
src/adapter.ts              your ConformanceAdapter (nine stubs to fill)
src/run.ts                  fetched loader + runner -> report.json
suite/                      fetched at the pinned ref (gitignored, never vendored)
examples/report.contract.md the exact report.json contract for any-language harnesses
.github/workflows/          the CI described above
```

## License and contributions

MIT, KYA-OS contributors.
Contributions require a DCO sign-off (`git commit -s`); see [CONTRIBUTING.md](./CONTRIBUTING.md).
