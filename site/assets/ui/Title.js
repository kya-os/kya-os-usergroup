// Title - Shuffle reveal animation for headings
// Creates a "decryption" effect - letters reveal in random order

import { shuffle, wait } from './UIUtils.js';

export class Title {
    constructor(element, options = {}) {
        this.element = element;
        this.originalText = element.textContent;
        this.letters = [];
        this.options = {
            revealDelay: options.revealDelay || 100,      // Delay before starting
            letterDelay: options.letterDelay || 40,       // Delay between letters
            glitchChars: options.glitchChars || '!@#$%^&*()_+-=[]{}|;:,.<>?/~`',
            glitchIterations: options.glitchIterations || 3,
            ...options
        };

        this.init();
    }

    init() {
        // Store original styles
        this.element.style.visibility = 'hidden';
        
        // Clear and split into letters
        this.element.textContent = '';

        const split = this.originalText.split('');
        split.forEach((char, index) => {
            const span = document.createElement('span');
            span.className = 'title-letter';
            span.dataset.char = char;
            span.textContent = char === ' ' ? '\u00A0' : char;
            span.style.display = 'inline-block';
            span.style.opacity = '0';
            this.element.appendChild(span);
            this.letters.push(span);
        });
    }

    async animateIn() {
        this.element.style.visibility = 'visible';
        this.element.classList.add('animate-ready');
        
        await wait(this.options.revealDelay);

        // Shuffle the order of letters to reveal
        const shuffledIndices = shuffle([...Array(this.letters.length).keys()]);

        // Reveal each letter with glitch effect
        const promises = shuffledIndices.map((letterIndex, orderIndex) => {
            return this.revealLetter(this.letters[letterIndex], orderIndex * this.options.letterDelay);
        });

        await Promise.all(promises);
    }

    async revealLetter(letterSpan, delay) {
        await wait(delay);

        const originalChar = letterSpan.dataset.char;
        const isSpace = originalChar === ' ';

        if (isSpace) {
            letterSpan.style.opacity = '1';
            return;
        }

        // Glitch phase - show random characters
        for (let i = 0; i < this.options.glitchIterations; i++) {
            const randomChar = this.options.glitchChars[Math.floor(Math.random() * this.options.glitchChars.length)];
            letterSpan.textContent = randomChar;
            letterSpan.style.opacity = '1';
            letterSpan.classList.add('glitching');
            await wait(50);
        }

        // Final reveal
        letterSpan.textContent = originalChar;
        letterSpan.classList.remove('glitching');
        letterSpan.classList.add('revealed');
    }

    // For dynamic title changes (like navigation)
    async setTitle(newText) {
        // Animate out
        await this.animateOut();
        
        // Update
        this.originalText = newText;
        this.letters = [];
        this.element.textContent = '';
        
        const split = newText.split('');
        split.forEach((char) => {
            const span = document.createElement('span');
            span.className = 'title-letter';
            span.dataset.char = char;
            span.textContent = char === ' ' ? '\u00A0' : char;
            span.style.display = 'inline-block';
            span.style.opacity = '0';
            this.element.appendChild(span);
            this.letters.push(span);
        });

        // Animate in
        await this.animateIn();
    }

    async animateOut() {
        const promises = this.letters.map((letter, i) => {
            return new Promise(resolve => {
                setTimeout(() => {
                    letter.style.transition = 'opacity 0.2s ease-out, transform 0.2s ease-out';
                    letter.style.opacity = '0';
                    letter.style.transform = 'translateY(-10px)';
                    resolve();
                }, i * 15);
            });
        });

        await Promise.all(promises);
    }
}

// Initialize title elements
export function initTitles() {
    const titles = document.querySelectorAll('[data-title-reveal]');
    const instances = [];
    
    titles.forEach(title => {
        const instance = new Title(title);
        instances.push(instance);
        // Auto-animate after a delay
        setTimeout(() => instance.animateIn(), 300);
    });

    return instances;
}
