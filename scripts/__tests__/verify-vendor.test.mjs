/**
 * Tests for the /verify/ page's vendored reference verifier, offline:
 *
 *   - the committed tree under site/assets/vendor/ is exactly what its
 *     manifest records (scripts/vendor-verifier.mjs --check re-derives the
 *     manifest from npm itself; that one needs the network and runs in CI)
 *   - every vendored module's imports resolve inside the vendored set, so
 *     the page can never 404 on a module it reaches
 *   - the committed samples verify the way the page says, run through the
 *     same bytes and import map the browser uses
 *   - the parsing primitives in scripts/lib/npm-vendor.mjs
 *
 *   node --test scripts/__tests__/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_DIMENSIONS, auditExitCode } from "../lib/audit-dimensions.mjs";
import { importSpecifiers, resolveExport, sha256, untar, walkGraph } from "../lib/npm-vendor.mjs";
import { registerVendoredImports } from "../lib/vendored-imports.mjs";
import { DEPENDENCIES, VERIFIER } from "../vendor-verifier.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendorDir = join(repoRoot, "site", "assets", "vendor");
const samplesDir = join(repoRoot, "site", "assets", "verify-samples");
const manifest = JSON.parse(readFileSync(join(vendorDir, "manifest.json"), "utf8"));
const INTEGRITY_DIMENSIONS = ["cryptographicIntegrity", "chainIntegrity", "checkpointIntegrity", "scopeEvidenceCompleteness"];

const listFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join("/"))
    .sort();

/** "@kya-os/mcp@1.21.2/dist/audit/index.js" -> { pkg: "@kya-os/mcp", path: "dist/audit/index.js" } */
function splitVendoredPath(file) {
  const at = file.indexOf("@", file.startsWith("@") ? 1 : 0);
  const slash = file.indexOf("/", at);
  return { pkg: file.slice(0, at), path: file.slice(slash + 1) };
}

// ---------------------------------------------------------------------------
// The committed tree

test("site/assets/vendor/ holds exactly the manifest's files, each matching its sha256", () => {
  const expected = [...Object.keys(manifest.files), "manifest.json"].sort();
  assert.deepEqual(listFiles(vendorDir), expected);
  for (const [path, digest] of Object.entries(manifest.files)) {
    assert.equal(sha256(readFileSync(join(vendorDir, path))), digest, path);
  }
});

test("the manifest vendors the pinned versions, and each package ships its license", () => {
  const pins = { [VERIFIER.name]: VERIFIER.version, ...DEPENDENCIES };
  assert.equal(manifest.packages.find((p) => p.name === VERIFIER.name)?.version, VERIFIER.version);
  for (const p of manifest.packages) {
    assert.equal(p.version, pins[p.name], `${p.name} is vendored at ${p.version}, pinned at ${pins[p.name]}`);
    assert.match(p.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    const own = Object.keys(manifest.files).filter((file) => file.startsWith(`${p.name}@${p.version}/`));
    assert.ok(own.some((file) => /\/(LICEN[CS]E|COPYING)[^/]*$/i.test(file)), `${p.name} ships no license file`);
    assert.equal(own.filter((file) => file.endsWith(".js") || file.endsWith(".mjs")).length, p.modules, `${p.name} module count`);
  }
});

test("every vendored module's imports resolve inside the vendored set", () => {
  const files = new Set(Object.keys(manifest.files));
  for (const target of Object.values(manifest.imports)) {
    assert.ok(target.startsWith("/vendor/") && files.has(target.slice("/vendor/".length)), `import map target ${target} is not vendored`);
  }
  for (const file of files) {
    if (!file.endsWith(".js") && !file.endsWith(".mjs")) continue;
    const { pkg, path } = splitVendoredPath(file);
    for (const { specifier, dynamic } of importSpecifiers(readFileSync(join(vendorDir, file), "utf8"))) {
      if (specifier.startsWith(".")) {
        const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
        assert.ok(files.has(resolved), `${file} imports ${specifier}, which is not vendored`);
      } else if (specifier.startsWith("node:")) {
        assert.ok(dynamic, `${file} statically imports ${specifier}`);
        assert.ok(manifest.onDemandBuiltins.includes(`${pkg}/${path} -> ${specifier}`), `${file} loads ${specifier} on demand without the manifest saying so`);
      } else {
        assert.ok(Object.hasOwn(manifest.imports, specifier), `${file} imports "${specifier}", which the import map does not resolve`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The samples, through the bytes the page runs

async function verifySample(bundleName) {
  registerVendoredImports();
  const audit = await import("@kya-os/mcp/audit");
  const { WebCryptoProvider } = await import("@kya-os/mcp/providers");
  const read = (name) => JSON.parse(readFileSync(join(samplesDir, name), "utf8"));
  const keys = new Map(read("keys.json").keys.map((item) => [item.kid, item.jwk]));
  return audit.verifyAuditBundle(read(bundleName), audit.parseAuditVerificationPolicy(read("policy.json")), {
    hasher: new audit.CryptoProviderAuditHasher(new WebCryptoProvider()),
    signatures: new audit.CompactJwsAuditSignatureVerifier({ resolve: async (signer) => keys.get(signer.kid) ?? null }),
  });
}

const verdicts = (report) => Object.fromEntries(AUDIT_DIMENSIONS.map(({ key }) => [key, report[key].verdict]));

test("the sample bundle passes every integrity dimension (kya-audit would exit 0)", async () => {
  const report = await verifySample("bundle.json");
  for (const name of INTEGRITY_DIMENSIONS) assert.equal(report[name].verdict, "valid", `${name}: ${report[name].reasonCodes.join(", ")}`);
  assert.equal(auditExitCode(report), 0);
  // Files alone carry no witness, authorization evidence or live status: the
  // verifier says so rather than counting them valid.
  assert.equal(report.anchorIntegrity.verdict, "indeterminate");
  assert.equal(report.authorizedAsObserved.verdict, "indeterminate");
  assert.equal(report.currentAuthorization.verdict, "indeterminate");
});

test("the tampered sample fails only on signatures and digests (kya-audit would exit 1)", async () => {
  const honest = await verifySample("bundle.json");
  const tampered = await verifySample("bundle.tampered.json");
  assert.equal(tampered.cryptographicIntegrity.verdict, "invalid");
  assert.ok(tampered.cryptographicIntegrity.reasonCodes.includes("AUDIT_ENTRY_DIGEST_MISMATCH"));
  assert.equal(auditExitCode(tampered), 1);
  assert.deepEqual({ ...verdicts(tampered), cryptographicIntegrity: "valid" }, verdicts(honest));
});

test("the tampered sample differs from the honest one by the denied entry's outcome alone", () => {
  const read = (name) => JSON.parse(readFileSync(join(samplesDir, name), "utf8"));
  const entriesOf = (bundle) => bundle.components.find((component) => component.path === "ledger/entries.json").content;
  const honest = read("bundle.json");
  const tampered = read("bundle.tampered.json");
  const changed = entriesOf(honest).flatMap((entry, index) =>
    JSON.stringify(entry) === JSON.stringify(entriesOf(tampered)[index]) ? [] : [{ entry, edited: entriesOf(tampered)[index] }],
  );
  assert.equal(changed.length, 1);
  assert.equal(changed[0].entry.core.event.outcome, "denied");
  assert.equal(changed[0].edited.core.event.outcome, "succeeded");
  assert.deepEqual({ ...changed[0].edited, core: { ...changed[0].edited.core, event: { ...changed[0].edited.core.event, outcome: "denied" } } }, changed[0].entry);
  const others = (bundle) => ({ ...bundle, components: bundle.components.filter((component) => component.path !== "ledger/entries.json") });
  assert.deepEqual(others(tampered), others(honest));
});

test("the page's dimension list names every dimension the verifier reports, in report order", async () => {
  const report = await verifySample("bundle.json");
  const reported = Object.entries(report)
    .filter(([, value]) => value !== null && typeof value === "object" && "verdict" in value)
    .map(([key]) => key);
  assert.deepEqual(AUDIT_DIMENSIONS.map(({ key }) => key), reported);
});

// ---------------------------------------------------------------------------
// Parsing primitives

test("importSpecifiers reads declarations and dynamic imports, never strings or comments", () => {
  const source = [
    'import a, { b } from "./a.js";',
    "import {",
    "  c,",
    '} from "pkg/sub";',
    'export * from "./re.js";',
    'export { d } from "./d.js";',
    'import "./side.js";',
    'const message = "x import from \\"./not-a-module.js\\"";',
    '// import { e } from "./commented.js";',
    ' * await import("./jsdoc.js")',
    'const lazy = () => import("node:crypto");',
  ].join("\n");
  assert.deepEqual(importSpecifiers(source), [
    { specifier: "./a.js", dynamic: false },
    { specifier: "pkg/sub", dynamic: false },
    { specifier: "./re.js", dynamic: false },
    { specifier: "./d.js", dynamic: false },
    { specifier: "./side.js", dynamic: false },
    { specifier: "node:crypto", dynamic: true },
  ]);
});

test("walkGraph records an on-demand built-in and refuses a static one", () => {
  const pkg = (files) => ({ files: new Map(Object.entries(files).map(([path, source]) => [path, Buffer.from(source)])) });
  const lazy = { p: pkg({ "index.js": 'export * from "./node.js";', "node.js": 'export const load = () => import("node:crypto");' }) };
  const { reached, onDemandBuiltins } = walkGraph(lazy, [{ pkg: "p", path: "index.js" }], () => assert.fail("no bare imports"));
  assert.deepEqual([...reached.get("p")].sort(), ["index.js", "node.js"]);
  assert.deepEqual(onDemandBuiltins, ["p/node.js -> node:crypto"]);
  const eager = { p: pkg({ "index.js": 'import { createHash } from "node:crypto";' }) };
  assert.throws(() => walkGraph(eager, [{ pkg: "p", path: "index.js" }], () => null), /statically imports node:crypto/);
});

test("resolveExport takes the browser/import/default condition for an exact subpath", () => {
  const packageJson = {
    name: "p",
    exports: { ".": { types: "./x.d.ts", import: "./dist/index.js" }, "./audit": { browser: "./dist/audit/browser.js", import: "./dist/audit/index.js" } },
  };
  assert.equal(resolveExport(packageJson, "."), "dist/index.js");
  assert.equal(resolveExport(packageJson, "./audit"), "dist/audit/browser.js");
  assert.throws(() => resolveExport(packageJson, "./missing"), /no browser\/import\/default target/);
});

/** A one-entry ustar archive (checksum unset: untar does not read it). */
function tarOf(name, body, type = "0") {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12, "utf8");
  header.write(type, 156, 1, "utf8");
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  Buffer.from(body).copy(padded);
  return Buffer.concat([header, padded, Buffer.alloc(1024)]);
}

test("untar strips the top folder and refuses links and escaping paths", () => {
  assert.deepEqual([...untar(tarOf("package/dist/index.js", "export {};"))], [["dist/index.js", Buffer.from("export {};")]]);
  assert.throws(() => untar(tarOf("package/link.js", "", "2")), /not a regular file/);
  assert.throws(() => untar(tarOf("package/../../etc/passwd", "x")), /unsafe path/);
});
