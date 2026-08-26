/**
 * Standalone build checks, split from lib/assertions.mjs to keep both files
 * under the lib LOC cap: theme integrity and motion gating (on the emitted
 * stylesheets), copy parity (button vs source vs constant, prompts and code
 * snippets alike), the home hero's migration hook, the home page polish
 * (keyphrases, anchored path, banned vocabulary), and the
 * suite pin agreement across every committed copy of the pin. Same
 * philosophy as lib/assertions.mjs: read the finished bytes back, never
 * trust the renderers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTEXT7_EXAMPLE_URL, PROMPTS, SUITE } from "./constants.mjs";
import { esc } from "./html.mjs";
import { SNIPPETS, snippetById, snippetText } from "./snippets.mjs";

export function assertBuild(condition, message) {
  if (!condition) {
    console.error(`Render check FAILED: ${message}`);
    process.exit(1);
  }
}

/**
 * Theme integrity, on the stylesheets: the token layer must be closed and
 * dark-first with a complete light side - the dark :root block, the
 * OS-preference light branch (guarded so an explicit dark override wins),
 * and the :root[data-theme="light"] hook the toggle drives, with the two
 * light blocks token-for-token identical. Every var(--x) referenced must be
 * defined, every :root token must be used, and no raw hex may bypass the
 * token layer outside the token blocks.
 */
export function assertThemeIntegrity(sheets) {
  const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = stripComments(sheets["tokens.css"]);
  const combined = Object.values(sheets).map(stripComments).join("\n");
  assertBuild(tokens.includes("@media (prefers-color-scheme: light)"), "tokens.css: the light prefers-color-scheme branch is missing");
  assertBuild(tokens.includes(':root:not([data-theme="dark"])'), 'tokens.css: OS-light must yield to a data-theme="dark" override');
  assertBuild(tokens.includes(':root[data-theme="light"]'), 'tokens.css: the data-theme="light" hook is missing');

  const rootBlocks = [...tokens.matchAll(/:root[^{}]*\{([^{}]*)\}/g)].map((m) => m[1]);
  assertBuild(rootBlocks.length === 3, `tokens.css: expected exactly three token blocks (dark, OS-light, explicit light), found ${rootBlocks.length}`);
  const declarations = (body) => [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, key, value]) => `${key}:${value.trim()}`).join(";");
  assertBuild(declarations(rootBlocks[1]) === declarations(rootBlocks[2]), "tokens.css: the OS-light and explicit-light token blocks drifted apart");

  const rootDefined = new Set(rootBlocks.flatMap((body) => [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])));
  const anyDefined = new Set([...combined.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const referenced = new Set([...combined.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  for (const token of referenced) {
    assertBuild(anyDefined.has(token), `stylesheets: var(${token}) is referenced but never defined`);
  }
  for (const token of rootDefined) {
    assertBuild(referenced.has(token), `tokens.css: token ${token} is defined but never used`);
  }
  const outsideTokens = combined.replace(/:root[^{}]*\{[^{}]*\}/g, "");
  const rawHex = outsideTokens.match(/#[0-9a-fA-F]{3,8}\b/);
  assertBuild(rawHex === null, `stylesheets: raw color ${rawHex?.[0]} bypasses the token layer (use var())`);
}

/**
 * Choreography safety, on the stylesheets: any hidden initial state
 * (opacity:0 or visibility:hidden) must be gated under an html.js-anim
 * selector - EVERY selector of the rule's list, overlay rules included - so
 * no JS, blocked JS, or reduced motion always yields a fully visible page.
 * Keyframe frames are exempt (they apply only mid-animation, never as an
 * initial state), and the gated motion rules must actually be present
 * (never vacuous).
 */
export function assertAnimGating(sheets) {
  const styles = Object.values(sheets).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const hidden = /opacity:\s*0[;}\s]|opacity:\s*0$|visibility:\s*hidden/.test(rule[2]);
    if (!hidden) continue;
    for (const selector of rule[1].split(",")) {
      const sel = selector.trim();
      if (/^(from|to|[\d.]+%(\s*,\s*[\d.]+%)*)$/.test(sel)) continue;
      assertBuild(
        sel.includes("html.js-anim"),
        `stylesheets: hidden initial state "${sel}" is not gated under html.js-anim`,
      );
    }
  }
  assertBuild(styles.includes("html.js-anim"), "stylesheets: the html.js-anim motion CSS is missing");
}

/**
 * Copy parity, per page: every copy button must name a source element on
 * the same page that carries exactly the bytes of the prompt (lib/
 * constants.mjs PROMPTS, via the <details> fallback <pre>) or the snippet
 * (lib/snippets.mjs, via the raw <pre>) it copies; every visible snippet
 * block (data-snippet - highlighting can restyle the code, never change it)
 * must reconstruct to the same bytes once its spans are stripped; every
 * button ships hidden (no JS, no dead button); and every prompt and snippet
 * defined must render somewhere - so the button, the fallback, and the
 * constant can never disagree.
 */
const unescapeHtml = (text) =>
  text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

function visibleSnippetText(block) {
  // Split on line spans first (token spans nest inside them), then strip
  // every remaining tag per line - reconstruction beats fragile pairing. A
  // plain block (no line spans) is one line of stripped text.
  const lines = block.includes('<span class="cl') ? block.split(/<span class="cl(?: hl)?(?: hl-add)?">/).slice(1) : [block];
  return unescapeHtml(lines.map((chunk) => chunk.replace(/<[^>]+>/g, "")).join("\n"));
}

export function assertCopyParity(pages) {
  const seen = new Set();
  const hiddenButton = (html, target) =>
    new RegExp(`<button[^>]*data-copy-target="${target}"[^>]*\\bhidden\\b`).test(html) ||
    new RegExp(`<button[^>]*\\bhidden\\b[^>]*data-copy-target="${target}"`).test(html);
  for (const [name, html] of Object.entries(pages)) {
    for (const [, id] of html.matchAll(/data-snippet="([^"]+)"/g)) {
      const snippet = snippetById(id);
      assertBuild(snippet !== undefined, `${name}: visible block names unknown snippet "${id}"`);
      const block = html.match(new RegExp(`<(\\w+)[^>]*data-snippet="${id}"[^>]*>([\\s\\S]*?)</\\1>`))?.[2];
      assertBuild(block !== undefined, `${name}: the visible "${id}" block is malformed`);
      assertBuild(visibleSnippetText(block) === snippetText(snippet), `${name}: the visible "${id}" block drifted from lib/snippets.mjs`);
      seen.add(id);
    }
    for (const [, target] of html.matchAll(/<button[^>]*data-copy-target="([^"]+)"[^>]*>/g)) {
      const prompt = PROMPTS.find((p) => p.id === target);
      const snippet = snippetById(target);
      assertBuild(prompt !== undefined || snippet !== undefined, `${name}: copy button targets unknown source "${target}"`);
      const source = html.match(new RegExp(`<pre id="${target}"[^>]*>([\\s\\S]*?)</pre>`))?.[1];
      assertBuild(source !== undefined, `${name}: copy button "${target}" has no source <pre>`);
      assertBuild(
        source === esc(prompt ? prompt.text : snippetText(snippet)),
        `${name}: the "${target}" source text drifted from what the button is meant to copy`,
      );
      assertBuild(hiddenButton(html, target), `${name}: the "${target}" copy button must ship hidden (no JS, no dead button)`);
      seen.add(target);
    }
  }
  for (const { id } of [...PROMPTS, ...SNIPPETS]) {
    assertBuild(seen.has(id), `prompt or snippet "${id}" is defined but rendered on no page`);
  }
}

/**
 * The home hero's migration hook: both README blocks sit inside the hero,
 * the After snippet still carries the two names the whole pitch rests on
 * (withKyaOs + NodeCryptoProvider - if README parity drifts, this is the
 * build failure to look at), and the real migrated server is linked.
 */
export function assertMigrateHook(landingHtml) {
  const hero = landingHtml.match(/<header class="hero fx">([\s\S]*?)<\/header>/)?.[1] ?? "";
  for (const id of ["migrate-before", "migrate-code"]) {
    assertBuild(hero.includes(`data-snippet="${id}"`), `the home hero must carry the "${id}" block`);
  }
  const after = landingHtml.match(/<pre id="migrate-code"[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? "";
  for (const symbol of ["withKyaOs", "NodeCryptoProvider"]) {
    assertBuild(after.includes(symbol), `the home hero After snippet lost "${symbol}" - README parity drifted`);
  }
  assertBuild(landingHtml.includes(`href="${CONTEXT7_EXAMPLE_URL}"`), "the home hero must link the context7 example migrated with exactly two lines");
}

/**
 * The home page polish, on the dist bytes: the hero keeps the keyphrases the
 * pitch rests on; the path renders exactly three anchored steps, and every
 * in-site anchor link on the page (the path's three included) resolves to a
 * real id in the built target page - parsed from that page's bytes, so a
 * renamed section elsewhere fails the build here; and the owner's banned
 * vocabulary appears nowhere on the page.
 */
const HOME_KEYPHRASES = [
  "Verifiable identity, delegated authority, and signed proofs for AI agents.",
  "<strong>verifiable cryptographic identity</strong>",
  "<strong>signed receipt for every tool call</strong>",
  "<strong>no logs to trust, nothing to impersonate.</strong>",
];
export const BANNED_COPY = /\b(certified|certifies|pinky|edge|live|compliance framework|trust matrix|validation engine|generate your badge|immediately|gRPC)\b/i;

export function assertHomePolish(pages) {
  const landing = pages["index.html"];
  for (const phrase of HOME_KEYPHRASES) {
    assertBuild(landing.includes(phrase), `the home hero lost its keyphrase "${phrase}"`);
  }
  const resolves = (href) => {
    const [, page, id] = href.match(/^\/([a-z-]+)\/#(.+)$/) ?? [];
    return page !== undefined && (pages[`${page}/index.html`] ?? "").includes(`id="${id}"`);
  };
  const path = landing.match(/<ol class="path">([\s\S]*?)<\/ol>/)?.[1] ?? "";
  const steps = path.split("</li>").filter((chunk) => chunk.includes("<li>")).map((chunk) => chunk.match(/href="([^"]+)"/)?.[1] ?? "");
  assertBuild(steps.length === 3, `the home path must render exactly three steps, found ${steps.length}`);
  for (const href of steps) {
    assertBuild(resolves(href), `home path step links "${href}", which is not a real anchor in its target page`);
  }
  for (const [, href] of landing.matchAll(/href="(\/[a-z-]+\/#[^"]+)"/g)) {
    assertBuild(resolves(href), `the home page links "${href}", which is not a real anchor in its target page`);
  }
  const banned = landing.match(BANNED_COPY);
  assertBuild(banned === null, `banned home vocabulary "${banned?.[0]}" leaked into dist/index.html`);
}

/**
 * The ladder readout on the home stats strip: the per-rung counts must be
 * the live registry numbers, recomputed here from the shaped entries - never
 * through the renderer's own math.
 */
export function assertLadderReadout(landingHtml, rendered) {
  const inVerification = rendered.filter((entry) => entry.conformance?.status === "in-verification").length;
  const verified = rendered.filter((entry) => entry.conformance?.status === "verified").length;
  assertBuild(
    landingHtml.includes(`<b>${inVerification}</b> in verification &middot; <b>${verified}</b> verified`),
    `the home stats strip must show the live per-rung counts (${inVerification} in verification, ${verified} verified)`,
  );
}

/**
 * Probe honesty, on the finished page bytes: "enforcement verified" appears
 * EXACTLY once per enforcing probe result, only on the builders page, and
 * nowhere else on the site - enforcement language never renders without
 * probe data behind it. Every probed service row must carry its classified
 * line dated with the committed probedAt (expected strings reconstructed
 * inline, never through the renderer), and the "deployed <version>"
 * provenance display renders exactly when the probe reported a version AND
 * the entry carries a claim.
 */
export function assertProbeHonesty(pages, rendered, probes) {
  const results = probes?.results ?? {};
  const probed = rendered.filter((entry) => (entry.kind === "service" || entry.kind === "implementation") && entry.probeUrl !== undefined && results[entry.slug] !== undefined);
  const enforcing = probed.filter((entry) => results[entry.slug].status === "enforcing").length;
  for (const [name, html] of Object.entries(pages)) {
    const count = (html.match(/enforcement verified/g) ?? []).length;
    const allowed = name === "builders/index.html" ? enforcing : 0;
    assertBuild(
      count === allowed,
      `${name}: "enforcement verified" appears ${count} times, expected ${allowed} - the phrase renders only with an enforcing probe result behind it`,
    );
  }
  const buildersHtml = pages["builders/index.html"];
  const expectedLines = {
    enforcing: `&#9679; live &middot; enforcement verified &middot; checked ${probes?.probedAt}`,
    open: `&#9679; live &middot; open (no proof required) &middot; checked ${probes?.probedAt}`,
    unreachable: `&#9675; unreachable &middot; checked ${probes?.probedAt}`,
  };
  for (const entry of probed) {
    const probe = results[entry.slug];
    assertBuild(
      buildersHtml.includes(expectedLines[probe.status]),
      `the probe line for "${entry.slug}" must render its classified status ("${probe.status}") dated ${probes.probedAt}`,
    );
    if (probe.provenanceVersion !== undefined && entry.conformance !== undefined) {
      assertBuild(
        buildersHtml.includes(`deployed ${esc(probe.provenanceVersion)}`),
        `"${entry.slug}" must render its probed deployment version (${probe.provenanceVersion}) beside its claim`,
      );
    }
  }
  const deployedCount = (buildersHtml.match(/&middot; deployed /g) ?? []).length;
  const expectedDeployed = probed.filter(
    (entry) => results[entry.slug].provenanceVersion !== undefined && entry.conformance !== undefined,
  ).length;
  assertBuild(
    deployedCount === expectedDeployed,
    `"deployed" renders ${deployedCount} times on the builders page, expected ${expectedDeployed} - the provenance display never renders without probe data`,
  );
}

/**
 * Profile rows, per directory row. (The badge embed line and the founding-builder tag was retired by owner direction; its
 * absence is asserted so it cannot quietly return without a decision.)
 */
export function assertFoundingCohort(buildersHtml, rendered) {
  for (const entry of rendered) {
    const start = buildersHtml.indexOf(`id="${entry.slug}"`);
    assertBuild(start !== -1, `no directory row found for "${entry.slug}"`);
    const row = buildersHtml.slice(start, buildersHtml.indexOf("</details>", start));
  }
  assertBuild(!buildersHtml.includes("founding builder"), "the retired founding-builder tag rendered");
}

/**
 * Suite pin agreement: the suite pin (version, vector count, vector-set
 * hash) is committed in several places that deliberately cannot import each
 * other - the starter must stay standalone-copyable and the badge worker's
 * fixture mint never imports site/ code. The build is the one place that
 * sees them all, so it reads every OTHER copy as bytes and asserts agreement
 * with SUITE in lib/constants.mjs; a drifted copy fails the build naming its
 * file.
 */
export function assertSuitePinAgreement(repoRoot) {
  const read = (path) => readFileSync(join(repoRoot, path), "utf8");

  const fetchSuitePath = "conformance/starter/scripts/fetch-suite.mjs";
  const fetchSuite = read(fetchSuitePath);
  const expectedHash = fetchSuite.match(/const EXPECTED_VECTOR_SET_HASH =\s*'([^']+)'/)?.[1];
  assertBuild(
    expectedHash === SUITE.vectorSetHash,
    `${fetchSuitePath}: EXPECTED_VECTOR_SET_HASH (${expectedHash}) does not match SUITE.vectorSetHash`,
  );
  assertBuild(
    /const PINNED_COMMIT = '[0-9a-f]{40}';/.test(fetchSuite),
    `${fetchSuitePath}: PINNED_COMMIT (a 40-hex commit SHA) is missing - the harness must be fetched at a commit, not a tag`,
  );

  const programReadme = "conformance/README.md";
  assertBuild(read(programReadme).includes(SUITE.vectorSetHash), `${programReadme}: the vector-set hash does not match SUITE.vectorSetHash`);
  assertBuild(
    read(programReadme).includes(`suite \`${SUITE.version}\`, ${SUITE.vectors} vectors`),
    `${programReadme}: the suite version / vector count line does not match SUITE (${SUITE.version}, ${SUITE.vectors} vectors)`,
  );

  const starterReadme = "conformance/starter/README.md";
  assertBuild(read(starterReadme).includes(SUITE.vectorSetHash), `${starterReadme}: the vector-set hash does not match SUITE.vectorSetHash`);
  assertBuild(
    read(starterReadme).includes(`(${SUITE.vectors} vectors)`),
    `${starterReadme}: the vector count does not match SUITE.vectors (${SUITE.vectors})`,
  );

  const mintPath = "workers/badge/fixtures/mint.mjs";
  const mint = read(mintPath);
  assertBuild(mint.includes(`suiteVersion: "${SUITE.version}"`), `${mintPath}: suiteVersion does not match SUITE.version (${SUITE.version})`);
  assertBuild(mint.includes(`vectorSetHash: "${SUITE.vectorSetHash}"`), `${mintPath}: vectorSetHash does not match SUITE.vectorSetHash`);
}
