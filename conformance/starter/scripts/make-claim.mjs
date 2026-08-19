#!/usr/bin/env node
/**
 * Generate claim.json (kya-os-conformance-claim@v1) from:
 *   - report.json           the harness output (TS runner or your own harness,
 *                           matching examples/report.contract.md exactly)
 *   - suite/manifest.json   what fetch-suite pinned and hash-verified
 *   - package.json          implementation name/version (override with flags)
 *   - git                   HEAD commit + clean-tree check + origin URL
 *
 * The conformance program attests exactly the bytes it re-runs at your pinned
 * commit, so this script REFUSES to emit a claim that could not be honestly
 * re-run: a failing or malformed report, a dirty working tree, a full-scope
 * claim that did not run every category, or placeholder metadata.
 *
 * Usage:
 *   node scripts/make-claim.mjs --subject https://example.com --level L2
 *   node scripts/make-claim.mjs --subject did:web:example.com --level L3 --scope subset
 *
 * Flags (env fallbacks in parentheses):
 *   --subject (CLAIM_SUBJECT)  https URL or DID identifying who claims conformance  [required]
 *   --level   (CLAIM_LEVEL)    L1 | L2 | L3, per CONFORMANCE.md                     [required]
 *   --scope   (CLAIM_SCOPE)    full | subset; default: derived from the report
 *   --name / --version / --repo  override implementation metadata
 *   --report / --out             paths (default report.json / claim.json)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLAIM_TYPE = 'kya-os-conformance-claim@v1';
const LEVELS = ['L1', 'L2', 'L3'];
const SCOPES = ['full', 'subset'];
const PLACEHOLDER_NAME = 'kya-os-conformance-starter';

function refuse(message) {
  console.error(`refusing to emit a claim: ${message}`);
  process.exit(1);
}

function readJson(path, hint) {
  if (!existsSync(path)) refuse(`${path} not found. ${hint}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    refuse(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/**
 * Enforce the published report contract (examples/report.contract.md), which is
 * exactly what the fetched suite/runner.ts emits. A bring-your-own-harness
 * report must match it field for field.
 */
function validateReport(report) {
  if (typeof report !== 'object' || report === null) refuse('report is not an object');
  if (typeof report.adapter !== 'string' || report.adapter.length === 0) {
    refuse('report.adapter must be a non-empty string');
  }
  if (!Array.isArray(report.results) || report.results.length === 0) {
    refuse('report.results must be a non-empty array');
  }
  const seenIds = new Set();
  for (const r of report.results) {
    if (typeof r !== 'object' || r === null) refuse('a report result is not an object');
    for (const field of ['id', 'category', 'description']) {
      if (typeof r[field] !== 'string' || r[field].length === 0) {
        refuse(`result ${JSON.stringify(r.id ?? '?')} is missing string "${field}"`);
      }
    }
    if (r.expected !== 'pass' && r.expected !== 'fail') {
      refuse(`result ${r.id} has invalid "expected": ${String(r.expected)}`);
    }
    if (r.actual !== 'pass' && r.actual !== 'fail' && r.actual !== 'error') {
      refuse(`result ${r.id} has invalid "actual": ${String(r.actual)}`);
    }
    if (typeof r.ok !== 'boolean' || r.ok !== (r.actual === r.expected)) {
      refuse(`result ${r.id} has "ok" inconsistent with expected/actual`);
    }
    if (r.detail !== undefined && typeof r.detail !== 'string') {
      refuse(`result ${r.id} has non-string "detail"`);
    }
    if (seenIds.has(r.id)) refuse(`duplicate vector id in report: ${r.id}`);
    seenIds.add(r.id);
  }
  const passed = report.results.filter((r) => r.ok).length;
  if (report.total !== report.results.length) refuse('report.total does not equal results.length');
  if (report.passed !== passed) refuse('report.passed does not equal the count of matching results');
  if (report.failed !== report.total - passed) refuse('report.failed is inconsistent');
  if (report.allMatched !== (report.failed === 0)) refuse('report.allMatched is inconsistent');
}

function resolveRepoUrl(flagValue, pkg) {
  if (flagValue) return flagValue;
  try {
    return git(['remote', 'get-url', 'origin']);
  } catch {
    // No origin remote; fall through to package.json.
  }
  const repository = pkg.repository;
  if (typeof repository === 'string' && repository.length > 0) return repository;
  if (typeof repository?.url === 'string' && repository.url.length > 0) return repository.url;
  return undefined;
}

const { values: args } = parseArgs({
  options: {
    subject: { type: 'string' },
    level: { type: 'string' },
    scope: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'string' },
    repo: { type: 'string' },
    report: { type: 'string', default: 'report.json' },
    out: { type: 'string', default: 'claim.json' },
  },
});

const subject = args.subject ?? process.env.CLAIM_SUBJECT;
const level = args.level ?? process.env.CLAIM_LEVEL;
const scopeArg = args.scope ?? process.env.CLAIM_SCOPE;

if (!subject) refuse('missing --subject (an https URL or DID identifying the claimant)');
if (!subject.startsWith('https://') && !subject.startsWith('did:')) {
  refuse(`subject must be an https URL or a DID, got: ${subject}`);
}
if (!level) refuse('missing --level (L1 | L2 | L3, per CONFORMANCE.md)');
if (!LEVELS.includes(level)) refuse(`level must be one of ${LEVELS.join(' | ')}, got: ${level}`);
if (scopeArg !== undefined && !SCOPES.includes(scopeArg)) {
  refuse(`scope must be one of ${SCOPES.join(' | ')}, got: ${scopeArg}`);
}

const manifest = readJson(join(ROOT, 'suite', 'manifest.json'), 'Run `npm run fetch-suite` first.');
const report = readJson(resolve(ROOT, args.report), 'Run the harness first (`npm run conformance`, or your own harness emitting the report contract).');
const pkg = readJson(join(ROOT, 'package.json'), 'This script must run inside the starter repo.');

validateReport(report);

if (!report.allMatched) {
  refuse(
    `the report does not fully match (${report.failed} of ${report.total} vectors mismatched). ` +
      'A claim attests a run in which every executed vector matched its expected outcome.',
  );
}

const suiteCategories = manifest.categories;
if (!Array.isArray(suiteCategories) || suiteCategories.length === 0) {
  refuse('suite/manifest.json has no categories; re-run `npm run fetch-suite`');
}
const ranCategories = [...new Set(report.results.map((r) => r.category))].sort();
const unknown = ranCategories.filter((c) => !suiteCategories.includes(c));
if (unknown.length > 0) {
  refuse(`report contains categories not in the pinned suite: ${unknown.join(', ')}`);
}
const missing = suiteCategories.filter((c) => !ranCategories.includes(c));
const derivedScope = missing.length === 0 ? 'full' : 'subset';
const scope = scopeArg ?? derivedScope;
if (scope === 'full' && missing.length > 0) {
  refuse(
    `scope=full but these suite categories were not run: ${missing.join(', ')}. ` +
      'Run the whole suite, or label the claim honestly with --scope subset.',
  );
}

const name = args.name ?? pkg.name;
const version = args.version ?? pkg.version;
if (!name || !version) refuse('package.json must carry the implementation name and version (or pass --name/--version)');
if (name === PLACEHOLDER_NAME && !args.name) {
  refuse(
    `package.json name is still the template placeholder "${PLACEHOLDER_NAME}". ` +
      'Set it to your implementation name (or pass --name).',
  );
}

const repoUrl = resolveRepoUrl(args.repo, pkg);
if (!repoUrl) {
  refuse('no repository URL found (git origin, package.json "repository", or --repo). The program re-runs your bytes; it needs to know where they live.');
}

let gitCommit;
try {
  gitCommit = git(['rev-parse', 'HEAD']);
} catch {
  refuse('not a git repository (or no commits). The claim pins the exact commit the program re-runs.');
}
const dirty = git(['status', '--porcelain']);
if (dirty.length > 0) {
  refuse(
    'the working tree is dirty. The claim attests the bytes at gitCommit; commit your changes first.\n' +
      dirty,
  );
}

const claim = {
  claim: CLAIM_TYPE,
  subject,
  implementation: {
    name,
    version,
    repo: repoUrl,
    digest: { gitCommit },
  },
  level,
  scope,
  categories: ranCategories,
  suite: {
    package: manifest.package,
    packageVersion: manifest.packageVersion,
    suiteVersion: manifest.suiteVersion,
    vectorSetHash: manifest.vectorSetHash,
  },
  report,
  ranAt: new Date().toISOString(),
};

const outPath = resolve(ROOT, args.out);
writeFileSync(outPath, `${JSON.stringify(claim, null, 2)}\n`);

console.log(`Wrote ${outPath}`);
console.log(`  claim:      ${claim.claim}`);
console.log(`  subject:    ${claim.subject}`);
console.log(`  impl:       ${name}@${version} (${repoUrl} @ ${gitCommit.slice(0, 12)})`);
console.log(`  level:      ${level}   scope: ${scope}`);
console.log(`  categories: ${ranCategories.join(', ')}`);
console.log(`  suite:      ${manifest.package}@${manifest.packageVersion} ${manifest.vectorSetHash}`);
console.log(`  report:     ${report.passed}/${report.total} matched (adapter: ${report.adapter})`);
console.log('');
console.log('Next: open the submission issue on decentralized-identity/kya-os-mcp and attach claim.json.');
console.log('Remember: the program attests only what it re-runs at your pinned commit; a subset claim is labeled a subset.');
