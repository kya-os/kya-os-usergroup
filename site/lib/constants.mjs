/**
 * Site-wide constants for the community hub build: canonical URLs, the
 * pinned conformance suite, and the prefilled "Add your project" link.
 * Everything here is data, not behavior - renderers import from this file
 * so a URL or suite pin changes in exactly one place.
 */

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
export const SUBMISSION_ISSUE_URL = `${MCP_REPO_URL}/issues/new?template=conformance_submission.md`;
export const REVOKED_TREE_URL = `${MCP_REPO_URL}/tree/main/examples/revoked`;
export const PLAYGROUND_URL = `${SITE_URL}/mcp/playground`;
export const DEMO_MCP_URL = "https://demo-mcp.kya-os.ai/mcp";
// 2026-08-20: the live standalone starter repo. Repoint to
// `${REPO_URL}/tree/main/conformance/starter` after PR #1 merges and the
// standalone repo is archived with a pointer (the /tree/main/ URL 404s until
// then - conformance/starter exists only on the feature branch).
export const STARTER_URL = "https://github.com/kya-os/conformance-starter";
export const SUITE = {
  version: "1.0.0",
  vectors: 44,
  vectorSetHash: "sha256:81d537d4574d3f66d651a03ca41c0b18493b67ea6f3e61aba47d1bda4f3cf49b",
};

export const TITLE = "KYA-OS Community";
export const DESCRIPTION =
  "The KYA-OS community registry: who builds on it, what conforms to it, and the standards it carries.";

// The prefilled "Add your project" link: opens the GitHub new-file editor on
// registry/builders/ with the entry template already in the buffer. GitHub
// auto-forks for non-collaborators and opens the PR from the fork.
const ENTRY_TEMPLATE = {
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
export const ADD_PROJECT_URL = `${REPO_URL}/new/main/registry/builders?filename=your-project.json&value=${encodeURIComponent(
  JSON.stringify(ENTRY_TEMPLATE, null, 2) + "\n",
)}`;

// The copy-to-agent prompts: curated onboarding prompts a visitor hands to
// their coding agent. Each renders as BOTH the copy button's payload and its
// no-JS <details> fallback (the button copies from the fallback's DOM node,
// and lib/assertions.mjs asserts the rendered pair carries exactly these
// bytes). The conformance prompt interpolates the pinned suite so the prompt
// can never drift from SUITE.
export const PROMPTS = [
  {
    id: "prompt-get-listed",
    text:
      "Add my project to the KYA-OS builders registry: read https://github.com/kya-os/kya-os-usergroup/blob/main/registry/builders/example-builder.json and CONTRIBUTING.md, create registry/builders/<my-slug>.json describing MY project (ask me for name, homepage, repo, kind, what it builds on), validate it against registry/schema/builder.schema.json, then open a PR to kya-os/kya-os-usergroup titled 'registry: add <my-slug>'.",
  },
  {
    id: "prompt-prove-conformance",
    text:
      `Prove my KYA-OS implementation conformant: clone https://github.com/kya-os/kya-os-usergroup and follow conformance/starter/README.md - fetch the pinned vector suite, run my implementation against the ${SUITE.vectors} vectors (suite ${SUITE.version}, vectorSetHash ${SUITE.vectorSetHash}), generate the claim JSON with scripts/make-claim.mjs, and open a conformance submission issue on decentralized-identity/kya-os-mcp with the claim.`,
  },
  {
    id: "prompt-run-revoked",
    text:
      "Show me KYA-OS in action: clone https://github.com/decentralized-identity/kya-os-mcp and run the examples/revoked demo (the on-chain revocation kill switch), then explain how the per-request proof, delegation chain, and status list interact, and scaffold a minimal verifier for my stack using @kya-os/mcp.",
  },
];
