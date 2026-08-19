# KYA-OS Usergroup

The community hub for [KYA-OS](https://kya-os.org), the open protocol for verifiable AI-agent identity, delegation, and proof, donated to the [Decentralized Identity Foundation](https://identity.foundation) (DIF).

One repo, one page, three registries: **who builds on KYA-OS, what conforms to it, and the standards it carries.**
Everything here is a public pull request away, and nothing here requires touching protocol code.

## The hub

The site renders as a single page at **builders.kya-os.org** with six sections:

| Section | What it shows | Backed by |
| --- | --- | --- |
| `#conformance` | The conformance program, the suite pin, and the implementations table with honest status chips | `registry/builders/` entries with a `conformance` claim |
| `#builders` | Implementations, services, integrations, and marketplaces building on KYA-OS | `registry/builders/` (`kind`-grouped) |
| `#templates` | Copyable starting points, with one-click deploy buttons where they exist | `registry/builders/` (`kind: template`) |
| `#examples` | Working demonstrations of the protocol | `registry/builders/` (`kind: example`) |
| `#standards` | The standards rails: what KYA-OS provides, carries, and projects onto, with evidence | `registry/interop/` |
| `#submit` | The three submission paths below | - |

Machine-readable mirrors ship next to the page: [`/builders.json`](https://builders.kya-os.org/builders.json) and [`/interop.json`](https://builders.kya-os.org/interop.json), both with open CORS.

> **Open decision:** whether the page ultimately lives at the `builders.kya-os.org` subdomain or at a path under the main site has not been settled; nothing in the registry format depends on the outcome.

## What lives here

- `registry/builders/*.json` - one file per project building on KYA-OS (`registry/schema/builder.schema.json`).
- `registry/interop/*.json` - one file per standards rail, with grounded status and evidence (`registry/schema/interop.schema.json`).
- `conformance/` - the conformance program docs and the [starter template](conformance/starter/) (fold-in of the former conformance-starter repo).
- `workers/badge/` - the Phase B badge worker scaffold for `badge.kya-os.org` (not deployable yet; see its README).
- `site/build-pages.mjs` - renders both registries into the static site. Zero npm dependencies, deterministic output.
- `scripts/validate.mjs` - dependency-free structural validation of both registries, run by CI and by the build.

## Get listed: three paths

### 1. The prefilled link (fastest)

Open this link and GitHub does the rest - the new-file editor opens on `registry/builders/` with the entry template already filled in; rename the file to `<your-slug>.json`, edit the fields, and propose the change.
GitHub forks the repo for you and opens the pull request:

```text
https://github.com/kya-os/kya-os-usergroup/new/main/registry/builders?filename=your-project.json&value=%7B%0A%20%20%22name%22%3A%20%22Your%20Project%22%2C%0A%20%20%22slug%22%3A%20%22your-project%22%2C%0A%20%20%22description%22%3A%20%22One%20or%20two%20sentences%20on%20what%20you%20ship%20on%20KYA-OS.%22%2C%0A%20%20%22homepage%22%3A%20%22https%3A%2F%2Fexample.com%22%2C%0A%20%20%22repo%22%3A%20%22https%3A%2F%2Fgithub.com%2Fyour-org%2Fyour-project%22%2C%0A%20%20%22kind%22%3A%20%22implementation%22%2C%0A%20%20%22buildsOn%22%3A%20%5B%0A%20%20%20%20%22kya-os-mcp%22%0A%20%20%5D%2C%0A%20%20%22contact%22%3A%20%7B%0A%20%20%20%20%22github%22%3A%20%22your-github-username%22%0A%20%20%7D%2C%0A%20%20%22listedAt%22%3A%20%22YYYY-MM-DD%22%0A%7D%0A
```

(The same button renders as **[Add your project ->]** on the site.)

### 2. The template file

Copy `registry/builders/example-builder.json` to `registry/builders/<your-slug>.json`, fill in your details, run `npm test` (no dependencies to install; Node 20+), and open a PR with DCO sign-off.
Field-by-field guidance is in [CONTRIBUTING.md](CONTRIBUTING.md).

### 3. A conformance claim

Run the pinned vector suite (the [starter](conformance/starter/) automates it), open a [conformance submission issue](https://github.com/decentralized-identity/kya-os-mcp/issues/new?template=conformance_submission.md) on kya-os-mcp with your `claim.json`, and add or update your registry entry with the `conformance` block.
The full flow is in [conformance/README.md](conformance/README.md).

## Honest conformance language

The registry renders what an entry proves, nothing more:

- A subset claim always names its categories ("L1 subset (signed-proof)") and never renders as a bare level.
- `verified` renders green only as a link to the verification credential; `in-verification` is amber; `self-reported` is grey.
- Non-verified chips link their public grounding (`conformance.evidenceUrl`, e.g. the submission issue) when the entry carries one, so the middle tiers are auditable too.
- A claim is an attestation of an observed re-run, never a seal of approval, and listing implies no endorsement by the working group (see [GOVERNANCE.md](GOVERNANCE.md)).
- Live badges at `badge.kya-os.org` ship at Phase B of the program.

## Related

- [kya-os.org](https://kya-os.org) - the KYA-OS protocol site and specification.
- [decentralized-identity/kya-os-mcp](https://github.com/decentralized-identity/kya-os-mcp) - the donated core: MCP binding spec, reference implementation, protocol schemas, and the conformance suite.
- [schema.kya-os.org](https://schema.kya-os.org) - the canonical JSON Schema registry for the protocol.
- [DIF Trusted AI Agents Working Group](https://github.com/decentralized-identity/trusted-ai-agents) (TAAWG) - the DIF working group KYA-OS work happens under.

## License

[MIT](LICENSE).
Contributions require [DCO](DCO) sign-off.
