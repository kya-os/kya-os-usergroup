/**
 * Verify-page checks, on the finished dist/ bytes: the import map, the
 * vendored verifier, the samples, and the page's claims about what it runs.
 * Split from lib/assertions.mjs for the LOC cap; same philosophy - re-read
 * the committed manifest and recompute every hash here, never trust the
 * build's own constants (lib/vendor.mjs) or its copy step.
 *
 *   - exactly one <script type="importmap"> on the verify page, in <head>
 *     before any module tag, on no other page; its JSON is exactly the
 *     committed manifest's import map, every target shipped, and its sha256
 *     is the CSP's second script-src hash
 *   - connect-src is exactly 'self' https: (the page fetches its samples and
 *     linked files; nothing else is loosened)
 *   - dist/vendor/ holds exactly the manifest's files plus manifest.json,
 *     each matching its recorded sha256, and the manifest is a byte copy
 *   - every bare specifier /ui/verify.js imports is in the import map
 *   - dist/verify/samples/ holds byte copies of the committed samples
 *   - the page quotes the version it runs (the command and the form name
 *     the manifest's @kya-os/mcp version) and lists every vendored package
 *     with its registry integrity
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { assertBuild } from "./checks.mjs";
import { esc } from "./html.mjs";
import { SAMPLE_FILES } from "./verify.mjs";

const IMPORT_MAP_TAG = /<script type="importmap">([\s\S]*?)<\/script>/g;
const fileSha256 = (bytes) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
const listFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join("/"))
    .sort();

export function assertVerifyPage({ distDir, pages, headers, importMapHash }) {
  const repoRoot = join(distDir, "..");
  const manifestSource = readFileSync(join(repoRoot, "site", "assets", "vendor", "manifest.json"));
  const manifest = JSON.parse(manifestSource.toString("utf8"));
  const html = pages["verify/index.html"];

  // The import map: one, on this page only, ahead of the modules, pinned.
  for (const [name, page] of Object.entries(pages)) {
    const count = [...page.matchAll(IMPORT_MAP_TAG)].length;
    assertBuild(count === (name === "verify/index.html" ? 1 : 0), `${name}: expected ${name === "verify/index.html" ? "exactly one import map" : "no import map"}, found ${count}`);
  }
  const importMapText = [...html.matchAll(IMPORT_MAP_TAG)][0][1];
  const mapAt = html.indexOf('<script type="importmap">');
  assertBuild(mapAt < html.indexOf('<script type="module"') && mapAt < html.indexOf("</head>"), "verify: the import map must sit in <head>, before every module tag");
  const importMapSha = createHash("sha256").update(importMapText, "utf8").digest("base64");
  assertBuild(importMapSha === importMapHash, `verify: import map sha256 ${importMapSha} is not the CSP's second script-src hash ${importMapHash}`);
  const { imports } = JSON.parse(importMapText);
  assertBuild(JSON.stringify(imports) === JSON.stringify(manifest.imports), "verify: the import map is not exactly the committed manifest's imports");
  for (const [specifier, target] of Object.entries(imports)) {
    assertBuild(target.startsWith("/vendor/") && manifest.files[target.slice("/vendor/".length)] !== undefined, `verify: import map target for "${specifier}" (${target}) is not a vendored file`);
  }
  assertBuild((headers.match(/connect-src ([^;]+);/)?.[1] ?? "").trim() === "'self' https:", "connect-src must be exactly 'self' https:");

  // The vendored tree, re-hashed file by file against the committed manifest.
  const vendorDist = join(distDir, "vendor");
  const shipped = listFiles(vendorDist);
  const expected = [...Object.keys(manifest.files), "manifest.json"].sort();
  assertBuild(shipped.join("\n") === expected.join("\n"), "dist/vendor/ must hold exactly the manifest's files plus manifest.json");
  assertBuild(readFileSync(join(vendorDist, "manifest.json")).equals(manifestSource), "dist/vendor/manifest.json is not a byte copy of the committed manifest");
  for (const [path, digest] of Object.entries(manifest.files)) {
    assertBuild(fileSha256(readFileSync(join(vendorDist, path))) === digest, `dist/vendor/${path} does not match its manifest sha256`);
  }

  // The client module resolves every bare specifier through the map.
  const verifyJs = readFileSync(join(distDir, "ui", "verify.js"), "utf8");
  for (const [, specifier] of verifyJs.matchAll(/^\s*(?:import|\})[^;]*?from "([^"./][^"]*)";/gm)) {
    assertBuild(Object.hasOwn(imports, specifier), `/ui/verify.js imports "${specifier}", which the import map does not resolve`);
  }

  // Samples: byte copies, nothing else.
  const samplesDist = join(distDir, "verify", "samples");
  assertBuild(listFiles(samplesDist).join(",") === [...SAMPLE_FILES].sort().join(","), `dist/verify/samples/ must hold exactly: ${SAMPLE_FILES.join(", ")}`);
  for (const name of SAMPLE_FILES) {
    assertBuild(
      readFileSync(join(samplesDist, name)).equals(readFileSync(join(repoRoot, "site", "assets", "verify-samples", name))),
      `dist/verify/samples/${name} is not a byte copy of site/assets/verify-samples/${name}`,
    );
  }

  // The page's claims: the version it quotes is the version it runs, and it
  // names every vendored package with the integrity the registry published.
  const verifier = manifest.packages.find((p) => p.name === "@kya-os/mcp");
  assertBuild(verifier !== undefined, "the vendored manifest has no @kya-os/mcp package");
  assertBuild(html.includes(`data-verifier="@kya-os/mcp@${esc(verifier.version)}"`), "verify: the form does not name the vendored @kya-os/mcp version");
  assertBuild(html.includes(`npx -p @kya-os/mcp@${esc(verifier.version)} kya-audit verify`), "verify: the command does not run the vendored @kya-os/mcp version");
  for (const p of manifest.packages) {
    assertBuild(html.includes(`<code>${esc(p.name)}@${esc(p.version)}</code>`) && html.includes(esc(p.integrity)), `verify: the page does not list ${p.name}@${p.version} with its integrity`);
  }
}
