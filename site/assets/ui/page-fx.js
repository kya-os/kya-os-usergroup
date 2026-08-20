// page-fx - the hub's motion layer, adapted from the Builders Site design
// handoff's page-fx.js (itself ported from kya-os.org's src/ui/*): Title
// decrypt, GlitchText hover scramble, ScrollSkew, and the 400ms
// FadeTransition between pages, driven by one initPageFx sequence.
//
// HUB ADAPTATIONS, all deliberate:
//   - Gated: the whole module is inert unless the inline theme script added
//     html.js-anim (never under prefers-reduced-motion, re-checked here), so
//     reduced-motion visitors get no animation AND no link interception, and
//     no-JS visitors get a fully visible static page from CSS alone.
//   - The staggered fadeUp entries live in the stylesheet as paused
//     animations under html.js-anim (.fx / .fxd-*); this module only flips
//     them to running - the handoff's paused+release pattern mapped onto the
//     hub's gating. window.__pageFxInit is the inline script's 2.5s failsafe
//     handshake: if this module never runs, the class is removed and the CSS
//     releases everything.
//   - FadeTransition paints its overlay via the .fade-overlay class (all
//     styling in hub.css, gated), and never intercepts modified clicks
//     (cmd/ctrl/shift/alt or a non-left button), so open-in-new-tab keeps
//     working - the handoff swallows cmd+click, a real bug.
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

export function shuffle(array) {
  const s = [...array];
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [s[i], s[j]] = [s[j], s[i]];
  }
  return s;
}

// Title - shuffle "decryption" reveal.
export class Title {
  constructor(element, options = {}) {
    this.element = element;
    this.originalText = element.textContent;
    this.letters = [];
    this.options = {
      revealDelay: options.revealDelay ?? 0,
      letterDelay: options.letterDelay ?? 30,
      glitchChars: options.glitchChars || "!@#$%^&*()_+-=[]{}|;:,.<>?/~`",
      glitchIterations: options.glitchIterations ?? 3,
    };
    this.init();
  }
  init() {
    // Assistive tech reads the real text via the label on the nearest
    // heading (a bare span cannot carry an accessible name); the animated
    // letter spans (glitch glyphs included) are decorative and hidden.
    (this.element.closest("h1,h2,h3") || this.element).setAttribute("aria-label", this.originalText);
    this.element.textContent = "";
    this.originalText.split("").forEach((char) => {
      const span = document.createElement("span");
      span.className = "title-letter";
      span.setAttribute("aria-hidden", "true");
      span.dataset.char = char;
      span.textContent = char === " " ? "\u00A0" : char;
      span.style.opacity = "0";
      this.element.appendChild(span);
      this.letters.push(span);
    });
  }
  restore() {
    this.element.style.visibility = "visible";
    this.letters.forEach((span) => {
      span.textContent = span.dataset.char === " " ? "\u00A0" : span.dataset.char;
      span.style.opacity = "1";
      span.classList.remove("glitching");
    });
  }
  async animateIn() {
    this.element.style.visibility = "visible";
    await wait(this.options.revealDelay);
    const order = shuffle([...Array(this.letters.length).keys()]);
    await Promise.all(order.map((letterIndex, orderIndex) => this.revealLetter(this.letters[letterIndex], orderIndex * this.options.letterDelay)));
  }
  async revealLetter(span, delay) {
    await wait(delay);
    const original = span.dataset.char;
    if (original === " ") { span.style.opacity = "1"; return; }
    for (let i = 0; i < this.options.glitchIterations; i++) {
      span.textContent = this.options.glitchChars[Math.floor(Math.random() * this.options.glitchChars.length)];
      span.style.opacity = "1";
      span.classList.add("glitching");
      await wait(50);
    }
    span.textContent = original;
    span.classList.remove("glitching");
    span.classList.add("revealed");
  }
}

// GlitchText - hover scramble for the opted-in nav links.
export class GlitchText {
  constructor(element, options = {}) {
    this.element = element;
    this.originalText = element.textContent;
    this.isGlitching = false;
    this.options = { glitchChars: "!<>-_\\/[]{}=+*^?#_", iterations: 3, speed: 50, ...options };
    this.element.addEventListener("mouseenter", () => this.glitch());
  }
  async glitch() {
    if (this.isGlitching) return;
    this.isGlitching = true;
    const original = this.originalText;
    for (let iteration = 0; iteration < this.options.iterations; iteration++) {
      let scrambled = "";
      for (const char of original) {
        scrambled += char === " " ? " " : Math.random() > 0.5 ? this.options.glitchChars[Math.floor(Math.random() * this.options.glitchChars.length)] : char;
      }
      this.element.textContent = scrambled;
      this.element.classList.add("glitching");
      await wait(this.options.speed);
    }
    this.element.textContent = original;
    this.element.classList.remove("glitching");
    this.isGlitching = false;
  }
}

// FadeTransition - the 400ms fade overlay between pages (replaces the old
// scanline wipe). Only plain left clicks on same-origin, non-hash links are
// intercepted; bfcache restores and tab re-focus reset a stuck overlay.
export class FadeTransition {
  constructor() {
    this.isTransitioning = false;
    const existing = document.querySelector(".fade-overlay");
    if (existing) existing.remove();
    this.overlay = document.createElement("div");
    this.overlay.className = "fade-overlay";
    document.body.appendChild(this.overlay);
    this.interceptLinks();
    window.addEventListener("pageshow", (event) => { if (event.persisted) this.reset(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.isTransitioning) this.reset();
    });
  }
  reset() {
    this.isTransitioning = false;
    this.overlay.classList.remove("active");
  }
  interceptLinks() {
    document.addEventListener("click", async (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (link.target === "_blank" || link.hasAttribute("data-no-transition")) return;
      event.preventDefault();
      if (this.isTransitioning) return;
      this.isTransitioning = true;
      this.overlay.classList.add("active");
      await wait(400);
      window.location.href = href;
    });
  }
}

// ScrollSkew - velocity-based skew on scroll, with the handoff's dead zone
// so light scrolls don't wobble. Skipped on touch devices.
export class ScrollSkew {
  constructor(options = {}) {
    this.options = { elements: options.elements || [], skewAmount: options.skewAmount ?? 0.8, lerpSpeed: options.lerpSpeed ?? 0.15 };
    this.lastScroll = 0;
    this.currentSkew = 0;
    this.targetSkew = 0;
    this.init();
  }
  init() {
    if (this.options.elements.length === 0) return;
    if (navigator.maxTouchPoints > 0) return;
    this.options.elements.forEach((el) => { el.style.willChange = "transform"; });
    window.addEventListener("scroll", this.onScroll.bind(this), { passive: true });
    this.update();
  }
  onScroll() {
    const currentScroll = window.scrollY;
    const delta = currentScroll - this.lastScroll;
    this.lastScroll = currentScroll;
    const excess = Math.max(0, Math.abs(delta) - 14) * Math.sign(delta);
    this.targetSkew = clamp(excess * 0.05 * this.options.skewAmount, -this.options.skewAmount, this.options.skewAmount);
  }
  update() {
    this.targetSkew *= 0.95;
    this.currentSkew = lerp(this.currentSkew, this.targetSkew, this.options.lerpSpeed);
    if (Math.abs(this.currentSkew) > 0.001) {
      this.options.elements.forEach((el) => { el.style.transform = `skewY(${this.currentSkew}deg)`; });
    }
    requestAnimationFrame(this.update.bind(this));
  }
}

// The handoff's PageInit sequence, on the hub's gating: prepare the hidden
// title, release the paused fadeUp entries, decrypt the title, then wire the
// interactive layers.
export async function initPageFx() {
  if (window.__pageFxInit) return;
  window.__pageFxInit = true;
  new FadeTransition();
  const titleEl = document.querySelector("[data-title-reveal]");
  const title = titleEl ? new Title(titleEl, { revealDelay: 0, letterDelay: 30, glitchIterations: 3 }) : null;
  window.addEventListener("pageshow", (e) => { if (e.persisted && title) title.restore(); });
  await wait(50);
  document.querySelectorAll(".fx").forEach((el) => { el.style.animationPlayState = "running"; });
  await wait(200);
  if (title) await title.animateIn();
  document.querySelectorAll("[data-glitch]").forEach((el) => {
    if (el.children.length === 0) new GlitchText(el);
  });
  const main = document.querySelector("main");
  if (main) new ScrollSkew({ elements: [main], skewAmount: 0.8 });
}

// The inline theme script sets html.js-anim only when prefers-reduced-motion
// does not match; re-checking both keeps this module fully inert (no hidden
// content, no link interception) for reduced-motion visitors and for any
// page whose gate did not run.
const animated =
  document.documentElement.classList.contains("js-anim") &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;

if (animated) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initPageFx());
  } else {
    initPageFx();
  }
} else {
  // Handshake even when inert, so the failsafe never strips a class that
  // reduced-motion visitors were never given.
  window.__pageFxInit = true;
}
