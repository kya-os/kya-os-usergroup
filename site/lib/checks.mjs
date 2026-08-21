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
import { FOUNDING_CUTOFF, MIGRATE_LINES, PROMPTS, SUITE } from "./constants.mjs";
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
      if (target === "migrate-code") {
        // The code-copy triangle: the hidden raw <pre> the button reads, the
        // visible highlighted block, and the MIGRATE_LINES constant must all
        // carry the same code - highlighting can restyle it, never change it.
        const rawText = MIGRATE_LINES.map(([text]) => text).join("\n");
        const rawPre = html.match(/<pre id="migrate-code"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
        assertBuild(rawPre === esc(rawText), `${name}: the migrate-code raw source drifted from MIGRATE_LINES`);
        const visible = html.match(/<pre class="code-block"><code>([\s\S]*?)<\/code><\/pre>/)?.[1];
        assertBuild(visible !== undefined, `${name}: the highlighted migrate block is missing`);
        // Split on line spans first (token spans nest inside them), then strip
        // every remaining tag per line - reconstruction beats fragile pairing.
        const lines = visible
          .split(/<span class="cl(?: hl)?">/)
          .slice(1)
          .map((chunk) => chunk.replace(/<[^>]+>/g, ""));
        const unescaped = lines
          .join("\n")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"');
        assertBuild(
          unescaped === rawText,
          `${name}: the highlighted migrate block drifted from MIGRATE_LINES`,
        );
        assertBuild(
          /<button[^>]*data-copy-target="migrate-code"[^>]*\bhidden\b|<button[^>]*\bhidden\b[^>]*data-copy-target="migrate-code"/.test(html),
          `${name}: the migrate-code copy button must ship hidden`,
        );
        continue;
      }
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
  const probed = rendered.filter((entry) => entry.kind === "service" && entry.probeUrl !== undefined && results[entry.slug] !== undefined);
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
 * The founding cohort and the profile rows, per directory row (blocks
 * re-extracted from the page bytes, the cutoff compared here - never through
 * the renderer's own predicate): every rendered entry listed on or before
 * the cutoff, and no other, carries the founding-builder tag; every expanded
 * row carries its copy-ready badge embed.
 */
export function assertFoundingCohort(buildersHtml, rendered) {
  for (const entry of rendered) {
    const start = buildersHtml.indexOf(`id="${entry.slug}"`);
    assertBuild(start !== -1, `no directory row found for "${entry.slug}"`);
    const row = buildersHtml.slice(start, buildersHtml.indexOf("</details>", start));
    const expected = entry.listedAt <= FOUNDING_CUTOFF;
    assertBuild(
      row.includes("founding builder") === expected,
      `"${entry.slug}" (listed ${entry.listedAt}) must ${expected ? "" : "not "}carry the founding-builder tag (cutoff ${FOUNDING_CUTOFF})`,
    );
    assertBuild(row.includes(`/badge/${entry.slug}.svg`), `the expanded row for "${entry.slug}" must carry its badge embed snippet`);
  }
  const count = (buildersHtml.match(/founding builder/g) ?? []).length;
  const expectedCount = rendered.filter((entry) => entry.listedAt <= FOUNDING_CUTOFF).length;
  assertBuild(count === expectedCount, `${count} founding-builder tags rendered, expected ${expectedCount}`);
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
