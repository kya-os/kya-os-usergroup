/**
 * The inline layer of the hub's theming: exactly what CANNOT live in the
 * stylesheets ships from here - the one inline script and the theme-color
 * meta pair. All CSS lives in real stylesheets under site/assets/css/
 * (byte-copied to /aliencn.css and /hub.css), which is what lets the CSP
 * tighten style-src to 'self': no <style> blocks, no style attributes.
 *
 * THEMING MODEL (dark-first, from the @kya-os/aliencn token layer):
 *   - :root in aliencn.css defines the DARK tokens; aliencn is dark-first.
 *   - @media (prefers-color-scheme: light) redefines them under
 *     :root:not([data-aliencn-theme="dark"]), so the OS preference flips the
 *     page but an explicit data-aliencn-theme="dark" attribute wins.
 *   - :root[data-aliencn-theme="light"] carries the same light tokens, so
 *     the toggle forces either theme by setting one attribute.
 *   Both light blocks must stay token-for-token identical -
 *   lib/assertions.mjs fails the build when they drift. color-scheme follows
 *   the active tokens so form controls and scrollbars match.
 *
 * CLIENT JS: the site ships exactly ONE fixed inline script per page
 * (THEME_SCRIPT, emitted byte-identical into every <head>), allowed by a
 * sha256 CSP hash that build-pages.mjs computes from these exact bytes
 * (assertions.mjs verifies the match against the emitted pages). Its first
 * statements run before paint: the js-anim gate adds html.js-anim unless the
 * user prefers reduced motion (so the gated motion rules in hub.css never
 * hide content without JS or against a reduced-motion preference), and the
 * theme half applies the stored preference so it never flashes the wrong
 * theme. All remaining motion runs from same-origin ES modules under /ui/
 * (the @kya-os/aliencn motion family, CLI-installed per aliencn.json and
 * sha256-pinned in lib/assertions.mjs), driven by the hub's own hub-init.js
 * and covered by script-src 'self'.
 */

/** Per-theme page background for the <meta name="theme-color"> pair (the
 * aliencn canvas tokens; keep in lockstep with site/assets/css/aliencn.css). */
export const THEME_COLORS = { light: "#edeee9", dark: "#060707" };

/**
 * The one inline script (see the theming model above). Three parts, one
 * script, all pre-paint where it matters: the js-anim gate adds html.js-anim
 * unless prefers-reduced-motion matches (every hidden initial state in
 * hub.css is gated under that class, so no JS / blocked JS / reduced motion
 * always yields a fully visible static page); the theme half applies the
 * stored preference to <html> as data-aliencn-theme immediately (the button
 * does not exist yet - a(g()) tolerates that); and the interactive half
 * labels the button on DOMContentLoaded and cycles system -> light -> dark
 * -> system on click via document-level delegation. The localStorage key
 * stays "theme", so preferences stored before the aliencn port still apply.
 * Keep this string byte-stable: its sha256 is pinned in the CSP.
 */
export const THEME_SCRIPT =
  '(function(){var d=document;' +
  'if(!matchMedia("(prefers-reduced-motion: reduce)").matches){d.documentElement.classList.add("js-anim")}' +
  'function g(){try{var v=localStorage.getItem("theme");return v==="light"||v==="dark"?v:null}catch(e){return null}}' +
  'function s(v){try{v?localStorage.setItem("theme",v):localStorage.removeItem("theme")}catch(e){}}' +
  'function a(v){var r=d.documentElement;if(v){r.setAttribute("data-aliencn-theme",v)}else{r.removeAttribute("data-aliencn-theme")}' +
  'var b=d.getElementById("theme-toggle");if(b){b.textContent=v||"auto";b.setAttribute("aria-label","Theme: "+(v||"system")+". Click to change.")}}' +
  'a(g());' +
  'd.addEventListener("DOMContentLoaded",function(){a(g())});' +
  'd.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest("#theme-toggle"):null;if(!t)return;' +
  'var c=g(),n=c==="light"?"dark":c==="dark"?null:"light";s(n);a(n)});' +
  "})();";
