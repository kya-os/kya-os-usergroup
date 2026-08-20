/**
 * Standalone build checks, split from lib/assertions.mjs to keep both files
 * under the lib LOC cap: theme integrity and motion gating (on the emitted
 * stylesheets), prompt parity (button vs fallback vs constant), and the
 * suite pin agreement across every committed copy of the pin. Same
 * philosophy as lib/assertions.mjs: read the finished bytes back, never
 * trust the renderers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROMPTS, SUITE } from "./constants.mjs";
import { esc } from "./html.mjs";

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
 * Prompt parity, per page: every copy button must name a fallback <pre> on
 * the same page, every fallback must carry exactly the prompt text from
 * lib/constants.mjs (re-escaped here), and every prompt in PROMPTS must
 * appear as such a pair somewhere on the site - so the button, the manual
 * fallback, and the constant can never disagree.
 */
export function assertPromptParity(pages) {
  const seen = new Set();
  for (const [name, html] of Object.entries(pages)) {
    for (const [, target] of html.matchAll(/<button[^>]*data-copy-target="([^"]+)"[^>]*>/g)) {
      const prompt = PROMPTS.find((p) => p.id === target);
      assertBuild(prompt !== undefined, `${name}: copy button targets unknown prompt "${target}"`);
      const fallback = html.match(new RegExp(`<pre id="${target}">([\\s\\S]*?)</pre>`))?.[1];
      assertBuild(fallback !== undefined, `${name}: copy button "${target}" has no <details> fallback <pre>`);
      assertBuild(
        fallback === esc(prompt.text),
        `${name}: the "${target}" fallback text drifted from the prompt the button copies`,
      );
      assertBuild(
        new RegExp(`<button[^>]*data-copy-target="${target}"[^>]*\\bhidden\\b`).test(html) ||
          new RegExp(`<button[^>]*\\bhidden\\b[^>]*data-copy-target="${target}"`).test(html),
        `${name}: the "${target}" copy button must ship hidden (no JS, no dead button)`,
      );
      seen.add(target);
    }
  }
  for (const prompt of PROMPTS) {
    assertBuild(seen.has(prompt.id), `prompt "${prompt.id}" is defined but rendered on no page`);
  }
}

/**
 * Suite pin agreement: the suite pin (version, vector count, vector-set
 * hash) is committed in several places that deliberately cannot import each
 * other - the starter must stay standalone-copyable and the badge fixtures
 * are committed artifacts. The build is the one place that sees them all, so
 * it reads every OTHER copy as bytes and asserts agreement with SUITE in
 * lib/constants.mjs; a drifted copy fails the build naming its file.
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

  const generatorPath = "workers/badge/fixtures/generate-fixtures.mjs";
  const generator = read(generatorPath);
  assertBuild(generator.includes(`suiteVersion: "${SUITE.version}"`), `${generatorPath}: suiteVersion does not match SUITE.version (${SUITE.version})`);
  assertBuild(generator.includes(`vectorSetHash: "${SUITE.vectorSetHash}"`), `${generatorPath}: vectorSetHash does not match SUITE.vectorSetHash`);

  for (const path of ["workers/badge/fixtures/dev-manifest.json", "workers/badge/fixtures/dev-credential.json"]) {
    const parsed = JSON.parse(read(path));
    const pin = parsed.credentialSubject?.suite ?? parsed;
    assertBuild(pin.suiteVersion === SUITE.version, `${path}: suiteVersion (${pin.suiteVersion}) does not match SUITE.version (${SUITE.version})`);
    assertBuild(pin.vectorSetHash === SUITE.vectorSetHash, `${path}: vectorSetHash (${pin.vectorSetHash}) does not match SUITE.vectorSetHash`);
  }
}
