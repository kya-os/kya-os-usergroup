#!/usr/bin/env node
/**
 * Fetch the KYA-OS conformance suite at a pinned commit.
 *
 * The @kya-os/mcp npm tarball does NOT ship conformance/ (its files allowlist is
 * dist, schemas, and docs), so the suite is fetched straight from GitHub.
 * EVERY file is fetched at PINNED_COMMIT, the commit SHA the release tag
 * PINNED_REF resolved to when the pin was taken - tags can move, commit SHAs
 * cannot. Written to suite/:
 *
 *   suite/types.ts       the ConformanceAdapter contract
 *   suite/loader.ts      vector loader (shape validation, id dedupe)
 *   suite/runner.ts      runConformance + report formatting
 *   suite/verify.py      the pure-stdlib Python cross-verifier (BYO-harness precedent)
 *   suite/vectors/*.json the committed vector files, byte-for-byte
 *   suite/manifest.json  what was fetched: ref, commit, versions, per-file
 *                        digests (vectors under `files`, harness under
 *                        `harness`), vectorSetHash
 *
 * Two integrity checks, both fail-loud:
 *   - Each downloaded harness file (the code you will EXECUTE) is verified
 *     against its pinned sha256 in EXPECTED_HARNESS_HASHES.
 *   - The vector-set hash is computed with the exact published recipe and
 *     verified against EXPECTED_VECTOR_SET_HASH. The printed hash is what
 *     you compare against the signed suite manifest for the release you pin.
 *
 * Vector-set hash recipe (implemented exactly, do not improvise; it covers
 * the vector files ONLY - harness digests live in manifest.harness and never
 * enter this recipe, which must keep matching the reference SUITE-MANIFEST):
 *   1. For each vector file, SHA-256 of the raw committed bytes.
 *   2. Build an array of [filename, hexdigest] pairs, sorted by filename.
 *   3. Canonicalize that array with RFC 8785 JCS.
 *   4. SHA-256 the JCS bytes; prefix "sha256:".
 *
 * Node builtins only: global fetch + node:crypto/node:fs/node:path.
 * Set GITHUB_TOKEN to raise the GitHub API rate limit (CI does this).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'decentralized-identity/kya-os-mcp';
const PINNED_REF = 'v1.14.1';
/**
 * The commit SHA that PINNED_REF resolved to when the pin was taken
 * (`git ls-remote` / the GitHub refs API). Every file is fetched at THIS
 * SHA, never at the tag: tags can be moved after the fact, commits cannot.
 */
const PINNED_COMMIT = '362924e308aaa9914f9cc2836c94e05ffd7370f9';
const SUITE_PACKAGE = '@kya-os/mcp';

/**
 * The vector-set hash of the suite at PINNED_COMMIT. When bumping the pin,
 * update PINNED_REF, PINNED_COMMIT, EXPECTED_VECTOR_SET_HASH, and
 * EXPECTED_HARNESS_HASHES together, and check the new vector-set hash
 * against the signed suite manifest for that release before trusting it.
 */
const EXPECTED_VECTOR_SET_HASH =
  'sha256:81d537d4574d3f66d651a03ca41c0b18493b67ea6f3e61aba47d1bda4f3cf49b';

/**
 * Harness files fetched alongside the vectors (all standalone: types-only or
 * node-builtin imports), each pinned to its sha256 at PINNED_COMMIT. These
 * are the files this starter EXECUTES, so each download is verified against
 * its pin and any drift fails loudly.
 */
const EXPECTED_HARNESS_HASHES = {
  'types.ts': '3c8bdfd024eebe660b985db764b7876963dcef8ca0204f2533dba1a8dce0a566',
  'loader.ts': 'af4a2c76e51df257c60872bcdde248e3123e3974625f7a285fe71504410bb76f',
  'runner.ts': '6a537c40cc78cdd035e7fbdf79c1b31379ba25a8cba7cd5c90709042efa4a248',
  'verify.py': 'aabb3429df7e66cecee82b962c62aa19cc60ffbbdfbdc1ec298f613af2f19eb7',
};
const HARNESS_FILES = Object.keys(EXPECTED_HARNESS_HASHES);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE_DIR = join(ROOT, 'suite');
const VECTORS_DIR = join(SUITE_DIR, 'vectors');

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * RFC 8785 (JCS) canonicalization, minimal on purpose. The value canonicalized
 * here is exactly an array of [string, string] pairs whose strings are ASCII
 * filenames and lowercase hex digests. For that narrow shape, JSON.stringify IS
 * the JCS form: JCS differs from compact JSON.stringify only in object key
 * ordering (no objects here), number formatting (no numbers here), and string
 * escaping of characters that these ASCII strings never contain. Arrays keep
 * their order in JCS, and we sort the pairs by filename before serializing.
 */
function jcsCanonicalizePairs(pairs) {
  return JSON.stringify(pairs);
}

function computeVectorSetHash(fileDigestPairs) {
  const sorted = [...fileDigestPairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const jcs = jcsCanonicalizePairs(sorted);
  return `sha256:${sha256Hex(Buffer.from(jcs, 'utf8'))}`;
}

async function fetchBytes(url, accept) {
  const headers = { 'user-agent': 'kya-os-conformance-starter' };
  if (accept) headers.accept = accept;
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${REPO}/${PINNED_COMMIT}/${path}`;
}

/** List conformance/vectors/*.json at the pinned commit (no filenames hardcoded; the hash is the pin). */
async function listVectorFileNames() {
  const url = `https://api.github.com/repos/${REPO}/contents/conformance/vectors?ref=${PINNED_COMMIT}`;
  const listing = JSON.parse((await fetchBytes(url, 'application/vnd.github+json')).toString('utf8'));
  if (!Array.isArray(listing)) {
    throw new Error(`Unexpected GitHub contents response for ${url}`);
  }
  const names = listing
    .filter((entry) => entry?.type === 'file' && typeof entry?.name === 'string' && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    throw new Error(`No vector files found at ${REPO}@${PINNED_COMMIT} conformance/vectors/`);
  }
  return names;
}

async function main() {
  console.log(`Fetching KYA-OS conformance suite: ${REPO} @ ${PINNED_REF} (commit ${PINNED_COMMIT})`);

  rmSync(SUITE_DIR, { recursive: true, force: true });
  mkdirSync(VECTORS_DIR, { recursive: true });

  const harnessDigestPairs = [];
  for (const file of HARNESS_FILES) {
    const bytes = await fetchBytes(rawUrl(`conformance/${file}`));
    const digest = sha256Hex(bytes);
    if (digest !== EXPECTED_HARNESS_HASHES[file]) {
      throw new Error(
        `Harness file ${file} sha256 mismatch:\n  expected: ${EXPECTED_HARNESS_HASHES[file]}\n  computed: ${digest}\n` +
          'The fetched harness is not the byte-identical harness this starter pins. Refusing to write executable code that drifted from its pin.',
      );
    }
    writeFileSync(join(SUITE_DIR, file), bytes);
    harnessDigestPairs.push([file, digest]);
    console.log(`  suite/${file} (${bytes.length} bytes, sha256 verified)`);
  }

  const vectorNames = await listVectorFileNames();
  const fileDigestPairs = [];
  const categories = [];
  const vectorFormatVersions = new Set();
  let vectorCount = 0;

  for (const name of vectorNames) {
    const bytes = await fetchBytes(rawUrl(`conformance/vectors/${name}`));
    writeFileSync(join(VECTORS_DIR, name), bytes);
    fileDigestPairs.push([name, sha256Hex(bytes)]);

    const parsed = JSON.parse(bytes.toString('utf8'));
    if (typeof parsed?.category !== 'string' || typeof parsed?.version !== 'string' || !Array.isArray(parsed?.vectors)) {
      throw new Error(`Vector file ${name} does not match the published VectorFile shape`);
    }
    categories.push(parsed.category);
    vectorFormatVersions.add(parsed.version);
    vectorCount += parsed.vectors.length;
    console.log(`  suite/vectors/${name} (${parsed.category}, ${parsed.vectors.length} vectors)`);
  }

  if (vectorFormatVersions.size !== 1) {
    throw new Error(`Vector files disagree on format version: ${[...vectorFormatVersions].join(', ')}`);
  }
  const suiteVersion = [...vectorFormatVersions][0];

  const packageJson = JSON.parse((await fetchBytes(rawUrl('package.json'))).toString('utf8'));
  if (packageJson.name !== SUITE_PACKAGE) {
    throw new Error(`Pinned ref package is ${packageJson.name}, expected ${SUITE_PACKAGE}`);
  }

  const vectorSetHash = computeVectorSetHash(fileDigestPairs);

  const manifest = {
    repo: REPO,
    ref: PINNED_REF,
    commit: PINNED_COMMIT,
    package: SUITE_PACKAGE,
    packageVersion: packageJson.version,
    suiteVersion,
    categories: [...categories].sort(),
    vectorCount,
    // `files` is the VECTOR files only - it is the input to the vector-set
    // hash recipe and must keep matching the reference SUITE-MANIFEST.
    // Harness digests live in the separate `harness` array below.
    files: [...fileDigestPairs].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    harness: [...harnessDigestPairs].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    vectorSetHash,
    fetchedAt: new Date().toISOString(),
  };
  writeFileSync(join(SUITE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log('');
  console.log(`Suite: ${SUITE_PACKAGE}@${packageJson.version} (vector format ${suiteVersion})`);
  console.log(`Categories (${categories.length}): ${manifest.categories.join(', ')}`);
  console.log(`Vectors: ${vectorCount} across ${vectorNames.length} files`);
  console.log(`vectorSetHash: ${vectorSetHash}`);
  console.log('Compare this hash against the signed suite manifest for the pinned release.');

  if (vectorSetHash !== EXPECTED_VECTOR_SET_HASH) {
    console.error('');
    console.error(`ERROR: vector-set hash mismatch.`);
    console.error(`  expected: ${EXPECTED_VECTOR_SET_HASH}`);
    console.error(`  computed: ${vectorSetHash}`);
    console.error('The fetched suite is not the byte-identical suite this starter pins.');
    console.error('If you intentionally bumped the pin, update PINNED_REF, PINNED_COMMIT, EXPECTED_VECTOR_SET_HASH, and EXPECTED_HARNESS_HASHES together after checking the signed suite manifest.');
    process.exit(1);
  }

  console.log('Vector-set hash verified against the pinned expectation.');
}

main().catch((error) => {
  console.error(`fetch-suite failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
