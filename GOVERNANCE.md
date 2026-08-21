# Governance

This repository is the KYA-OS builder community registry. It is deliberately
lightweight: the registry exists so that anyone building on KYA-OS can list
their work by pull request, without touching the specification or the
reference implementation.

## Relationship to the working group

KYA-OS is developed in the
[DIF Trusted Agents & Authority Working Group](https://identity.foundation/working-groups/trusted-agents.html).
This repository is a community surface, not a specification venue: nothing in
the registry is normative, and listing here implies no endorsement or
conformance claim by the working group.

## Maintainers

Maintainers review registry entries and keep the site rendering. The current
maintainer roster is the repository's collaborator list; changes to it follow
the working group's process.

## Decision making

- Registry entries: merged by any maintainer once CI validates the entry and
  the criteria in [CONTRIBUTING.md](./CONTRIBUTING.md) are met - lazy
  consensus, no vote needed.
- Changes to the entry schema, validation rules, or site: opened as pull
  requests and merged on maintainer lazy consensus. Anything that would
  change what a listing MEANS (badges, tiers, conformance implications) goes
  to the working group first.
- Removals: entries that become defunct, misleading, or violate the
  [Code of Conduct](./CODE_OF_CONDUCT.md) may be removed by a maintainer,
  with the reason stated on the pull request or commit.

## Conformance display rules

The registry renders conformance claims; it does not grant them. Chips on
the site render only what the entry proves:

- A subset claim always renders with its categories ("L1 subset
  (signed-proof)") and never as a bare level.
- `verified` renders green only with the credential link
  (`attestationUrl`), which the validator requires and the site build
  asserts. At Phase B of the conformance program, CI additionally
  cross-checks the rendered status against the credential itself, so a
  registry entry cannot drift greener than its credential.
- `in-verification` renders amber, `self-reported` renders grey, and no
  wording anywhere may describe a listing as certified.

Badge semantics (the states served by `workers/badge/`, and anything else
that would change what a conformance display MEANS) belong to the working
group under the meaning-change rule above: proposals land there first, not
in this repo's PRs.

## Contributions

Every commit requires a Developer Certificate of Origin sign-off
(`git commit -s`). See [CONTRIBUTING.md](./CONTRIBUTING.md).
