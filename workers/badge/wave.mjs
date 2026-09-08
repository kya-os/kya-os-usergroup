/**
 * The badge's signature wave, the worker's own copy.
 *
 * DELIBERATE REDUNDANCY RULE: this module never imports site/ or scripts/
 * code (the worker must stay self-contained for Cloudflare bundling), so the
 * FNV-1a hash, the LCG, the bar draw, and the badge bar geometry are
 * reimplemented here from the same constants site/lib/waveform.mjs uses. The
 * site build's render checks (site/lib/badge.mjs) assert both sides derive
 * the same seed and emit the same rect bytes, so the two copies provably
 * cannot drift apart while the /badge/ paths hand over between the tiers.
 *
 * The seed is the credential's `proof.proofValue` - the multibase Ed25519
 * signature this worker verifies against the pinned key - so the wave is a
 * fingerprint of the signature itself: the same credential always draws the
 * same wave, and a reissued one redraws it completely.
 */

function fnv1a(input) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The seed for one credential's wave. Throws when there is no signature - the caller fails closed. */
export function credentialWaveSeed(credential) {
  const proofValue = credential?.proof?.proofValue;
  if (typeof proofValue !== "string" || proofValue.length === 0) {
    throw new Error("no proof.proofValue to fingerprint - a signature wave needs a signature");
  }
  return `kya-os:sig:${fnv1a(proofValue).toString(16).padStart(8, "0")}`;
}

// The badge wave: the directory row's bar geometry (barWidth 2, gap 1.5,
// track 11) at 14 bars, centered in the badge's 20px height. Because the
// draw is sequential, these 14 bars are exactly the first 14 of the 16 the
// site row draws from the same seed - the badge and the row are one wave.
export const BARS = 14;
const BAR_WIDTH = 2, GAP = 1.5, TRACK = 11, BADGE_HEIGHT = 20;
const HEIGHT_MIN = 0.3, HEIGHT_SPAN = 0.7, OPACITY_MIN = 0.6, OPACITY_SPAN = 0.4;
export const PITCH = BAR_WIDTH + GAP;
export const WAVE_WIDTH = BARS * PITCH;

const num = (value) => value.toFixed(1).replace(/\.0$/, "");

/**
 * The wave as badge <rect> elements, laid out from x0. A README badge carries
 * no CSS, so the bars take the state color as a literal fill instead of
 * currentColor; per-bar fill-opacity keeps the prototype's depth.
 */
export function waveRects(seed, x0, color) {
  let state = fnv1a(seed);
  const draw = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let out = "";
  for (let i = 0; i < BARS; i++) {
    const height = (HEIGHT_MIN + draw() * HEIGHT_SPAN) * TRACK;
    const opacity = OPACITY_MIN + draw() * OPACITY_SPAN;
    const y = (BADGE_HEIGHT - height) / 2;
    out +=
      `<rect x="${num(x0 + i * PITCH)}" y="${num(y)}" width="${num(BAR_WIDTH)}" height="${num(height)}"` +
      ` rx="${num(BAR_WIDTH / 2)}" fill="#${color}" fill-opacity="${opacity.toFixed(2)}"/>`;
  }
  return out;
}
