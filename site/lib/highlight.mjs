// Build-time syntax highlighting for the hub's code snippets: the modern
// docs-site pattern (Shiki, shadcn, Stripe) is to highlight at build and ship
// colored spans - which is exactly what a deterministic zero-dependency
// static build can do itself for the small TypeScript subset the snippets
// use. Scope is deliberately narrow: line comments, single-quote and template
// strings, and a fixed keyword set; everything else renders in the base ink.
// Colors ride the theme tokens, so both themes stay AA without new palette.
import { esc } from "./html.mjs";

const KEYWORDS = new Set([
  "import",
  "from",
  "const",
  "await",
  "async",
  "new",
  "export",
  "return",
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
    else if (word !== undefined)
      out += KEYWORDS.has(word) ? `<span class="tok-kw">${esc(word)}</span>` : esc(word);
    else out += esc(rest);
  }
  return out;
}
