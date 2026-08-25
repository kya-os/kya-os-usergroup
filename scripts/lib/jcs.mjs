/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) for the conformance program's
 * signing tools: sorted object keys (UTF-16 code unit order), ECMAScript
 * number serialization, and the mandatory string escape set.
 *
 * DELIBERATE REDUNDANCY RULE: workers/badge/verify.mjs carries its own JCS
 * implementation and neither file may import the other - the worker must
 * stay self-contained for Cloudflare bundling, and the repo's house style is
 * independent implementations cross-proving each other. Parity tests
 * (workers/badge/parity.test.mjs) assert both produce identical bytes on
 * shared edge vectors; a divergence fails the suite, never ships.
 *
 * This implementation is deliberately explicit where the worker leans on
 * JSON.stringify: the escape table, the surrogate handling, and the key
 * comparator are spelled out, so the two implementations share no shortcut
 * that could hide a common bug.
 */

// The two-character escapes RFC 8785 section 3.2.2.2 mandates, by code unit.
const ESCAPES = {
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
  0x22: '\\"',
  0x5c: "\\\\",
};

const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

/** Serialize one string per RFC 8785: mandatory escapes, control characters
 * as lowercase \u00xx, well-formed surrogate pairs literal, lone surrogates
 * escaped (matching well-formed JSON.stringify, which the worker relies on). */
function serializeString(value) {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (ESCAPES[code] !== undefined) {
      out += ESCAPES[code];
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (isHighSurrogate(code) && i + 1 < value.length && isLowSurrogate(value.charCodeAt(i + 1))) {
      out += value[i] + value[i + 1];
      i++;
    } else if (isHighSurrogate(code) || isLowSurrogate(code)) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += value[i];
    }
  }
  return out + '"';
}

/** Serialize one number per RFC 8785 section 3.2.2.3: ECMAScript ToString of
 * a finite double (String() implements exactly that); -0 serializes as "0". */
function serializeNumber(value) {
  if (!Number.isFinite(value)) throw new Error("JCS: non-finite numbers have no canonical form");
  if (Object.is(value, -0)) return "0";
  return String(value);
}

/** RFC 8785 property ordering: UTF-16 code unit order, then length. */
function compareUtf16(a, b) {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const delta = a.charCodeAt(i) - b.charCodeAt(i);
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

/**
 * Canonicalize a JSON value per RFC 8785. Throws on values with no JSON
 * form (undefined, functions, symbols, bigints, non-finite numbers) so a
 * malformed document can never silently canonicalize - callers fail closed.
 */
export function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return serializeNumber(value);
  if (typeof value === "string") return serializeString(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item === undefined ? null : item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort(compareUtf16);
    return `{${keys.map((key) => `${serializeString(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error(`JCS: unsupported type ${typeof value}`);
}
