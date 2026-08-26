/**
 * The site's code snippets as data. Every block of code a page shows (and a
 * visitor may copy) is defined here once, so the visible highlighted block,
 * the hidden raw <pre> a copy button reads, and this constant can be
 * asserted equal on the finished bytes (lib/checks.mjs - the same parity
 * contract the copy-to-agent prompts have).
 *
 * PARITY SOURCE: the reference implementation, decentralized-identity/
 * kya-os-mcp at origin/main. The migrate pair is verbatim from its README
 * section "Migrate any MCP server in 2 lines" (the two "+1 line" comments
 * mark the entire delta from a stock MCP server); every export name and
 * import path in the other snippets exists in that tree.
 *
 * Shape: `lines` is [[text, added]] for highlighted TypeScript (added lines
 * render with the diff gutter); `text` is a plain snippet. snippetText()
 * gives the clipboard bytes for either.
 */
import { ENTRY_TEMPLATE, ORIGIN } from "./constants.mjs";

/** The "before" block: a standard MCP server with no identity or proofs. */
export const MIGRATE_BEFORE = {
  id: "migrate-before",
  lines: [
    ["import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';", false],
    ["", false],
    ["const server = new McpServer({ name: 'my-server', version: '1.0.0' });", false],
    ["", false],
    ["server.registerTool('greet', { description: 'Say hello' }, async (args) => ({", false],
    ["  content: [{ type: 'text', text: `Hello, ${args.name}!` }],", false],
    ["}));", false],
  ],
};

/** The "after" block: every tool response now carries a signed proof. */
export const MIGRATE_AFTER = {
  id: "migrate-code",
  lines: [
    ["import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';", false],
    ["import { withKyaOs, NodeCryptoProvider } from '@kya-os/mcp';  // +1 line", true],
    ["", false],
    ["const server = new McpServer({ name: 'my-server', version: '1.0.0' });", false],
    ["await withKyaOs(server, { crypto: new NodeCryptoProvider() }); // +1 line", true],
    ["", false],
    ["server.registerTool('greet', { description: 'Say hello' }, async (args) => ({", false],
    ["  content: [{ type: 'text', text: `Hello, ${args.name}!` }],", false],
    ["}));", false],
  ],
};

/**
 * The entry template: what the builders page's entry builder shows before a
 * field is typed (the live preview replaces it as the visitor types) and
 * what the no-JS <details> fallback carries.
 */
export const ENTRY_PREVIEW = { id: "entry-preview", text: JSON.stringify(ENTRY_TEMPLATE, null, 2) };

/**
 * The README embed for a badge: the real /badge/<slug>.svg path the build
 * emits (lib/badge.mjs) and the worker serves, linking the directory row.
 * "your-slug" is the placeholder the badge preview fills in.
 */
export const BADGE_EMBED_SLUG = "your-slug";
export const BADGE_EMBED = {
  id: "badge-embed",
  text: `[![KYA-OS conformance](${ORIGIN}/badge/${BADGE_EMBED_SLUG}.svg)](${ORIGIN}/builders/#${BADGE_EMBED_SLUG})`,
};

/**
 * The four discovery projections of one Entity Card. Every export is real:
 * src/card/emit.ts in the reference tree, published on the
 * `@kya-os/mcp/card` subpath (package.json exports["./card"]); the minimal
 * card is exactly what EntityCardSchema requires (id, entityType, name),
 * and entityType 'agent' is the only type toA2AExtension accepts.
 */
export const CARD_PROJECTIONS = {
  id: "card-projections",
  lines: [
    ["import {", false],
    ["  toServerCardMeta, toCatalogEntry, toA2AExtension, toAgentFacts, type EntityCard,", false],
    ["} from '@kya-os/mcp/card';", false],
    ["", false],
    ["// 1. Define the Entity Card once", false],
    ["const card: EntityCard = {", false],
    ["  id: 'did:web:agents.example.com:my-agent',", false],
    ["  entityType: 'agent',", false],
    ["  name: 'my-agent',", false],
    ["};", false],
    ["", false],
    ["// 2. Project it onto each rail", false],
    ["toServerCardMeta(card); // server.json _meta block", false],
    ["toCatalogEntry(card);   // catalog.json entry, always by reference", false],
    ["toA2AExtension(card);   // A2A AgentCard extensions[] item", false],
    ["toAgentFacts(card);     // NANDA AgentFacts JSON-LD", false],
  ],
};

/**
 * REVOKED, the 60-second path: the three commands verbatim from
 * examples/revoked/README.md lines 18-20 ("Try it in 60 seconds"), and the
 * expected output the README prints at lines 26-30 (rendered, never copied:
 * the number is the README's own elapsedMs, not a promise).
 */
export const REVOKED_VERIFY = {
  id: "revoked-verify",
  lines: [
    ["cd examples/revoked", false],
    ["npm install", false],
    ["npm run verify:once", false],
  ],
};
export const REVOKED_VERDICT = {
  id: "revoked-verdict",
  lines: [
    ["{", false],
    ['  "verdict": "CREDENTIAL_REVOKED",', false],
    ['  "checks": { "basicValid": true, "signatureValid": true, "statusValid": false },', false],
    ['  "elapsedMs": 828', false],
    ["}", false],
  ],
};

/**
 * The consent gate, verbatim from the reference README section "Protect
 * tools with human consent" (README.md lines 96-102): wrapWithDelegation and
 * wrapWithProof come from the root `@kya-os/mcp` package, not a subpath.
 */
export const CONSENT_GATE = {
  id: "consent-gate",
  lines: [
    ["const checkout = kyaos.wrapWithDelegation(", false],
    ["  'checkout',", false],
    ["  { scopeId: 'cart:write', consentUrl: 'https://example.com/consent' },", false],
    ["  kyaos.wrapWithProof('checkout', async (args) => ({", false],
    ["    content: [{ type: 'text', text: `Order placed: ${args.item}` }],", false],
    ["  })),", false],
    [");", false],
  ],
};

export const SNIPPETS = [MIGRATE_BEFORE, MIGRATE_AFTER, ENTRY_PREVIEW, BADGE_EMBED, CARD_PROJECTIONS, REVOKED_VERIFY, REVOKED_VERDICT, CONSENT_GATE];

/** The plain-text bytes of a snippet: what the clipboard receives. */
export function snippetText(snippet) {
  return snippet.text ?? snippet.lines.map(([text]) => text).join("\n");
}

export function snippetById(id) {
  return SNIPPETS.find((snippet) => snippet.id === id);
}
