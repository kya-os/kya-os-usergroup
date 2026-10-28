/**
 * Let Node load the vendored verifier through the same import map the
 * /verify/ page uses (site/assets/vendor/manifest.json `imports`), so the
 * sample generator and the tests run exactly the bytes the browser runs.
 * Call registerVendoredImports() before the first dynamic import of a
 * mapped specifier ("@kya-os/mcp/audit", "jose", ...).
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const vendorDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "site", "assets", "vendor");

/** The manifest's import map with each "/vendor/..." target as a file: URL. */
export function vendoredImportUrls() {
  const { imports } = JSON.parse(readFileSync(join(vendorDir, "manifest.json"), "utf8"));
  return Object.fromEntries(
    Object.entries(imports).map(([specifier, target]) => [specifier, pathToFileURL(join(vendorDir, target.slice("/vendor/".length))).href]),
  );
}

let registered = false;
export function registerVendoredImports() {
  if (registered) return;
  const hooks = `
    let imports;
    export async function initialize(data) { imports = data.imports; }
    export async function resolve(specifier, context, next) {
      return Object.hasOwn(imports, specifier) ? { url: imports[specifier], shortCircuit: true } : next(specifier, context);
    }`;
  register(`data:text/javascript,${encodeURIComponent(hooks)}`, { data: { imports: vendoredImportUrls() } });
  registered = true;
}
