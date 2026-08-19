/**
 * Render checks: assert the built artifact is complete and honest, reading
 * the finished files back from dist/ rather than trusting the renderers.
 *
 * The honesty rules these enforce are documented in lib/html.mjs, where they
 * are applied at render time. Two of the checks deliberately do NOT reuse
 * the shared formatters: the subset check reconstructs the expected label
 * inline and the certified check scans raw bytes, so a regression in the
 * formatter cannot make its own assertion pass.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATE_SLUG } from "./constants.mjs";
import { withConformance } from "./data.mjs";
import { esc } from "./html.mjs";

function assertBuild(condition, message) {
  if (!condition) {
    console.error(`Render check FAILED: ${message}`);
    process.exit(1);
  }
}

/** Verify every dist/ artifact against the shaped registry data; exits non-zero on the first failure. */
export function runRenderChecks({ distDir, rendered, interopSorted }) {
  const conformanceEntries = withConformance(rendered);

  for (const name of ["index.html", "404.html", "builders.json", "interop.json", "_headers"]) {
    const path = join(distDir, name);
    assertBuild(statSync(path).size > 0, `dist/${name} is missing or empty`);
  }
  const indexHtml = readFileSync(join(distDir, "index.html"), "utf8");
  for (const entry of rendered) {
    assertBuild(indexHtml.includes(esc(entry.name)), `dist/index.html does not list "${entry.name}"`);
  }
  for (const entry of interopSorted) {
    assertBuild(indexHtml.includes(`id="std-${entry.slug}"`), `dist/index.html does not list standard "${entry.slug}"`);
  }

  // Honesty assertions.
  // "Certificate Transparency" (RFC 9162) is a standard's proper name and is
  // fine; conformance-flavored "certified"/"certification" language is not.
  assertBuild(!/certified|certification/i.test(indexHtml), 'the word "certified"/"certification" leaked into index.html');
  for (const entry of conformanceEntries) {
    const c = entry.conformance;
    if (c.scope === "subset") {
      assertBuild(
        indexHtml.includes(esc(`${c.level} subset (${c.categories.join(", ")})`)),
        `subset claim for "${entry.slug}" must render with its categories, never as a bare level`,
      );
    }
  }
  // A green "verified" chip exists only as a credential link: no anchor-less occurrence.
  assertBuild(
    !/<span class="chip st-verified(?! demo)/.test(indexHtml),
    'a "verified" chip rendered without a credential link',
  );
  // Non-verified claims that carry public evidence must render it (the chip is the link).
  for (const entry of conformanceEntries) {
    const c = entry.conformance;
    if (c.status !== "verified" && c.evidenceUrl) {
      assertBuild(
        indexHtml.includes(`href="${esc(c.evidenceUrl)}"`),
        `evidenceUrl for "${entry.slug}" did not render`,
      );
    }
  }
  // Every standards row shows its listing date - freshness is auditable on-page.
  assertBuild(
    (indexHtml.match(/class="row-listed/g) ?? []).length === interopSorted.length,
    "every interop row must render its listedAt date",
  );

  const published = JSON.parse(readFileSync(join(distDir, "builders.json"), "utf8"));
  assertBuild(published.count === rendered.length, "builders.json count mismatch");
  assertBuild(
    !published.builders.some((entry) => entry.slug === TEMPLATE_SLUG),
    `template entry "${TEMPLATE_SLUG}" leaked into builders.json`,
  );
  assertBuild(!indexHtml.includes(`id="${TEMPLATE_SLUG}"`), `template entry "${TEMPLATE_SLUG}" leaked into index.html`);
  const publishedInterop = JSON.parse(readFileSync(join(distDir, "interop.json"), "utf8"));
  assertBuild(publishedInterop.count === interopSorted.length, "interop.json count mismatch");
  const notFoundHtml = readFileSync(join(distDir, "404.html"), "utf8");
  assertBuild(notFoundHtml.includes("404"), "dist/404.html is not a not-found page");
}
