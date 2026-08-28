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
 * THE SIGNATURE WAVE: a badge minted from a verified credential (verified,
 * under appeal, revoked) carries that credential's wave - the bars seeded by
 * its proof.proofValue, the signature the build just verified
 * (lib/waveform.mjs's credentialWaveSeed). So the badge is visually unique
 * per credential, identical to the wave the directory row draws for the same
 * entry, and completely redrawn by a reissue. The rungs below the credential
 * boundary (listed, self-reported, in verification) keep the flat badge:
 * there is no signature to fingerprint yet. A verified badge with no
 * seedable signature refuses the build, exactly like a missing verdict.
 *
 * Deterministic by construction: fixed dimensions from a fixed mono advance,
 * a seeded (never random) wave, no timestamps - each file is a pure function
 * of its entry and the committed credential state. The rendering is the
 * design's shields grammar in the site palette (dark side of tokens.css):
 * canvas label cell, line-tone message cell, tier-toned mono text and bars.
 *
 * The render checks on the emitted bytes live in lib/badge-checks.mjs (split
 * for the lib LOC cap), including the byte-parity assertion against the
 * worker's independent renderer.
 */
import { assertBuild } from "./checks.mjs";
import { conformanceLabel } from "./data.mjs";
import { esc } from "./html.mjs";
import { proofWaveform } from "./waveform.mjs";

export const LABEL = "KYA-OS";
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
    // Fail closed on the wave the same way as on the verdict: a badge minted
    // from a verified credential carries that credential's signature
    // fingerprint or it does not render at all.
    const wave = verdict.waveSeed;
    assertBuild(
      typeof wave === "string" && wave.length > 0,
      `badge for "${entry.slug}" refused: the verdict carries no wave seed - the signature wave is derived from the ` +
        `credential's proof.proofValue (site/lib/waveform.mjs), and a verified badge never renders without it`,
    );
    if (verdict.state === "revoked") return { message: "revoked", color: STATE_COLORS.revoked, wave };
    if (verdict.state === "suspended") return { message: "◌ under appeal", color: STATE_COLORS.suspended, wave };
    return { message: `✓ ${conformanceLabel(c)} verified`, color: STATE_COLORS.verified, wave };
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
const CELL_PAD = 9;
const cellWidth = (text) => [...text].length * 6.6 + CELL_PAD * 2;

// The signature wave's geometry: the directory row's bars (barWidth 2, gap
// 1.5, track 11 - CLAIM_WAVE in scripts/lib/builder-entry.mjs) at 14 of its
// 16 bars, centered in the badge's 20px height. proofWaveform draws
// sequentially, so these 14 ARE the row's first 14 from the same seed: the
// badge and the row carry one wave, not two lookalikes.
export const WAVE_BARS = 14;
const BAR_WIDTH = 2, BAR_GAP = 1.5, TRACK = 11, HEIGHT = 20;
const PITCH = BAR_WIDTH + BAR_GAP;
const WAVE_WIDTH = WAVE_BARS * PITCH;

/**
 * The wave as badge <rect>s from x0. A README badge carries no CSS, so the
 * bars take the state color as a literal fill instead of currentColor (the
 * one deliberate difference from lib/waveform.mjs's page rendering).
 */
function waveRects(seed, x0, color) {
  return proofWaveform(seed, { bars: WAVE_BARS })
    .map((bar, i) => {
      const height = bar.height * TRACK;
      return (
        `<rect x="${num(x0 + i * PITCH)}" y="${num((HEIGHT - height) / 2)}" width="${num(BAR_WIDTH)}" height="${num(height)}"` +
        ` rx="${num(BAR_WIDTH / 2)}" fill="#${color}" fill-opacity="${bar.opacity.toFixed(2)}"/>`
      );
    })
    .join("");
}

/**
 * The badge SVG: KYA-OS label cell + state message cell, and - for the
 * states minted from a verified credential - that credential's signature
 * wave leading the message cell. `wave` is the seed (null below the
 * credential rungs, where there is no signature to fingerprint).
 */
export function renderBadgeSvg({ message, color, wave = null }) {
  const lw = cellWidth(LABEL);
  // The wave leads the message cell: one cell pad, the bars, then the text
  // cell whole and unshifted (so the message keeps its own padding).
  const ww = wave === null ? 0 : CELL_PAD + WAVE_WIDTH;
  const mw = cellWidth(message) + ww;
  const bars = wave === null ? "" : `\n  ${waveRects(wave, lw + CELL_PAD, color)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(lw + mw)}" height="20" role="img" aria-label="${LABEL}: ${esc(message)}">
  <title>${LABEL}: ${esc(message)}</title>
  <rect width="${num(lw)}" height="20" fill="${CELL_LABEL}"/>
  <rect x="${num(lw)}" width="${num(mw)}" height="20" fill="${CELL_MESSAGE}"/>${bars}
  <g font-family="${FONT}" font-size="11" text-anchor="middle">
    <text x="${num(lw / 2)}" y="14" fill="${TEXT_LABEL}">${LABEL}</text>
    <text x="${num(lw + ww + cellWidth(message) / 2)}" y="14" fill="#${color}">${esc(message)}</text>
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
