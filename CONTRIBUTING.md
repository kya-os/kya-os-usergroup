# Contributing

Thanks for building on KYA-OS.
This repo exists so you can list yourself: the whole contribution surface is one JSON file and one pull request.
The fastest path is the prefilled link in the [README](README.md#1-the-prefilled-link-fastest) (or the **[Add your project ->]** button on the site); everything below is the same flow done by hand, plus the field reference.

## Add your project to the registry

### 1. Fork and branch

Fork [kya-os/kya-os-usergroup](https://github.com/kya-os/kya-os-usergroup) and create a branch.
(The prefilled link does this for you.)

### 2. Add your entry

Copy the template:

```sh
cp registry/builders/example-builder.json registry/builders/<your-slug>.json
```

Fill in your details.
Every entry must conform to [`registry/schema/builder.schema.json`](registry/schema/builder.schema.json):

| Field | Required | Rules |
| --- | --- | --- |
| `name` | yes | 1-80 characters |
| `slug` | yes | `^[a-z0-9-]{2,40}$`, must equal the filename (`<slug>.json`), unique across builders AND interop - convention: your repo name, lowercased |
| `description` | yes | 280 characters max |
| `homepage` | yes | `https://` URL |
| `repo` | no | `https://` URL |
| `kind` | yes | one of `implementation`, `service`, `template`, `example`, `integration`, `marketplace` (see below) |
| `buildsOn` | no | which KYA-OS repos you build on: `kya-os-mcp` (the reference implementation - also the right slug if you consume the `@kya-os/mcp` npm package), `kya-os-schema` (the published schemas at schema.kya-os.org), `kya-os` (the spec text), `spec` (protocol-level work). List what you build ON, not yourself - a project that is one of these repos lists only its upstreams |
| `standards` | no | interop-registry slugs you exercise; each must exist as `registry/interop/<slug>.json` |
| `conformance` | no | a conformance claim (see below) |
| `probeUrl` | no | `https://` URL of your live MCP endpoint; `service` and `implementation` kinds only (see below) |
| `deploy` | no | one-click deploy targets: `{platform, url}` with platform one of `vercel`, `railway`, `cloudflare`, `docker`, `other` |
| `contact` | no | object with `email` and/or `github` |
| `listedAt` | yes | date added, `YYYY-MM-DD` |

No other properties are allowed.
The template entry (`example-builder.json`) stays in the repo and is never rendered on the site; do not edit it, copy it.

### Picking your `kind`

`kind` decides which section of the site renders you:

- **`implementation`** - you implement the protocol itself (an SDK, a library, an independent verifier). Renders under `#builders`, and this is the kind that usually carries a `conformance` claim.
- **`service`** - you run something live that speaks KYA-OS (a hosted server, a demo endpoint) or hosts KYA-OS artifacts at stable URLs (a schema host, a registry). Include the live URL as `homepage`.
- **`integration`** - you wire KYA-OS into another product or ecosystem.
- **`marketplace`** - you list or distribute KYA-OS-speaking agents/servers.
- **`template`** - you ship a copyable starting point. Add `deploy` targets and the site renders one-click deploy buttons.
- **`example`** - a working demonstration to read and steal from. A pinned repo directory is a fine `homepage`.

### Claiming conformance

A `conformance` block states what you proved against the [pinned vector suite](conformance/README.md):

```json
"conformance": {
  "level": "L1",
  "scope": "subset",
  "categories": ["signed-proof"],
  "suiteVersion": "1.0.0",
  "status": "in-verification",
  "evidenceUrl": "https://github.com/kya-os/kya-os-usergroup/issues/123"
}
```

- `scope: "subset"` requires `categories` - a subset never renders as a bare level.
- `status` starts at `self-reported`; it becomes `in-verification` when your [submission issue](https://github.com/kya-os/kya-os-usergroup/issues/new?template=conformance_submission.yml) is open on this repo, and `verified` only when the program's re-run issues a credential - at which point `attestationUrl` (the credential's canonical URL) is required.
  (Claims already in flight as issues on the spec repo remain valid `evidenceUrl` targets; new submission issues open here.)
  The validator enforces both rules, and the site renders `verified` green only as a link to that credential.
- `evidenceUrl` (optional, strongly recommended) is the public record grounding a non-verified claim - your submission issue or verification thread.
  The site renders `self-reported` and `in-verification` chips as links to it, so put it on the entry as soon as the issue exists.
- Run the suite first: the [conformance starter](conformance/starter/) takes you from an existing implementation to a submission-ready `claim.json` in under an hour.

### Proving live enforcement (`probeUrl`)

Add `probeUrl` to a `service` entry and once a day the probe sends one bare JSON-RPC request - no proof, no capability declaration - to that endpoint, committing what the wire answered to [`registry/probes.json`](registry/probes.json) and rendering it dated on the directory: the protocol's own refusal renders as enforcement verified, and unreachable means the probe could not classify the answer.
An endpoint that serves the bare request renders as `open (no proof required)` - stated honestly, never punitively.

### 3. Validate locally

```sh
npm test
```

This runs `scripts/validate.mjs` (structural validation of every entry in both registries), `site/build-pages.mjs` (the site must render, and it regenerates `workers/badge/generated-allowlist.mjs` - commit it if it changed), and the badge worker tests.
There are no dependencies to install; Node 20+ is all you need.

### 4. Open a pull request

- Sign off every commit for the [Developer Certificate of Origin](DCO): `git commit -s`.
- Fill in the pull request template checklist.

### 5. CI validates

The `validate` workflow runs the same validation and build on your PR.
A red check means your entry does not conform; the log lists every error per file.

### 6. Review and merge

A maintainer reviews your entry against the criteria below and merges it.

### 7. Auto-deploy

On merge to `main`, the `deploy` workflow re-validates, rebuilds, and publishes the site to Cloudflare Pages.
Your entry appears on the rendered page and in `builders.json` within minutes.

## Entry review criteria

Maintainers check that:

- **Real project.** The entry describes something that exists and demonstrably builds on KYA-OS - not a placeholder, a squat, or an announcement of intent.
- **Working links.** `homepage`, `repo`, and any `deploy` or `attestationUrl` links resolve and point at the described project.
- **Accurate claims.** `standards` slugs match what the project actually exercises, and `conformance` matches the public record (the submission issue or the credential). Overclaiming is grounds for rejection.
- **No trademark abuse.** The name and description do not misappropriate KYA-OS, DIF, or third-party marks, and do not imply endorsement or official status that has not been granted.
- **Accurate description.** The description says what the project does, without spam or unrelated promotion.

Entries that stop meeting the criteria (dead links, abandoned squats, claims that no longer hold) may be removed by maintainers.

## Adding a standards rail (registry/interop/)

Interop entries state, with evidence, how KYA-OS relates to an external standard; they are held to a stricter bar than builder entries because the site presents them as ground truth.
`shipping` and `specified` require an `evidence` URL, a status is never listed above what the evidence shows, and mixed maturity lists the conservative tier with the detail in `notes`.
Expect maintainers to check the evidence link before merging.

## Everything else

Changes to the schemas, the validator, the site, the conformance program docs, or the badge worker are welcome as issues or PRs, but expect more discussion than a registry entry - and anything that changes what a listing MEANS goes to the working group first (see [GOVERNANCE.md](GOVERNANCE.md)).
DCO sign-off is required for every contribution.
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
