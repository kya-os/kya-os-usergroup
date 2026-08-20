// UIUtils - Animation utilities inspired by alien.js/space.js
// Provides tween, easing, and animation helpers

// Easing functions
export const Easing = {
    linear: t => t,
    easeInQuad: t => t * t,
    easeOutQuad: t => t * (2 - t),
    easeInOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    easeInCubic: t => t * t * t,
    easeOutCubic: t => (--t) * t * t + 1,
    easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
    easeInQuart: t => t * t * t * t,
    easeOutQuart: t => 1 - (--t) * t * t * t,
    easeInOutQuart: t => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,
    easeInQuint: t => t * t * t * t * t,
    easeOutQuint: t => 1 + (--t) * t * t * t * t,
    easeInOutQuint: t => t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t,
    easeInSine: t => 1 - Math.cos(t * Math.PI / 2),
    easeOutSine: t => Math.sin(t * Math.PI / 2),
    easeInOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    easeInExpo: t => t === 0 ? 0 : Math.pow(2, 10 * t - 10),
    easeOutExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    easeInOutExpo: t => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
    easeOutElastic: t => {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    easeOutBack: t => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
};

// Simple tween function
export function tween(element, props, duration = 400, easing = 'easeOutCubic', delay = 0) {
    return new Promise(resolve => {
        setTimeout(() => {
            const easingFn = typeof easing === 'function' ? easing : Easing[easing] || Easing.easeOutCubic;
            const start = performance.now();
            const initial = {};
            
            // Get initial values
            const computed = getComputedStyle(element);
            for (const prop in props) {
                if (prop === 'opacity') {
                    initial[prop] = parseFloat(computed.opacity) || 0;
                } else if (prop === 'y' || prop === 'x' || prop === 'scale' || prop === 'rotation' || prop === 'skewX' || prop === 'skewY') {
                    initial[prop] = 0; // Transform properties start from current or 0
                }
            }

            function update(currentTime) {
                const elapsed = currentTime - start;
                const progress = Math.min(elapsed / duration, 1);
                const eased = easingFn(progress);

                let transform = '';
                for (const prop in props) {
                    const from = initial[prop] || 0;
                    const to = props[prop];
                    const current = from + (to - from) * eased;

                    if (prop === 'opacity') {
                        element.style.opacity = current;
                    } else if (prop === 'y') {
                        transform += `translateY(${current}px) `;
                    } else if (prop === 'x') {
                        transform += `translateX(${current}px) `;
                    } else if (prop === 'scale') {
                        transform += `scale(${current}) `;
                    } else if (prop === 'rotation') {
                        transform += `rotate(${current}deg) `;
                    } else if (prop === 'skewX') {
                        transform += `skewX(${current}deg) `;
                    } else if (prop === 'skewY') {
                        transform += `skewY(${current}deg) `;
                    }
                }

                if (transform) {
                    element.style.transform = transform.trim();
                }

                if (progress < 1) {
                    requestAnimationFrame(update);
                } else {
                    resolve();
                }
            }

            requestAnimationFrame(update);
        }, delay);
    });
}

// Utility functions
export function shuffle(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
