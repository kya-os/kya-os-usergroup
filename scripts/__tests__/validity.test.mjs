/**
 * The program's timestamp on the scripts side: one rule from one
 * implementation (scripts/lib/datetime.mjs, isProgramTimestamp), the form the
 * program writes validFrom and allocatedAt in (scripts/issue-credential.mjs,
 * scripts/revoke-credential.mjs), YYYY-MM-DDThh:mm:ssZ: an [XMLSCHEMA11-2]
 * dateTimeStamp in UTC to the second, on a day its month has. The shape
 * check holds a credential's and a status list's validFrom to it, and the
 * committed-file validation the allocation ledger's allocatedAt. The
 * published schema's validFrom pattern is its lexical grammar, which, as for
 * proof.created, leaves the day-of-month constraint to the verifiers: over
 * generated timestamps, that is the one place the pattern and the rule
 * disagree. The shape check also refuses a validUntil, whatever its value,
 * with its own reason. A validFrom that does not parse is never beyond the
 * clock skew, so the public verifier names it once, by this rule. Both full
 * verifiers on one world: workers/badge/validity-rule.test.mjs.
 *
 *   node --test scripts/__tests__/validity.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROGRAM_TIMESTAMP_RE, beyondSkew, isProgramTimestamp } from "../lib/datetime.mjs";
import { checkCredentialShape, checkStatusListShape } from "../lib/shape.mjs";
import { validateCredentials } from "../validate-credentials.mjs";
import { VALID_FROM, signedCredential, signedList, signedWorld, verdictOnWorld } from "./fixtures/signed-documents.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const PROGRAM_TIMESTAMPS = [VALID_FROM, "2024-02-29T00:00:00Z", "2025-12-31T24:00:00Z"];
const OTHER_VALUES = [
  "2026-01-01T00:00:00.000Z",
  "2026-01-01T00:00:00+00:00",
  "2025-12-31T19:00:00-05:00",
  "2026-01-01T00:00:00",
  "2026-01-01",
  "12026-01-01T00:00:00Z",
  "2026-02-29T00:00:00Z", // 2026 is not a leap year
  "2026-02-30T00:00:00Z",
  "2026-04-31T00:00:00Z",
  "2026-13-01T00:00:00Z",
  "yesterday",
  20260101,
  "",
  undefined,
];

/** Each value of `values` the check `accepts` gets wrong, against the rule: accept exactly the program timestamps. */
const misjudged = (values, accepts) =>
  values.filter((value) => accepts(value) !== PROGRAM_TIMESTAMPS.includes(value)).map((value) => JSON.stringify(value) ?? "undefined");

test("the shape check holds validFrom to the program's timestamp, on a credential and on a status list", () => {
  const VALID_FROM_ERROR = '"validFrom" must be';
  const passes = (errors) => !errors.some((error) => error.includes(VALID_FROM_ERROR));
  const values = [...PROGRAM_TIMESTAMPS, ...OTHER_VALUES];
  const credential = (validFrom) => passes(checkCredentialShape(signedCredential({ validFrom, created: VALID_FROM }), "t"));
  const list = (validFrom) => passes(checkStatusListShape(signedList("revocation", { validFrom, created: VALID_FROM }), "revocation", "t"));
  assert.deepEqual({ credential: misjudged(values, credential), list: misjudged(values, list) }, { credential: [], list: [] });
});

test("the shape check refuses a validUntil whatever its value, naming it, on a credential and on a status list", () => {
  const VALID_UNTIL_ERROR = '"validUntil" is forbidden';
  const values = ["2099-01-01T00:00:00Z", null, "", false, 0];
  const refused = (errors) => errors.some((error) => error.includes(VALID_UNTIL_ERROR));
  const credential = (validUntil) => refused(checkCredentialShape({ ...signedCredential(), validUntil }, "t"));
  const list = (validUntil) => refused(checkStatusListShape({ ...signedList("revocation"), validUntil }, "revocation", "t"));
  const missed = (check) => values.filter((value) => !check(value)).map((value) => JSON.stringify(value));
  assert.deepEqual({ credential: missed(credential), list: missed(list) }, { credential: [], list: [] });
  assert.equal(refused(checkCredentialShape(signedCredential(), "t")), false, "a credential without one passes this check");
});

test("a validFrom that does not parse is never beyond the clock skew, so verify-credential.mjs names it once, by the timestamp rule, on a credential and on a status list", async () => {
  const now = Date.parse(VALID_FROM);
  assert.equal(beyondSkew(NaN, now), false, "a validFrom Date.parse cannot read (NaN) is not beyond the skew");
  const unreadable = { validFrom: "yesterday", created: VALID_FROM };
  const credential = await verdictOnWorld(signedWorld({ credential: signedCredential(unreadable) }), { now });
  const list = await verdictOnWorld(signedWorld({ revocation: signedList("revocation", unreadable) }), { now });
  const rule = '"validFrom" must be the program\'s timestamp, YYYY-MM-DDThh:mm:ssZ on a day its month has';
  assert.deepEqual(
    { credential: credential.checks.schema.errors, list: list.checks.status.reason },
    { credential: [`credential: ${rule}`], list: `revocation list: ${rule}` },
  );
});

const readValidFromPattern = () =>
  JSON.parse(readFileSync(join(repoRoot, "registry", "credentials", "schema", "attestation-v1.json"), "utf8")).properties.validFrom.pattern;

test("the published schema's validFrom pattern is the program timestamp's lexical grammar, and leaves the day-of-month constraint to the verifiers", () => {
  const pattern = readValidFromPattern();
  assert.equal(pattern, PROGRAM_TIMESTAMP_RE.source);
  const february30 = "2026-02-30T00:00:00Z";
  assert.match(february30, new RegExp(pattern), "the grammar admits any day from 01 to 31");
  assert.equal(isProgramTimestamp(february30), false, "the rule refuses a day its month does not have");
});

// Years chosen for the leap rules: every fourth, not every hundredth, every four hundredth, 0000 included.
const YEARS = ["0000", "1900", "2000", "2024", "2026", "2100", "2400", "9999"];
const twoDigits = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(2, "0"));
const TIMES = [...twoDigits(0, 25).map((hour) => `${hour}:00:00`), "23:59:59", "23:60:00", "23:59:60", "24:00:00", "24:00:01", "24:01:00", "99:99:99", "00:00:00.5"];

/** Is `timestamp` on a day from 01 to 31 that its month, from 01 to 12, does not have? Date carries such a day into the next month. */
function onADayItsMonthLacks(timestamp) {
  const [year, month, day] = timestamp.slice(0, 10).split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCMonth() !== month - 1;
}

test("the published validFrom pattern and isProgramTimestamp disagree only on a day its month does not have, over generated timestamps", () => {
  const pattern = new RegExp(readValidFromPattern(), "u"); // with the u flag, as JSON Schema validators such as ajv compile it
  const generated = YEARS.flatMap((year) =>
    twoDigits(0, 13).flatMap((month) => twoDigits(0, 32).flatMap((day) => TIMES.map((time) => `${year}-${month}-${day}T${time}Z`))),
  );
  const counts = { "both accept": 0, "only the pattern admits, on a day its month lacks": 0, "both refuse": 0 };
  const unexplained = [];
  for (const value of generated) {
    const admitted = pattern.test(value);
    const accepted = isProgramTimestamp(value);
    const dayItsMonthLacks = admitted && onADayItsMonthLacks(value);
    if ((admitted !== accepted) !== dayItsMonthLacks) unexplained.push(`${value}: the pattern ${admitted ? "admits" : "refuses"} it, the rule ${accepted ? "accepts" : "refuses"} it`);
    counts[dayItsMonthLacks ? "only the pattern admits, on a day its month lacks" : accepted ? "both accept" : "both refuse"] += 1;
  }
  assert.deepEqual(unexplained.slice(0, 10), [], `${unexplained.length} of ${generated.length} unexplained`);
  assert.ok(Object.values(counts).every((count) => count > 0), `each kind generated: ${JSON.stringify(counts)}`);
});

test("validate-credentials.mjs holds the allocation ledger's allocatedAt to the program's timestamp", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kya-validity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["keys", "credentials"]) cpSync(join(repoRoot, "registry", dir), join(root, "registry", dir), { recursive: true });
  const ledgerFile = join(root, "registry", "credentials", "allocations.json");
  const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
  if (ledger.allocations.length === 0) {
    t.skip("the unprovisioned era commits no allocation");
    return;
  }
  const accepts = (allocatedAt) => {
    writeFileSync(ledgerFile, JSON.stringify({ ...ledger, allocations: [{ ...ledger.allocations[0], allocatedAt }, ...ledger.allocations.slice(1)] }));
    return !validateCredentials([], root).errors.some((error) => error.includes("allocations[0].allocatedAt must be"));
  };
  assert.deepEqual(misjudged([...PROGRAM_TIMESTAMPS, ...OTHER_VALUES], accepts), []);
});
