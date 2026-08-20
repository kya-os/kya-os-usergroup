// SmoothScroll - Smooth scrolling with skew effect based on velocity
// Creates premium editorial feel with momentum-based deformation

import { lerp, clamp } from './UIUtils.js';

export class SmoothScroll {
    constructor(options = {}) {
        this.options = {
            lerpSpeed: options.lerpSpeed || 0.1,
            skewAmount: options.skewAmount || 7.5,
            container: options.container || document.querySelector('.scroll-container'),
            ...options
        };

        this.position = 0;
        this.targetPosition = 0;
        this.lastPosition = 0;
        this.delta = 0;
        this.velocity = 0;
        this.height = 0;
        this.isEnabled = false;
        this.rafId = null;

        this.init();
    }

    init() {
        if (!this.options.container) {
            console.warn('SmoothScroll: No container found');
            return;
        }

        // Don't apply on touch devices
        if (navigator.maxTouchPoints > 0) {
            return;
        }

        // Set up fixed viewport
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
        document.body.style.height = '100%';
        document.body.style.overflow = 'hidden';

        // Container setup
        this.options.container.style.willChange = 'transform';

        this.enable();
    }

    enable() {
        if (this.isEnabled) return;
        this.isEnabled = true;

        this.onResize();
        window.addEventListener('resize', this.onResize.bind(this));
        this.rafId = requestAnimationFrame(this.update.bind(this));
    }

    disable() {
        this.isEnabled = false;
        window.removeEventListener('resize', this.onResize.bind(this));
        
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        // Reset styles
        document.body.style.position = '';
        document.body.style.width = '';
        document.body.style.height = '';
        document.body.style.overflow = '';
        document.body.style.height = '';
    }

    onResize() {
        const rect = this.options.container.getBoundingClientRect();
        this.height = rect.height;
        
        // Set body height for scrollbar
        document.body.style.height = `${this.height}px`;
        
        // Temporarily enable scrolling
        document.body.style.position = 'relative';
        document.body.style.overflow = 'auto';
        
        this.position = window.scrollY || document.documentElement.scrollTop;
        this.targetPosition = this.position;
    }

    update() {
        if (!this.isEnabled) return;

        // Get scroll position
        this.targetPosition = window.scrollY || document.documentElement.scrollTop;

        // Lerp current position
        this.position = lerp(this.position, this.targetPosition, this.options.lerpSpeed);

        // Calculate velocity
        this.delta = this.position - this.lastPosition;
        this.velocity = this.delta;
        this.lastPosition = this.position;

        // Apply transform with skew
        const skew = clamp(
            (this.delta / window.innerWidth) * 10 * this.options.skewAmount,
            -10,
            10
        );

        this.options.container.style.transform = `
            translateY(${-Math.round(this.position * 100) / 100}px)
            skewY(${skew}deg)
        `;

        this.rafId = requestAnimationFrame(this.update.bind(this));
    }

    // Get normalized scroll progress (0-1)
    get progress() {
        const scrollableHeight = this.height - window.innerHeight;
        return scrollableHeight > 0 ? clamp(this.position / scrollableHeight, 0, 1) : 0;
    }

    // Scroll to specific position
    scrollTo(target, instant = false) {
        let targetY = 0;

        if (typeof target === 'number') {
            targetY = target;
        } else if (target instanceof Element) {
            targetY = target.offsetTop;
        }

        if (instant) {
            this.position = targetY;
            this.targetPosition = targetY;
            window.scrollTo(0, targetY);
        } else {
            window.scrollTo(0, targetY);
        }
    }
}

// Simpler skew-on-scroll for pages without full smooth scroll
export class ScrollSkew {
    constructor(options = {}) {
        this.options = {
            elements: options.elements || document.querySelectorAll('[data-scroll-skew]'),
            skewAmount: options.skewAmount || 3,
            lerpSpeed: options.lerpSpeed || 0.15,
            ...options
        };

        this.lastScroll = 0;
        this.currentSkew = 0;
        this.targetSkew = 0;
        this.rafId = null;

        this.init();
    }

    init() {
        if (this.options.elements.length === 0) return;
        
        // Don't apply on touch devices
        if (navigator.maxTouchPoints > 0) return;

        this.options.elements.forEach(el => {
            el.style.willChange = 'transform';
        });

        window.addEventListener('scroll', this.onScroll.bind(this), { passive: true });
        this.update();
    }

    onScroll() {
        const currentScroll = window.scrollY;
        const delta = currentScroll - this.lastScroll;
        this.lastScroll = currentScroll;

        // Calculate target skew based on scroll speed
        this.targetSkew = clamp(
            delta * 0.1 * this.options.skewAmount,
            -this.options.skewAmount,
            this.options.skewAmount
        );
    }

    update() {
        // Lerp skew to target (and decay to 0)
        this.targetSkew *= 0.95; // Decay
        this.currentSkew = lerp(this.currentSkew, this.targetSkew, this.options.lerpSpeed);

        // Apply to elements
        if (Math.abs(this.currentSkew) > 0.001) {
            this.options.elements.forEach(el => {
                el.style.transform = `skewY(${this.currentSkew}deg)`;
            });
        }

        this.rafId = requestAnimationFrame(this.update.bind(this));
    }

    destroy() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }
        window.removeEventListener('scroll', this.onScroll.bind(this));
    }
}
