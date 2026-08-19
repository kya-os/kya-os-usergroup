/**
 * The token + CSS layer for the community hub: every color on the site is
 * defined here, once per theme, and every rule consumes them through var().
 *
 * THEMING MODEL (CSS-only, zero client JS):
 *   - :root defines the LIGHT tokens; no OS preference means light.
 *   - @media (prefers-color-scheme: dark) redefines them under
 *     :root:not([data-theme="light"]), so the OS preference flips the page
 *     but an explicit data-theme="light" attribute would win.
 *   - :root[data-theme="dark"] carries the same dark tokens, so a future
 *     toggle can force either theme by setting one attribute - no CSS
 *     changes, and no script ships today.
 *   Both dark blocks are emitted from ONE template string so they can never
 *   drift apart. color-scheme follows the active tokens so form controls and
 *   scrollbars match.
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
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace`;

const DARK_TOKENS = `color-scheme:dark;
    --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --baseline:#383835; --border:rgba(255,255,255,.10);
    --accent:#3987e5; --accent-deep:#86b6ef;
    --good:#0ca30c; --good-ink:#0ca30c; --warning:#fab219; --warning-ink:#fab219`;

/** Per-theme page background for the <meta name="theme-color"> pair. */
export const THEME_COLORS = { light: "#f9f9f7", dark: "#0d0d0d" };

/** Strip source indentation from an emitted sheet; one rule per line stays inspectable. */
const strip = (css) => css.replace(/\n\s+/g, "\n");

// The base look every page shares: the token blocks, reset, type, header,
// and footer. Page-specific CSS (INDEX_CSS, NOT_FOUND_CSS) is appended into
// the same <style> block by the page renderers.
export const SHARED_CSS = strip(`
  :root{ ${LIGHT_TOKENS} }
  @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){ ${DARK_TOKENS} } }
  :root[data-theme="dark"]{ ${DARK_TOKENS} }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{font-family:system-ui,"Segoe UI",sans-serif;font-size:15.5px;background:var(--page);color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden;min-height:100vh}
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
  nav{margin-left:auto;display:flex;gap:8px 18px;font-size:13.5px;flex-wrap:wrap}
  nav a{color:var(--ink-2)}
  nav a:hover{color:var(--ink)}
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
  .nf .back:hover{color:var(--accent)}`);
