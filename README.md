# KYA-OS Usergroup

The builder community registry for [KYA-OS](https://kya-os.org), the open protocol for verifiable AI-agent identity, delegation, and proof, donated to the [Decentralized Identity Foundation](https://identity.foundation) (DIF).

This repo is the KYA-OS analogue of DIF's other usergroup repos (`didcomm-usergroup`, `veramo-usergroup`): a deliberately separate, publicly PR-able home for the community around the protocol, kept apart from the spec and implementation repos so that getting listed never requires touching protocol code.

## What lives here

- `registry/builders/*.json` - one file per builder or project building on KYA-OS.
- `registry/schema/builder.schema.json` - the JSON Schema every entry must conform to.
- `site/build-pages.mjs` - renders the registry into a static site.
- `scripts/validate.mjs` - dependency-free structural validation, run by CI and by the build.

## Get listed

Anyone shipping something real on KYA-OS can be listed.
The short version:

1. Fork this repo.
2. Copy `registry/builders/example-builder.json` to `registry/builders/<your-slug>.json` and fill in your details.
3. Run `npm test` locally (validation + build; no dependencies to install).
4. Open a pull request with DCO sign-off (`git commit -s`).
5. CI validates your entry; a maintainer reviews and merges; the site redeploys automatically.

The full step-by-step flow, including entry review criteria, is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Render target

The registry renders to a static page deployed on Cloudflare Pages.
The planned home is **builders.kya-os.org**.

> **Open decision:** whether the page ultimately lives at the `builders.kya-os.org` subdomain or at a path under the main site (for example `kya-os.org/builders`) has not been settled yet.
> The build and deploy pipeline targets the subdomain for now; nothing in the registry format depends on the outcome.

The deployed site also serves `builders.json`, the machine-readable merged registry, with open CORS.

## Related

- [kya-os.org](https://kya-os.org) - the KYA-OS protocol site and specification.
- [decentralized-identity/kya-os-mcp](https://github.com/decentralized-identity/kya-os-mcp) - the donated core: MCP binding spec, reference implementation, and protocol schemas.
- [schema.kya-os.org](https://schema.kya-os.org) - the canonical JSON Schema registry for the protocol.
- [DIF Trusted AI Agents Working Group](https://github.com/decentralized-identity/trusted-ai-agents) (TAAWG) - the DIF working group KYA-OS work happens under.

## License

[MIT](LICENSE).
Contributions require [DCO](DCO) sign-off.
