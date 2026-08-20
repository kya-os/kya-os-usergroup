// GlitchText - Glitch effect on hover for text elements
// Creates a brief scramble/distortion effect

import { wait } from './UIUtils.js';

export class GlitchText {
    constructor(element, options = {}) {
        this.element = element;
        this.originalText = element.textContent;
        this.isGlitching = false;
        this.options = {
            glitchChars: options.glitchChars || '!<>-_\\/[]{}—=+*^?#_',
            iterations: options.iterations || 3,
            speed: options.speed || 50,
            triggerOnHover: options.triggerOnHover !== false,
            ...options
        };

        if (this.options.triggerOnHover) {
            this.addListeners();
        }
    }

    addListeners() {
        this.element.addEventListener('mouseenter', () => this.glitch());
    }

    async glitch() {
        if (this.isGlitching) return;
        this.isGlitching = true;

        const originalText = this.originalText;
        const length = originalText.length;

        // Glitch iterations
        for (let iter = 0; iter < this.options.iterations; iter++) {
            let glitchedText = '';
            
            for (let i = 0; i < length; i++) {
                const char = originalText[i];
                
                if (char === ' ') {
                    glitchedText += ' ';
                } else if (Math.random() > 0.5) {
                    // Replace with random glitch character
                    glitchedText += this.options.glitchChars[
                        Math.floor(Math.random() * this.options.glitchChars.length)
                    ];
                } else {
                    glitchedText += char;
                }
            }

            this.element.textContent = glitchedText;
            this.element.classList.add('glitching');
            await wait(this.options.speed);
        }

        // Restore original
        this.element.textContent = originalText;
        this.element.classList.remove('glitching');
        this.isGlitching = false;
    }

    // Continuous subtle glitch (for ambient effect)
    startAmbientGlitch(interval = 3000) {
        this.ambientInterval = setInterval(() => {
            if (Math.random() > 0.7) {
                this.microGlitch();
            }
        }, interval);
    }

    stopAmbientGlitch() {
        if (this.ambientInterval) {
            clearInterval(this.ambientInterval);
        }
    }

    async microGlitch() {
        if (this.isGlitching) return;
        this.isGlitching = true;

        const originalText = this.originalText;
        const randomIndex = Math.floor(Math.random() * originalText.length);
        
        if (originalText[randomIndex] !== ' ') {
            const glitchedText = 
                originalText.slice(0, randomIndex) + 
                this.options.glitchChars[Math.floor(Math.random() * this.options.glitchChars.length)] +
                originalText.slice(randomIndex + 1);

            this.element.textContent = glitchedText;
            await wait(100);
            this.element.textContent = originalText;
        }

        this.isGlitching = false;
    }
}

// Initialize glitch text elements
export function initGlitchText() {
    const elements = document.querySelectorAll('[data-glitch]');
    elements.forEach(el => new GlitchText(el));
}
