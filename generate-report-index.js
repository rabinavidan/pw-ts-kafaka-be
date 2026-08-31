#!/usr/bin/env node
// Generates dist/reports/index.html — the "Live test report" landing page
// linking each layer's Playwright HTML report, using the coverage
// breakdown produced by generate-coverage.js.
//
// Usage: node generate-report-index.js <coverage.json> <outFile>

const fs = require('fs');
const path = require('path');

const [, , coverageFile, outFile] = process.argv;
if (!coverageFile || !outFile) {
  process.stderr.write('Usage: node generate-report-index.js <coverage.json> <outFile>\n');
  process.exit(1);
}

let coverage = { overall: { total: 0, passed: 0, failed: 0, passRate: 0 }, layers: {} };
try {
  coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
} catch (e) {
  process.stderr.write(`Warning: could not read ${coverageFile}: ${e.message}\n`);
}

const REPORTS = [
  { dir: 'be',            label: 'Backend',        desc: 'API · Kafka · Integration' },
  { dir: 'microservices', label: 'Microservices',   desc: 'Gateway + orders/payments/events/notifications, idempotency, DLQ, contracts' },
  { dir: 'db',            label: 'DB Layer',        desc: 'Direct PostgreSQL tests' },
  { dir: 'e2e',           label: 'E2E (UI)',        desc: 'Orders & Payments dashboard flows' },
  { dir: 'ui-smoke',      label: 'UI Smoke',        desc: 'Dashboard smoke checks' },
];

const { overall } = coverage;
const statusColor = overall.failed > 0 ? '#f85149' : '#3fb950';

function escape(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

const rows = REPORTS.map(r => {
  const layerKeys = Object.keys(coverage.layers || {}).filter(k =>
    r.dir === 'e2e' ? k.startsWith('e2e-') : k === r.dir || (r.dir === 'be' && ['api', 'kafka', 'integration'].includes(k))
  );
  const merged = layerKeys.reduce((acc, k) => {
    const s = coverage.layers[k];
    acc.total += s.total; acc.passed += s.passed; acc.failed += s.failed;
    return acc;
  }, { total: 0, passed: 0, failed: 0 });
  const stat = merged.total > 0 ? `${merged.passed}/${merged.total} passing` : '—';
  return `
    <a class="card" href="./${r.dir}/">
      <div class="card-title">${escape(r.label)}</div>
      <div class="card-desc">${escape(r.desc)}</div>
      <div class="card-stat" style="color:${merged.failed > 0 ? '#f85149' : '#3fb950'}">${escape(stat)}</div>
    </a>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Live Test Report — Playwright Kafka Microservices</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 24px; min-height: 100vh;
    background: #0d1117; color: #e6edf3;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  .sub { color: #8b949e; margin: 0 0 28px; }
  .summary {
    display: flex; align-items: center; gap: 10px;
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 14px 18px; margin-bottom: 28px; font-size: 15px;
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: ${statusColor}; flex-shrink: 0; }
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px;
  }
  .card {
    display: block; text-decoration: none; color: inherit;
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 16px 18px; transition: border-color .15s;
  }
  .card:hover { border-color: #58a6ff; }
  .card-title { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
  .card-desc { color: #8b949e; font-size: 12.5px; margin-bottom: 12px; }
  .card-stat { font-size: 13px; font-weight: 600; }
  footer { margin-top: 36px; color: #6e7681; font-size: 12.5px; }
  a.plain { color: #58a6ff; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Live Test Report</h1>
    <p class="sub">Playwright HTML reports from the latest CI run on <code>main</code>.</p>

    <div class="summary">
      <span class="dot"></span>
      <span>${escape(overall.passed)}/${escape(overall.total)} tests passing across ${REPORTS.length} layers${overall.failed > 0 ? ` — ${escape(overall.failed)} failing` : ''}</span>
    </div>

    <div class="grid">
${rows}
    </div>

    <footer>
      Generated on every push to <code>main</code> by
      <a class="plain" href="https://github.com/rabinavidan/playwright-kafka-microservices/actions/workflows/ci.yml">ci.yml</a>.
      Also see the single-file <a class="plain" href="./test-report.html">pretty backend report</a>.
    </footer>
  </div>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
console.log(`Wrote ${outFile}`);
