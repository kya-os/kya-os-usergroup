/**
 * The registry vocabulary, read from the two JSON Schemas so the enums and
 * the property order live in exactly one place: registry/schema/. The
 * validator (scripts/validate.mjs), the site build, and - via the module
 * the build emits to dist/ui/registry-enums.js - the browser-side entry
 * builder all consume these same values. Bounds and patterns stay in the
 * rule modules (the Ajv-free house rule: plain JS checks, no schema
 * interpreter); what this module derives is the vocabulary a shape change
 * would otherwise have to be hand-synced across files.
 *
 * Node-only (reads the schema files). The browser gets the generated
 * module instead; site/lib/module-checks.mjs asserts the two agree by
 * re-reading the schemas independently.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "registry", "schema");
const schema = (name) => JSON.parse(readFileSync(join(schemaDir, name), "utf8"));
const builder = schema("builder.schema.json");
const interop = schema("interop.schema.json");

export const KINDS = builder.properties.kind.enum;
export const BUILDS_ON = builder.properties.buildsOn.items.enum;
export const CONFORMANCE_LEVELS = builder.properties.conformance.properties.level.enum;
export const CONFORMANCE_SCOPES = builder.properties.conformance.properties.scope.enum;
export const CONFORMANCE_STATUSES = builder.properties.conformance.properties.status.enum;
export const DEPLOY_PLATFORMS = builder.properties.deploy.items.properties.platform.enum;
export const INTEROP_CATEGORIES = interop.properties.category.enum;
export const INTEROP_STATUSES = interop.properties.status.enum;

// Property order as the schemas declare it: the allowed key sets for the
// additionalProperties:false checks, and the order a generated entry file
// serializes its keys in.
export const BUILDER_KEYS = Object.keys(builder.properties);
export const CONFORMANCE_KEYS = Object.keys(builder.properties.conformance.properties);
export const DEPLOY_KEYS = Object.keys(builder.properties.deploy.items.properties);
export const CONTACT_KEYS = Object.keys(builder.properties.contact.properties);
export const INTEROP_KEYS = Object.keys(interop.properties);
