/**
 * Static badge tiers, built with the site: dist/badge/<slug>.svg plus
 * dist/badge/<slug>.json (the shields.io endpoint schema) for EVERY rendered
 * registry entry, from the same chip semantics the pages render - listed and
 * self-reported grey, in-verification amber, every message printed through
 * the honest claim label so a subset never renders as a bare level. The
 * label cell always says KYA-OS.
 *
 * HARD BOUNDARY: a status "verified" entry REFUSES static generation with a
 * build error naming the Phase B worker - a verified badge may only ever
 * come from live credential verification (workers/badge/worker.mjs), never
 * from a static build. The worker takes over the same /badge/ path space at
 * Phase B, which is what lets an embedded badge upgrade itself as the
 * entry's status climbs.
 *
 * Deterministic by construction: fixed dimensions from a fixed mono advance,
 * no timestamps - each file is a pure function of its entry. The rendering
 * is the design's flat two-cell shields grammar in the site palette (dark
 * side of tokens.css): canvas label cell, line-tone message cell, ink-dim or
 * amber mono text.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertBuild } from "./checks.mjs";
import { conformanceLabel } from "./data.mjs";
import { esc } from "./html.mjs";

const LABEL = "KYA-OS";
const FONT = "JetBrains Mono,SFMono-Regular,Consolas,monospace";
// Site palette (tokens.css, dark side): canvas / line cells, ink-bright /
// ink-dim / amber text. Raw hex on purpose - SVG files carry no CSS layer.
const CELL_LABEL = "#0a0a0a";
const CELL_MESSAGE = "#1a1a1a";
const TEXT_LABEL = "#ffffff";
const STATE_COLORS = { listed: "999999", "self-reported": "999999", "in-verification": "ffb340" };

/**
 * The badge state for one rendered entry: chip glyph + honest label + tier
 * color. Refuses "verified" - that tier is the Phase B worker's alone.
 */
export function badgeState(entry) {
  const c = entry.conformance;
  assertBuild(
    c?.status !== "verified",
    `static badge for "${entry.slug}" refused: a "verified" badge is minted only by the Phase B badge worker ` +
      `(workers/badge/worker.mjs) from live credential verification - the static build never renders one`,
  );
  if (!c) return { message: "· listed", color: STATE_COLORS.listed };
  const glyph = c.status === "in-verification" ? "◌" : "·";
  const suffix = c.status === "in-verification" ? "in verification" : "self-reported";
  return { message: `${glyph} ${conformanceLabel(c)} ${suffix}`, color: STATE_COLORS[c.status] };
}

// Fixed 11px mono advance (0.6em); one-decimal strings keep the SVG
// byte-stable across platforms, mirroring lib/waveform.mjs.
const num = (value) => {
  const rounded = value.toFixed(1);
  return rounded.replace(/\.0$/, "");
};
const cellWidth = (text) => [...text].length * 6.6 + 18;

/** The flat two-cell badge SVG: KYA-OS label cell + state message cell. */
export function renderBadgeSvg({ message, color }) {
  const lw = cellWidth(LABEL);
  const mw = cellWidth(message);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(lw + mw)}" height="20" role="img" aria-label="${LABEL}: ${esc(message)}">
  <title>${LABEL}: ${esc(message)}</title>
  <rect width="${num(lw)}" height="20" fill="${CELL_LABEL}"/>
  <rect x="${num(lw)}" width="${num(mw)}" height="20" fill="${CELL_MESSAGE}"/>
  <g font-family="${FONT}" font-size="11" text-anchor="middle">
    <text x="${num(lw / 2)}" y="14" fill="${TEXT_LABEL}">${LABEL}</text>
    <text x="${num(lw + mw / 2)}" y="14" fill="#${color}">${esc(message)}</text>
  </g>
</svg>
`;
}

/** The shields.io endpoint JSON: exactly {schemaVersion, label, message, color}. */
export function renderBadgeJson({ message, color }) {
  return JSON.stringify({ schemaVersion: 1, label: LABEL, message, color }) + "\n";
}

/** Every rendered entry's badge pair, as [filename, contents] - refuses verified. */
export function renderBadgeFiles(rendered) {
  return rendered.flatMap((entry) => {
    const state = badgeState(entry);
    return [
      [`${entry.slug}.svg`, renderBadgeSvg(state)],
      [`${entry.slug}.json`, renderBadgeJson(state)],
    ];
  });
}

/**
 * Badge render checks, on the finished dist/badge/ bytes. The expected
 * message is reconstructed inline (never through badgeState or the
 * formatters), matching the assertion philosophy in lib/assertions.mjs: a
 * regression in a renderer cannot make its own check pass.
 */
export function assertBadges(distDir, rendered) {
  const badgeDir = join(distDir, "badge");
  const emitted = readdirSync(badgeDir).sort();
  const expectedFiles = rendered.flatMap((entry) => [`${entry.slug}.json`, `${entry.slug}.svg`]).sort();
  assertBuild(
    emitted.join(",") === expectedFiles.join(","),
    `dist/badge/ must hold exactly one .svg + .json pair per rendered entry (found: ${emitted.join(", ")})`,
  );
  for (const entry of rendered) {
    const c = entry.conformance;
    assertBuild(c?.status !== "verified", `verified entry "${entry.slug}" must never reach static badge emission (Phase B worker territory)`);
    const label = c && (c.scope === "subset" ? `${c.level} subset (${c.categories.join(", ")})` : `${c.level} full`);
    const message = !c
      ? "· listed"
      : c.status === "in-verification"
        ? `◌ ${label} in verification`
        : `· ${label} self-reported`;
    const color = c?.status === "in-verification" ? "ffb340" : "999999";

    for (const ext of ["svg", "json"]) {
      const path = join(badgeDir, `${entry.slug}.${ext}`);
      assertBuild(statSync(path).size > 0, `dist/badge/${entry.slug}.${ext} is missing or empty`);
    }
    const svg = readFileSync(join(badgeDir, `${entry.slug}.svg`), "utf8");
    assertBuild(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.endsWith("</svg>\n") && !/&(?!amp;|lt;|gt;|quot;|#)/.test(svg),
      `dist/badge/${entry.slug}.svg is not a well-formed standalone SVG`,
    );
    assertBuild(svg.includes(`>${LABEL}</text>`), `dist/badge/${entry.slug}.svg lost its ${LABEL} label cell`);
    assertBuild(svg.includes(`>${esc(message)}</text>`), `dist/badge/${entry.slug}.svg message does not match the entry's state ("${message}")`);
    const shields = JSON.parse(readFileSync(join(badgeDir, `${entry.slug}.json`), "utf8"));
    assertBuild(
      Object.keys(shields).sort().join(",") === "color,label,message,schemaVersion",
      `dist/badge/${entry.slug}.json must carry exactly the shields endpoint keys {schemaVersion, label, message, color}`,
    );
    assertBuild(shields.schemaVersion === 1 && shields.label === LABEL, `dist/badge/${entry.slug}.json label/schemaVersion drifted`);
    assertBuild(shields.message === message, `dist/badge/${entry.slug}.json message does not match the entry's state ("${message}")`);
    assertBuild(shields.color === color, `dist/badge/${entry.slug}.json color does not match the entry's tier (${color})`);
    for (const [ext, bytes] of [["svg", svg], ["json", JSON.stringify(shields)]]) {
      assertBuild(!/certified|certification/i.test(bytes), `banned term leaked into dist/badge/${entry.slug}.${ext}`);
      assertBuild(!bytes.includes("verified"), `"verified" leaked into static dist/badge/${entry.slug}.${ext} - that tier belongs to the Phase B worker`);
    }
    if (c?.scope === "subset") {
      assertBuild(shields.message.includes(`${c.level} subset (`), `subset badge for "${entry.slug}" must name its categories, never a bare level`);
    }
  }
}
