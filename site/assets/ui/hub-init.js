// hub-init - the community hub's motion entry point (NOT vendored; see
// VENDORED.md). Reproduces kya-os-site's PageInit.js sequence with its exact
// timings, mapped onto the hub's selectors, using the vendored modules
// unchanged. Two deliberate divergences from the reference, both documented:
// modified clicks (cmd/ctrl/shift/alt or a non-left button) are never
// intercepted, so open-in-new-tab keeps working (the reference swallows
// cmd+click - a real bug); and the overlay color is theme-aware - the gated
// CSS in lib/theme.mjs paints it var(--page), so the wipe matches light and
// dark mode instead of the reference's hard #0a0a0a.
import { GlitchText } from "./GlitchText.js";
import { PageTransition } from "./PageTransition.js";
import { ScrollSkew } from "./SmoothScroll.js";
import { Title } from "./Title.js";
import { wait } from "./UIUtils.js";

// The inline theme script sets html.js-anim only when prefers-reduced-motion
// does not match; re-checking both here keeps this module fully inert (no
// hidden content, no link interception) for reduced-motion visitors and for
// any page whose gate did not run.
const animated =
  document.documentElement.classList.contains("js-anim") &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;

// PageTransition with the modified-click fix: only a plain left click is
// intercepted; everything else falls through to native navigation. The
// [data-no-transition], external/#/mailto/_blank skips and the popstate
// transitionIn behavior are kept from the vendored class.
class HubPageTransition extends PageTransition {
  interceptLinks() {
    document.addEventListener("click", async (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (link.target === "_blank" || link.hasAttribute("data-no-transition")) return;
      e.preventDefault();
      if (this.isTransitioning) return;
      await this.navigateTo(href);
    });
    window.addEventListener("popstate", () => {
      if (!this.isTransitioning) this.transitionIn();
    });
  }
}

let transition = null;

async function initPage() {
  const page = document.querySelector("article.wrap");
  const titleEl = document.querySelector("h1");
  const lede = document.querySelector(".hero .lede");
  const groupHeads = document.querySelectorAll(".group-head");
  const sectionLedes = document.querySelectorAll(".section-lede");
  const blocks = document.querySelectorAll(".card, .path, .step");

  // STEP 1: prepare the title (letter spans, still hidden), then fade the
  // page container in after the reference's 50ms beat.
  const title = titleEl ? new Title(titleEl, { revealDelay: 0, letterDelay: 30, glitchIterations: 3 }) : null;
  await wait(50);
  if (page) page.classList.add("visible");

  // STEP 2: decrypt the h1.
  if (title) await title.animateIn();

  // STEP 3: fade the hero lede in.
  if (lede) lede.classList.add("visible");

  // STEP 4: group heads on 200ms offsets, section ledes trailing by 100ms.
  await wait(100);
  groupHeads.forEach((head, index) => {
    setTimeout(() => head.classList.add("visible"), index * 200);
  });
  sectionLedes.forEach((desc, index) => {
    setTimeout(() => desc.classList.add("visible"), index * 200 + 100);
  });

  // STEP 5: card-like blocks on 80ms offsets (inline styles, like the reference).
  await wait(150);
  blocks.forEach((block, index) => {
    setTimeout(() => {
      block.style.opacity = "1";
      block.style.transform = "translateY(0)";
    }, index * 80);
  });

  // STEP 6: hover glitch on opted-in elements, the bracket CTAs, and the nav
  // brand (glitching only the KYA-OS name span keeps the styled sub intact).
  document.querySelectorAll("[data-glitch]").forEach((el) => new GlitchText(el));
  document.querySelectorAll(".add-cta a").forEach((el) => new GlitchText(el));
  const brandName = document.querySelector(".brand .brand-name");
  if (brandName) {
    const brandGlitch = new GlitchText(brandName, { triggerOnHover: false });
    brandName.closest(".brand").addEventListener("mouseenter", () => brandGlitch.glitch());
  }

  // STEP 7: subtle scroll skew on the page container.
  if (page) new ScrollSkew({ elements: [page], skewAmount: 0.8 });

  // STEP 8: page transitions, site-wide.
  transition = new HubPageTransition();
}

// bfcache restore: force every choreographed element visible (the reference's
// forceShowContent, on hub selectors) and park the overlay, so a back
// navigation never strands hidden content or a stuck wipe.
function forceShowContent() {
  const page = document.querySelector("article.wrap");
  if (page) page.classList.add("visible");
  document.querySelectorAll(".hero .lede, .group-head, .section-lede").forEach((el) => el.classList.add("visible"));
  document.querySelectorAll(".card, .path, .step").forEach((el) => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });
  if (transition) {
    transition.isTransitioning = false;
    transition.overlay.classList.remove("active");
    transition.overlay.style.opacity = "0";
    transition.overlay.style.transform = "translateY(100%)";
  }
}

if (animated) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPage);
  } else {
    initPage();
  }
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) forceShowContent();
  });
}
