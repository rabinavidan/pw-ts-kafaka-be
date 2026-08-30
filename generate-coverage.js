#!/usr/bin/env node
// Aggregates one or more Playwright JSON result files into a pass-rate
// "coverage" summary: a shields.io endpoint badge JSON plus a per-layer
// breakdown, and gates on a minimum pass-rate threshold.
//
// Usage: node generate-coverage.js <file1.json> [file2.json ...] \
//          --out=dist/badges/tests.json --breakdown=dist/badges/coverage.json \
//          --threshold=100
//
// Exits non-zero if the overall pass rate (passed / (total - skipped)) is
// below --threshold, so this can be run as a CI gate step.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const flags = Object.fromEntries(
  args.filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  })
);

if (!files.length) {
  process.stderr.write('Usage: node generate-coverage.js <results.json> [...] [--out=path] [--breakdown=path] [--threshold=N]\n');
  process.exit(1);
}

const outFile        = flags.out ?? 'dist/badges/tests.json';
const breakdownFile  = flags.breakdown ?? 'dist/badges/coverage.json';
const threshold       = Number(flags.threshold ?? 100);

function walk(suites, project = null) {
  const tests = [];
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const result = (test.results || []).slice(-1)[0] || {};
        const status =
          result.status === 'passed'  ? 'passed'  :
          result.status === 'skipped' ? 'skipped' : 'failed';
        tests.push({ project: test.projectName || project || 'default', status });
      }
    }
    tests.push(...walk(suite.suites || [], project));
  }
  return tests;
}

let allTests = [];
for (const file of files) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    allTests.push(...walk(data.suites || []));
  } catch (e) {
    process.stderr.write(`Warning: could not read ${file}: ${e.message}\n`);
  }
}

function summarize(tests) {
  const total   = tests.length;
  const passed  = tests.filter(t => t.status === 'passed').length;
  const failed  = tests.filter(t => t.status === 'failed').length;
  const skipped = tests.filter(t => t.status === 'skipped').length;
  const executed = total - skipped;
  const passRate = executed > 0 ? (passed / executed) * 100 : 100;
  return { total, passed, failed, skipped, passRate: Math.round(passRate * 10) / 10 };
}

const overall = summarize(allTests);

const byLayer = {};
for (const t of allTests) {
  (byLayer[t.project] ??= []).push(t);
}
const layers = Object.fromEntries(
  Object.entries(byLayer).map(([name, tests]) => [name, summarize(tests)])
);

function badgeColor(rate) {
  if (rate >= 100) return 'brightgreen';
  if (rate >= 95)  return 'green';
  if (rate >= 90)  return 'yellow';
  if (rate >= 75)  return 'orange';
  return 'red';
}

const badge = {
  schemaVersion: 1,
  label: 'tests',
  message: overall.failed > 0
    ? `${overall.passed}/${overall.total} passing (${overall.passRate}%)`
    : `${overall.passed}/${overall.total} passing`,
  color: badgeColor(overall.passRate),
};

for (const f of [outFile, breakdownFile]) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
}
fs.writeFileSync(outFile, JSON.stringify(badge, null, 2));
fs.writeFileSync(breakdownFile, JSON.stringify({ generatedAt: new Date().toISOString(), overall, layers }, null, 2));

console.log(`Coverage: ${overall.passed}/${overall.total} passing (${overall.passRate}% of executed tests), threshold ${threshold}%`);
for (const [name, s] of Object.entries(layers)) {
  console.log(`  ${name}: ${s.passed}/${s.total} (${s.passRate}%)`);
}

if (overall.passRate < threshold) {
  console.error(`FAIL: pass rate ${overall.passRate}% is below threshold ${threshold}%`);
  process.exit(1);
}
