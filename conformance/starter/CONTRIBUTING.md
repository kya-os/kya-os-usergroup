# Contributing

Thanks for improving the starter.

## Sign-off is required

Every commit must carry a `Signed-off-by` line certifying the [DCO](./DCO).

```bash
git commit -s
```

Unsigned commits are not merged.

## Commit style

Use conventional commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`).

## Where issues go

This starter is the `conformance/starter/` directory of [kya-os/kya-os-usergroup](https://github.com/kya-os/kya-os-usergroup).

- Problems with this template (scripts, skeleton, workflow, docs): open an issue on [kya-os/kya-os-usergroup](https://github.com/kya-os/kya-os-usergroup/issues).
- Problems with the conformance suite itself (vectors, harness, levels): open an issue on [decentralized-identity/kya-os-mcp](https://github.com/decentralized-identity/kya-os-mcp).
  The suite is fetched from there at a pinned ref; this template never forks it.
