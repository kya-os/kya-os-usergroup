/**
 * The vendored reference verifier as the build sees it: the committed
 * site/assets/vendor/manifest.json (written by scripts/vendor-verifier.mjs),
 * the @kya-os/mcp pin it records, and the exact import-map bytes the /verify/
 * page inlines - the _headers CSP pins the same constant by hash, so the
 * page and the policy cannot drift (lib/verify-checks.mjs re-checks both on
 * the dist bytes).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const VENDOR_SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "vendor");
export const VENDOR_MANIFEST = JSON.parse(readFileSync(join(VENDOR_SRC_DIR, "manifest.json"), "utf8"));
export const VERIFIER_PACKAGE = VENDOR_MANIFEST.packages.find((p) => p.name === "@kya-os/mcp");
export const IMPORT_MAP = JSON.stringify({ imports: VENDOR_MANIFEST.imports });
