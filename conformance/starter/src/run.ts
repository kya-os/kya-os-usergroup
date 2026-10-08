/**
 * Run the pinned conformance vectors through YOUR adapter and write report.json.
 *
 * Uses the FETCHED harness (suite/loader.ts + suite/runner.ts), which
 * scripts/fetch-suite.mjs downloads at a pinned commit SHA and verifies
 * file-by-file against pinned sha256 hashes before writing, so the vector
 * validation and report shape are exactly the published ones, not a local
 * fork and not whatever a moved tag now points at.
 *
 * A category whose adapter method is still the NotImplementedError stub is
 * left out of the report and listed as skipped, so implementing only the
 * categories you cover yields a subset report, which `npm run claim` labels
 * as one. A method that answers any vector is reported in full: a
 * NotImplementedError it throws for other inputs counts as a mismatch.
 *
 * Exit codes: 0 = every reported vector matched, 1 = mismatches (report still
 * written), 2 = suite not fetched or harness error, 3 = no method implemented.
 * Every run deletes report.json first, so an exit that writes no report leaves
 * none behind for `npm run claim` to pick up.
 */

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVectors } from '../suite/loader.js';
import { formatReport, runConformance, type ConformanceReport } from '../suite/runner.js';
import type { ConformanceAdapter, ConformanceVector } from '../suite/types.js';
import { StarterAdapter } from './adapter.js';

// Compiled location is dist/src/run.js, so the repo root is two levels up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VECTORS_DIR = join(ROOT, 'suite', 'vectors');
const REPORT_PATH = join(ROOT, 'report.json');

/** The adapter method the runner calls for each category. */
const CATEGORY_METHOD = {
  'signed-proof': 'verifySignedProof',
  'delegation-chain': 'verifyDelegationChain',
  'status-list': 'verifyStatusList',
  'did-key-resolution': 'resolveDidKey',
  'did-web-resolution': 'resolveDidWeb',
  'card-proof': 'verifyCardProof',
  'entity-card': 'verifyEntityCard',
  'audit-integrity': 'verifyAuditIntegrity',
  negotiation: 'evaluateNegotiation',
} as const satisfies Record<ConformanceVector['category'], keyof ConformanceAdapter>;

/**
 * Wrap the adapter to record which methods only ever threw NotImplementedError.
 * Matched by name, so it works whether or not adapter.ts still defines the class.
 */
function trackStubs(adapter: ConformanceAdapter): {
  adapter: ConformanceAdapter;
  stubbedOnly: () => Set<string>;
} {
  const stubbed = new Set<string>();
  const answered = new Set<string>();
  const tracked = new Proxy(adapter, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const method = String(property);
        try {
          const result: unknown = await value.apply(target, args);
          answered.add(method);
          return result;
        } catch (error) {
          const stub = error instanceof Error && error.name === 'NotImplementedError';
          (stub ? stubbed : answered).add(method);
          throw error;
        }
      };
    },
  });
  return {
    adapter: tracked,
    stubbedOnly: () => new Set([...stubbed].filter((method) => !answered.has(method))),
  };
}

/** The report without the skipped categories, with its totals recomputed. */
function withoutCategories(report: ConformanceReport, skipped: ReadonlySet<string>): ConformanceReport {
  const results = report.results.filter((r) => !skipped.has(r.category));
  const passed = results.filter((r) => r.ok).length;
  return {
    ...report,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
    allMatched: passed === results.length,
  };
}

async function main(): Promise<void> {
  // report.json is gitignored, so a clean tree does not show it is stale.
  rmSync(REPORT_PATH, { force: true });

  if (!existsSync(VECTORS_DIR)) {
    console.error(`No fetched suite at ${VECTORS_DIR}. Run \`npm run fetch-suite\` first.`);
    process.exit(2);
  }

  const vectors = loadVectors(VECTORS_DIR);
  const { adapter, stubbedOnly } = trackStubs(new StarterAdapter());
  const full = await runConformance(adapter, vectors);

  const stubs = stubbedOnly();
  const categories = [...new Set(vectors.map((v) => v.category))];
  const skipped = categories.filter((c) => stubs.has(CATEGORY_METHOD[c]));
  const report = withoutCategories(full, new Set(skipped));

  if (report.total === 0) {
    console.error('No adapter method is implemented yet: every one still throws NotImplementedError.');
    console.error('Implement the methods in src/adapter.ts for the categories your implementation covers.');
    process.exit(3);
  }

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(formatReport(report));
  if (skipped.length > 0) {
    console.log('');
    console.log('Skipped, adapter method not implemented:');
    for (const category of skipped) console.log(`  - ${category} (${CATEGORY_METHOD[category]})`);
    console.log('This report covers a subset of the suite; `npm run claim` will label the claim a subset.');
  }
  console.log('');
  console.log(`Report written to ${REPORT_PATH}`);

  process.exit(report.allMatched ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`Harness error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
