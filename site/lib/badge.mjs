/**
 * Static badge tiers, built with the site: dist/badge/<slug>.svg plus
 * dist/badge/<slug>.json (the shields.io endpoint schema) for EVERY rendered
 * registry entry, from the same chip semantics the pages render - listed and
 * self-reported grey, in-verification amber, every message printed through
 * the honest claim label so a subset never renders as a bare level. The
 * label cell always says KYA-OS.
 *
 * THE VERIFIED BOUNDARY (v1.5): a "verified" badge renders here ONLY when
 * the build cryptographically verified the entry's credential against the
 * committed program keys and its signed status lists
 * (site/lib/credentials.mjs - the build refuses before this module runs
 * otherwise). The badge is therefore backed by build-time verification of
 * in-repo state: green "✓ <claim> verified" on a clean credential, amber
 * "◌ under appeal" while the suspension bit is set, dark "revoked" once the
 * revocation bit is terminal. The Phase B worker upgrades the same
 * /badge/ paths to request-time verification (workers/badge/worker.mjs).
 * An entry at status verified/revoked WITHOUT a build verdict refuses with
 * a build error - a verified badge can never render on trust.
 *
 * Deterministic by construction: fixed dimensions from a fixed mono advance,
 * no timestamps - each file is a pure function of its entry and the
 * committed credential state. The rendering is the design's flat two-cell
 * shields grammar in the site palette (dark side of tokens.css): canvas
 * label cell, line-tone message cell, tier-toned mono text.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertBuild } from "./checks.mjs";
import { conformanceLabel } from "./data.mjs";
import { esc } from "./html.mjs";

const LABEL = "KYA-OS";
const FONT = "JetBrains Mono,SFMono-Regular,Consolas,monospace";
// Site palette (tokens.css, dark side): canvas / line cells, ink-bright /
// tier text. Raw hex on purpose - SVG files carry no CSS layer. Verified is
// the signal-green family tuned to read on the message cell; revoked is the
// dead grey tier, dimmer than listed's #999999.
const CELL_LABEL = "#0a0a0a";
const CELL_MESSAGE = "#1a1a1a";
const TEXT_LABEL = "#ffffff";
const STATE_COLORS = {
  listed: "999999",
  "self-reported": "999999",
  "in-verification": "ffb340",
  verified: "00c86e",
  suspended: "ffb340",
  revoked: "6e7681",
};

/**
 * The badge state for one rendered entry: honest message + tier color.
 * `verdict` is the build's credential verification result for the slug;
 * required (and trusted only because site/lib/credentials.mjs refused the
 * build on any verification failure) whenever the entry claims a rung that
 * needs a credential behind it.
 */
export function badgeState(entry, verdict) {
  const c = entry.conformance;
  if (!c) return { message: "· listed", color: STATE_COLORS.listed };
  if (c.status === "verified" || c.status === "revoked") {
    assertBuild(
      verdict !== undefined,
      `badge for "${entry.slug}" refused: status "${c.status}" renders only from build-time cryptographic verification ` +
        `of the linked credential (site/lib/credentials.mjs) - no verdict, no badge`,
    );
    if (verdict.state === "revoked") return { message: "revoked", color: STATE_COLORS.revoked };
    if (verdict.state === "suspended") return { message: "◌ under appeal", color: STATE_COLORS.suspended };
    return { message: `✓ ${conformanceLabel(c)} verified`, color: STATE_COLORS.verified };
  }
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

/** Every rendered entry's badge pair, as [filename, contents]. */
export function renderBadgeFiles(rendered, verdicts) {
  return rendered.flatMap((entry) => {
    const state = badgeState(entry, verdicts.get(entry.slug));
    return [
      [`${entry.slug}.svg`, renderBadgeSvg(state)],
      [`${entry.slug}.json`, renderBadgeJson(state)],
    ];
  });
}

/**
 * The expected badge message and color for one entry, reconstructed WITHOUT
 * badgeState or the formatters (assertion philosophy: a regression in a
 * renderer cannot make its own check pass). The verdict is data from the
 * build's independent cryptographic verification, not renderer output.
 */
function expectedBadge(entry, verdict) {
  const c = entry.conformance;
  const label = c && (c.scope === "subset" ? `${c.level} subset (${c.categories.join(", ")})` : `${c.level} full`);
  if (!c) return { message: "· listed", color: "999999" };
  if (c.status === "verified" || c.status === "revoked") {
    if (verdict.state === "revoked") return { message: "revoked", color: "6e7681" };
    if (verdict.state === "suspended") return { message: "◌ under appeal", color: "ffb340" };
    return { message: `✓ ${label} verified`, color: "00c86e" };
  }
  if (c.status === "in-verification") return { message: `◌ ${label} in verification`, color: "ffb340" };
  return { message: `· ${label} self-reported`, color: "999999" };
}

/**
 * Badge render checks, on the finished dist/badge/ bytes: exactly one
 * .svg + .json pair per rendered entry, each carrying the expected state.
 * "verified" may appear in a badge file ONLY for an entry whose credential
 * this build cryptographically verified with clean status bits; a subset
 * never renders as a bare level; banned terms appear nowhere.
 */
export function assertBadges(distDir, rendered, verdicts) {
  const badgeDir = join(distDir, "badge");
  const emitted = readdirSync(badgeDir).sort();
  const expectedFiles = rendered.flatMap((entry) => [`${entry.slug}.json`, `${entry.slug}.svg`]).sort();
  assertBuild(
    emitted.join(",") === expectedFiles.join(","),
    `dist/badge/ must hold exactly one .svg + .json pair per rendered entry (found: ${emitted.join(", ")})`,
  );
  for (const entry of rendered) {
    const c = entry.conformance;
    const verdict = verdicts.get(entry.slug);
    assertBuild(
      !(c?.status === "verified" || c?.status === "revoked") || verdict !== undefined,
      `entry "${entry.slug}" reached badge assertion at status "${c?.status}" without a build verdict - the verifier must refuse first`,
    );
    const { message, color } = expectedBadge(entry, verdict);

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
      assertBuild(
        bytes.includes("verified") === (verdict?.state === "verified"),
        `"verified" in dist/badge/${entry.slug}.${ext} must appear exactly when the build verified the credential (state: ${verdict?.state ?? "none"})`,
      );
    }
    if (c?.scope === "subset" && shields.message.includes(c.level)) {
      assertBuild(shields.message.includes(`${c.level} subset (`), `subset badge for "${entry.slug}" must name its categories, never a bare level`);
    }
  }
}
