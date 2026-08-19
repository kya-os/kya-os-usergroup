/**
 * Run the pinned conformance vectors through YOUR adapter and write report.json.
 *
 * Uses the FETCHED harness (suite/loader.ts + suite/runner.ts, pinned and
 * hash-verified by scripts/fetch-suite.mjs) so the vector validation and report
 * shape are exactly the published ones, not a local fork.
 *
 * Exit codes: 0 = every vector matched, 1 = mismatches (report still written),
 * 2 = suite not fetched.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVectors } from '../suite/loader.js';
import { formatReport, runConformance } from '../suite/runner.js';
import { StarterAdapter } from './adapter.js';

// Compiled location is dist/src/run.js, so the repo root is two levels up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VECTORS_DIR = join(ROOT, 'suite', 'vectors');
const REPORT_PATH = join(ROOT, 'report.json');

async function main(): Promise<void> {
  if (!existsSync(VECTORS_DIR)) {
    console.error(`No fetched suite at ${VECTORS_DIR}. Run \`npm run fetch-suite\` first.`);
    process.exit(2);
  }

  const vectors = loadVectors(VECTORS_DIR);
  const report = await runConformance(new StarterAdapter(), vectors);

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(formatReport(report));
  console.log('');
  console.log(`Report written to ${REPORT_PATH}`);
  if (!report.allMatched) {
    console.log('Mismatches above. If the adapter is still stubbed, implement src/adapter.ts.');
  }

  process.exit(report.allMatched ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`Harness error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
