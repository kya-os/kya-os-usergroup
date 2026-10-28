/**
 * Zero-dependency npm vendoring primitives for scripts/vendor-verifier.mjs:
 * fetch a published tarball, check it against the registry's own sha512
 * integrity, unpack it in memory, resolve package `exports`, and walk the
 * ES module graph from a set of entry points. Nothing here executes the
 * code it reads - the graph walk parses import statements only.
 */
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { gunzipSync } from "node:zlib";

const REGISTRY = "https://registry.npmjs.org";

/** Download name@version from the npm registry and refuse any byte the registry's integrity does not cover. */
export async function fetchTarball(name, version) {
  const metaUrl = `${REGISTRY}/${name.replace("/", "%2F")}/${version}`;
  const metaResponse = await fetch(metaUrl);
  if (!metaResponse.ok) throw new Error(`${metaUrl}: HTTP ${metaResponse.status}`);
  const { dist } = await metaResponse.json();
  if (typeof dist?.integrity !== "string" || !dist.integrity.startsWith("sha512-")) {
    throw new Error(`${name}@${version}: the registry published no sha512 integrity`);
  }
  const tarballResponse = await fetch(dist.tarball);
  if (!tarballResponse.ok) throw new Error(`${dist.tarball}: HTTP ${tarballResponse.status}`);
  const bytes = Buffer.from(await tarballResponse.arrayBuffer());
  const actual = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (actual !== dist.integrity) {
    throw new Error(`${name}@${version}: tarball integrity ${actual} does not match the registry's ${dist.integrity}`);
  }
  return { tarball: dist.tarball, integrity: dist.integrity, files: untar(gunzipSync(bytes)) };
}

/**
 * Unpack a (ustar / pax) tar archive into a Map of path -> bytes, with the
 * archive's top-level folder ("package/" for npm) stripped. Regular files
 * only; links and devices are refused, never followed.
 */
export function untar(archive) {
  const files = new Map();
  const field = (header, start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0[\s\S]*$/, "");
  let paxPath = null;
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const body = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      paxPath = body.toString("utf8").match(/^\d+ path=(.*)$/m)?.[1] ?? null;
      continue;
    }
    if (type === "g") continue;
    const prefix = field(header, 345, 155);
    const name = paxPath ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    paxPath = null;
    if (type === "5") continue;
    if (type !== "0" && type !== "7") throw new Error(`tar entry ${name}: type ${type} is not a regular file`);
    const path = name.split("/").slice(1).join("/");
    if (path === "" || path.split("/").includes("..")) throw new Error(`tar entry ${name}: unsafe path`);
    files.set(path, Buffer.from(body));
  }
  return files;
}

/** Resolve an `exports` target for the browser: a string, or the first matching condition. */
function exportTarget(target, conditions = ["browser", "import", "default"]) {
  if (typeof target === "string") return target;
  if (target === null || typeof target !== "object") return null;
  for (const condition of conditions) {
    if (condition in target) {
      const resolved = exportTarget(target[condition], conditions);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

/** The file a package's `exports` map gives for a subpath ("." or "./audit"); exact keys only. */
export function resolveExport(packageJson, subpath) {
  const exportsField = packageJson.exports;
  const target =
    exportsField === undefined
      ? subpath === "." ? packageJson.module ?? packageJson.main : null
      : typeof exportsField === "string" || !Object.keys(exportsField).some((key) => key.startsWith("."))
        ? subpath === "." ? exportTarget(exportsField) : null
        : exportTarget(exportsField[subpath]);
  if (typeof target !== "string") throw new Error(`${packageJson.name}: exports has no browser/import/default target for "${subpath}"`);
  return posix.normalize(target.replace(/^\.\//, ""));
}

/**
 * The specifiers a module's static and dynamic imports name. Statement-level
 * only: a line must begin with an import declaration (`import "x"`,
 * `import a, { b } from "x"`, `import * as a from "x"`) or a re-export
 * (`export * from "x"`, `export * as a from "x"`, `export { a } from "x"`),
 * multi-line lists included, so JSDoc examples and line comments that mention
 * an import never count. A dynamic import must take a string literal on a
 * non-comment line. Returns [{ specifier, dynamic }].
 */
export function importSpecifiers(source) {
  const found = new Map();
  const declaration = /^[ \t]*(?:import\s*(?:[\w$*{}\s,]+?\s*from\s*)?|export\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*)["']([^"']+)["']/gm;
  for (const [, specifier] of source.matchAll(declaration)) found.set(specifier, false);
  for (const line of source.split("\n")) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const [, specifier] of line.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!found.has(specifier)) found.set(specifier, true);
    }
  }
  return [...found].map(([specifier, dynamic]) => ({ specifier, dynamic }));
}

/**
 * Walk the module graph from `entries` (each {pkg, path}) across the
 * unpacked packages. `resolveBare(specifier)` maps a bare specifier to
 * {pkg, path} or throws. A Node built-in may only be imported dynamically
 * (loaded on first use, as NodeCryptoProvider does): the browser never
 * evaluates it unless that code path runs, so it is recorded, not vendored.
 * A static built-in import would break the page at load and is refused.
 * Returns { reached: Map(pkg -> Set(paths)), onDemandBuiltins: [string] }.
 */
export function walkGraph(packages, entries, resolveBare) {
  const reached = new Map(Object.keys(packages).map((pkg) => [pkg, new Set()]));
  const onDemandBuiltins = new Set();
  const stack = [...entries];
  while (stack.length > 0) {
    const { pkg, path } = stack.pop();
    if (reached.get(pkg).has(path)) continue;
    const bytes = packages[pkg].files.get(path);
    if (bytes === undefined) throw new Error(`${pkg}: ${path} is imported but not in the published tarball`);
    reached.get(pkg).add(path);
    for (const { specifier, dynamic } of importSpecifiers(bytes.toString("utf8"))) {
      if (specifier.startsWith(".")) {
        stack.push({ pkg, path: posix.normalize(posix.join(posix.dirname(path), specifier)) });
      } else if (specifier.startsWith("node:")) {
        if (!dynamic) throw new Error(`${pkg}/${path} statically imports ${specifier}; the browser cannot load it`);
        onDemandBuiltins.add(`${pkg}/${path} -> ${specifier}`);
      } else {
        stack.push(resolveBare(specifier, `${pkg}/${path}`));
      }
    }
  }
  return { reached, onDemandBuiltins: [...onDemandBuiltins].sort() };
}

export const sha256 = (bytes) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
