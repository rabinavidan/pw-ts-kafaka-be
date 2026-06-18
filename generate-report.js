#!/usr/bin/env node
// Reads test-results/results.json → generates test-report.html
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'test-results', 'results.json');
if (!fs.existsSync(src)) {
  console.error('No test-results/results.json found. Run: npm test');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(src, 'utf8'));

// ── Extract tests ─────────────────────────────────────────────────
const projects = { api: [], kafka: [], integration: [] };
let runStart = Infinity, runEnd = 0;

function walk(suites, projectFilter) {
  for (const suite of suites || []) {
    if (suite.suites) walk(suite.suites, projectFilter);
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        if (projectFilter && test.projectName !== projectFilter) continue;
        const result = test.results?.[0] || {};
        const startMs = result.startTime ? new Date(result.startTime).getTime() : 0;
        if (startMs < runStart) runStart = startMs;
        const endMs = startMs + (result.duration || 0);
        if (endMs > runEnd) runEnd = endMs;
        const entry = {
          file:     suite.file || '',
          suite:    suite.title || '',
          title:    spec.title,
          status:   result.status || 'unknown',
          duration: result.duration || 0,
          project:  test.projectName,
          tags:     spec.tags || [],
        };
        if (projects[test.projectName]) projects[test.projectName].push(entry);
      }
    }
  }
}
walk(data.suites);

const allTests = [...projects.api, ...projects.kafka, ...projects.integration];
const total    = allTests.length;
const passed   = allTests.filter(t => t.status === 'passed').length;
const failed   = allTests.filter(t => t.status === 'failed').length;
const skipped  = total - passed - failed;
const runDate  = runStart < Infinity ? new Date(runStart) : new Date();
const totalMs  = runEnd - runStart;

function fmtMs(ms) {
  if (ms >= 60000) return `${(ms/60000).toFixed(1)}m`;
  if (ms >= 1000)  return `${(ms/1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function groupBySuite(tests) {
  const map = new Map();
  for (const t of tests) {
    const key = t.suite || t.file;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return map;
}

function pct(n, d) { return d ? Math.round((n/d)*100) : 0; }

function tagBadge(tag) {
  const colors = { smoke: '#f59e0b', regression: '#8b5cf6', default: '#64748b' };
  const c = colors[tag] || colors.default;
  return `<span style="background:${c}22;color:${c};border:1px solid ${c}44;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase">${tag}</span>`;
}

function statusIcon(s) {
  if (s === 'passed')  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7.5" fill="#22c55e22" stroke="#22c55e"/><path d="M5 8l2.5 2.5L11 6" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (s === 'failed')  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7.5" fill="#ef444422" stroke="#ef4444"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7.5" fill="#94a3b822" stroke="#94a3b8"/><path d="M8 5v4M8 11v.5" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

function projectIcon(name) {
  const icons = {
    api:         `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    kafka:       `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
    integration: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
  };
  return icons[name] || icons.api;
}

function circleProgress(pct, color) {
  const r = 36, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return `
    <svg width="96" height="96" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r="${r}" fill="none" stroke="#1e293b" stroke-width="8"/>
      <circle cx="48" cy="48" r="${r}" fill="none" stroke="${color}" stroke-width="8"
        stroke-dasharray="${dash} ${circ}" stroke-dashoffset="${circ/4}"
        stroke-linecap="round"
        style="transition:stroke-dasharray 1s ease"/>
      <text x="48" y="48" text-anchor="middle" dy=".35em" fill="${color}" font-size="18" font-weight="700" font-family="system-ui">${pct}%</text>
    </svg>`;
}

function suiteBlock(tests, projectColor) {
  const groups = groupBySuite(tests);
  let html = '';
  for (const [suiteName, items] of groups) {
    const sp = items.filter(t => t.status === 'passed').length;
    const sf = items.filter(t => t.status === 'failed').length;
    const label = suiteName.replace('tests/', '').replace(/\.spec\.ts$/, '');
    html += `
    <div class="suite">
      <div class="suite-header" onclick="this.parentNode.classList.toggle('open')">
        <span class="suite-arrow">▶</span>
        <span class="suite-name">${label}</span>
        <span class="suite-meta">
          ${sf > 0 ? `<span class="badge fail">${sf} failed</span>` : ''}
          <span class="badge pass">${sp} passed</span>
        </span>
      </div>
      <div class="suite-body">
        ${items.map(t => `
        <div class="test-row ${t.status}">
          <span class="test-icon">${statusIcon(t.status)}</span>
          <span class="test-title">${t.title}</span>
          <span class="test-tags">${t.tags.map(tagBadge).join(' ')}</span>
          <span class="test-dur" style="color:${projectColor};">${fmtMs(t.duration)}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }
  return html;
}

const projectDefs = [
  { id: 'api',         label: 'REST API',      color: '#3b82f6', desc: 'HTTP endpoint contracts, status codes & payloads' },
  { id: 'kafka',       label: 'Kafka',          color: '#f59e0b', desc: 'Producer, consumer, DLQ & message-flow tests' },
  { id: 'integration', label: 'Integration',    color: '#a855f7', desc: 'End-to-end API → Kafka event pipeline tests' },
];

function projectCard(def) {
  const tests = projects[def.id];
  const p     = tests.filter(t => t.status === 'passed').length;
  const f     = tests.filter(t => t.status === 'failed').length;
  const pct_  = pct(p, tests.length);
  const totalDur = tests.reduce((s, t) => s + t.duration, 0);
  return `
  <div class="proj-card">
    <div class="proj-header" style="border-color:${def.color}22">
      <div class="proj-icon" style="color:${def.color};background:${def.color}11">${projectIcon(def.id)}</div>
      <div class="proj-meta">
        <div class="proj-label">${def.label}</div>
        <div class="proj-desc">${def.desc}</div>
      </div>
      ${circleProgress(pct_, def.color)}
    </div>
    <div class="proj-stats">
      <div class="stat"><span class="stat-n" style="color:#22c55e">${p}</span><span class="stat-l">Passed</span></div>
      <div class="stat"><span class="stat-n" style="color:#ef4444">${f}</span><span class="stat-l">Failed</span></div>
      <div class="stat"><span class="stat-n" style="color:#94a3b8">${tests.length}</span><span class="stat-l">Total</span></div>
      <div class="stat"><span class="stat-n" style="color:${def.color}">${fmtMs(totalDur)}</span><span class="stat-l">Duration</span></div>
    </div>
    ${suiteBlock(tests, def.color)}
  </div>`;
}

// ── Duration bar chart ────────────────────────────────────────────
const maxDur = Math.max(...allTests.map(t => t.duration), 1);
function durationBars() {
  const topSlow = [...allTests].sort((a,b)=>b.duration-a.duration).slice(0,10);
  return topSlow.map(t => {
    const w = Math.round((t.duration / maxDur) * 100);
    const pDef = projectDefs.find(p => p.id === t.project) || projectDefs[0];
    return `
    <div class="bar-row">
      <span class="bar-label" title="${t.title}">${t.title.length > 50 ? t.title.slice(0,49)+'…' : t.title}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width:${w}%;background:${pDef.color};"></div>
      </div>
      <span class="bar-dur">${fmtMs(t.duration)}</span>
    </div>`;
  }).join('');
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test Report — pw-ts-kafka-be</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #080f1c;
    --surface: #0f1929;
    --card: #111d2f;
    --border: #1e2d45;
    --text: #e2e8f0;
    --muted: #64748b;
    --green: #22c55e;
    --red: #ef4444;
    --amber: #f59e0b;
    --blue: #3b82f6;
    --purple: #a855f7;
  }
  html { scroll-behavior: smooth; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    min-height: 100vh;
  }

  /* ── Grid bg ─────────────────────────────────────── */
  body::before {
    content:'';
    position:fixed;inset:0;
    background-image:
      linear-gradient(rgba(59,130,246,.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(59,130,246,.04) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
    z-index: 0;
  }

  /* ── Header ──────────────────────────────────────── */
  .header {
    position: relative; z-index: 1;
    background: linear-gradient(135deg, #0f1929 0%, #0a1628 100%);
    border-bottom: 1px solid var(--border);
    padding: 40px 48px 32px;
  }
  .header-inner { max-width: 1200px; margin: 0 auto; }
  .breadcrumb { font-size: 12px; color: var(--muted); letter-spacing: .8px; text-transform: uppercase; margin-bottom: 12px; }
  .breadcrumb span { color: var(--blue); }
  h1 { font-size: 32px; font-weight: 800; letter-spacing: -1px; line-height: 1.1;
       background: linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%);
       -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .run-meta { margin-top: 8px; color: var(--muted); font-size: 13px; display:flex; gap:20px; flex-wrap:wrap; }
  .run-meta b { color: var(--text); }

  /* ── Hero Stats ──────────────────────────────────── */
  .hero { position:relative;z-index:1; max-width:1200px; margin:32px auto; padding:0 48px; }
  .hero-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; }
  .hero-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    display: flex; flex-direction:column; gap:6px;
    position: relative; overflow: hidden;
    transition: transform .2s, border-color .2s;
  }
  .hero-card:hover { transform:translateY(-2px); }
  .hero-card::before {
    content:'';
    position:absolute;top:0;left:0;right:0;height:3px;
    border-radius:12px 12px 0 0;
  }
  .hero-card.total::before  { background: var(--blue); }
  .hero-card.pass::before   { background: var(--green); }
  .hero-card.fail::before   { background: var(--red); }
  .hero-card.dur::before    { background: var(--amber); }
  .hero-icon { font-size:24px; margin-bottom:4px; }
  .hero-n {
    font-size: 44px; font-weight: 800; letter-spacing: -2px; line-height:1;
  }
  .hero-card.total .hero-n  { color: var(--blue); }
  .hero-card.pass  .hero-n  { color: var(--green); }
  .hero-card.fail  .hero-n  { color: var(--red); }
  .hero-card.dur   .hero-n  { color: var(--amber); font-size:34px; }
  .hero-label { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; }
  .hero-sub { font-size: 12px; color: var(--muted); margin-top:4px; }

  /* pass rate bar */
  .pass-bar { margin-top:16px; background:var(--bg); border-radius:99px; height:6px; overflow:hidden; }
  .pass-bar-fill { height:100%; border-radius:99px; background:linear-gradient(90deg,var(--green),#16a34a); animation:grow 1s ease; }
  @keyframes grow { from{width:0} }

  /* ── Content ─────────────────────────────────────── */
  .content { position:relative;z-index:1; max-width:1200px; margin:0 auto; padding:0 48px 64px; }

  /* ── Section headers ─────────────────────────────── */
  .section-title {
    font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
    color: var(--muted); margin: 40px 0 16px;
    display:flex; align-items:center; gap:10px;
  }
  .section-title::after { content:''; flex:1; height:1px; background:var(--border); }

  /* ── Project cards ───────────────────────────────── */
  .projects { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; }
  @media(max-width:900px){ .projects { grid-template-columns:1fr; } }
  .proj-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px; overflow: hidden;
    transition: transform .2s, box-shadow .2s;
  }
  .proj-card:hover { transform: translateY(-3px); box-shadow: 0 20px 40px rgba(0,0,0,.4); }
  .proj-header {
    padding: 20px;
    border-bottom: 1px solid;
    display: flex; align-items: center; gap: 14px;
  }
  .proj-icon {
    width: 40px; height: 40px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .proj-meta { flex: 1; }
  .proj-label { font-weight: 700; font-size: 15px; }
  .proj-desc  { font-size: 11px; color: var(--muted); margin-top:2px; line-height:1.4; }
  .proj-stats {
    display: flex; padding: 14px 20px; gap: 0;
    border-bottom: 1px solid var(--border);
  }
  .stat { flex:1; text-align:center; padding:4px 0; }
  .stat-n { display:block; font-size:20px; font-weight:800; line-height:1; }
  .stat-l { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.6px; }

  /* ── Suites ──────────────────────────────────────── */
  .suite { border-bottom: 1px solid var(--border); }
  .suite:last-child { border-bottom: none; }
  .suite-header {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; cursor: pointer;
    user-select: none;
    transition: background .15s;
  }
  .suite-header:hover { background: rgba(255,255,255,.03); }
  .suite-arrow { font-size:9px; color:var(--muted); transition:transform .2s; flex-shrink:0; }
  .suite.open .suite-arrow { transform: rotate(90deg); }
  .suite-name  { font-size: 12px; font-weight: 600; flex:1; color: var(--text); }
  .suite-meta  { display:flex; gap:6px; flex-shrink:0; }
  .badge { font-size:10px; padding:1px 7px; border-radius:99px; font-weight:600; }
  .badge.pass { background:#22c55e18; color:#22c55e; }
  .badge.fail { background:#ef444418; color:#ef4444; }

  .suite-body { display:none; padding:0 0 8px; }
  .suite.open .suite-body { display:block; }

  .test-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 16px 8px 32px;
    transition: background .15s;
  }
  .test-row:hover { background: rgba(255,255,255,.02); }
  .test-icon { flex-shrink:0; display:flex; }
  .test-title { flex:1; font-size:12px; color:var(--text); }
  .test-tags  { display:flex; gap:4px; flex-shrink:0; }
  .test-dur   { font-size:11px; font-weight:600; font-variant-numeric:tabular-nums; flex-shrink:0; min-width:42px; text-align:right; }

  /* ── Duration chart ──────────────────────────────── */
  .chart-box {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px; padding: 24px;
  }
  .chart-title { font-size:13px; font-weight:600; margin-bottom:18px; color:var(--muted); text-transform:uppercase; letter-spacing:.8px; }
  .bar-row { display:flex; align-items:center; gap:12px; margin-bottom:10px; }
  .bar-label { font-size:11px; color:var(--muted); width:280px; flex-shrink:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bar-track { flex:1; background:var(--bg); border-radius:99px; height:8px; overflow:hidden; }
  .bar-fill  { height:100%; border-radius:99px; animation:grow 1s ease; }
  .bar-dur   { font-size:11px; font-weight:600; color:var(--text); min-width:38px; text-align:right; font-variant-numeric:tabular-nums; }

  /* ── Footer ──────────────────────────────────────── */
  .footer {
    position:relative;z-index:1;
    text-align:center; padding:24px;
    border-top:1px solid var(--border);
    font-size:11px; color:var(--muted);
  }
  .footer a { color:var(--blue); text-decoration:none; }

  /* ── Pulse dot ───────────────────────────────────── */
  .pulse { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--green); margin-right:6px;
           box-shadow:0 0 0 0 rgba(34,197,94,.4); animation:pulse 2s infinite; }
  @keyframes pulse {
    0%   { box-shadow:0 0 0 0 rgba(34,197,94,.4); }
    70%  { box-shadow:0 0 0 8px rgba(34,197,94,0); }
    100% { box-shadow:0 0 0 0 rgba(34,197,94,0); }
  }

  /* ── Tags legend ─────────────────────────────────── */
  .legend { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:24px; }
</style>
</head>
<body>

<header class="header">
  <div class="header-inner">
    <div class="breadcrumb">pw-ts-kafka-be &nbsp;/&nbsp; <span>Test Report</span></div>
    <h1>Test Run Results</h1>
    <div class="run-meta">
      <span><b>${passed === total ? '<span class="pulse"></span>' : ''}${passed}/${total}</span> tests passed</b></span>
      <span>Run on <b>${runDate.toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})} ${runDate.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</b></span>
      <span>Duration <b>${fmtMs(totalMs)}</b></span>
      <span>Playwright <b>${data.config?.version || ''}</b></span>
    </div>
  </div>
</header>

<section class="hero">
  <div class="hero-grid">
    <div class="hero-card total">
      <div class="hero-icon">🧪</div>
      <div class="hero-n">${total}</div>
      <div class="hero-label">Total Tests</div>
      <div class="pass-bar"><div class="pass-bar-fill" style="width:${pct(passed,total)}%"></div></div>
      <div class="hero-sub">${pct(passed,total)}% pass rate</div>
    </div>
    <div class="hero-card pass">
      <div class="hero-icon">✅</div>
      <div class="hero-n">${passed}</div>
      <div class="hero-label">Passed</div>
      <div class="hero-sub">
        ${projectDefs.map(p=>`<b style="color:${p.color}">${projects[p.id].filter(t=>t.status==='passed').length}</b> ${p.label}`).join(' · ')}
      </div>
    </div>
    <div class="hero-card fail">
      <div class="hero-icon">${failed > 0 ? '❌' : '🎉'}</div>
      <div class="hero-n">${failed}</div>
      <div class="hero-label">Failed</div>
      <div class="hero-sub">${failed === 0 ? 'All green — zero failures!' : `${failed} test${failed>1?'s':''} need attention`}</div>
    </div>
    <div class="hero-card dur">
      <div class="hero-icon">⏱</div>
      <div class="hero-n">${fmtMs(totalMs)}</div>
      <div class="hero-label">Total Duration</div>
      <div class="hero-sub">Avg ${fmtMs(Math.round(allTests.reduce((s,t)=>s+t.duration,0)/total))} per test</div>
    </div>
  </div>
</section>

<main class="content">
  <div class="section-title">Projects</div>
  <div class="projects">
    ${projectDefs.map(projectCard).join('')}
  </div>

  <div class="section-title">Slowest Tests</div>
  <div class="chart-box">
    <div class="chart-title">Top 10 by Duration</div>
    ${durationBars()}
  </div>
</main>

<footer class="footer">
  Generated by <a href="https://playwright.dev">Playwright</a> test framework
  &nbsp;·&nbsp; pw-ts-kafka-be
  &nbsp;·&nbsp; ${runDate.toISOString().slice(0,10)}
</footer>

<script>
  // Open first suite of each project by default
  document.querySelectorAll('.suite').forEach((s,i) => {
    if (i % 1 === 0) {} // leave all closed, user clicks to open
  });
  // Animate hero numbers on load
  document.querySelectorAll('.hero-n').forEach(el => {
    const text = el.textContent.trim();
    if (/^\\d+$/.test(text)) {
      const target = parseInt(text);
      let current = 0;
      const step = Math.ceil(target / 20);
      const iv = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = current;
        if (current >= target) clearInterval(iv);
      }, 30);
    }
  });
</script>
</body>
</html>`;

const out = path.join(__dirname, 'test-report.html');
fs.writeFileSync(out, html, 'utf8');
console.log(`✓ Report written → ${out}`);
console.log(`  Open with: open test-report.html`);
