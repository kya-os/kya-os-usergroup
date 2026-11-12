/**
 * The deploy preflight's checks and its verdict, for preflight.mjs (the
 * command line the deploy workflow runs) and its tests: this worker's own
 * checks (worker.mjs over verify.mjs) against the documents a fetch serves,
 * and the verdict on them, with no I/O of its own.
 *
 * Checks, each against the documents `fetchImpl` serves:
 *   - both status lists fetch and verify against the pinned status keys
 *   - every allowlist entry at status verified or revoked resolves to a
 *     badge state: its credential, the status bits it names, and its claim
 *     binding all pass, exactly as a badge request would
 * These are the documents the worker fetches; a superseded credential that
 * no allowlist entry names is not among them.
 */
import { STATUS_LIST_URLS, fetchVerifiedStatusList, resolveBadgeState } from "./worker.mjs";

/**
 * Run every check against the documents `fetchImpl` serves.
 * @returns {Promise<{ checked: string[], failures: string[] }>} one line per
 * check that passed and per check that failed, each naming what it checked.
 */
export async function preflight({ allowlist, issuerKeys, statusKeys, provisioned, fetchImpl }) {
  const checked = [];
  const failures = [];
  for (const purpose of Object.keys(STATUS_LIST_URLS)) {
    try {
      await fetchVerifiedStatusList(purpose, fetchImpl, statusKeys);
      checked.push(`${purpose} list: verified`);
    } catch (err) {
      failures.push(`${purpose} list: ${err.message}`);
    }
  }
  for (const [slug, entry] of Object.entries(allowlist)) {
    if (entry.status !== "verified" && entry.status !== "revoked") continue;
    try {
      const state = await resolveBadgeState(entry, { fetchImpl, issuerKeys, statusKeys, provisioned });
      checked.push(`${slug}: ${state.message}`);
    } catch (err) {
      failures.push(`${slug}: ${err.message}`);
    }
  }
  return { checked, failures };
}

const REFUSAL = 'refusing to deploy it (workers/badge/README.md, "Deploy order").';

/**
 * The verdict on a preflight's checks, as the command line prints it: a
 * line per check, then the verdict. It refuses (code 1) when any check
 * failed, and when no check ran at all, since a preflight that checked
 * nothing has verified nothing; otherwise it passes (code 0).
 * @returns {{ code: 0 | 1, out: string[], err: string[] }} the exit code,
 * and the lines for stdout and for stderr.
 */
export function verdict({ checked, failures }) {
  const out = checked.map((line) => `ok    ${line}`);
  const err = failures.map((line) => `FAIL  ${line}`);
  if (failures.length > 0) {
    return { code: 1, out, err: [...err, `The live documents do not verify under this worker - ${REFUSAL}`] };
  }
  if (checked.length === 0) {
    return { code: 1, out, err: [`No check ran, so nothing was verified: ${REFUSAL}`] };
  }
  const count = `${checked.length} check${checked.length === 1 ? "" : "s"}`;
  return { code: 0, out: [...out, `Both status lists and every allowlist entry at verified or revoked verify under this worker (${count}).`], err };
}
