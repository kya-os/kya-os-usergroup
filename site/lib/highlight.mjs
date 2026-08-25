// Build-time syntax highlighting for the hub's code snippets: the modern
// docs-site pattern (Shiki, shadcn, Stripe) is to highlight at build and ship
// colored spans - which is exactly what a deterministic zero-dependency
// static build can do itself for the small TypeScript subset the snippets
// use. Scope is deliberately narrow: line comments, single-quote and template
// strings, and a fixed keyword set; everything else renders in the base ink.
// Colors ride the theme tokens, so both themes stay AA without new palette.
import { esc } from "./html.mjs";
import { snippetText } from "./snippets.mjs";

const KEYWORDS = new Set([
  "import",
  "from",
  "const",
  "await",
  "async",
  "new",
  "export",
  "return",
  "type",
]);

const TOKEN =
  /(\/\/.*$)|('(?:[^'\\]|\\.)*')|(`(?:[^`\\]|\\.)*`)|([A-Za-z_$][\w$]*)|(\s+|.)/gm;

/** Highlight one line of TypeScript into token spans (pre-escaped HTML). */
export function highlightTs(line) {
  let out = "";
  for (const m of line.matchAll(TOKEN)) {
    const [, comment, str, template, word, rest] = m;
    if (comment !== undefined) out += `<span class="tok-com">${esc(comment)}</span>`;
    else if (str !== undefined || template !== undefined)
      out += `<span class="tok-str">${esc(str ?? template)}</span>`;
    else if (word !== undefined) {
      // `type` is contextual: a keyword before an import name or alias, a
      // plain property key when a colon follows (`{ type: 'text' }`).
      const keyword = KEYWORDS.has(word) && !(word === "type" && line[m.index + word.length] === ":");
      out += keyword ? `<span class="tok-kw">${esc(word)}</span>` : esc(word);
    }
    else out += esc(rest);
  }
  return out;
}

/**
 * A code block from a lib/snippets.mjs snippet: one source, two renders. The
 * visible block carries build-time token highlighting and diff gutters
 * (added lines) and is the no-JS fallback (select it by hand); with `copy`,
 * a hidden raw <pre> carrying the plain code sits beside it and the copy
 * button (shipped hidden - /ui/copy-prompt.js reveals it) reads from THAT,
 * so clipboard text is always the plain code. lib/checks.mjs asserts the
 * visible block, the raw <pre>, and the snippet constant agree.
 */
export function codeBlock(snippet, { copy = true } = {}) {
  const code = snippet.lines
    .map(([text, added]) => `<span class="cl${added ? " hl" : ""}">${highlightTs(text)}</span>`)
    .join("");
  const copyPair = copy
    ? `\n      <pre id="${snippet.id}" hidden aria-hidden="true">${esc(snippetText(snippet))}</pre>\n      <button type="button" class="copy-code" data-copy-target="${snippet.id}" hidden>[ copy ]</button>`
    : "";
  return `<div class="code-wrap">
      <pre class="code-block" data-snippet="${snippet.id}"><code>${code}</code></pre>${copyPair}
    </div>`;
}
