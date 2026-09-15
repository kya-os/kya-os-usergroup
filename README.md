# KYA-OS Usergroup

The community hub for [KYA-OS](https://kya-os.org), the open protocol for verifiable AI-agent identity, delegation, and proof, donated to the [Decentralized Identity Foundation](https://identity.foundation) (DIF).

One repo, one page, three registries: **who builds on KYA-OS, what conforms to it, and the standards it carries.**
Everything here is a public pull request away, and nothing here requires touching protocol code.

## The hub

The site renders as six pages at **builders.kya-os.org**:

| Page | What it shows | Backed by |
| --- | --- | --- |
| `/` | The overview: hero, live stats strip (suite pin, vectors, rails, projects), the THE RAILS panel, four navigation cards | build-time counts |
| `/builders/` | The directory: every registry entry as a filterable, expandable row (CSS-only filter, native `<details>`), the on-ramps, and the three submission paths | `registry/builders/` |
| `/conformance/` | The program: the suite pin, the four-step pipeline, badge anatomy, levels, the verification state machine, and the implementations table with honest status chips | `registry/builders/` entries with a `conformance` claim |
| `/standards/` | The standards rails matrix: what KYA-OS provides, carries, and projects onto, every row grounded, dated, and expandable to its evidence | `registry/interop/` |
| `/rails/` | The protocol rails diagram: one identity in, one signed proof, every surface out | static + live rail count |
| `/use-cases/` | The REVOKED flagship and the recipe grid | static |

The design language is the KYA-OS Builders Site handoff: `#0a0a0a` canvas with a fixed dot grid, Space Grotesk display, JetBrains Mono micro-labels, `#00ff88` signal green, and seeded "signed proof" waveforms - computed at BUILD TIME (`site/lib/waveform.mjs`, the same FNV-1a/LCG math as Checkpoint's proof-waveform, emitted as static SVG).
Where an entry has a credential, its wave is seeded by that credential's signature (`proof.proofValue`), so the wave is the credential's signature fingerprint: the directory row and the `/badge/<slug>.svg` you embed draw the same bars, and a reissued credential redraws them.
It ships as two real stylesheets (`site/assets/css/tokens.css` + `hub.css`); the dark side is the design, the light side is the hub's own paper/ink/darkened-green mapping, and both hold a 4.5:1 text-contrast floor.
Every page ships exactly one inline script: the theme toggle (system, light, dark), which also gates the page choreography behind an `html.js-anim` class unless `prefers-reduced-motion` is set, and arms a 2.5s failsafe that releases the gate if the motion module never loads.
The motion itself - title decrypt, staggered fadeUp entries, hover glitch, scroll skew, the 400ms fade page transition - runs from the same-origin `/ui/page-fx.js` module; without JavaScript (or with reduced motion) the site is fully visible with native navigation.
Key sections also carry `[ copy prompt for your agent ]` buttons (`/ui/copy-prompt.js`): curated onboarding prompts for coding agents, each with an always-reachable `<details>` fallback that the build asserts carries exactly the text the button copies.
The inline script is sha256-pinned in the CSP (`script-src 'self' 'sha256-...'`), and build assertions fail if script and policy drift or if any `dist/ui/` module is not a byte copy of its committed source.
Typography is self-hosted: the two brand faces (Space Grotesk, JetBrains Mono) ship as committed variable woff2 files under `site/assets/fonts/` with their OFL licenses, copied to `/fonts/` at build time.

Machine-readable mirrors ship next to the pages: [`/builders.json`](https://builders.kya-os.org/builders.json) and [`/interop.json`](https://builders.kya-os.org/interop.json), both with open CORS.

> **Open decision:** whether the site ultimately lives at the `builders.kya-os.org` subdomain or at a path under the main site has not been settled; nothing in the registry format depends on the outcome.

## What lives here

- `registry/builders/*.json` - one file per project building on KYA-OS (`registry/schema/builder.schema.json`).
- `registry/interop/*.json` - one file per standards rail, with grounded status and evidence (`registry/schema/interop.schema.json`).
- `conformance/` - the conformance program docs and the [starter template](conformance/starter/) (fold-in of the former conformance-starter repo).
- `workers/badge/` - the Phase B badge worker, taking over `builders.kya-os.org/badge/*` from the static tiers with request-time verification (deployment staged behind key provisioning; see its README for the runbook).
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

Run the pinned vector suite (the [starter](conformance/starter/) automates it), open a [conformance submission issue](https://github.com/kya-os/kya-os-usergroup/issues/new?template=conformance_submission.yml) on this repo with your `claim.json`, and add or update your registry entry with the `conformance` block.
The full flow is in [conformance/README.md](conformance/README.md).

## Honest conformance language

The registry renders what an entry proves, nothing more:

- A subset claim always names its categories ("L1 subset (signed-proof)") and never renders as a bare level.
- `verified` renders green only as a link to the verification credential; `in-verification` is amber; `self-reported` is grey.
- Non-verified chips link their public grounding (`conformance.evidenceUrl`, e.g. the submission issue) when the entry carries one, so the middle tiers are auditable too.
- A claim is an attestation of an observed re-run, never a seal of approval, and listing implies no endorsement by the working group (see [GOVERNANCE.md](GOVERNANCE.md)).
- Live verified badges take over `builders.kya-os.org/badge/*` at Phase B of the program.

## Related

- [kya-os.org](https://kya-os.org) - the KYA-OS protocol site and specification.
- [decentralized-identity/kya-os-mcp](https://github.com/decentralized-identity/kya-os-mcp) - the donated core: MCP binding spec, reference implementation, protocol schemas, and the conformance suite.
- [schema.kya-os.org](https://schema.kya-os.org) - the canonical JSON Schema registry for the protocol.
- [DIF Trusted AI Agents Working Group](https://github.com/decentralized-identity/trusted-ai-agents) (TAAWG) - the DIF working group KYA-OS work happens under.

## License

[MIT](LICENSE).
Contributions require [DCO](DCO) sign-off.
