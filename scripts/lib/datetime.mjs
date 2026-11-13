/**
 * The program's datetime rules on this side of the deliberate-redundancy
 * boundary, each implemented once:
 *
 *   - the [XMLSCHEMA11-2] dateTimeStamp, for proof.created: the cryptosuite
 *     (attest.mjs) refuses to sign or verify a proof whose created is not
 *     one, the shape check (shape.mjs) holds committed documents to it, and
 *     the published schema's created pattern
 *     (registry/credentials/schema/attestation-v1.json) is
 *     DATE_TIME_STAMP_RE, pinned equal by scripts/__tests__/created.test.mjs;
 *   - the program's own timestamp, for validFrom and the allocation ledger's
 *     allocatedAt: a dateTimeStamp in UTC to the second, the form the
 *     program writes them in (issue-credential.mjs, revoke-credential.mjs),
 *     held by the shape check and validate-credentials.mjs; the schema's
 *     validFrom pattern is PROGRAM_TIMESTAMP_RE, pinned equal by
 *     scripts/__tests__/validity.test.mjs;
 *   - the clock skew, for validFrom as a verifier reads it: beyondSkew,
 *     which the public verifier (verdict.mjs, for verify-credential.mjs)
 *     applies to the credential and to each status list.
 *
 * Each pattern is its rule's lexical grammar. XMLSCHEMA11-2 section 3.3.7.2
 * also constrains the day of the month, which neither pattern does, so the
 * two functions check it and the published patterns leave it to them.
 * The badge worker holds these rules independently (workers/badge/verify.mjs
 * and worker.mjs).
 */

// The dateTimeStamp lexical grammar: a dateTime whose timezone is required.
// VC Data Integrity 1.0, section 2.1, requires proof.created to be one, and
// lets a processor accept a value written without an offset, read as UTC;
// this one does not. EdDSA Cryptosuites v1.0, section 3.3.5 step 3, requires
// an error for a value that is not a valid datetime.
export const DATE_TIME_STAMP_RE =
  /^-?([1-9][0-9]{3,}|0[0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?|24:00:00(?:\.0+)?)(?:Z|[+-](?:(?:0[0-9]|1[0-3]):[0-5][0-9]|14:00))$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Is `value` an [XMLSCHEMA11-2] dateTimeStamp: the lexical pattern, on a
 * day its month has (February 29 only in a leap year)? */
export function isDateTimeStamp(value) {
  const match = typeof value === "string" ? DATE_TIME_STAMP_RE.exec(value) : null;
  if (match === null) return false;
  const [, year, month, day] = match;
  // Leap years repeat every 400 years, and 400 divides 10000: the last four
  // digits decide, whatever the year's length or sign.
  const lastFour = Number(year.slice(-4));
  const leap = lastFour % 4 === 0 && (lastFour % 100 !== 0 || lastFour % 400 === 0);
  return Number(day) <= (month === "02" && leap ? 29 : DAYS_IN_MONTH[Number(month) - 1]);
}

// The program's own timestamp, lexically: the dateTimeStamp grammar above with
// a four-digit year, whole seconds and Z alone.
export const PROGRAM_TIMESTAMP_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T(([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]|24:00:00)Z$/;

/** Is `value` the program's own timestamp, YYYY-MM-DDThh:mm:ssZ: a
 * dateTimeStamp in UTC to the second, on a day its month has? */
export const isProgramTimestamp = (value) => PROGRAM_TIMESTAMP_RE.test(value) && isDateTimeStamp(value);

// The clock skew a verifier allows a validFrom ahead of its own clock: 300s,
// the badge worker's too (pinned equal in workers/badge/parity.test.mjs).
export const CLOCK_SKEW_MS = 300_000;

/**
 * Is a validFrom at `validFromMs` beyond the clock skew ahead of `nowMs`?
 * It is from exactly CLOCK_SKEW_MS ahead on, where Digital Bazaar's verifier
 * draws the same line; a validFrom that does not parse (NaN) is not, and the
 * program's timestamp rule refuses it.
 */
export const beyondSkew = (validFromMs, nowMs) => validFromMs >= nowMs + CLOCK_SKEW_MS;
