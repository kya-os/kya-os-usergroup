// badge-preview - "Preview your badge" on the conformance page. Draws the
// proof-waveform lockup for a slug and claimed level client-side from the
// SAME bytes the build draws with (/ui/waveform.js is a byte copy of
// site/lib/waveform.mjs; the seed and geometry come from
// /ui/builder-entry.js, exactly as the directory row derives them), so the
// preview is the wave the entry will get. Visual only, grey unverified
// tier: verification comes from the program, never from this page. Also
// fills the visitor's slug into the README embed snippet (visible spans and
// the raw <pre> the copy button reads, together). The form ships hidden and
// is revealed here; the build-time lockup beside it is the no-JS state.
import { CLAIM_WAVE, claimWaveSeed } from "./builder-entry.js";
import { waveformSvg } from "./waveform.js";

const form = document.getElementById("badge-preview");
if (form) init(form);

function init(form) {
  const byId = (id) => document.getElementById(id);
  const wave = byId("bp-wave");
  const seedOut = byId("bp-seed");
  const embedRaw = byId("badge-embed");
  const embedSlugs = document.querySelectorAll("[data-embed-slug]");
  const embedTemplate = embedRaw ? embedRaw.textContent : null;
  const placeholder = form.elements.namedItem("slug").placeholder;

  function render() {
    const slug = form.elements.namedItem("slug").value.trim() || placeholder;
    const seed = claimWaveSeed(slug, { level: form.elements.namedItem("level").value, scope: "full" });
    // The waveform module emits an SVG string of numbers only (the seed is
    // hashed, never printed), parsed as a document rather than assigned as
    // markup. Parsed as HTML on purpose: the string carries no xmlns (it is
    // written for the HTML parser at build time), so parsing it as XML
    // yields a namespace-less root that renders nothing.
    const svg = new DOMParser().parseFromString(waveformSvg(seed, CLAIM_WAVE), "text/html").body.firstElementChild;
    wave.replaceChildren(document.adoptNode(svg));
    seedOut.textContent = seed;
    for (const span of embedSlugs) span.textContent = slug;
    if (embedRaw) embedRaw.textContent = embedTemplate.replaceAll(placeholder, slug);
  }

  form.addEventListener("input", render);
  form.addEventListener("submit", (event) => event.preventDefault());
  form.hidden = false;
  render();
}
