// PageTransition - Animated page transitions
// Creates smooth transitions between pages with overlay effects

import { tween, wait } from "./UIUtils.js";

export class PageTransition {
  constructor(options = {}) {
    this.options = {
      duration: options.duration || 600,
      easing: options.easing || "easeInOutQuart",
      overlayColor: options.overlayColor || "#0a0a0a",
      ...options,
    };

    this.overlay = null;
    this.scanlines = null;
    this.isTransitioning = false;

    this.init();
    this.interceptLinks();
  }

  init() {
    // Create overlay element
    this.overlay = document.createElement("div");
    this.overlay.className = "page-transition-overlay";
    this.overlay.innerHTML = `
            <div class="transition-scanlines"></div>
            <div class="transition-glitch"></div>
        `;
    document.body.appendChild(this.overlay);

    // Get references
    this.scanlines = this.overlay.querySelector(".transition-scanlines");
    this.glitch = this.overlay.querySelector(".transition-glitch");
  }

  interceptLinks() {
    // Intercept all internal navigation links
    document.addEventListener("click", async (e) => {
      const link = e.target.closest("a");

      if (!link) return;

      const href = link.getAttribute("href");

      // Skip external links, hash links, and special links
      if (
        !href ||
        href.startsWith("http") ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        link.target === "_blank" ||
        link.hasAttribute("data-no-transition")
      ) {
        return;
      }

      e.preventDefault();

      if (this.isTransitioning) return;

      await this.navigateTo(href);
    });

    // Handle browser back/forward
    window.addEventListener("popstate", () => {
      if (!this.isTransitioning) {
        this.transitionIn();
      }
    });
  }

  async navigateTo(url) {
    this.isTransitioning = true;

    // Transition out (show overlay)
    await this.transitionOut();

    // Navigate
    window.location.href = url;
  }

  async transitionOut() {
    // Show overlay
    this.overlay.classList.add("active");

    // Animate wipe from bottom
    this.overlay.style.transform = "translateY(100%)";
    this.overlay.style.opacity = "1";

    await tween(
      this.overlay,
      { y: 0 },
      this.options.duration,
      "easeInOutQuart",
    );

    // Brief glitch effect at peak
    this.glitch.classList.add("active");
    await wait(100);
    this.glitch.classList.remove("active");
  }

  async transitionIn() {
    // Wipe away upward
    await wait(100);

    await tween(
      this.overlay,
      { y: -100 },
      this.options.duration,
      "easeInOutQuart",
    );

    this.overlay.classList.remove("active");
    this.overlay.style.transform = "translateY(100%)";

    this.isTransitioning = false;
  }

  // Call this on page load for entrance animation
  async enter() {
    // Start with overlay visible
    this.overlay.classList.add("active");
    this.overlay.style.transform = "translateY(0)";
    this.overlay.style.opacity = "1";

    await wait(200);

    // Wipe away
    await this.transitionIn();
  }
}

// Simpler fade transition (less intrusive)
export class FadeTransition {
  constructor() {
    this.overlay = null;
    this.isTransitioning = false;

    this.init();
    this.interceptLinks();
    this.handlePageShow();
  }

  init() {
    // Remove any existing overlay from previous page (shouldn't happen but safety)
    const existing = document.querySelector(".fade-transition-overlay");
    if (existing) existing.remove();
    
    this.overlay = document.createElement("div");
    this.overlay.className = "fade-transition-overlay";
    document.body.appendChild(this.overlay);
    
    // Ensure overlay starts completely hidden
    this.overlay.classList.remove("active");
    this.overlay.style.opacity = "0";
    this.isTransitioning = false;
  }

  handlePageShow() {
    // Reset state when page is restored from bfcache (browser back/forward)
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        console.log("FadeTransition: Page restored from bfcache, resetting state");
        this.reset();
      }
    });
    
    // Also reset when page becomes visible (tab switch, etc.)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.isTransitioning) {
        console.log("FadeTransition: Page visible again, resetting stuck transition");
        this.reset();
      }
    });
  }
  
  reset() {
    this.isTransitioning = false;
    this.overlay.classList.remove("active");
    this.overlay.style.opacity = "0";
  }

  interceptLinks() {
    document.addEventListener("click", async (e) => {
      const link = e.target.closest("a");

      if (!link) return;

      const href = link.getAttribute("href");

      if (
        !href ||
        href.startsWith("http") ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        link.target === "_blank" ||
        link.hasAttribute("data-no-transition")
      ) {
        return;
      }

      e.preventDefault();

      if (this.isTransitioning) return;

      await this.navigateTo(href);
    });
  }

  async navigateTo(url) {
    this.isTransitioning = true;

    // Fade out
    this.overlay.classList.add("active");
    await wait(400);

    // Navigate
    window.location.href = url;
  }

  async enter() {
    // No delay on initial page load - content appears immediately
    this.overlay.classList.remove("active");
  }
}
