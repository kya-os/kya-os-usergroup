/**
 * assertVerdicts (fixtures/full-verifiers.mjs), the one check the tests that
 * run both full verifiers make: it passes each verifier's verdict only when
 * it is the one expected, a refusal only for the reason expected.
 *
 *   node --test workers/badge/full-verifiers.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ACCEPTED, assertVerdicts, refusedFor } from "./fixtures/full-verifiers.mjs";

const REFUSED_FOR_FORM = refusedFor('credential: "validFrom" must be', "credential validFrom must be");

test("assertVerdicts passes an acceptance expected, and a refusal whose reason holds the text expected among others", () => {
  assertVerdicts({ accepted: { cli: "accepted", worker: "accepted" } }, { accepted: ACCEPTED });
  const verdicts = {
    refused: {
      cli: { refused: 'credential: "validFrom" is required; credential: "validFrom" must be the program\'s timestamp' },
      worker: { refused: "credential validFrom must be the program's timestamp" },
    },
  };
  assertVerdicts(verdicts, { refused: REFUSED_FOR_FORM });
});

test("assertVerdicts fails a refusal for another reason, a refusal where an acceptance is expected, an acceptance where a refusal is, and a world missing or extra", () => {
  const formRefusal = { refused: "credential validFrom must be the program's timestamp" };
  const failing = {
    "the public verifier refusing for another reason": [{ w: { cli: { refused: 'credential: "validFrom" is required' }, worker: formRefusal } }, { w: REFUSED_FOR_FORM }],
    "the worker refusing for another reason": [{ w: { cli: { refused: 'credential: "validFrom" must be' }, worker: { refused: "credential proof carries no created" } } }, { w: REFUSED_FOR_FORM }],
    "the public verifier accepting a world to refuse": [{ w: { cli: "accepted", worker: formRefusal } }, { w: REFUSED_FOR_FORM }],
    "the worker refusing a world to accept": [{ w: { cli: "accepted", worker: { refused: "unexpected validUntil on the credential" } } }, { w: ACCEPTED }],
    "a refusal whose reason holds the word undefined, where an acceptance is expected": [{ w: { cli: { refused: "got undefined" }, worker: "accepted" } }, { w: ACCEPTED }],
    "a world missing": [{}, { w: ACCEPTED }],
    "a world extra": [{ w: ACCEPTED, v: ACCEPTED }, { w: ACCEPTED }],
  };
  for (const [what, [verdicts, expected]] of Object.entries(failing)) {
    assert.throws(() => assertVerdicts(verdicts, expected), assert.AssertionError, what);
  }
});
