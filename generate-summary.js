#!/usr/bin/env node
// Reads one or more Playwright JSON result files → writes HTML to stdout
// Usage: node generate-summary.js <file1.json> [file2.json ...] >> $GITHUB_STEP_SUMMARY
// Env:   SUMMARY_LABEL  — section heading (default: "Test Results")

const fs = require('fs');

const LABEL = process.env.SUMMARY_LABEL || 'Test Results';

function fmtMs(ms) {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >=  1_000) return `${(ms /  1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function walk(suites, suitePath = '') {
  const tests = [];
  for (const suite of suites || []) {
    const path = suitePath ? `${suitePath} › ${suite.title}` : suite.title;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const result = (test.results || []).slice(-1)[0] || {};
        const status =
          result.status === 'passed'  ? 'passed'  :
          result.status === 'skipped' ? 'skipped' : 'failed';
        tests.push({
          suite:    path,
          title:    spec.title,
          project:  test.projectName || 'default',
          status,
          duration: result.duration || 0,
          error:    result.error?.message?.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 400) || '',
        });
      }
    }
    tests.push(...walk(suite.suites || [], path));
  }
  return tests;
}

const files = process.argv.slice(2);
if (!files.length) {
  process.stderr.write('Usage: node generate-summary.js <results.json> [...]\n');
  process.exit(1);
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

const passed  = allTests.filter(t => t.status === 'passed').length;
const failed  = allTests.filter(t => t.status === 'failed').length;
const skipped = allTests.filter(t => t.status === 'skipped').length;
const total   = allTests.length;
const totalMs = allTests.reduce((s, t) => s + t.duration, 0);
const icon    = failed > 0 ? '❌' : total === 0 ? '⚠️' : '✅';

function statusCell(status) {
  return status === 'passed'  ? '✅' :
         status === 'skipped' ? '⏭️' : '❌';
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Group tests by project
const byProject = new Map();
for (const t of allTests) {
  if (!byProject.has(t.project)) byProject.set(t.project, []);
  byProject.get(t.project).push(t);
}

let rows = '';
for (const [project, tests] of byProject) {
  const pp = tests.filter(t => t.status === 'passed').length;
  const pf = tests.filter(t => t.status === 'failed').length;
  const pt = tests.length;
  const pm = tests.reduce((s, t) => s + t.duration, 0);
  const badge = pf > 0 ? `❌ ${pf} failed` : `✅ all passed`;

  rows += `
<tr>
  <td colspan="4" style="background:#0d1b2a;padding:10px 14px;font-size:13px;font-weight:700;border-top:2px solid #1e3a5f;border-bottom:1px solid #1e3a5f">
    📦 &nbsp;${esc(project)} &emsp;
    <span style="font-weight:400;font-size:11px;color:#94a3b8">${badge} &nbsp;·&nbsp; ${pp}/${pt} &nbsp;·&nbsp; ${fmtMs(pm)}</span>
  </td>
</tr>`;

  // Group by suite within project
  const bySuite = new Map();
  for (const t of tests) {
    if (!bySuite.has(t.suite)) bySuite.set(t.suite, []);
    bySuite.get(t.suite).push(t);
  }

  for (const [suite, sTests] of bySuite) {
    const suiteName = suite.replace(/^.*tests\/e2e\/|^.*tests\//, '').replace(/\.e2e\.spec\.ts|\.spec\.ts/, '');
    rows += `
<tr>
  <td colspan="4" style="padding:6px 14px 4px 28px;font-size:11px;color:#475569;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid #0f1929">
    ${esc(suiteName)}
  </td>
</tr>`;

    for (const t of sTests) {
      const durColor = t.status === 'failed'  ? '#f87171' :
                       t.status === 'skipped' ? '#94a3b8' : '#34d399';
      const errorHtml = t.error ? `
        <br/>
        <details>
          <summary style="color:#f87171;font-size:11px;cursor:pointer;margin-top:4px">▶ Show error</summary>
          <pre style="font-size:10px;color:#fca5a5;white-space:pre-wrap;margin-top:6px;padding:8px;background:#1a0a0a;border-radius:4px;border:1px solid #3a1515">${esc(t.error)}</pre>
        </details>` : '';

      rows += `
<tr style="border-bottom:1px solid #0f1929">
  <td style="text-align:center;padding:7px 14px;font-size:15px;vertical-align:top">${statusCell(t.status)}</td>
  <td style="padding:7px 14px;font-size:12px;color:#64748b;vertical-align:top;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.suite)}">${esc(t.suite.split(' › ').slice(-2).join(' › '))}</td>
  <td style="padding:7px 14px;font-size:12px;vertical-align:top">${esc(t.title)}${errorHtml}</td>
  <td style="padding:7px 14px;font-size:12px;text-align:right;font-family:monospace;color:${durColor};vertical-align:top;white-space:nowrap">${fmtMs(t.duration)}</td>
</tr>`;
    }
  }
}

const passPct = total ? Math.round((passed / total) * 100) : 0;

const html = `
<h2>${icon} ${esc(LABEL)}</h2>

<table>
<tr>
  <td>🧪 <strong>${total}</strong> total</td>
  <td>✅ <strong>${passed}</strong> passed</td>
  <td>❌ <strong>${failed}</strong> failed</td>
  <td>⏭️ <strong>${skipped}</strong> skipped</td>
  <td>⏱ <strong>${fmtMs(totalMs)}</strong></td>
  <td>📈 <strong>${passPct}%</strong> pass rate</td>
</tr>
</table>

<table style="width:100%;border-collapse:collapse;margin-top:16px;font-family:system-ui,sans-serif">
<thead>
<tr style="background:#0d1b2a;border-bottom:2px solid #1e3a5f">
  <th style="padding:9px 14px;text-align:center;width:44px">Status</th>
  <th style="padding:9px 14px;text-align:left;width:30%">Suite</th>
  <th style="padding:9px 14px;text-align:left">Test Name</th>
  <th style="padding:9px 14px;text-align:right;width:80px">Duration</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>

`;

process.stdout.write(html);
