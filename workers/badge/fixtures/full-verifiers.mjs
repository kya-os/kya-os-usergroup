/**
 * Both full verifiers on one world, for the tests where they meet: the
 * public verifier, scripts/verify-credential.mjs, run offline as a reader
 * runs it, and this worker's badge handler, each given the same credential
 * and the two status lists it names. The public verifier reads its keys
 * from a program key file, the committed one unless `keysFile` names
 * another; the worker is handed the same keys pinned.
 *
 * Each verifier's verdict is "accepted" or { refused: <its reason> }, and
 * assertVerdicts holds a refusal to the reason the test expects, so a world
 * meant to be refused for one rule fails its test when either verifier
 * refuses it for another.
 *
 * Given a time, `now`, both verifiers hold the world to it: the public
 * verifier's command line with Date.now() answering `now` in its process,
 * and the worker in-process with Date mocked to it, so each reads `now`
 * where it reads the clock.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_ISSUER_KEYS, PINNED_STATUS_KEYS } from "../generated-keys.mjs";
import { STATUS_LIST_URLS, createBadgeHandler, resolveBadgeState } from "../worker.mjs";

const VERIFY_CREDENTIAL = fileURLToPath(new URL("../../../scripts/verify-credential.mjs", import.meta.url));

/** @typedef {"accepted" | { refused: string }} Verdict one verifier's verdict on a world, a refusal with its reason */

/** Each document of a world, keyed as the world holds it, with the name both verifiers give it in a refusal. */
export const DOCUMENT_NAMES = Object.freeze({ credential: "credential", revocation: "revocation list", suspension: "suspension list" });

/** Both verifiers accepting a world. */
export const ACCEPTED = Object.freeze({ cli: "accepted", worker: "accepted" });

/** Both verifiers refusing a world, the public verifier with a reason that holds the text `cli`, and the worker with one that holds `worker`. */
export const refusedFor = (cli, worker) => ({ cli: { refusedFor: cli }, worker: { refusedFor: worker } });

/** `verdict` for each of `worlds`, keyed as verdictsOnWorlds reports them. */
export const each = (worlds, verdict) => Object.fromEntries(Object.keys(worlds).map((label) => [label, verdict]));

/**
 * Asserts that `verdicts` (verdictsOnWorlds) are `expected` (label ->
 * ACCEPTED or refusedFor(...)), `message` naming the case. A refusal whose
 * reason holds the text expected stands for the expectation; any other
 * verdict is shown as it is, its whole reason included, so the failure says
 * what each verifier did instead.
 */
export function assertVerdicts(verdicts, expected, message) {
  const shown = (verdict, want) => (typeof want?.refusedFor === "string" && verdict.refused?.includes(want.refusedFor) ? want : verdict);
  const settled = Object.fromEntries(
    Object.entries(verdicts).map(([label, { cli, worker }]) => [label, { cli: shown(cli, expected[label]?.cli), worker: shown(worker, expected[label]?.worker) }]),
  );
  assert.deepEqual(settled, expected, message);
}

/** The public verifier's reason for INVALID: the errors or the reason of the check that refused it, the only check that carries any. */
const cliReason = ({ schema, proof, status }) => [schema.errors, proof.reason, status.reason].flat().filter((reason) => reason !== undefined).join("; ");

/** The worker's reason for the unverified badge: what resolveBadgeState throws on the same world, which the handler renders as that badge. */
async function workerReason(entry, dependencies) {
  try {
    await resolveBadgeState(entry, dependencies);
    return "none: resolveBadgeState resolved a state";
  } catch (err) {
    return err.message;
  }
}

/**
 * Both verdicts on one world: `world` holds the credential and the
 * revocation and suspension lists; `dir` is an empty folder for its files;
 * `entry` is the allowlist entry the badge at `slug` is served for; `now`,
 * when given, is the time both verifiers hold it to, Date already mocked to
 * it for the worker (verdictsOnWorlds).
 * @returns {Promise<{ cli: Verdict, worker: Verdict }>}
 * the public verifier refuses with INVALID, the worker with the unverified
 * badge.
 */
export async function bothVerdicts(world, { dir, slug, entry, issuerKeys, statusKeys, keysFile, now }) {
  const credentialFile = join(dir, entry.credentialUrl.split("/").at(-1));
  writeFileSync(credentialFile, JSON.stringify(world.credential));
  for (const purpose of ["revocation", "suspension"]) writeFileSync(join(dir, `${purpose}-1.json`), JSON.stringify(world[purpose]));
  const keys = keysFile === undefined ? [] : ["--keys", keysFile];
  // Given the time, the command line's process reads it from Date.now().
  const clock = now === undefined ? [] : ["--import", `data:text/javascript,${encodeURIComponent(`Date.now = () => ${now};`)}`];
  const cli = spawnSync(process.execPath, [...clock, VERIFY_CREDENTIAL, credentialFile, "--offline", "--status-dir", dir, ...keys], { encoding: "utf8" });

  const { verdict, checks } = JSON.parse(cli.stdout);

  const served = { [entry.credentialUrl]: world.credential, [STATUS_LIST_URLS.revocation]: world.revocation, [STATUS_LIST_URLS.suspension]: world.suspension };
  const fetchImpl = async (url) => (url in served ? new Response(JSON.stringify(served[url]), { status: 200 }) : new Response("not found", { status: 404 }));
  const dependencies = { issuerKeys, statusKeys, provisioned: true, fetchImpl };
  const handler = createBadgeHandler({ allowlist: { [slug]: entry }, ...dependencies });
  const badge = await (await handler(new Request(`https://builders.kya-os.org/badge/${slug}.json`))).json();
  return {
    cli: verdict === "INVALID" ? { refused: cliReason(checks) } : "accepted",
    worker: badge.message === "unverified" ? { refused: await workerReason(entry, dependencies) } : "accepted",
  };
}

/** A key file's entries for one purpose, as the worker pins them. */
const pinned = (programKeys, purpose) =>
  programKeys.filter((key) => key.purpose === purpose).map(({ id, publicKeyMultibase }) => ({ id, publicKeyMultibase }));

/**
 * Both verdicts on each of `worlds` (label -> world), for the badge at
 * `slug` with allowlist `entry`, every world in a folder of its own that
 * the test `t` removes when it ends. With `programKeys` (a program key
 * file's entries) both verifiers use those keys; without, the committed
 * ones. With `now` (milliseconds since the epoch) both verifiers hold each
 * world to that time, Date mocked to it until the last world is judged.
 * @returns {Promise<Record<string, { cli: Verdict, worker: Verdict }>>}
 */
export async function verdictsOnWorlds(t, worlds, { slug, entry, programKeys, now }) {
  const temp = mkdtempSync(join(tmpdir(), "kya-full-verifiers-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  let keys = { issuerKeys: PINNED_ISSUER_KEYS, statusKeys: PINNED_STATUS_KEYS };
  if (programKeys !== undefined) {
    const keysFile = join(temp, "program-keys.json");
    writeFileSync(keysFile, JSON.stringify({ version: 1, keys: programKeys }));
    keys = { issuerKeys: pinned(programKeys, "issuer"), statusKeys: pinned(programKeys, "status"), keysFile };
  }
  if (now !== undefined) t.mock.timers.enable({ apis: ["Date"], now });
  try {
    const verdicts = {};
    for (const [label, world] of Object.entries(worlds)) {
      verdicts[label] = await bothVerdicts(world, { dir: mkdtempSync(join(temp, "world-")), slug, entry, ...keys, now });
    }
    return verdicts;
  } finally {
    if (now !== undefined) t.mock.timers.reset();
  }
}
