// entry-builder - the "Build your entry" form on the builders page. Renders
// registry/builders/<slug>.json live from the fields, runs the SAME static
// rules the CI validator runs (/ui/builder-entry.js is a byte copy of
// scripts/lib/builder-entry.mjs; /ui/registry-enums.js is generated from the
// schemas at build time), and unlocks the prefilled pull-request link only
// when every check passes. The form ships with the `hidden` attribute and is
// revealed here, so a no-JS visitor never meets a dead form - the <details>
// template beside it is the always-reachable path. Independent of the
// js-anim motion gate: a form is not motion.
import { builderEntryErrors, DESCRIPTION_MAX, newEntryUrl } from "./builder-entry.js";
import * as vocab from "./registry-enums.js";

const form = document.getElementById("entry-builder");
if (form) init(form);

function init(form) {
  const byId = (id) => document.getElementById(id);
  const control = (name) => form.elements.namedItem(name);
  const preview = byId("entry-preview");
  const filename = byId("entry-filename");
  const prLink = byId("entry-pr");
  const count = byId("entry-desc-count");
  const status = byId("entry-status");
  const errorSlots = new Map([...form.querySelectorAll("[data-err]")].map((el) => [el.getAttribute("data-err"), el]));
  const interopSlugs = new Set(vocab.INTEROP_RAILS.map((rail) => rail.slug));
  // Errors show per field once the visitor has touched it; the status line
  // always carries the live count, so an untouched form is quiet, not red.
  const touched = new Set();
  let slugEdited = false;

  const text = (name) => control(name).value.trim();
  const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const pad = (n) => String(n).padStart(2, "0");
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
  const selected = (name) => [...control(name).selectedOptions].map((option) => option.value);
  const listOrUndefined = (list) => (list.length > 0 ? list : undefined);

  // The entry, serialized in the schema's property order with unset
  // optionals omitted - exactly the file the pull request will carry.
  function readEntry() {
    const values = {
      name: text("name"),
      slug: text("slug"),
      description: text("description"),
      homepage: text("homepage"),
      repo: text("repo") || undefined,
      kind: control("kind").value,
      buildsOn: listOrUndefined(checked("buildsOn")),
      standards: listOrUndefined(selected("standards")),
      contact: text("github") ? { github: text("github") } : undefined,
      listedAt: today(),
    };
    const entry = {};
    for (const key of vocab.BUILDER_KEYS) if (values[key] !== undefined) entry[key] = values[key];
    return entry;
  }

  function render() {
    const entry = readEntry();
    const errors = builderEntryErrors(entry, { filename: `${entry.slug}.json`, vocab, interopSlugs });
    preview.textContent = JSON.stringify(entry, null, 2);
    filename.textContent = `${entry.slug || "your-slug"}.json`;
    count.textContent = `${entry.description.length}/${DESCRIPTION_MAX}`;
    const shown = new Map([...errorSlots.keys()].map((field) => [field, []]));
    for (const { field, message } of errors) {
      const slot = errorSlots.has(field) ? field : "entry";
      if (slot === "entry" || touched.has(slot)) shown.get(slot).push(message);
    }
    for (const [field, messages] of shown) errorSlots.get(field).textContent = messages.join(" ");
    if (errors.length === 0) {
      prLink.href = newEntryUrl(vocab.REPO_URL, entry);
      prLink.removeAttribute("aria-disabled");
      status.textContent = "every check passes - the pull request opens with this file in the editor";
    } else {
      prLink.removeAttribute("href");
      prLink.setAttribute("aria-disabled", "true");
      status.textContent = `${errors.length} check${errors.length === 1 ? "" : "s"} left before the pull request unlocks; listedAt is set to today for you`;
    }
  }

  function onInput(event) {
    const name = event.target.name;
    if (!name) return;
    touched.add(name === "github" ? "contact" : name);
    if (name === "name") {
      touched.add("slug");
      if (!slugEdited) control("slug").value = slugify(event.target.value);
    }
    if (name === "slug") slugEdited = event.target.value.trim() !== "";
    render();
  }

  form.addEventListener("input", onInput);
  form.addEventListener("change", onInput);
  form.addEventListener("submit", (event) => event.preventDefault());
  form.hidden = false;
  render();
}
