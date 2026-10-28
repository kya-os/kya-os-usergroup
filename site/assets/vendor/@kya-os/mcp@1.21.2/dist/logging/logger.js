/**
 * Transport-aware Logger for KYA-OS
 *
 * Provides a lightweight, dependency-free logging interface that:
 * - Maps log levels correctly for Cloudflare Workers
 * - Routes all logs to stderr for stdio transport (so stdout remains protocol-only)
 * - Supports runtime configuration of log level and transport mode
 */
const SEVERITY = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
export function createDefaultConsoleLogger() {
    let level = 'info';
    let forceStderr = false;
    function shouldLog(l) {
        return SEVERITY[l] >= SEVERITY[level];
    }
    function write(l, ...args) {
        if (!shouldLog(l))
            return;
        if (forceStderr) {
            console.error(...args);
            return;
        }
        switch (l) {
            case 'debug':
                if (typeof console.debug === 'function') {
                    console.debug(...args);
                }
                else {
                    console.log(...args);
                }
                break;
            case 'info':
                if (typeof console.info === 'function') {
                    console.info(...args);
                }
                else {
                    console.log(...args);
                }
                break;
            case 'warn':
                if (typeof console.warn === 'function') {
                    console.warn(...args);
                }
                else {
                    console.error(...args);
                }
                break;
            case 'error':
                console.error(...args);
                break;
        }
    }
    return {
        configure(opts = {}) {
            if (opts.level)
                level = opts.level;
            if (opts.forceStderr === true) {
                forceStderr = true;
            }
            else if (opts.forceStderr === false) {
                forceStderr = false;
            }
            else if (opts.transport === 'stdio') {
                forceStderr = true;
            }
            else if (opts.transport === 'sse' || opts.transport === 'http') {
                forceStderr = false;
            }
        },
        debug: (...a) => write('debug', ...a),
        info: (...a) => write('info', ...a),
        warn: (...a) => write('warn', ...a),
        error: (...a) => write('error', ...a),
    };
}
export const logger = createDefaultConsoleLogger();
//# sourceMappingURL=logger.js.map