#!/usr/bin/env node
/**
 * Fetch the KYA-OS conformance suite at a pinned ref.
 *
 * The @kya-os/mcp npm tarball does NOT ship conformance/ (its files allowlist is
 * dist, schemas, and docs), so the suite is fetched straight from GitHub at
 * PINNED_REF and written to suite/:
 *
 *   suite/types.ts       the ConformanceAdapter contract
 *   suite/loader.ts      vector loader (shape validation, id dedupe)
 *   suite/runner.ts      runConformance + report formatting
 *   suite/verify.py      the pure-stdlib Python cross-verifier (BYO-harness precedent)
 *   suite/vectors/*.json the committed vector files, byte-for-byte
 *   suite/manifest.json  what was fetched: ref, versions, per-file digests, vectorSetHash
 *
 * It then computes the vector-set hash with the exact published recipe and
 * verifies it against EXPECTED_VECTOR_SET_HASH, so a tampered or drifted
 * download fails loudly. The printed hash is what you compare against the
 * signed suite manifest for the release you pin.
 *
 * Vector-set hash recipe (implemented exactly, do not improvise):
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
const SUITE_PACKAGE = '@kya-os/mcp';

/**
 * The vector-set hash of the suite at PINNED_REF. Update BOTH constants
 * together when bumping the pin, and check the new value against the signed
 * suite manifest for that release before trusting it.
 */
const EXPECTED_VECTOR_SET_HASH =
  'sha256:81d537d4574d3f66d651a03ca41c0b18493b67ea6f3e61aba47d1bda4f3cf49b';

/** Harness files fetched alongside the vectors (all standalone: types-only or node-builtin imports). */
const HARNESS_FILES = ['types.ts', 'loader.ts', 'runner.ts', 'verify.py'];

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
  return `https://raw.githubusercontent.com/${REPO}/${PINNED_REF}/${path}`;
}

/** List conformance/vectors/*.json at the pinned ref (no filenames hardcoded; the hash is the pin). */
async function listVectorFileNames() {
  const url = `https://api.github.com/repos/${REPO}/contents/conformance/vectors?ref=${PINNED_REF}`;
  const listing = JSON.parse((await fetchBytes(url, 'application/vnd.github+json')).toString('utf8'));
  if (!Array.isArray(listing)) {
    throw new Error(`Unexpected GitHub contents response for ${url}`);
  }
  const names = listing
    .filter((entry) => entry?.type === 'file' && typeof entry?.name === 'string' && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    throw new Error(`No vector files found at ${REPO}@${PINNED_REF} conformance/vectors/`);
  }
  return names;
}

async function main() {
  console.log(`Fetching KYA-OS conformance suite: ${REPO} @ ${PINNED_REF}`);

  rmSync(SUITE_DIR, { recursive: true, force: true });
  mkdirSync(VECTORS_DIR, { recursive: true });

  for (const file of HARNESS_FILES) {
    const bytes = await fetchBytes(rawUrl(`conformance/${file}`));
    writeFileSync(join(SUITE_DIR, file), bytes);
    console.log(`  suite/${file} (${bytes.length} bytes)`);
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
    package: SUITE_PACKAGE,
    packageVersion: packageJson.version,
    suiteVersion,
    categories: [...categories].sort(),
    vectorCount,
    files: [...fileDigestPairs].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
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
    console.error('If you intentionally bumped PINNED_REF, update EXPECTED_VECTOR_SET_HASH after checking the signed suite manifest.');
    process.exit(1);
  }

  console.log('Vector-set hash verified against the pinned expectation.');
}

main().catch((error) => {
  console.error(`fetch-suite failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
