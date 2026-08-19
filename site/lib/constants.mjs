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
export const SUBMISSION_ISSUE_URL = `${MCP_REPO_URL}/issues/new?template=conformance_submission.md`;
export const STARTER_URL = `${REPO_URL}/tree/main/conformance/starter`;
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
