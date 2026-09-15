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
 * The badge's display label: the claim trimmed to fit a 20px chip. "L3"
 * for a full-scope claim, "L3 subset" for subset - the category list and
 * the full claim string live in the implementations table and the
 * credential, not the artifact.
 */
const badgeLabel = (c) => (c.scope === "subset" ? `${c.level} subset` : c.level);

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
    return { message: `✓ ${badgeLabel(c)} verified`, color: STATE_COLORS.verified, wave };
  }
  const glyph = c.status === "in-verification" ? "◌" : "·";
  const suffix = c.status === "in-verification" ? "in verification" : "self-reported";
  return { message: `${glyph} ${badgeLabel(c)} ${suffix}`, color: STATE_COLORS[c.status] };
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
 * The KYA-OS mark, inlined so the artifact carries the brand without any
 * external fetch (a README badge loads nothing). Source
 * site/assets/img/kya-mark-white.svg (viewBox 0 0 197 227), drawn 11px tall
 * in the label cell; the label text shifts right to make room.
 */
const MARK_D = "M85.807 0.190363C96.416 -0.0168199 107.047 -0.143695 117.645 0.291926C134.724 0.998586 147.873 9.07309 157.611 22.9492C157.866 23.3103 158.094 23.6932 158.301 24.081C158.37 24.2138 158.333 24.4052 158.349 24.6708C154.784 25.5474 151.167 26.2912 147.634 27.3271C113.453 37.3199 90.5985 70.3001 93.9134 105.671C96.5803 134.157 111.264 154.573 137.136 166.877C140.249 168.359 143.437 169.107 146.89 168.141C151.873 166.749 155.252 162.844 155.773 157.744C156.256 152.995 153.626 148.203 148.967 146.195C142.991 143.619 137.386 140.516 132.653 136.006C105.097 109.773 115.35 63.6591 151.714 50.7656C156.965 48.902 162.598 48.1099 169.033 46.5868C169.819 54.4646 171.275 61.3225 171.02 68.122C170.568 80.3992 173.527 91.5764 179.483 102.101C184.227 110.478 189.018 118.83 194.023 127.054C198.023 133.625 196.466 138.699 189.209 141.435C187.313 142.152 185.364 142.748 183.504 143.55C178.638 145.653 177.172 149.722 179.753 154.365C181.05 156.692 183.089 158.934 181.352 161.617C179.981 163.731 177.9 165.39 175.897 167.504C175.983 167.632 176.497 168.312 176.932 169.033C179.179 172.768 178.51 177.055 175.052 179.653C171.078 182.634 170.143 186.501 170.313 191.293C170.488 196.356 170.499 201.652 169.235 206.492C166.308 217.707 157.627 222.769 146.996 225.234C135.984 227.79 125.502 226.303 115.786 220.65C102.122 212.703 91.3686 202.141 87.8304 186.06C86.837 181.55 86.97 176.758 86.8744 172.094C86.5609 156.39 82.7148 141.7 74.5335 128.249C65.906 114.07 54.3559 102.68 39.2152 95.9911C24.2926 89.4034 14.4545 72.7434 19.6341 52.7314C27.619 21.8764 53.9585 0.811927 85.807 0.190363ZM14.4857 111.658C15.681 111.977 17.381 112.365 19.0384 112.875C44.8254 120.828 62.208 144.065 63.058 171.053C63.637 189.577 60.3325 207.247 53.0384 224.247C52.2044 226.186 51.2644 226.685 49.3255 226.335C42.3238 225.06 35.4866 223.423 29.7279 218.897C23.5122 214.015 21.2808 207.645 22.3646 199.899C22.7046 197.482 22.8426 194.969 22.5345 192.562C22.3485 191.123 21.4025 189.534 20.3294 188.493C14.6028 182.915 14.3688 181.927 17.8431 175.6C16.2017 173.847 14.3531 172.402 13.2269 170.521C12.021 168.503 12.4833 166.467 14.3001 164.528C15.7344 163.004 16.8446 160.926 17.4183 158.902C18.4594 155.263 16.8659 152.453 13.3597 151.066C10.7353 150.03 7.97805 149.329 5.38023 148.24C0.264303 146.094 -1.36161 141.69 1.1937 136.76C5.49146 128.472 9.92764 120.254 14.4857 111.664V111.658ZM63.9505 39.4452C53.825 39.4773 45.8567 47.5041 45.8832 57.6562C45.9044 67.5746 54.0216 75.6022 64.0091 75.581C74.1028 75.5597 82.2472 67.4581 82.2474 57.4335H82.2416C82.2416 47.3769 74.14 39.4134 63.9505 39.4452ZM169.043 46.5849C169.04 46.5857 169.036 46.586 169.033 46.5868V46.5849H169.043Z";
const MARK_SCALE = "0.0485"; // 227 * 0.0485 = 11.0px tall
const MARK_W = 9.6; // 197 * 0.0485, rounded to the num() grid
const MARK_GAP = 5.4;

/**
 * The badge SVG: KYA-OS label cell + state message cell, and - for the
 * states minted from a verified credential - that credential's signature
 * wave leading the message cell. `wave` is the seed (null below the
 * credential rungs, where there is no signature to fingerprint).
 */
export function renderBadgeSvg({ message, color, wave = null }) {
  const labelTextW = [...LABEL].length * 6.6;
  const lw = CELL_PAD + MARK_W + MARK_GAP + labelTextW + CELL_PAD;
  // The wave leads the message cell: one cell pad, the bars, then the text
  // cell whole and unshifted (so the message keeps its own padding).
  const ww = wave === null ? 0 : CELL_PAD + WAVE_WIDTH;
  const mw = cellWidth(message) + ww;
  const bars = wave === null ? "" : `\n  ${waveRects(wave, lw + CELL_PAD, color)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(lw + mw)}" height="20" role="img" aria-label="${LABEL}: ${esc(message)}">
  <title>${LABEL}: ${esc(message)}</title>
  <rect width="${num(lw)}" height="20" fill="${CELL_LABEL}"/>\n  <path transform="translate(${num(CELL_PAD)} 4.5) scale(${MARK_SCALE})" d="${MARK_D}" fill="${TEXT_LABEL}"/>
  <rect x="${num(lw)}" width="${num(mw)}" height="20" fill="${CELL_MESSAGE}"/>${bars}
  <g font-family="${FONT}" font-size="11" text-anchor="middle">
    <text x="${num(CELL_PAD + MARK_W + MARK_GAP + labelTextW / 2)}" y="14" fill="${TEXT_LABEL}">${LABEL}</text>
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
