/**
 * The public verifier's verdict on one credential, the one
 * scripts/verify-credential.mjs prints (its header says what each check
 * holds): schema, proof, then status, fail-closed at every step. It reads
 * nothing itself and takes the time as `now`: the command line hands it its
 * loaders, the key file and this machine's clock, and the tests their own
 * documents and clock.
 */
import { decodeStatusList, statusBitAt, verifyCredential } from "./attest.mjs";
import { beyondSkew } from "./datetime.mjs";
import { checkCredentialShape, checkStatusListShape } from "./shape.mjs";

/** Does `document`'s validFrom sit beyond the clock skew ahead of `now`? The one skew rule (datetime.mjs), for the credential and both status lists alike. */
const validFromBeyondSkew = (document, now) => beyondSkew(Date.parse(document?.validFrom ?? ""), now);

/**
 * The committed key that `document`'s proof names, for `purpose`; throws,
 * naming `label`, when it names none.
 */
function keyFor(keys, document, purpose, label) {
  const fragment = String(document?.proof?.verificationMethod ?? "").split("#")[1];
  const key = keys.find((candidate) => candidate.id === fragment);
  if (key === undefined || key.purpose !== purpose) {
    throw new Error(`${label}: proof.verificationMethod does not name a committed "${purpose}" key (got "${fragment ?? "none"}")`);
  }
  return key;
}

/**
 * @param {object} sources
 * @param {() => Promise<unknown>} sources.loadCredential reads the
 *   credential; what it throws is the schema check's one error
 * @param {{ provisioned: boolean, keys: object[], errors: string[] }} sources.programKeys
 *   the program key file, as readProgramKeys (keys.mjs) reads it
 * @param {(entry: object) => Promise<unknown>} sources.loadStatusList reads
 *   the status list a credentialStatus entry names
 * @param {number} sources.now the time each validFrom is held to, in
 *   milliseconds since the epoch
 * @returns {Promise<{ verdict: "VERIFIED" | "SUSPENDED" | "REVOKED" | "INVALID", checks: object, credential: unknown }>}
 *   the credential is null when it could not be read
 */
export async function credentialVerdict({ loadCredential, programKeys, loadStatusList, now }) {
  const checks = { schema: { ok: false }, proof: { ok: false }, status: { ok: false } };
  let credential = null;
  const answer = (verdict) => ({ verdict, checks, credential });
  try {
    credential = await loadCredential();
  } catch (err) {
    checks.schema.errors = [err.message];
    return answer("INVALID");
  }

  // ── keys: the committed trust root, refusing the sentinel ─────────────────
  if (!programKeys.provisioned) {
    checks.proof.reason =
      programKeys.errors.length > 0
        ? `program key file is unusable: ${programKeys.errors.join("; ")}`
        : "program keys are unprovisioned (the committed sentinel) - nothing can verify yet";
    return answer("INVALID");
  }

  // ── schema ────────────────────────────────────────────────────────────────
  const schemaErrors = checkCredentialShape(credential, "credential");
  if (credential?.proof === undefined) schemaErrors.push("credential: proof is missing");
  if (validFromBeyondSkew(credential, now)) schemaErrors.push("credential: validFrom is 300s or more in the future, beyond the clock skew");
  if (schemaErrors.length > 0) {
    checks.schema.errors = schemaErrors;
    return answer("INVALID");
  }
  checks.schema.ok = true;

  // ── proof ─────────────────────────────────────────────────────────────────
  try {
    const issuerKey = keyFor(programKeys.keys, credential, "issuer", "credential");
    const { ok, reason } = verifyCredential(credential, issuerKey.publicKeyMultibase);
    if (!ok) {
      checks.proof.reason = reason;
      return answer("INVALID");
    }
    checks.proof.ok = true;
    checks.proof.verificationMethod = credential.proof.verificationMethod;
  } catch (err) {
    checks.proof.reason = err.message;
    return answer("INVALID");
  }

  // ── status: both lists, proof-verified before any bit is read ─────────────
  try {
    const bits = {};
    for (const entry of credential.credentialStatus) {
      const list = await loadStatusList(entry);
      const listErrors = checkStatusListShape(list, entry.statusPurpose, `${entry.statusPurpose} list`);
      if (validFromBeyondSkew(list, now)) listErrors.push(`${entry.statusPurpose} list: validFrom is 300s or more in the future, beyond the clock skew`);
      if (listErrors.length > 0) throw new Error(listErrors.join("; "));
      const statusKey = keyFor(programKeys.keys, list, "status", `${entry.statusPurpose} list`);
      const { ok, reason } = verifyCredential(list, statusKey.publicKeyMultibase);
      if (!ok) throw new Error(`${entry.statusPurpose} list proof did not verify (${reason})`);
      bits[entry.statusPurpose] = statusBitAt(decodeStatusList(list.credentialSubject.encodedList), Number(entry.statusListIndex));
    }
    checks.status.ok = true;
    checks.status.revoked = bits.revocation === true;
    checks.status.suspended = bits.suspension === true;
  } catch (err) {
    checks.status.reason = err.message;
    return answer("INVALID");
  }
  if (checks.status.revoked) return answer("REVOKED");
  if (checks.status.suspended) return answer("SUSPENDED");
  return answer("VERIFIED");
}
