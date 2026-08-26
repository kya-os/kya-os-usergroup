/**
 * Site-wide constants for the community hub build: canonical URLs, the
 * pinned conformance suite, and the prefilled "Add your project" link.
 * Everything here is data, not behavior - renderers import from this file
 * so a URL or suite pin changes in exactly one place.
 */
import { newEntryUrl } from "../../scripts/lib/builder-entry.mjs";

export const ORIGIN = "https://builders.kya-os.org"; // planned; final URL decision open
export const SITE_URL = "https://kya-os.org";
export const MCP_REPO_URL = "https://github.com/decentralized-identity/kya-os-mcp";
export const REPO_URL = "https://github.com/kya-os/kya-os-usergroup";
export const DIF_URL = "https://identity.foundation";
export const TEMPLATE_SLUG = "example-builder";

export const CONFORMANCE_MD_URL = `${MCP_REPO_URL}/blob/main/CONFORMANCE.md`;
export const ENTITY_CARD_URL = `${MCP_REPO_URL}/blob/main/SPEC-ENTITY-CARD.md`;
export const MIGRATE_README_URL = `${MCP_REPO_URL}#migrate-any-mcp-server-in-2-lines`;
export const DOCS_QUICKSTART_URL = `${SITE_URL}/mcp/docs/getting-started/quickstart`;
// Conformance submissions open HERE - the community repo that carries the
// registry - via .github/ISSUE_TEMPLATE/conformance_submission.yml. Claims
// already in flight on the spec repo remain valid; see conformance/README.md.
export const SUBMISSION_ISSUE_URL = `${REPO_URL}/issues/new?template=conformance_submission.yml`;
export const REVOKED_TREE_URL = `${MCP_REPO_URL}/tree/main/examples/revoked`;
// The real MCP server (Context7) migrated with exactly the two lines the
// home hero shows - the README's own pointer.
export const CONTEXT7_EXAMPLE_URL = `${MCP_REPO_URL}/tree/main/examples/context7-with-kya-os`;
// The README's next step after the two lines: per-tool consent gating.
export const CONSENT_GUIDE_URL = "https://github.com/decentralized-identity/kya-os-mcp#protect-tools-with-human-consent";
export const PLAYGROUND_URL = `${SITE_URL}/mcp/playground`;
// The live proof console on the protocol site: try a signed request against
// the demo server without running anything.
export const PLAYGROUND_PROOF_URL = `${PLAYGROUND_URL}/proof`;
export const DEMO_MCP_URL = "https://demo-mcp.kya-os.ai/mcp";
// 2026-08-20: the live standalone starter repo. Repoint to
// `${REPO_URL}/tree/main/conformance/starter` after PR #1 merges and the
// standalone repo is archived with a pointer (the /tree/main/ URL 404s until
// then - conformance/starter exists only on the feature branch).
export const STARTER_URL = "https://github.com/kya-os/conformance-starter";
export const SUITE = {
  version: "1.0.0",
  vectors: 44,
  // The nine vector files conformance/SUITE-MANIFEST.json pins, one
  // category each (conformance/README.md: "44 vectors across nine categories").
  categories: 9,
  vectorSetHash: "sha256:81d537d4574d3f66d651a03ca41c0b18493b67ea6f3e61aba47d1bda4f3cf49b",
};


export const TITLE = "KYA-OS Builders";
export const DESCRIPTION =
  "The KYA-OS community registry: who builds on it, what conforms to it, and the standards it carries.";

// The entry template: the file contributors start from, the JSON the
// builders page's entry builder shows before a field is typed, and the
// buffer the prefilled "Add your project" link opens the GitHub new-file
// editor on registry/builders/ with (GitHub auto-forks for
// non-collaborators and opens the PR from the fork). Keys in schema order.
export const ENTRY_TEMPLATE = {
  name: "Your Project",
  slug: "your-project",
  description: "One or two sentences on what you ship on KYA-OS.",
  homepage: "https://example.com",
  repo: "https://github.com/your-org/your-project",
  kind: "implementation",
  buildsOn: ["kya-os-mcp"],
  contact: { github: "your-github-username" },
  listedAt: "YYYY-MM-DD",
};
export const ADD_PROJECT_URL = newEntryUrl(REPO_URL, ENTRY_TEMPLATE);

// The copy-to-agent prompts: curated onboarding prompts a visitor hands to
// their coding agent. Each renders as BOTH the copy button's payload and its
// no-JS <details> fallback (the button copies from the fallback's DOM node,
// and lib/assertions.mjs asserts the rendered pair carries exactly these
// bytes). The join and claim prompts interpolate the pinned suite so neither
// can ever drift from SUITE.
export const PROMPTS = [
  {
    id: "prompt-join-registry",
    text:
      `Join the KYA-OS builders registry end to end: (1) read https://github.com/kya-os/kya-os-usergroup/blob/main/registry/builders/example-builder.json and CONTRIBUTING.md, ask me for my project's name, slug (lowercase repo-name style, 2-40 chars of a-z 0-9 hyphen; unique across registry/), homepage, repo, kind, what it builds on, and a contact GitHub handle, and create registry/builders/<my-slug>.json; (2) if my project implements KYA-OS verification, also clone the repo, follow conformance/starter/README.md to run the pinned ${SUITE.vectors}-vector suite (suite ${SUITE.version}, vectorSetHash ${SUITE.vectorSetHash}), and embed a self-reported conformance object in my entry with the level and scope the run actually supports; (3) validate with npm test; (4) open ONE pull request to kya-os/kya-os-usergroup titled 'registry: add <my-slug>'; (5) if I want verification, also open a conformance submission issue on kya-os/kya-os-usergroup with my claim JSON and set my entry's status to in-verification with the issue as evidenceUrl - all in the same session.`,
  },
  {
    id: "prompt-prove-conformance",
    text:
      `Prove my KYA-OS implementation conformant: clone https://github.com/kya-os/kya-os-usergroup and follow conformance/starter/README.md - fetch the pinned vector suite, run my implementation against the ${SUITE.vectors} vectors (suite ${SUITE.version}, vectorSetHash ${SUITE.vectorSetHash}), generate the claim JSON with scripts/make-claim.mjs, and open a conformance submission issue on kya-os/kya-os-usergroup with the claim.`,
  },
  {
    id: "prompt-run-revoked",
    text:
      "Show me KYA-OS in action: clone https://github.com/decentralized-identity/kya-os-mcp and run the examples/revoked demo (the on-chain revocation kill switch), then explain how the per-request proof, delegation chain, and status list interact, and scaffold a minimal verifier for my stack using @kya-os/mcp.",
  },
];
