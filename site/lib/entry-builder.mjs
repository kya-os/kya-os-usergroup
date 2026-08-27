/**
 * The "Build your entry" section of the builders page: a zero-dependency
 * form that renders registry/builders/<slug>.json live from its fields,
 * runs the validator's static rules as the visitor types, and offers copy
 * JSON plus the prefilled pull-request link. The behavior is
 * /ui/entry-builder.js, which imports the SAME scripts/lib/builder-entry.mjs
 * the CI validator runs (byte-copied to /ui/builder-entry.js) and the
 * schema-derived vocabulary the build emits (/ui/registry-enums.js); this
 * module only renders the markup, with the enum-driven controls filled at
 * build time from the same vocabulary.
 *
 * No-JS contract: the form ships hidden and the module reveals it (no JS,
 * no dead form); the always-visible <details> carries the template JSON and
 * the copy-the-file instructions, so nothing here is JS-only.
 */
import { ENTRY_TEMPLATE, REPO_URL } from "./constants.mjs";
import { esc } from "./html.mjs";
import { ENTRY_PREVIEW, snippetText } from "./snippets.mjs";
import { DESCRIPTION_MAX } from "../../scripts/lib/builder-entry.mjs";
import { BUILDS_ON, KINDS } from "../../scripts/lib/registry-enums.mjs";

function field(name, label, control, hint = "") {
  return `        <div class="eb-field">
          <label class="eb-label" for="entry-${name}">${label}</label>
          ${control}${hint ? `\n          <span class="eb-hint">${hint}</span>` : ""}
          <span class="eb-err" data-err="${name}"></span>
        </div>`;
}

const input = (name, type, extra = "") =>
  `<input id="entry-${name}" name="${name}" type="${type}" autocomplete="off" spellcheck="false"${extra} />`;

export function sectionEntryBuilder(interopSorted) {
  const kindOptions = KINDS.map(
    (kind) => `<option value="${kind}"${kind === ENTRY_TEMPLATE.kind ? " selected" : ""}>${kind}</option>`,
  ).join("");
  const buildsOn = BUILDS_ON.map(
    (repo) =>
      `<label class="eb-check"><input type="checkbox" name="buildsOn" value="${repo}"${ENTRY_TEMPLATE.buildsOn.includes(repo) ? " checked" : ""} />${repo}</label>`,
  ).join("");
  const standards = [...interopSorted]
    .sort((a, b) => a.slug.localeCompare(b.slug, "en"))
    .map((rail) => `<option value="${esc(rail.slug)}">${esc(rail.slug)} &middot; ${esc(rail.standard)}</option>`)
    .join("");
  return `  <section id="build-entry" class="fx fxd-35">
    <h2>Build your entry</h2>
    <div class="rule"></div>
    <p class="section-lede">Fill in the fields and watch <code>registry/builders/&lt;your-slug&gt;.json</code> take shape. The checks that run here as you type are the checks CI runs on your pull request - same rules, same messages - and the pull-request button opens the GitHub editor with the finished file already in it.</p>
    <form id="entry-builder" class="eb" hidden novalidate>
      <div class="eb-grid">
        <div>
${field("name", "name", input("name", "text", ` maxlength="80" placeholder="${esc(ENTRY_TEMPLATE.name)}"`))}
${field("slug", "slug", input("slug", "text", ` maxlength="40" placeholder="${esc(ENTRY_TEMPLATE.slug)}"`), "derived from the name; edit to override - it becomes the filename")}
${field(
    "description",
    `description <span class="eb-count" id="entry-desc-count">0/${DESCRIPTION_MAX}</span>`,
    `<textarea id="entry-description" name="description" maxlength="${DESCRIPTION_MAX}" rows="3" placeholder="${esc(ENTRY_TEMPLATE.description)}"></textarea>`,
  )}
${field("homepage", "homepage", input("homepage", "url", ` placeholder="${esc(ENTRY_TEMPLATE.homepage)}"`))}
${field("repo", `repo <span class="eb-opt">optional</span>`, input("repo", "url", ` placeholder="${esc(ENTRY_TEMPLATE.repo)}"`))}
${field("kind", "kind", `<select id="entry-kind" name="kind">${kindOptions}</select>`)}
${field("buildsOn", "builds on", `<div class="eb-checks">${buildsOn}</div>`, "what you build ON, not yourself")}
${field("standards", `standards <span class="eb-opt">optional</span>`, `<select id="entry-standards" name="standards" multiple size="6">${standards}</select>`, "the rails you exercise; cmd/ctrl-click for several")}
${field("github", `contact.github <span class="eb-opt">optional</span>`, input("github", "text", ` maxlength="39" placeholder="${esc(ENTRY_TEMPLATE.contact.github)}"`))}
        </div>
        <div class="eb-side">
          <div class="eb-file">registry/builders/<span id="entry-filename">${esc(ENTRY_TEMPLATE.slug)}.json</span></div>
          <pre id="entry-preview" class="eb-json">${esc(snippetText(ENTRY_PREVIEW))}</pre>
          <span class="eb-err" data-err="entry"></span>
          <div class="eb-actions">
            <button type="button" class="copy-btn" data-copy-target="entry-preview" hidden>[ copy JSON ]</button>
            <a id="entry-pr" class="btn-solid" aria-disabled="true">open pull request on GitHub -&gt;</a>
          </div>
          <p class="micro" id="entry-status">listedAt is set to today for you</p>
        </div>
      </div>
    </form>
    <details class="disclosure">
      <summary>or copy the template file manually</summary>
      <pre data-snippet="entry-preview">${esc(snippetText(ENTRY_PREVIEW))}</pre>
      <p class="note">Save it as <code>registry/builders/&lt;your-slug&gt;.json</code> in a fork of <a href="${REPO_URL}">kya-os/kya-os-usergroup</a>, keep <code>slug</code> equal to the filename, set <code>listedAt</code> to today, run <code>npm test</code> (no dependencies to install), and open a pull request signed off with <code>git commit -s</code>. The field reference is in <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">CONTRIBUTING.md</a>.</p>
    </details>
  </section>`;
}
