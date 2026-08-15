# Contributing

Thanks for building on KYA-OS.
This repo exists so you can list yourself: the whole contribution surface is one JSON file and one pull request.

## Add your project to the registry

### 1. Fork and branch

Fork [decentralized-identity/kya-os-usergroup](https://github.com/decentralized-identity/kya-os-usergroup) and create a branch.

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
| `slug` | yes | `^[a-z0-9-]{2,40}$`, must equal the filename (`<slug>.json`), unique |
| `description` | yes | 280 characters max |
| `homepage` | yes | `https://` URL |
| `repo` | no | `https://` URL |
| `categories` | no | any of `implementation`, `integration`, `tooling`, `demo`, `research`, `service` |
| `kyaOsRepos` | no | which KYA-OS packages/specs you build on (e.g. `kya-os-mcp`, `schema`) |
| `contact` | no | object with `email` and/or `github` |
| `listedAt` | yes | date added, `YYYY-MM-DD` |

No other properties are allowed.
The template entry (`example-builder.json`) stays in the repo and is never rendered on the site; do not edit it, copy it.

### 3. Validate locally

```sh
npm test
```

This runs `scripts/validate.mjs` (structural validation of every entry) and `site/build-pages.mjs` (the site must render).
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
- **Working links.** `homepage` and `repo` resolve and point at the described project.
- **No trademark abuse.** The name and description do not misappropriate KYA-OS, DIF, or third-party marks, and do not imply endorsement or official status that has not been granted.
- **Accurate description.** The description says what the project does, without spam or unrelated promotion.

Entries that stop meeting the criteria (dead links, abandoned squats) may be removed by maintainers.

## Everything else

Changes to the schema, the validator, the site, or the workflows are welcome as issues or PRs, but expect more discussion than a registry entry.
DCO sign-off is required for every contribution.
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
