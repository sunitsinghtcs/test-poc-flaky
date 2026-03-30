#!/usr/bin/env ts-node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/generate-html-report.ts
//
// Generates a self-contained interactive HTML executive report from
// flaky-store.json and heal-store.json.
//
// Usage:
//   npx ts-node scripts/generate-html-report.ts
//   npx ts-node scripts/generate-html-report.ts --store-dir ./flaky-results --out ./reports/report.html
// ─────────────────────────────────────────────────────────────────────────────
import * as fs   from 'fs';
import * as path from 'path';
import { FlakyTestTracker } from '../src/flaky/FlakyTestTracker';
import { FlakyAnalyzer }    from '../src/flaky/FlakyAnalyzer';
import type { FlakyTestSummary, TestRunRecord } from '../src/flaky/types';

// Healing module is optional — only loaded if the files exist
type HealingRecord = { testId:string; title:string; file:string; project:string; timestamp:string; originalLocator:string; healedStrategy:string; healedSelector:string; attemptsLog:{strategy:string;selector:string;succeeded:boolean}[]; suggestedFix:string; };
type HealStoreShape = { version:number; records:HealingRecord[] };

function loadHealRecords(storeDir: string): HealingRecord[] {
  const storePath = path.join(storeDir, 'heal-store.json');
  if (!fs.existsSync(storePath)) return [];
  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as HealStoreShape;
    return parsed.records ?? [];
  } catch {
    return [];
  }
}

// ── Args ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : undefined; };
  return {
    storeDir : get('--store-dir') ?? path.join(process.cwd(), 'flaky-results'),
    outFile  : get('--out')       ?? path.join(process.cwd(), 'flaky-results', 'report.html'),
  };
}

// ── Run timeline helper ───────────────────────────────────────────────────────
interface RunPoint {
  timestamp : string;
  label     : string;
  total     : number;
  passed    : number;
  failed    : number;
  flaky     : number;
  passRate  : number;
}

function buildTimeline(records: TestRunRecord[]): RunPoint[] {
  const byTs = new Map<string, TestRunRecord[]>();
  for (const r of records) {
    const b = byTs.get(r.runTimestamp) ?? [];
    b.push(r);
    byTs.set(r.runTimestamp, b);
  }
  return [...byTs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ts, recs]) => {
      const total  = recs.length;
      const passed = recs.filter(r => r.finalStatus === 'passed').length;
      const failed = recs.filter(r => r.finalStatus === 'failed' || r.finalStatus === 'timedOut').length;
      const flaky  = recs.filter(r => r.flakyInThisRun).length;
      return {
        timestamp : ts,
        label     : new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }),
        total, passed, failed, flaky,
        passRate  : total > 0 ? Math.round((passed / total) * 100) : 0,
      };
    });
}

// ── Health score ──────────────────────────────────────────────────────────────
function calcHealthScore(summaries: FlakyTestSummary[]): number {
  if (!summaries.length) return 100;
  const total    = summaries.length;
  const clean    = summaries.filter(s => s.category === 'clean').length;
  const flaky    = summaries.filter(s => s.category === 'flaky').length;
  const failing  = summaries.filter(s => s.category === 'consistently_failing').length;
  const critical = summaries.filter(s => s.severity === 'critical').length;
  const high     = summaries.filter(s => s.severity === 'high').length;
  const score = Math.max(0, Math.round(
    ((clean / total) * 70) +
    (((total - failing) / total) * 20) +
    (((total - flaky - failing) / total) * 10) -
    (critical * 5) - (high * 2)
  ));
  return Math.min(100, score);
}

// ── Browser breakdown ─────────────────────────────────────────────────────────
interface BrowserRow { browser: string; total: number; clean: number; flaky: number; failing: number; passRate: number; }
function buildBrowserBreakdown(summaries: FlakyTestSummary[]): BrowserRow[] {
  const map = new Map<string, BrowserRow>();
  for (const s of summaries) {
    if (!map.has(s.project)) map.set(s.project, { browser: s.project, total: 0, clean: 0, flaky: 0, failing: 0, passRate: 0 });
    const row = map.get(s.project)!;
    row.total++;
    if (s.category === 'clean') row.clean++;
    else if (s.category === 'flaky') row.flaky++;
    else row.failing++;
  }
  for (const row of map.values()) row.passRate = row.total > 0 ? Math.round((row.clean / row.total) * 100) : 0;
  return [...map.values()].sort((a, b) => b.passRate - a.passRate);
}

// ── HTML generator ────────────────────────────────────────────────────────────
function generateHTML(
  summaries    : FlakyTestSummary[],
  timeline     : RunPoint[],
  healRecords  : HealingRecord[],
  latestRecs   : import('../src/flaky/types').TestRunRecord[],
  totalRuns    : number,
  latestRunAt  : string,
  generatedAt  : string,
): string {
  // ── Latest run stats ──
  const lr_total   = latestRecs.length;
  const lr_passed  = latestRecs.filter(r => !r.flakyInThisRun && r.finalStatus === 'passed').length;
  const lr_flaky   = latestRecs.filter(r => r.flakyInThisRun).length;
  const lr_failed  = latestRecs.filter(r => r.finalStatus === 'failed' || r.finalStatus === 'timedOut').length;
  const lr_passRate= lr_total > 0 ? Math.round((lr_passed/lr_total)*100) : 0;
  const total    = summaries.length;
  const clean    = summaries.filter(s => s.category === 'clean').length;
  const flaky    = summaries.filter(s => s.category === 'flaky').length;
  const failing  = summaries.filter(s => s.category === 'consistently_failing').length;
  const critical = summaries.filter(s => s.severity === 'critical').length;
  const high     = summaries.filter(s => s.severity === 'high').length;
  const medium   = summaries.filter(s => s.severity === 'medium').length;
  const low      = summaries.filter(s => s.severity === 'low').length;
  const health   = calcHealthScore(summaries);
  const passRate = total > 0 ? Math.round((clean / total) * 100) : 0;
  const flakyRate= total > 0 ? Math.round((flaky / total) * 100) : 0;
  const failRate = total > 0 ? Math.round((failing / total) * 100) : 0;
  const avgDur   = summaries.length > 0 ? (summaries.reduce((s, x) => s + x.avgDurationMs, 0) / summaries.length / 1000).toFixed(2) : '0';
  const browsers = buildBrowserBreakdown(summaries);

  const healthColor = health >= 80 ? '#22c55e' : health >= 60 ? '#f59e0b' : '#ef4444';
  const healthLabel = health >= 80 ? 'Healthy' : health >= 60 ? 'Degraded' : 'Critical';

  // Serialize data for JS
  const jsonSummaries = JSON.stringify(summaries);
  const jsonTimeline  = JSON.stringify(timeline);
  const jsonHeal      = JSON.stringify(healRecords);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Test Health Report — Flaky Analysis</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet"/>
<style>
:root{
  --bg:#080c14;--bg2:#0d1420;--bg3:#121928;--bg4:#1a2235;
  --border:#1e2d45;--border2:#263550;
  --text:#e2e8f0;--text2:#94a3b8;--text3:#64748b;
  --green:#22c55e;--green-dim:#14532d;
  --red:#ef4444;--red-dim:#7f1d1d;
  --amber:#f59e0b;--amber-dim:#78350f;
  --blue:#3b82f6;--blue-dim:#1e3a5f;
  --purple:#a855f7;
  --critical:#ef4444;--high:#f97316;--medium:#f59e0b;--low:#22c55e;
  --radius:12px;--radius-sm:8px;
  font-size:14px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'DM Mono',monospace;min-height:100vh;overflow-x:hidden}
::selection{background:var(--blue);color:#fff}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--bg2)}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}

/* ── Layout ── */
.shell{max-width:1400px;margin:0 auto;padding:0 24px 60px}

/* ── Header ── */
header{
  position:relative;padding:40px 0 32px;
  border-bottom:1px solid var(--border);margin-bottom:32px;
  display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:16px;
}
.header-left h1{
  font-family:'Syne',sans-serif;font-size:28px;font-weight:800;
  background:linear-gradient(135deg,#e2e8f0 0%,#94a3b8 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
  letter-spacing:-0.5px;
}
.header-left .sub{color:var(--text3);font-size:12px;margin-top:6px;letter-spacing:0.5px}
.header-right{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.badge{
  padding:4px 12px;border-radius:20px;font-size:11px;font-weight:500;
  border:1px solid;letter-spacing:0.5px;text-transform:uppercase;
}
.badge-time{border-color:var(--border2);color:var(--text3);background:var(--bg3)}
.badge-runs{border-color:var(--blue-dim);color:var(--blue);background:rgba(59,130,246,.08)}
.pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}

/* ── Health Score ── */
.health-banner{
  background:linear-gradient(135deg,var(--bg2) 0%,var(--bg3) 100%);
  border:1px solid var(--border);border-radius:var(--radius);
  padding:28px 32px;margin-bottom:28px;
  display:flex;align-items:center;gap:32px;flex-wrap:wrap;
}
.score-ring{position:relative;width:120px;height:120px;flex-shrink:0}
.score-ring svg{transform:rotate(-90deg)}
.score-ring .track{fill:none;stroke:var(--border2);stroke-width:8}
.score-ring .fill{fill:none;stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset 1.5s cubic-bezier(.4,0,.2,1)}
.score-label{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;
}
.score-label .num{font-family:'Syne',sans-serif;font-size:28px;font-weight:800}
.score-label .lbl{font-size:10px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin-top:2px}
.health-info h2{font-family:'Syne',sans-serif;font-size:20px;font-weight:700;margin-bottom:6px}
.health-info p{color:var(--text2);font-size:13px;line-height:1.6;max-width:500px}
.health-badges{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}

/* ── KPI grid ── */
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px}
.kpi-card{
  background:var(--bg2);border:1px solid var(--border);
  border-radius:var(--radius);padding:20px 22px;
  position:relative;overflow:hidden;transition:border-color .2s,transform .2s;cursor:default;
}
.kpi-card:hover{border-color:var(--border2);transform:translateY(-2px)}
.kpi-card::before{
  content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:var(--accent,var(--blue));
}
.kpi-card .kpi-label{font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
.kpi-card .kpi-value{font-family:'Syne',sans-serif;font-size:32px;font-weight:800;line-height:1;color:var(--accent,var(--text))}
.kpi-card .kpi-sub{font-size:11px;color:var(--text3);margin-top:6px}
.kpi-card.green{--accent:var(--green)}
.kpi-card.red{--accent:var(--red)}
.kpi-card.amber{--accent:var(--amber)}
.kpi-card.blue{--accent:var(--blue)}
.kpi-card.purple{--accent:var(--purple)}

/* ── Sections ── */
.section{margin-bottom:28px}
.section-title{
  font-family:'Syne',sans-serif;font-size:15px;font-weight:700;
  color:var(--text2);text-transform:uppercase;letter-spacing:1.5px;
  margin-bottom:16px;display:flex;align-items:center;gap:10px;
}
.section-title::after{content:'';flex:1;height:1px;background:var(--border)}

/* ── Charts row ── */
.charts-row{display:grid;grid-template-columns:300px 1fr 1fr;gap:16px;margin-bottom:28px}
@media(max-width:900px){.charts-row{grid-template-columns:1fr}}
.chart-card{
  background:var(--bg2);border:1px solid var(--border);
  border-radius:var(--radius);padding:20px;
}
.chart-card h3{font-family:'Syne',sans-serif;font-size:13px;font-weight:600;color:var(--text2);margin-bottom:16px;text-transform:uppercase;letter-spacing:1px}
.donut-wrap{position:relative;width:160px;height:160px;margin:0 auto 16px}
.donut-legend{display:flex;flex-direction:column;gap:8px}
.donut-legend-item{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}
.donut-legend-item .dot{width:10px;height:10px;border-radius:2px;flex-shrink:0}
.donut-legend-item .legend-label{color:var(--text2);flex:1}
.donut-legend-item .legend-val{color:var(--text);font-weight:500}

/* ── Severity bars ── */
.sev-list{display:flex;flex-direction:column;gap:12px}
.sev-row{display:flex;align-items:center;gap:12px}
.sev-row .sev-label{width:70px;font-size:12px;display:flex;align-items:center;gap:6px}
.sev-row .sev-bar-track{flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden}
.sev-row .sev-bar-fill{height:100%;border-radius:4px;transition:width 1s ease}
.sev-row .sev-count{width:30px;text-align:right;font-size:12px;color:var(--text2)}

/* ── Browser breakdown ── */
.browser-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:28px}
.browser-card{
  background:var(--bg2);border:1px solid var(--border);
  border-radius:var(--radius);padding:16px 18px;
}
.browser-card .bname{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;margin-bottom:10px;text-transform:capitalize}
.browser-stats{display:flex;gap:12px;font-size:11px;flex-wrap:wrap}
.browser-stat{display:flex;flex-direction:column;gap:2px}
.browser-stat .bs-val{font-size:18px;font-weight:700;font-family:'Syne',sans-serif}
.browser-stat .bs-lbl{color:var(--text3);text-transform:uppercase;letter-spacing:0.5px}
.pass-ring-wrap{display:flex;align-items:center;gap:12px;margin-top:12px}
.pass-bar-track{flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden}
.pass-bar-fill{height:100%;border-radius:3px;background:var(--green);transition:width 1s ease}
.pass-pct{font-size:12px;color:var(--text2);width:36px;text-align:right}

/* ── Test table ── */
.table-toolbar{
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  margin-bottom:14px;
}
.search-box{
  flex:1;min-width:200px;background:var(--bg3);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:8px 14px;color:var(--text);font-family:inherit;font-size:13px;
  outline:none;transition:border-color .2s;
}
.search-box:focus{border-color:var(--blue)}
.search-box::placeholder{color:var(--text3)}
.filter-pills{display:flex;gap:6px;flex-wrap:wrap}
.pill{
  padding:5px 12px;border-radius:20px;font-size:11px;cursor:pointer;
  border:1px solid var(--border);color:var(--text2);background:var(--bg3);
  transition:all .15s;user-select:none;letter-spacing:0.3px;
}
.pill:hover{border-color:var(--border2)}
.pill.active{color:#fff;border-color:transparent}
.pill.all.active{background:var(--blue)}
.pill.failing.active{background:var(--red)}
.pill.flaky.active{background:var(--amber);color:#000}
.pill.clean.active{background:var(--green);color:#000}
.pill.critical.active{background:var(--critical)}
.pill.high.active{background:var(--high)}
.sort-select{
  background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:8px 12px;color:var(--text);font-family:inherit;font-size:12px;outline:none;cursor:pointer;
}

.table-wrap{overflow-x:auto;border-radius:var(--radius);border:1px solid var(--border)}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{
  background:var(--bg3);padding:10px 14px;text-align:left;
  color:var(--text3);font-weight:500;text-transform:uppercase;
  letter-spacing:0.8px;font-size:10px;white-space:nowrap;
  border-bottom:1px solid var(--border);cursor:pointer;user-select:none;
}
thead th:hover{color:var(--text)}
thead th .sort-icon{opacity:.4;margin-left:4px}
thead th.sorted .sort-icon{opacity:1}
tbody tr{border-bottom:1px solid var(--border);transition:background .1s}
tbody tr:last-child{border-bottom:none}
tbody tr:hover{background:var(--bg3)}
tbody td{padding:10px 14px;vertical-align:middle}
.td-title{max-width:220px}
.td-title .test-name{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.td-title .test-file{font-size:10px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;margin-top:2px}
.status-badge{
  display:inline-flex;align-items:center;gap:5px;
  padding:3px 9px;border-radius:20px;font-size:10px;font-weight:500;
  white-space:nowrap;text-transform:uppercase;letter-spacing:0.4px;
}
.status-badge.failing{background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.3)}
.status-badge.flaky{background:rgba(245,158,11,.15);color:var(--amber);border:1px solid rgba(245,158,11,.3)}
.status-badge.clean{background:rgba(34,197,94,.15);color:var(--green);border:1px solid rgba(34,197,94,.3)}
.sev-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.sev-dot.critical{background:var(--critical)}
.sev-dot.high{background:var(--high)}
.sev-dot.medium{background:var(--medium)}
.sev-dot.low{background:var(--low)}
.mini-bar-track{width:80px;height:5px;background:var(--border);border-radius:2px;display:inline-block;overflow:hidden;vertical-align:middle}
.mini-bar-fill{height:100%;border-radius:2px}
.num-cell{font-variant-numeric:tabular-nums;text-align:right}
.error-chip{
  display:inline-block;background:rgba(239,68,68,.1);color:#fca5a5;
  font-size:10px;padding:2px 7px;border-radius:4px;max-width:200px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  border:1px solid rgba(239,68,68,.2);cursor:help;
}
.no-results{padding:40px;text-align:center;color:var(--text3);font-size:13px}
.row-count{font-size:12px;color:var(--text3);padding:8px 14px;text-align:right;background:var(--bg3);border-top:1px solid var(--border)}

/* ── Timeline chart ── */
.timeline-card{
  background:var(--bg2);border:1px solid var(--border);
  border-radius:var(--radius);padding:20px;margin-bottom:28px;
}
.timeline-card h3{font-family:'Syne',sans-serif;font-size:13px;font-weight:600;color:var(--text2);margin-bottom:16px;text-transform:uppercase;letter-spacing:1px}
.chart-container{position:relative;height:200px}

/* ── Heal section ── */
.heal-list{display:flex;flex-direction:column;gap:12px}
.heal-card{
  background:var(--bg2);border:1px solid var(--border);
  border-radius:var(--radius);padding:18px 20px;
  border-left:3px solid var(--amber);
}
.heal-card .heal-title{font-weight:600;font-size:13px;margin-bottom:8px;color:var(--text)}
.heal-meta{font-size:11px;color:var(--text3);margin-bottom:10px;display:flex;gap:16px;flex-wrap:wrap}
.heal-row{display:flex;gap:10px;align-items:flex-start;font-size:12px;margin-bottom:6px}
.heal-row .hl{width:60px;color:var(--text3);flex-shrink:0}
.heal-row code{background:var(--bg4);padding:2px 7px;border-radius:4px;font-size:11px;color:var(--text2);border:1px solid var(--border)}
.heal-fix{margin-top:10px;background:var(--bg4);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:10px 14px;font-size:11px}
.heal-fix .fix-label{color:var(--green);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}
.heal-fix pre{color:var(--text2);white-space:pre-wrap;word-break:break-all;line-height:1.6}
.empty-state{padding:32px;text-align:center;color:var(--text3);font-size:13px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius)}

/* ── Footer ── */
footer{border-top:1px solid var(--border);padding-top:20px;margin-top:40px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
footer .fl{font-size:11px;color:var(--text3)}
footer .fr{font-size:11px;color:var(--text3);text-align:right}

/* ── Animations ── */
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.kpi-card{animation:fadeUp .4s ease both}
.kpi-card:nth-child(1){animation-delay:.05s}
.kpi-card:nth-child(2){animation-delay:.1s}
.kpi-card:nth-child(3){animation-delay:.15s}
.kpi-card:nth-child(4){animation-delay:.2s}
.kpi-card:nth-child(5){animation-delay:.25s}
.kpi-card:nth-child(6){animation-delay:.3s}
.health-banner{animation:fadeUp .4s ease both}
</style>
</head>
<body>
<div class="shell">

<!-- ── Header ── -->
<header>
  <div class="header-left">
    <h1>Test Health Report</h1>
    <div class="sub"><span class="pulse"></span>Flaky Test Analysis Dashboard</div>
  </div>
  <div class="header-right">
    <span class="badge badge-runs">${timeline.length} run${timeline.length !== 1 ? 's' : ''} recorded</span>
    <span class="badge badge-time">Generated ${generatedAt}</span>
  </div>
</header>

<!-- ── Latest Run Banner ── -->
<div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:16px 24px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
  <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text2)">
    🕐 LATEST RUN &nbsp;<span style="font-weight:400;color:var(--text3)">${latestRunAt}</span>
    <span style="margin-left:16px;font-size:11px;color:var(--text3);font-weight:400">(${totalRuns} total run${totalRuns !== 1 ? 's' : ''} recorded — cross-run stats below)</span>
  </div>
  <div style="display:flex;gap:20px;flex-wrap:wrap">
    <div style="text-align:center">
      <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--blue)">${lr_total}</div>
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Tests Run</div>
    </div>
    <div style="text-align:center">
      <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--green)">${lr_passed}</div>
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Passed (${lr_passRate}%)</div>
    </div>
    <div style="text-align:center">
      <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--amber)">${lr_flaky}</div>
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Flaky</div>
    </div>
    <div style="text-align:center">
      <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--red)">${lr_failed}</div>
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Failed</div>
    </div>
  </div>
</div>

<!-- ── Health Score Banner ── -->
<div class="health-banner">
  <div class="score-ring">
    <svg viewBox="0 0 120 120" width="120" height="120">
      <circle class="track" cx="60" cy="60" r="50"/>
      <circle class="fill" cx="60" cy="60" r="50"
        stroke="${healthColor}"
        stroke-dasharray="${2 * Math.PI * 50}"
        stroke-dashoffset="${2 * Math.PI * 50 * (1 - health / 100)}"
        id="scoreArc"/>
    </svg>
    <div class="score-label">
      <span class="num" style="color:${healthColor}">${health}</span>
      <span class="lbl">/ 100</span>
    </div>
  </div>
  <div class="health-info">
    <h2>All-Time Suite Health: <span style="color:${healthColor}">${healthLabel}</span></h2>
    <p>
      Across all <strong>${timeline.length} recorded run${timeline.length !== 1 ? 's' : ''}</strong>,
      ${total} unique test+browser combinations tracked.
      ${clean} always pass cleanly (${passRate}%), ${flaky} show non-deterministic behaviour,
      ${failing} consistently fail on every run.
      ${healRecords.length > 0 ? `Self-healing intercepted ${healRecords.length} locator failure${healRecords.length !== 1 ? 's' : ''}.` : ''}
    </p>
    <div class="health-badges">
      ${critical > 0 ? `<span class="badge" style="border-color:rgba(239,68,68,.4);color:var(--critical);background:rgba(239,68,68,.08)">${critical} Critical</span>` : ''}
      ${high     > 0 ? `<span class="badge" style="border-color:rgba(249,115,22,.4);color:var(--high);background:rgba(249,115,22,.08)">${high} High</span>` : ''}
      ${medium   > 0 ? `<span class="badge" style="border-color:rgba(245,158,11,.4);color:var(--medium);background:rgba(245,158,11,.08)">${medium} Medium</span>` : ''}
      ${healRecords.length > 0 ? `<span class="badge" style="border-color:rgba(168,85,247,.4);color:var(--purple);background:rgba(168,85,247,.08)">${healRecords.length} Auto-healed</span>` : ''}
    </div>
  </div>
</div>

<!-- ── KPI Cards ── -->
<div class="kpi-grid">
  <div class="kpi-card blue">
    <div class="kpi-label">Total Tests</div>
    <div class="kpi-value">${total}</div>
    <div class="kpi-sub">across all browsers</div>
  </div>
  <div class="kpi-card green">
    <div class="kpi-label">Pass Rate</div>
    <div class="kpi-value">${passRate}%</div>
    <div class="kpi-sub">${clean} clean tests</div>
  </div>
  <div class="kpi-card amber">
    <div class="kpi-label">Flaky Rate</div>
    <div class="kpi-value">${flakyRate}%</div>
    <div class="kpi-sub">${flaky} non-deterministic</div>
  </div>
  <div class="kpi-card red">
    <div class="kpi-label">Fail Rate</div>
    <div class="kpi-value">${failRate}%</div>
    <div class="kpi-sub">${failing} consistently failing</div>
  </div>
  <div class="kpi-card ${Number(avgDur) > 5 ? 'amber' : 'green'}">
    <div class="kpi-label">Avg Duration</div>
    <div class="kpi-value">${avgDur}s</div>
    <div class="kpi-sub">per test attempt</div>
  </div>
  <div class="kpi-card purple">
    <div class="kpi-label">Auto-healed</div>
    <div class="kpi-value">${healRecords.length}</div>
    <div class="kpi-sub">self-healing events</div>
  </div>
</div>

<!-- ── Charts Row ── -->
<div class="section-title">Distribution &amp; Severity</div>
<div class="charts-row">

  <!-- Donut -->
  <div class="chart-card">
    <h3>Test Distribution</h3>
    <div class="donut-wrap">
      <canvas id="donutChart"></canvas>
    </div>
    <div class="donut-legend">
      <div class="donut-legend-item"><span class="dot" style="background:var(--green)"></span><span class="legend-label">Clean</span><span class="legend-val">${clean}</span></div>
      <div class="donut-legend-item"><span class="dot" style="background:var(--amber)"></span><span class="legend-label">Flaky</span><span class="legend-val">${flaky}</span></div>
      <div class="donut-legend-item"><span class="dot" style="background:var(--red)"></span><span class="legend-label">Failing</span><span class="legend-val">${failing}</span></div>
    </div>
  </div>

  <!-- Severity bars -->
  <div class="chart-card">
    <h3>Severity Breakdown</h3>
    <div class="sev-list" style="margin-top:8px">
      ${[
        { label: '🔴 Critical', key: 'critical', color: 'var(--critical)', count: critical },
        { label: '🟠 High',     key: 'high',     color: 'var(--high)',     count: high     },
        { label: '🟡 Medium',   key: 'medium',   color: 'var(--medium)',   count: medium   },
        { label: '🟢 Low',      key: 'low',      color: 'var(--low)',      count: low      },
      ].map(s => `
      <div class="sev-row">
        <span class="sev-label">${s.label}</span>
        <div class="sev-bar-track">
          <div class="sev-bar-fill" style="width:${flaky > 0 ? Math.round((s.count/flaky)*100) : 0}%;background:${s.color}"></div>
        </div>
        <span class="sev-count">${s.count}</span>
      </div>`).join('')}
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);font-size:11px;color:var(--text3);line-height:1.8">
        <div>🔴 Critical &nbsp;≥ 50% flaky rate</div>
        <div>🟠 High &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;25 – 50%</div>
        <div>🟡 Medium &nbsp;&nbsp;10 – 25%</div>
        <div>🟢 Low &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 5 – 10%</div>
      </div>
    </div>
  </div>

  <!-- Pass rate chart -->
  <div class="chart-card">
    <h3>Pass Rate by Run</h3>
    <div class="chart-container">
      <canvas id="passRateChart"></canvas>
    </div>
  </div>

</div>

<!-- ── Browser Breakdown ── -->
${browsers.length > 0 ? `
<div class="section-title">Browser Breakdown</div>
<div class="browser-grid">
  ${browsers.map(b => `
  <div class="browser-card">
    <div class="bname">${b.browser}</div>
    <div class="browser-stats">
      <div class="browser-stat">
        <span class="bs-val" style="color:var(--green)">${b.clean}</span>
        <span class="bs-lbl">Clean</span>
      </div>
      <div class="browser-stat">
        <span class="bs-val" style="color:var(--amber)">${b.flaky}</span>
        <span class="bs-lbl">Flaky</span>
      </div>
      <div class="browser-stat">
        <span class="bs-val" style="color:var(--red)">${b.failing}</span>
        <span class="bs-lbl">Failing</span>
      </div>
      <div class="browser-stat">
        <span class="bs-val">${b.total}</span>
        <span class="bs-lbl">Total</span>
      </div>
    </div>
    <div class="pass-ring-wrap">
      <div class="pass-bar-track"><div class="pass-bar-fill" style="width:${b.passRate}%"></div></div>
      <span class="pass-pct">${b.passRate}%</span>
    </div>
  </div>`).join('')}
</div>` : ''}

<!-- ── Timeline ── -->
${timeline.length > 1 ? `
<div class="section-title">Run History</div>
<div class="timeline-card">
  <h3>Pass / Fail / Flaky per Run</h3>
  <div class="chart-container">
    <canvas id="timelineChart"></canvas>
  </div>
</div>` : ''}

<!-- ── Test Table ── -->
<div class="section-title">All Tests</div>
<div class="table-toolbar">
  <input class="search-box" id="searchBox" placeholder="Search by test name or file..." type="text" oninput="applyFilters()"/>
  <div class="filter-pills">
    <span class="pill all active"    onclick="setFilter('all',this)">All</span>
    <span class="pill failing"       onclick="setFilter('consistently_failing',this)">Failing</span>
    <span class="pill flaky"         onclick="setFilter('flaky',this)">Flaky</span>
    <span class="pill clean"         onclick="setFilter('clean',this)">Clean</span>
    <span class="pill critical"      onclick="setFilter('critical',this)">Critical</span>
    <span class="pill high"          onclick="setFilter('high',this)">High</span>
  </div>
  <select class="sort-select" id="sortSelect" onchange="applyFilters()">
    <option value="category">Sort: Category</option>
    <option value="flakyRate">Sort: Flaky Rate ↓</option>
    <option value="failureRate">Sort: Fail Rate ↓</option>
    <option value="totalRuns">Sort: Runs ↓</option>
    <option value="avgDurationMs">Sort: Duration ↓</option>
    <option value="title">Sort: Name A–Z</option>
  </select>
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Status</th>
        <th>Test</th>
        <th>Browser</th>
        <th class="num-cell">Runs</th>
        <th>Pass %</th>
        <th>Flaky %</th>
        <th>Fail %</th>
        <th>Severity</th>
        <th class="num-cell">Avg Dur</th>
        <th>Last Error</th>
      </tr>
    </thead>
    <tbody id="testTableBody"></tbody>
  </table>
  <div class="row-count" id="rowCount"></div>
</div>

<!-- ── Self-Healing ── -->
<div class="section-title" style="margin-top:28px">Self-Healing Events</div>
<div id="healSection"></div>

<!-- ── Footer ── -->
<footer>
  <div class="fl">Test Health Report · Generated by Flaky Detection System</div>
  <div class="fr">Generated ${generatedAt}</div>
</footer>

</div><!-- /shell -->

<script>
// ── Data ──────────────────────────────────────────────────────────────────────
const SUMMARIES  = ${jsonSummaries};
const TIMELINE   = ${jsonTimeline};
const HEAL       = ${jsonHeal};

let activeFilter = 'all';

// ── Table render ──────────────────────────────────────────────────────────────
function pct(r){ return (r*100).toFixed(1)+'%'; }
function dur(ms){ return (ms/1000).toFixed(2)+'s'; }

function statusBadge(s){
  if(s.category==='consistently_failing') return '<span class="status-badge failing">● Failing</span>';
  if(s.category==='flaky')  return '<span class="status-badge flaky">◆ Flaky</span>';
  return '<span class="status-badge clean">✓ Clean</span>';
}
function sevCell(s){
  if(s.category!=='flaky') return '<span style="color:var(--text3)">—</span>';
  const map={critical:'var(--critical)',high:'var(--high)',medium:'var(--medium)',low:'var(--low)'};
  return '<span class="sev-dot '+s.severity+'"></span>'+s.severity.charAt(0).toUpperCase()+s.severity.slice(1);
}
function miniBar(rate, color){
  return '<div class="mini-bar-track"><div class="mini-bar-fill" style="width:'+Math.round(rate*100)+'%;background:'+color+'"></div></div> '+(rate*100).toFixed(0)+'%';
}

function renderTable(){
  const search = document.getElementById('searchBox').value.toLowerCase();
  const sortBy = document.getElementById('sortSelect').value;

  let rows = SUMMARIES.filter(s => {
    const matchSearch = !search || s.title.toLowerCase().includes(search) || s.file.toLowerCase().includes(search);
    const matchFilter =
      activeFilter==='all' ? true :
      activeFilter==='critical'||activeFilter==='high' ? s.severity===activeFilter && s.category==='flaky' :
      s.category===activeFilter;
    return matchSearch && matchFilter;
  });

  if(sortBy==='flakyRate')    rows.sort((a,b)=>b.flakyRate-a.flakyRate);
  else if(sortBy==='failureRate') rows.sort((a,b)=>b.failureRate-a.failureRate);
  else if(sortBy==='totalRuns')   rows.sort((a,b)=>b.totalRuns-a.totalRuns);
  else if(sortBy==='avgDurationMs') rows.sort((a,b)=>b.avgDurationMs-a.avgDurationMs);
  else if(sortBy==='title')   rows.sort((a,b)=>a.title.localeCompare(b.title));
  else {
    const o={consistently_failing:0,flaky:1,clean:2};
    rows.sort((a,b)=>o[a.category]-o[b.category]||b.flakyRate-a.flakyRate);
  }

  const body = document.getElementById('testTableBody');
  if(!rows.length){
    body.innerHTML='<tr><td colspan="10"><div class="no-results">No tests match your filter.</div></td></tr>';
    document.getElementById('rowCount').textContent='';
    return;
  }

  const passColor='var(--green)',flakyColor='var(--amber)',failColor='var(--red)';
  body.innerHTML = rows.map(s => {
    const passRate = s.totalRuns>0 ? s.cleanPassRuns/s.totalRuns : 0;
    const err = s.recentErrors[0] ? '<span class="error-chip" title="'+s.recentErrors[0].replace(/"/g,"&quot;")+'">'+s.recentErrors[0].substring(0,40)+(s.recentErrors[0].length>40?'…':'')+'</span>' : '<span style="color:var(--text3)">—</span>';
    return \`<tr>
      <td>\${statusBadge(s)}</td>
      <td class="td-title">
        <span class="test-name" title="\${s.title}">\${s.title}</span>
        <span class="test-file">\${s.file}</span>
      </td>
      <td style="color:var(--text2);text-transform:capitalize">\${s.project}</td>
      <td class="num-cell">\${s.totalRuns}</td>
      <td>\${miniBar(passRate,passColor)}</td>
      <td>\${s.category==='flaky'?miniBar(s.flakyRate,flakyColor):'<span style="color:var(--text3)">—</span>'}</td>
      <td>\${s.failedRuns>0?miniBar(s.failureRate,failColor):'<span style="color:var(--text3)">—</span>'}</td>
      <td>\${sevCell(s)}</td>
      <td class="num-cell">\${dur(s.avgDurationMs)}</td>
      <td>\${err}</td>
    </tr>\`;
  }).join('');

  document.getElementById('rowCount').textContent = rows.length+' of '+SUMMARIES.length+' tests shown';
}

function setFilter(f, el){
  activeFilter=f;
  document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  renderTable();
}
function applyFilters(){ renderTable(); }

// ── Donut chart ───────────────────────────────────────────────────────────────
function renderDonut(){
  const clean   = SUMMARIES.filter(s=>s.category==='clean').length;
  const flaky   = SUMMARIES.filter(s=>s.category==='flaky').length;
  const failing = SUMMARIES.filter(s=>s.category==='consistently_failing').length;
  const ctx = document.getElementById('donutChart').getContext('2d');
  new Chart(ctx,{
    type:'doughnut',
    data:{
      labels:['Clean','Flaky','Failing'],
      datasets:[{data:[clean,flaky,failing],backgroundColor:['#22c55e','#f59e0b','#ef4444'],borderWidth:0,hoverOffset:4}]
    },
    options:{
      responsive:true,maintainAspectRatio:true,
      cutout:'72%',
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+c.raw+' tests'}}},
      animation:{animateRotate:true,duration:1200}
    }
  });
}

// ── Pass rate over runs ───────────────────────────────────────────────────────
function renderPassRate(){
  if(!TIMELINE.length) return;
  const ctx = document.getElementById('passRateChart').getContext('2d');
  new Chart(ctx,{
    type:'line',
    data:{
      labels: TIMELINE.map(t=>t.label),
      datasets:[{
        label:'Pass Rate %',
        data: TIMELINE.map(t=>t.passRate),
        borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.1)',
        fill:true,tension:.4,pointRadius:3,pointHoverRadius:5,
        pointBackgroundColor:'#22c55e',borderWidth:2
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      scales:{
        x:{ticks:{color:'#64748b',font:{size:10},maxRotation:30},grid:{color:'rgba(255,255,255,.04)'}},
        y:{min:0,max:100,ticks:{color:'#64748b',font:{size:10},callback:v=>v+'%'},grid:{color:'rgba(255,255,255,.04)'}}
      },
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw+'%'}}}
    }
  });
}

// ── Timeline chart ────────────────────────────────────────────────────────────
function renderTimeline(){
  const el = document.getElementById('timelineChart');
  if(!el || !TIMELINE.length) return;
  const ctx = el.getContext('2d');
  new Chart(ctx,{
    type:'bar',
    data:{
      labels: TIMELINE.map(t=>t.label),
      datasets:[
        {label:'Passed', data:TIMELINE.map(t=>t.passed), backgroundColor:'#22c55e',borderRadius:3,stack:'s'},
        {label:'Flaky',  data:TIMELINE.map(t=>t.flaky),  backgroundColor:'#f59e0b',borderRadius:3,stack:'s'},
        {label:'Failed', data:TIMELINE.map(t=>t.failed), backgroundColor:'#ef4444',borderRadius:3,stack:'s'},
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      scales:{
        x:{ticks:{color:'#64748b',font:{size:10},maxRotation:30},grid:{color:'rgba(255,255,255,.04)'}},
        y:{ticks:{color:'#64748b',font:{size:10}},grid:{color:'rgba(255,255,255,.04)'},stacked:true}
      },
      plugins:{
        legend:{labels:{color:'#94a3b8',font:{size:11},boxWidth:10,padding:12}},
        tooltip:{mode:'index',intersect:false}
      }
    }
  });
}

// ── Heal section ──────────────────────────────────────────────────────────────
function renderHeal(){
  const el = document.getElementById('healSection');
  if(!HEAL.length){
    el.innerHTML='<div class="empty-state">✅ No self-healing events recorded yet. Tests with healLocator() will appear here when they auto-recover from a broken locator.</div>';
    return;
  }
  const byTest = new Map();
  for(const r of HEAL){ if(!byTest.has(r.testId)) byTest.set(r.testId,[r]); else byTest.get(r.testId).push(r); }
  el.innerHTML='<div class="heal-list">'+[...byTest.values()].map(recs=>{
    const r=recs[0];
    const tried = r.attemptsLog.map(a=>'<div style="font-size:11px;color:'+(a.succeeded?'var(--green)':'var(--text3)')+';">'+(a.succeeded?'✅':'❌')+' ['+a.strategy+'] '+a.selector+'</div>').join('');
    return \`<div class="heal-card">
      <div class="heal-title">🩹 \${r.title}</div>
      <div class="heal-meta">
        <span>📁 \${r.file}</span>
        <span>🖥 \${r.project}</span>
        <span>🔁 Healed \${recs.length}×</span>
        <span>🕐 \${new Date(r.timestamp).toLocaleString()}</span>
      </div>
      <div class="heal-row"><span class="hl">Original</span><code>\${r.originalLocator}</code></div>
      <div class="heal-row"><span class="hl">Healed</span><code>page.\${r.healedSelector}</code></div>
      <div style="margin-top:10px;font-size:11px;color:var(--text3);margin-bottom:6px">Strategies tried:</div>
      \${tried}
      <div class="heal-fix">
        <div class="fix-label">💡 Suggested permanent fix</div>
        <pre>\${r.suggestedFix}</pre>
      </div>
    </div>\`;
  }).join('')+'</div>';
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderTable();
renderDonut();
renderPassRate();
renderTimeline();
renderHeal();
</script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const { storeDir, outFile } = parseArgs();

  const tracker    = new FlakyTestTracker(storeDir);
  const analyzer   = new FlakyAnalyzer(tracker);
  const summaries  = analyzer.analyze({ minRuns: 1 });
  const allRecords = tracker.getAllRecords();
  const latestRecs = tracker.getLatestRunRecords();
  const timeline   = buildTimeline(allRecords);
  const healRecs   = loadHealRecords(storeDir);
  const timestamps = tracker.getRunTimestamps();
  const generatedAt= new Date().toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' });
  const latestRunAt= timestamps.length > 0 ? new Date(timestamps[0]).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' }) : 'N/A';

  const html = generateHTML(summaries, timeline, healRecs, latestRecs, timestamps.length, latestRunAt, generatedAt);

  const outDir = path.dirname(outFile);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html, 'utf-8');

  console.log('\n  ✅  HTML Report generated');
  console.log(`  📄  ${outFile}`);
  console.log(`  📊  ${summaries.length} tests  |  ${timeline.length} runs  |  ${healRecs.length} heal events\n`);
}

main();