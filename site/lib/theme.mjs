/**
 * The token + CSS layer for the community hub: every color on the site is
 * defined here, once per theme, and every rule consumes them through var().
 *
 * THEMING MODEL (CSS tokens + one deliberate inline script):
 *   - :root defines the LIGHT tokens; no OS preference means light.
 *   - @media (prefers-color-scheme: dark) redefines them under
 *     :root:not([data-theme="light"]), so the OS preference flips the page
 *     but an explicit data-theme="light" attribute wins.
 *   - :root[data-theme="dark"] carries the same dark tokens, so the toggle
 *     forces either theme by setting one attribute - no CSS changes.
 *   Both dark blocks are emitted from ONE template string so they can never
 *   drift apart. color-scheme follows the active tokens so form controls and
 *   scrollbars match.
 *
 * CLIENT JS: the site ships exactly ONE fixed inline script per page
 * (THEME_SCRIPT, emitted byte-identical into every <head>), allowed by a
 * sha256 CSP hash that build-pages.mjs computes from these exact bytes
 * (assertions.mjs verifies the match against the emitted pages). Its first
 * statements run before paint: the js-anim gate adds html.js-anim unless the
 * user prefers reduced motion (so the MOTION_CSS hidden states below never
 * apply without JS or against a reduced-motion preference), and the theme
 * half applies the stored preference so it never flashes the wrong theme.
 * All remaining motion runs from same-origin ES modules under /ui/ (the
 * @kya-os/aliencn motion family, CLI-installed per aliencn.json and
 * sha256-pinned in lib/assertions.mjs), driven by the hub's own hub-init.js
 * and covered by script-src 'self'.
 *
 * FONTS: the two brand faces (Space Grotesk for UI, JetBrains Mono for
 * identifiers) are self-hosted variable woff2 files, committed under
 * site/assets/fonts/ with their OFL licenses and byte-copied to dist/fonts/.
 * font-display: swap keeps the system fallbacks painting first; the stacks
 * below keep the previous fallback chains intact, so tokens and contrast are
 * untouched in both themes.
 *
 * PALETTE: the KYA-OS house pairs (light / dark). Where a raw status hue
 * cannot hold 4.5:1 as text on the light surface, a text-safe -ink variant
 * carries the readable value per theme (green #006300, amber #8a5f00 on
 * light) while the raw hue keeps doing borders and washes. The house ramp
 * also names serious #ec835a and critical #d03b3b; no surface uses them yet,
 * so they are deliberately not emitted - lib/assertions.mjs fails the build
 * on unused tokens, on referenced-but-undefined tokens, and on any raw hex
 * outside these token blocks.
 *
 * SIZE: shared repeated treatments (underlines, tabular numerals, surface
 * panels, hover colors) are grouped into single rules, and the emitted
 * sheets are indentation-stripped (deterministically, at module load), to
 * keep the index sheet under the ~9KB budget while the source stays
 * readable.
 */

const LIGHT_TOKENS = `color-scheme:light;
    --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781;
    --grid:#e1e0d9; --baseline:#c3c2b7; --border:rgba(11,11,11,.10);
    --accent:#2a78d6; --accent-deep:#1c5cab;
    --good:#0ca30c; --good-ink:#006300; --warning:#fab219; --warning-ink:#8a5f00;
    --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace`;

const DARK_TOKENS = `color-scheme:dark;
    --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --baseline:#383835; --border:rgba(255,255,255,.10);
    --accent:#3987e5; --accent-deep:#86b6ef;
    --good:#0ca30c; --good-ink:#0ca30c; --warning:#fab219; --warning-ink:#fab219`;

/** Per-theme page background for the <meta name="theme-color"> pair. */
export const THEME_COLORS = { light: "#f9f9f7", dark: "#0d0d0d" };

/**
 * The one inline script (see the theming model above). Three parts, one
 * script, all pre-paint where it matters: the js-anim gate adds html.js-anim
 * unless prefers-reduced-motion matches (every hidden initial state in
 * MOTION_CSS is gated under that class, so no JS / blocked JS / reduced
 * motion always yields a fully visible static page); the theme half applies
 * the stored preference to <html> immediately (the button does not exist yet
 * - a(g()) tolerates that); and the interactive half labels the button on
 * DOMContentLoaded and cycles system -> light -> dark -> system on click via
 * document-level delegation. Keep this string byte-stable: its sha256 is
 * pinned in the CSP.
 */
export const THEME_SCRIPT =
  '(function(){var d=document;' +
  'if(!matchMedia("(prefers-reduced-motion: reduce)").matches){d.documentElement.classList.add("js-anim")}' +
  'function g(){try{var v=localStorage.getItem("theme");return v==="light"||v==="dark"?v:null}catch(e){return null}}' +
  'function s(v){try{v?localStorage.setItem("theme",v):localStorage.removeItem("theme")}catch(e){}}' +
  'function a(v){var r=d.documentElement;if(v){r.setAttribute("data-theme",v)}else{r.removeAttribute("data-theme")}' +
  'var b=d.getElementById("theme-toggle");if(b){b.textContent=v||"auto";b.setAttribute("aria-label","Theme: "+(v||"system")+". Click to change.")}}' +
  'a(g());' +
  'd.addEventListener("DOMContentLoaded",function(){a(g())});' +
  'd.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest("#theme-toggle"):null;if(!t)return;' +
  'var c=g(),n=c==="light"?"dark":c==="dark"?null:"light";s(n);a(n)});' +
  "})();";

/** Strip source indentation from an emitted sheet; one rule per line stays inspectable. */
const strip = (css) => css.replace(/\n\s+/g, "\n");

// The base look every page shares: the self-hosted brand faces, the token
// blocks, reset, type, header, and footer. Page-specific CSS (INDEX_CSS,
// NOT_FOUND_CSS, ANIM_CSS) is appended into the same <style> block by the
// page renderers.
export const SHARED_CSS = strip(`
  @font-face{font-family:"Space Grotesk";font-style:normal;font-weight:300 700;font-display:swap;src:url(/fonts/space-grotesk-latin-wght.woff2) format("woff2")}
  @font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:100 800;font-display:swap;src:url(/fonts/jetbrains-mono-latin-wght.woff2) format("woff2")}
  :root{ ${LIGHT_TOKENS} }
  @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){ ${DARK_TOKENS} } }
  :root[data-theme="dark"]{ ${DARK_TOKENS} }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{font-family:"Space Grotesk",system-ui,"Segoe UI",sans-serif;font-size:15.5px;background:var(--page);color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden;min-height:100vh}
  body::before{content:"";position:fixed;inset:0;background-image:radial-gradient(circle,var(--grid) 1px,transparent 1px);background-size:40px 40px;opacity:.5;pointer-events:none;z-index:0}
  .wrap{max-width:980px;margin:0 auto;padding:0 40px;position:relative;z-index:1}
  a{color:inherit;text-decoration:none;text-underline-offset:3px}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  code,.mono{font-family:var(--mono)}
  ::selection{background:var(--accent);color:var(--page)}
  header.bar{border-bottom:1px solid var(--grid);position:sticky;top:0;background:color-mix(in srgb,var(--page) 92%,transparent);backdrop-filter:blur(6px);z-index:2}
  header.bar .wrap{display:flex;align-items:center;flex-wrap:wrap;gap:10px 16px;min-height:64px;padding-top:10px;padding-bottom:10px}
  .brand{color:var(--ink);font-weight:600;font-size:16px;letter-spacing:-.01em;white-space:nowrap}
  .brand .sub{color:var(--muted);font-weight:400}
  nav{margin-left:auto;display:flex;gap:8px 16px;font-size:13.5px;flex-wrap:wrap;align-items:center}
  nav a{color:var(--ink-2)}
  nav a:hover{color:var(--ink)}
  nav a.active{color:var(--ink);font-weight:600}
  .theme-btn{font-family:var(--mono);font-size:12px;font-weight:600;line-height:1.5;color:var(--ink-2);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:4px 12px;cursor:pointer;min-width:62px;text-align:center}
  .theme-btn:hover{color:var(--ink);border-color:var(--baseline)}
  nav a.nav-cta{font-size:12.5px;font-weight:600;color:var(--page);background:var(--accent-deep);border-radius:6px;padding:6px 12px;white-space:nowrap}
  nav a.nav-cta:hover{color:var(--page);background:color-mix(in srgb,var(--accent-deep) 85%,var(--ink))}
  @media(max-width:800px){header.bar{position:static}}
  footer{border-top:1px solid var(--grid);margin-top:72px;padding:28px 0 64px;color:var(--muted);font-size:13px}
  footer .wrap{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center}
  footer a{color:var(--ink-2);text-decoration:underline}
  footer a:hover{color:var(--ink)}`);

// The index page look. Type scale: 15.5px/1.6 body, h1 clamp, 21px h2 with a
// hairline underline, 12px/600 chips; mono is reserved for identifiers
// (slugs, hashes, versions, filenames, dates) - labels stay in the UI face.
// The first four rules are the grouped shared treatments; everything after
// them only adds what is specific to one element.
export const INDEX_CSS = strip(`
  .section-lede a,.note a,.path a,.empty a,.card .links a,.stdtag,td:first-child>a,td.links-cell a,a.step,a.st-verified,a.st-inverif,a.st-self,a.chip.conf,.claim-link{text-decoration:underline}
  .stat,.group-count,.step-n,.pin,table,.row-listed{font-variant-numeric:tabular-nums}
  .card,.path,.table-wrap,.step,.pin{background:var(--surface);border:1px solid var(--border);border-radius:8px}
  .card h3 a:hover,.card .links a:hover,.stdtag:hover,.add-cta a:hover,td.links-cell a:hover,a.claim-link:hover{color:var(--accent-deep)}
  .section-lede a:hover,.note a:hover,.path a:hover,.empty a:hover,td:first-child>a:hover{color:var(--accent)}
  .card:hover,a.step:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}
  .hero{padding:64px 0 18px}
  .eyebrow{font-size:12px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--accent-deep);margin-bottom:22px}
  h1{font-size:clamp(36px,6vw,56px);font-weight:300;letter-spacing:-.02em;line-height:1.1;color:var(--ink)}
  .lede{max-width:640px;font-size:17.5px;line-height:1.65;color:var(--ink-2);margin-top:18px}
  .page-hero{padding:52px 0 6px}
  .page-hero h1{font-size:clamp(30px,5vw,42px)}
  .page-hero .lede{font-size:16px;margin-top:14px}
  .nav-card{display:block}
  .nav-card .go{font-family:var(--mono);font-size:12.5px;color:var(--accent-deep)}
  .nav-card:hover .go{text-decoration:underline}
  .chips-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:30px;align-items:center}
  .btn{display:inline-block;font-size:13.5px;font-weight:600;color:var(--page);background:var(--accent-deep);border-radius:6px;padding:10px 19px}
  .btn:hover{background:color-mix(in srgb,var(--accent-deep) 85%,var(--ink))}
  .stat{font-size:12.5px;color:var(--ink-2);border:1px solid var(--border);border-radius:999px;padding:6px 14px;background:var(--surface)}
  .stat b{color:var(--ink);font-weight:600}
  a.stat{font-family:var(--mono);font-size:12px}
  a.stat:hover{color:var(--ink);border-color:var(--baseline)}
  main{padding:8px 0}
  section{padding:44px 0 10px;scroll-margin-top:76px}
  @media(max-width:800px){section{scroll-margin-top:12px}}
  h2{font-size:21px;font-weight:600;letter-spacing:-.01em;color:var(--ink);padding-bottom:10px;border-bottom:1px solid var(--baseline);margin-bottom:16px}
  .section-lede{max-width:760px;font-size:15px;color:var(--ink-2);margin-bottom:20px}
  .group-head{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin:26px 0 12px;display:flex;align-items:center;gap:10px}
  .group-count{font-size:11px;border:1px solid var(--border);border-radius:999px;padding:1px 8px;color:var(--muted);background:var(--surface)}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
  @media(max-width:520px){.cards{grid-template-columns:1fr}}
  .card{padding:22px;transition:border-color .15s ease}
  .card-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
  .card h3{font-size:17px;font-weight:600}
  .card h3 a{color:var(--ink)}
  .chip{font-size:12px;font-weight:600;line-height:1.5;color:var(--ink-2);border:1px solid var(--baseline);border-radius:4px;padding:2px 9px;white-space:nowrap}
  .chip.demo{font-size:11px;padding:0 7px}
  .chip.kind{border-color:var(--grid)}
  .chip.conf{font-family:var(--mono);font-weight:500;color:var(--ink)}
  .st-verified,.st-shipping{color:var(--good-ink);border-color:color-mix(in srgb,var(--good) 55%,transparent);background:color-mix(in srgb,var(--good) 8%,transparent)}
  .st-inverif{color:var(--warning-ink);border-color:color-mix(in srgb,var(--warning-ink) 55%,transparent);background:color-mix(in srgb,var(--warning) 14%,transparent)}
  .st-specified{color:var(--accent-deep);border-color:color-mix(in srgb,var(--accent) 55%,transparent);background:color-mix(in srgb,var(--accent) 8%,transparent)}
  .st-exploring{border-style:dashed}
  .st-none{border-style:dashed;border-color:var(--grid)}
  .conf-line{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
  .card .desc{font-size:14.5px;line-height:1.6;color:var(--ink-2);margin-bottom:16px}
  .card .links{display:flex;gap:14px;flex-wrap:wrap;font-family:var(--mono);font-size:12.5px;align-items:baseline}
  .card .links a{color:var(--ink-2)}
  .builds-on{color:var(--muted);font-size:12px}
  .krepo{color:var(--ink-2);font-size:12px}
  .stdtag{color:var(--ink-2);font-family:var(--mono);font-size:12px}
  .deploys{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
  .deploy-btn{font-size:12.5px;font-weight:600;color:var(--ink-2);border:1px solid var(--baseline);border-radius:6px;padding:6px 12px}
  .deploy-btn:hover{color:var(--accent-deep);border-color:var(--accent)}
  .empty{color:var(--ink-2);font-size:14px;padding:6px 0 10px}
  .add-cta{margin-top:20px;font-family:var(--mono);font-size:13px}
  .add-cta a{color:var(--ink-2)}
  .pin{font-size:12.5px;color:var(--ink-2);padding:10px 14px;margin-bottom:18px;overflow-x:auto;white-space:nowrap}
  .pin b{color:var(--ink);font-weight:600}
  .pin .hash{color:var(--ink)}
  .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:22px}
  .step{padding:14px;font-size:13.5px;display:flex;align-items:center;gap:10px}
  .step-n{font-size:12px;color:var(--muted);border:1px solid var(--baseline);border-radius:999px;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
  .table-wrap{overflow-x:auto;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);text-align:left;padding:10px 14px;border-bottom:1px solid var(--baseline)}
  td{padding:12px 14px;border-bottom:1px solid var(--grid);vertical-align:top}
  tr:last-child td{border-bottom:none}
  tbody tr:hover{background:color-mix(in srgb,var(--accent) 5%,transparent)}
  td:first-child>a{color:var(--accent-deep)}
  a.claim-link{color:var(--ink)}
  td.mono{font-size:12.5px;white-space:nowrap}
  td.std-name{font-weight:600;color:var(--ink);min-width:180px}
  td.links-cell{font-family:var(--mono);font-size:12px;white-space:nowrap}
  td.links-cell a{color:var(--muted)}
  .row-notes{color:var(--ink-2);font-size:12.5px;margin-top:6px}
  .row-listed{color:var(--muted);font-size:11px;margin-top:6px;white-space:nowrap}
  .note{color:var(--ink-2);font-size:13.5px;max-width:760px}
  .paths{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
  .path{padding:24px}
  .path.primary{border-color:color-mix(in srgb,var(--accent) 55%,var(--border))}
  .path h3{font-size:15px;font-weight:600;color:var(--ink);margin-bottom:10px}
  .path p{font-size:14px;color:var(--ink-2);margin-bottom:10px}
  .path a.btn,.path a.btn:hover{text-decoration:none;color:var(--page)}
  .path code{font-size:12.5px;color:var(--ink)}`);

// The 404 page look: same shell, same tokens, quiet stamp.
export const NOT_FOUND_CSS = strip(`
  .nf{padding:120px 0 40px;max-width:560px}
  .nf .code{font-size:13px;letter-spacing:.18em;color:var(--muted);margin-bottom:16px}
  .nf h1{font-size:42px;font-weight:300;color:var(--ink);margin-bottom:16px}
  .nf p{color:var(--ink-2);margin-bottom:10px}
  .nf .back{font-family:var(--mono);font-size:13px;color:var(--accent-deep);text-decoration:underline}
  .nf .back:hover{color:var(--accent)}
  .nf .nf-pages{font-size:13px;margin-top:18px}
  .nf .nf-pages a{color:var(--ink-2);text-decoration:underline}
  .nf .nf-pages a:hover{color:var(--accent)}`);

// The motion layer's CSS, on every page: the entry-state and page-transition
// rules that accompany the vendored /ui/ modules, adapted from kya-os-site
// css/main.css (the reference site of the aliencn motion family). Selectors are mapped to the
// hub's markup and ONLY color values diverge, onto the hub's theme tokens:
// the overlay wipes in var(--page) (the reference hard-codes #0a0a0a; the hub
// has a light mode), scanlines/glows derive from var(--ink), and the glitch
// hues map to var(--warning)/var(--good)/var(--accent). RULE: any hidden
// initial state (opacity:0), including all overlay rules, may exist ONLY
// under an html.js-anim selector - lib/assertions.mjs fails the build
// otherwise (keyframe frames are exempt there: they apply only mid-animation,
// never as an initial state). Without the class (no JS, blocked JS, reduced
// motion) none of this applies and the page is fully visible, static. The
// overlay element itself is created only by PageTransition at runtime.
export const MOTION_CSS = strip(`
  html.js-anim article.wrap{opacity:0}
  html.js-anim article.wrap.visible{opacity:1;transition:opacity 0.4s ease-out}
  html.js-anim .hero .lede{opacity:0;transform:translateY(10px)}
  html.js-anim .hero .lede.visible{opacity:1;transform:translateY(0);transition:opacity 0.5s ease-out,transform 0.5s ease-out}
  html.js-anim .group-head,html.js-anim .section-lede{opacity:0;transform:translateY(10px);transition:opacity 0.4s ease-out,transform 0.4s ease-out}
  html.js-anim .group-head.visible,html.js-anim .section-lede.visible{opacity:1;transform:translateY(0)}
  html.js-anim .card,html.js-anim .path,html.js-anim .step{opacity:0;transform:translateY(15px);transition:border-color 0.15s ease,opacity 0.4s ease-out,transform 0.4s ease-out}
  .title-letter{display:inline-block;transition:opacity 0.3s ease,transform 0.3s ease}
  .title-letter.glitching{color:var(--muted);text-shadow:2px 0 var(--accent),-2px 0 var(--warning),0 0 10px color-mix(in srgb,var(--ink) 30%,transparent)}
  .title-letter.revealed{animation:letterReveal 0.3s ease-out}
  @keyframes letterReveal{0%{opacity:0.7;transform:translateY(-5px);text-shadow:0 0 20px var(--accent)}100%{opacity:1;transform:translateY(0);text-shadow:none}}
  .glitching{animation:textGlitch 0.1s infinite}
  @keyframes textGlitch{0%,100%{text-shadow:1px 0 var(--warning),-1px 0 var(--good)}25%{text-shadow:-1px 0 var(--warning),1px 0 var(--good)}50%{text-shadow:1px 0 var(--good),-1px 0 var(--warning)}75%{text-shadow:0 1px var(--warning),0 -1px var(--good)}}
  html.js-anim .page-transition-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:var(--page);z-index:9999;pointer-events:none;opacity:0;transform:translateY(100%)}
  html.js-anim .page-transition-overlay.active{pointer-events:all}
  html.js-anim .transition-scanlines{position:absolute;top:0;left:0;width:100%;height:100%;background:repeating-linear-gradient(0deg,transparent,transparent 2px,color-mix(in srgb,var(--ink) 3%,transparent) 2px,color-mix(in srgb,var(--ink) 3%,transparent) 4px);pointer-events:none}
  html.js-anim .transition-glitch{position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--warning) 10%,transparent) 25%,color-mix(in srgb,var(--good) 10%,transparent) 50%,color-mix(in srgb,var(--accent) 10%,transparent) 75%,transparent 100%);animation:none}
  html.js-anim .transition-glitch.active{opacity:1;animation:glitchFlash 0.15s ease-out}
  @keyframes glitchFlash{0%,100%{transform:translateX(0);opacity:0}25%{transform:translateX(-5px);opacity:1}50%{transform:translateX(5px);opacity:0.5}75%{transform:translateX(-2px);opacity:1}}`);
