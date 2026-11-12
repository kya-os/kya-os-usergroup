/**
 * validFrom and validUntil, one rule on both full verifiers, for a
 * credential and for a status list alike: validFrom is the program's
 * timestamp, YYYY-MM-DDThh:mm:ssZ on a day its month has, and less than the
 * 300s clock skew in the future, which each side decides with one pure
 * function, beyondSkew; no program document carries a validUntil, whatever
 * its value. Each world is a credential and both status lists signed by the
 * scripts side's signer under throwaway keys
 * (scripts/__tests__/fixtures/signed-documents.mjs), every proof created at
 * the same time, so the one document a world changes, the credential or
 * either status list, differs in validFrom or validUntil alone, and both
 * verifiers must refuse it for the rule it breaks.
 *
 *   node --test workers/badge/validity-rule.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ACCEPTED, DOCUMENT_NAMES, assertVerdicts, refusedFor, verdictsOnWorlds } from "./fixtures/full-verifiers.mjs";
import { beyondSkew as workerBeyondSkew } from "./worker.mjs";
import { beyondSkew as scriptsBeyondSkew } from "../../scripts/lib/datetime.mjs";
import {
  BADGE,
  PROGRAM_KEYS,
  VALID_FROM,
  resigned,
  signedCredential,
  signedList,
  signedWorld,
} from "../../scripts/__tests__/fixtures/signed-documents.mjs";

/** Both verdicts on each of `worlds`, at this machine's clock, or at `now` when given (fixtures/full-verifiers.mjs). */
const verdicts = (t, worlds, now) => verdictsOnWorlds(t, worlds, { ...BADGE, programKeys: PROGRAM_KEYS, now });

/** The document `kind` (credential, revocation, suspension) signed with `fields` (signed-documents.mjs). */
const signed = (kind, fields) => (kind === "credential" ? signedCredential(fields) : signedList(kind, fields));

/**
 * For each of `variants` (label -> value), three worlds, in which the
 * credential, the revocation list or the suspension list is `sign(kind,
 * value)`. `expect(verdictFor)` gives each world the verdict `verdictFor`
 * gives the name of the document it changes.
 */
function worldsFor(variants, sign) {
  const worlds = {};
  const names = {};
  for (const [variant, value] of Object.entries(variants)) {
    for (const [kind, name] of Object.entries(DOCUMENT_NAMES)) {
      const label = `a ${name}, ${variant}`;
      worlds[label] = signedWorld({ [kind]: sign(kind, value) });
      names[label] = name;
    }
  }
  return { worlds, expect: (verdictFor) => Object.fromEntries(Object.entries(names).map(([label, name]) => [label, verdictFor(name)])) };
}

/** worldsFor each form of validFrom (label -> validFrom, left out when undefined). */
function validFromWorlds(forms) {
  const variants = Object.fromEntries(Object.entries(forms).map(([form, validFrom]) => [`validFrom ${form}`, validFrom]));
  return worldsFor(variants, (kind, validFrom) => signed(kind, { validFrom, created: VALID_FROM }));
}

const accepted = () => ACCEPTED;
/** Both verifiers refusing document `name` for a validFrom not in the program's form. */
const refusedForForm = (name) => refusedFor(`${name}: "validFrom" must be the program's timestamp`, `${name} validFrom must be the program's timestamp`);
// Both verifiers word a validFrom beyond the clock skew alike.
const BEYOND_SKEW = "validFrom is 300s or more in the future, beyond the clock skew";
/** Both verifiers refusing document `name` for a validFrom beyond the clock skew. */
const refusedForSkew = (name) => refusedFor(`${name}: ${BEYOND_SKEW}`, `${name} ${BEYOND_SKEW}`);

test("verify-credential.mjs and the worker both accept validFrom in the program's form, on a credential and on each status list", async (t) => {
  const { worlds, expect } = validFromWorlds({
    "as the program writes it": VALID_FROM,
    "on a leap day": "2024-02-29T00:00:00Z",
    "at the end of a day, 24:00:00": "2025-12-31T24:00:00Z",
  });
  assertVerdicts(await verdicts(t, worlds), expect(accepted));
});

test("verify-credential.mjs and the worker both refuse validFrom in any other form, or absent, on a credential and on each status list", async (t) => {
  const { worlds, expect } = validFromWorlds({
    "with fractional seconds": "2026-01-01T00:00:00.000Z",
    "with a +00:00 offset": "2026-01-01T00:00:00+00:00",
    "with a -05:00 offset": "2025-12-31T19:00:00-05:00",
    "with no timezone": "2026-01-01T00:00:00",
    "a date alone": "2026-01-01",
    "with a five-digit year": "12026-01-01T00:00:00Z",
    "on February 29 of a common year": "2026-02-29T00:00:00Z",
    "on February 30": "2026-02-30T00:00:00Z",
    "on April 31": "2026-04-31T00:00:00Z",
    "in a 13th month": "2026-13-01T00:00:00Z",
    "in words": "yesterday",
    "a number": 20260101,
    "absent": undefined,
  });
  assertVerdicts(await verdicts(t, worlds), expect(refusedForForm));
});

test("the skew rule, one pure function on each side, refuses a validFrom from exactly 300,000 ms ahead of the clock on, as Digital Bazaar's verifier does", () => {
  const validFromMs = Date.parse(VALID_FROM);
  const beyondWhenAheadBy = { 299_999: false, 300_000: true, 300_001: true };
  for (const [side, beyondSkew] of Object.entries({ scripts: scriptsBeyondSkew, worker: workerBeyondSkew })) {
    const verdicts = Object.fromEntries(Object.keys(beyondWhenAheadBy).map((ms) => [ms, beyondSkew(validFromMs, validFromMs - Number(ms))]));
    assert.deepEqual(verdicts, beyondWhenAheadBy, `the ${side} side`);
  }
});

/** `seconds` from now, in the program's timestamp form: whole seconds, rounded down. */
const fromNow = (seconds) => new Date(Date.now() + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

// Here the public verifier runs as a reader runs it, its command line
// reading this machine's clock, so the worlds are dated from the test's own:
// a validFrom 299s ahead, rounded down, stays inside the skew however long
// the verifiers take, and one 360s ahead stays beyond it unless they take a
// minute. The test after it gives both verifiers the time instead, to hold
// the line to the millisecond.
test("verify-credential.mjs and the worker both accept a credential or status list valid from inside the clock skew, and refuse one valid from beyond it", async (t) => {
  const inside = validFromWorlds({ "299s ahead": fromNow(299) });
  const beyond = validFromWorlds({ "360s ahead": fromNow(360), "in 2099": "2099-01-01T00:00:00Z" });
  assertVerdicts(await verdicts(t, { ...inside.worlds, ...beyond.worlds }), { ...inside.expect(accepted), ...beyond.expect(refusedForSkew) });
});

test("verify-credential.mjs and the worker, given the time, both accept a credential or status list valid from 299,999 ms ahead of it, and refuse one valid from 300,000 ms ahead", async (t) => {
  const validFrom = "2026-01-02T00:00:00Z";
  const { worlds, expect } = validFromWorlds({ [validFrom]: validFrom });
  const ahead = (ms) => verdicts(t, worlds, Date.parse(validFrom) - ms);
  assertVerdicts(await ahead(299_999), expect(accepted), "299,999 ms ahead");
  assertVerdicts(await ahead(300_000), expect(refusedForSkew), "300,000 ms ahead");
});

test("verify-credential.mjs and the worker both refuse a credential or status list that carries a validUntil, whatever its value", async (t) => {
  const values = Object.fromEntries(["2099-01-01T00:00:00Z", null, "", false].map((value) => [`with validUntil ${JSON.stringify(value)}`, value]));
  const withValidUntil = (kind, validUntil) => resigned(signed(kind), (proof, unsecured) => (unsecured.validUntil = validUntil));
  const { worlds, expect } = worldsFor(values, withValidUntil);
  assertVerdicts(await verdicts(t, worlds), expect((name) => refusedFor(`${name}: "validUntil" is forbidden`, `unexpected validUntil on the ${name}`)));
});
