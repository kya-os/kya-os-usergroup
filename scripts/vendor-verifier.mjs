#!/usr/bin/env node
/**
 * Vendor the reference audit verifier for the /verify/ page: the exact files
 * npm publishes for @kya-os/mcp and its runtime dependencies, byte for byte,
 * limited to the modules the browser actually loads.
 *
 * This repository is zero-dependency by design, so the verifier is not an
 * npm dependency and nothing is bundled or transformed. Instead:
 *   1. each pinned tarball is downloaded and checked against the sha512
 *      integrity the registry publishes for it (lib/npm-vendor.mjs);
 *   2. each dependency pin must satisfy the range @kya-os/mcp's own
 *      package.json declares, and every runtime dependency must be pinned;
 *   3. the ES module graph is walked from the verifier's public subpaths
 *      (@kya-os/mcp/audit and @kya-os/mcp/providers), and only reached files
 *      are copied, plus each package's package.json and license;
 *   4. site/assets/vendor/manifest.json records the tarballs, their
 *      integrity, a sha256 per vendored file, and the import map the page
 *      and the Node tests both resolve bare specifiers through.
 *
 * The page runs the same code the `kya-audit` CLI runs; only the crypto
 * provider differs (WebCryptoProvider in the browser, as the SDK documents).
 *
 * Run: node scripts/vendor-verifier.mjs          write site/assets/vendor/
 *      node scripts/vendor-verifier.mjs --check  re-download and fail on any drift
 * To upgrade, change the pins below, run it, and commit the result.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTarball, resolveExport, sha256, walkGraph } from "./lib/npm-vendor.mjs";

export const VERIFIER = { name: "@kya-os/mcp", version: "1.21.2", subpaths: ["./audit", "./providers"] };
// The versions @kya-os/mcp 1.21.2's own package-lock.json resolves, which
// are the versions its CI tested against.
export const DEPENDENCIES = { jose: "6.2.12", zod: "4.6.5", "json-canonicalize": "3.0.1" };

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VENDOR_DIR = join(repoRoot, "site", "assets", "vendor");
const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

/** Caret and exact ranges only: anything else is refused rather than guessed at. */
function satisfies(version, range) {
  const parse = (v) => v.split(".").map(Number);
  const exact = range.match(/^(\d+\.\d+\.\d+)$/);
  if (exact) return version === exact[1];
  const caret = range.match(/^\^(\d+\.\d+\.\d+)$/);
  if (!caret) throw new Error(`unsupported dependency range "${range}"; extend satisfies() deliberately`);
  const [min, have] = [parse(caret[1]), parse(version)];
  const lock = min[0] > 0 ? 1 : min[1] > 0 ? 2 : 3;
  for (let i = 0; i < lock; i += 1) if (have[i] !== min[i]) return false;
  for (let i = 0; i < 3; i += 1) if (have[i] !== min[i]) return have[i] > min[i];
  return true;
}

/** Split "@scope/name/sub/path" or "name/sub" into the package name and its exports subpath. */
function splitSpecifier(specifier) {
  const parts = specifier.split("/");
  const nameLength = specifier.startsWith("@") ? 2 : 1;
  const rest = parts.slice(nameLength).join("/");
  return { name: parts.slice(0, nameLength).join("/"), subpath: rest === "" ? "." : `./${rest}` };
}

/** Compute the vendored file set: Map(relative path -> bytes) plus the manifest. */
export async function buildVendorSet() {
  const pins = { [VERIFIER.name]: VERIFIER.version, ...DEPENDENCIES };
  const packages = {};
  await Promise.all(
    Object.entries(pins).map(async ([name, version]) => {
      const fetched = await fetchTarball(name, version);
      const packageJson = JSON.parse(fetched.files.get("package.json").toString("utf8"));
      if (packageJson.name !== name || packageJson.version !== version) {
        throw new Error(`${name}@${version}: the tarball's package.json says ${packageJson.name}@${packageJson.version}`);
      }
      packages[name] = { ...fetched, version, packageJson };
    }),
  );

  const declared = packages[VERIFIER.name].packageJson.dependencies ?? {};
  for (const [name, range] of Object.entries(declared)) {
    if (!(name in DEPENDENCIES)) throw new Error(`${VERIFIER.name}@${VERIFIER.version} depends on ${name} (${range}), which is not pinned here`);
    if (!satisfies(DEPENDENCIES[name], range)) throw new Error(`pin ${name}@${DEPENDENCIES[name]} does not satisfy ${VERIFIER.name}'s range ${range}`);
  }
  for (const name of Object.keys(DEPENDENCIES)) {
    if (!(name in declared)) throw new Error(`${name} is pinned but ${VERIFIER.name}@${VERIFIER.version} does not depend on it`);
  }

  const url = (name, path) => `/vendor/${name}@${packages[name].version}/${path}`;
  const imports = {};
  const resolveBare = (specifier, from) => {
    const { name, subpath } = splitSpecifier(specifier);
    if (!(name in packages)) throw new Error(`${from} imports "${specifier}", which is not vendored`);
    const path = resolveExport(packages[name].packageJson, subpath);
    imports[specifier] = url(name, path);
    return { pkg: name, path };
  };
  const entries = VERIFIER.subpaths.map((subpath) => resolveBare(`${VERIFIER.name}${subpath.slice(1)}`, "the /verify/ page"));
  const { reached, onDemandBuiltins } = walkGraph(packages, entries, resolveBare);

  const files = new Map();
  const manifestPackages = [];
  for (const name of Object.keys(packages).sort()) {
    const paths = reached.get(name);
    if (paths.size === 0) continue;
    const { version, tarball, integrity, files: unpacked, packageJson } = packages[name];
    const metadata = [...unpacked.keys()].filter((path) => path === "package.json" || LICENSE_FILE.test(path));
    if (!metadata.some((path) => LICENSE_FILE.test(path))) throw new Error(`${name}@${version} ships no license file to vendor beside its code`);
    for (const path of [...paths, ...metadata].sort()) files.set(`${name}@${version}/${path}`, unpacked.get(path));
    manifestPackages.push({ name, version, license: packageJson.license, tarball, integrity, modules: paths.size });
  }
  const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : 1)));
  const manifest = {
    note: "Generated by scripts/vendor-verifier.mjs. Every file is a byte copy from the npm tarball named here, checked against the registry's integrity; do not edit.",
    packages: manifestPackages,
    imports: sorted(imports),
    // Node built-ins the vendored code loads only on first use, in code paths
    // the page never takes (NodeCryptoProvider); listed so the exception is
    // visible, never vendored.
    onDemandBuiltins,
    files: sorted(Object.fromEntries([...files].map(([path, bytes]) => [path, sha256(bytes)]))),
  };
  return { files, manifest };
}

const manifestBytes = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

function listDisk(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join("/"))
    .sort();
}

async function main() {
  const check = process.argv.includes("--check");
  const { files, manifest } = await buildVendorSet();
  if (check) {
    const problems = [];
    const onDisk = listDisk(VENDOR_DIR);
    const expected = [...files.keys(), "manifest.json"].sort();
    for (const path of expected.filter((p) => !onDisk.includes(p))) problems.push(`missing: ${path}`);
    for (const path of onDisk.filter((p) => !expected.includes(p))) problems.push(`not from any pinned tarball: ${path}`);
    for (const [path, bytes] of files) {
      if (onDisk.includes(path) && !readFileSync(join(VENDOR_DIR, path)).equals(bytes)) problems.push(`differs from npm: ${path}`);
    }
    if (onDisk.includes("manifest.json") && readFileSync(join(VENDOR_DIR, "manifest.json"), "utf8") !== manifestBytes(manifest)) {
      problems.push("manifest.json is not what the pins produce");
    }
    if (problems.length > 0) {
      console.error(`Vendored verifier drifted from npm (${problems.length}):\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`Vendored verifier matches npm: ${files.size} files from ${manifest.packages.map((p) => `${p.name}@${p.version}`).join(", ")}`);
    return;
  }
  rmSync(VENDOR_DIR, { recursive: true, force: true });
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(VENDOR_DIR, path)), { recursive: true });
    writeFileSync(join(VENDOR_DIR, path), bytes);
  }
  writeFileSync(join(VENDOR_DIR, "manifest.json"), manifestBytes(manifest));
  for (const p of manifest.packages) console.log(`${p.name}@${p.version}: ${p.modules} modules (${p.integrity.slice(0, 22)}...)`);
  console.log(`Wrote ${files.size} files and manifest.json to site/assets/vendor/`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
