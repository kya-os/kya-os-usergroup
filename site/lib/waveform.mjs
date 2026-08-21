/**
 * Build-time proof waveforms: the "signature fingerprint" artifact of the
 * builders-site design, computed here instead of at runtime. The math is a
 * straight port of the design handoff's proof-waveform.js (itself ported from
 * Checkpoint's proof-waveform.tsx + seeded-rng.ts): same FNV-1a hash, same
 * LCG constants, same ranges - an identical seed draws the identical wave
 * here, in the prototype, and in Checkpoint. No Math.random anywhere, so the
 * emitted SVG is a pure function of the seed and the build stays
 * deterministic.
 *
 * Rendering emits static SVG strings with presentation ATTRIBUTES only
 * (never style="..."), so the pages keep the no-inline-style contract under
 * style-src 'self'. Color rides currentColor: the wrapping element's class
 * picks the token.
 */

export function fnv1a(input) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function makeSeededRng(seed) {
  let state = fnv1a(seed);
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const HEIGHT_MIN = 0.3, HEIGHT_SPAN = 0.7, OPACITY_MIN = 0.6, OPACITY_SPAN = 0.4;

/** The bar data: {height, opacity} pairs in [0..1], seeded. */
export function proofWaveform(seed, { bars = 24, opacity = true } = {}) {
  const count = Math.max(0, Math.floor(bars));
  const rng = makeSeededRng(seed);
  return Array.from({ length: count }, () => {
    const height = HEIGHT_MIN + rng() * HEIGHT_SPAN;
    const opacityDraw = OPACITY_MIN + rng() * OPACITY_SPAN;
    return { height, opacity: opacity ? opacityDraw : 1 };
  });
}

// Fixed-precision numbers keep the SVG byte-stable across platforms (no
// float-formatting drift) while staying visually identical to the prototype.
const num = (value) => {
  const rounded = value.toFixed(3);
  return rounded.replace(/\.?0+$/, "") || "0";
};

/**
 * The waveform as a static SVG string. Mirrors the prototype's
 * proofWaveformEl geometry exactly: pitch = barWidth + gap, centered bars,
 * rx = barWidth / 2, fill currentColor with per-bar fill-opacity.
 */
export function waveformSvg(seed, { bars = 24, opacity = true, trackHeight = 14, barWidth = 2.4, gap = 1.6 } = {}) {
  const data = proofWaveform(seed, { bars, opacity });
  if (data.length === 0) return "";
  const pitch = barWidth + gap;
  const width = data.length * pitch;
  const rects = data
    .map((bar, i) => {
      const y = ((1 - bar.height) * trackHeight) / 2;
      return `<rect x="${num(i * pitch)}" y="${num(y)}" width="${num(barWidth)}" height="${num(bar.height * trackHeight)}" rx="${num(barWidth / 2)}" fill="currentColor" fill-opacity="${num(bar.opacity)}"/>`;
    })
    .join("");
  return `<svg class="wf" aria-hidden="true" viewBox="0 0 ${num(width)} ${num(trackHeight)}" width="${num(width)}" height="${num(trackHeight)}" preserveAspectRatio="none">${rects}</svg>`;
}

/**
 * The canonical "signed proof" lockup: waveform + mono label in a plain
 * (borderless) span - the artifact KYA-OS generates, used everywhere a proof
 * is represented. `tone` picks the color class (signal by default); `small`
 * drops the label to the 8px variant.
 */
export function waveformLockup(seed, { label = "signed proof", bars = 16, trackHeight = 11, barWidth = 2, gap = 1.5, tone = "signal", small = false } = {}) {
  const wave = waveformSvg(seed, { bars, trackHeight, barWidth, gap });
  return `<span class="wf-lockup tone-${tone}${small ? " wf-sm" : ""}">${wave}<span class="wf-label">${label}</span></span>`;
}
