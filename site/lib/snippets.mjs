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

export const SNIPPETS = [MIGRATE_BEFORE, MIGRATE_AFTER];

/** The plain-text bytes of a snippet: what the clipboard receives. */
export function snippetText(snippet) {
  return snippet.text ?? snippet.lines.map(([text]) => text).join("\n");
}

export function snippetById(id) {
  return SNIPPETS.find((snippet) => snippet.id === id);
}
