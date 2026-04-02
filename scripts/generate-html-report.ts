#!/usr/bin/env ts-node
// scripts/generate-html-report.ts
// Usage:
//   npx ts-node scripts/generate-html-report.ts
//   npx ts-node scripts/generate-html-report.ts --store-dir ./flaky-results --out ./flaky-results/report.html

import * as fs   from 'fs';
import * as path from 'path';
import { FlakyTestTracker } from '../src/flaky/FlakyTestTracker';
import { FlakyAnalyzer }    from '../src/flaky/FlakyAnalyzer';
import type { FlakyTestSummary, TestRunRecord } from '../src/flaky/types';

// ── Healing store (optional) ──────────────────────────────────────────────────
interface HealingRecord {
  testId: string; title: string; file: string; project: string;
  timestamp: string; originalLocator: string; healedStrategy: string;
  healedSelector: string;
  attemptsLog: { strategy: string; selector: string; succeeded: boolean }[];
  suggestedFix: string;
}
function loadHealRecords(storeDir: string): HealingRecord[] {
  const p = path.join(storeDir, 'heal-store.json');
  if (!fs.existsSync(p)) return [];
  try { return (JSON.parse(fs.readFileSync(p, 'utf-8')) as any).records ?? []; }
  catch { return []; }
}

// ── CLI args ──────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };
  return {
    storeDir: get('--store-dir') ?? path.join(process.cwd(), 'flaky-results'),
    outFile : get('--out')       ?? path.join(process.cwd(), 'flaky-results', 'report.html'),
  };
}

// ── Timeline ──────────────────────────────────────────────────────────────────
interface RunPoint { label: string; passed: number; failed: number; flaky: number; passRate: number; }
function buildTimeline(records: TestRunRecord[]): RunPoint[] {
  const map = new Map<string, TestRunRecord[]>();
  for (const r of records) { const b = map.get(r.runTimestamp) ?? []; b.push(r); map.set(r.runTimestamp, b); }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ts, recs]) => {
    const total  = recs.length;
    const passed = recs.filter(r => r.finalStatus === 'passed' && !r.flakyInThisRun).length;
    const failed = recs.filter(r => r.finalStatus === 'failed' || r.finalStatus === 'timedOut').length;
    const flaky  = recs.filter(r => r.flakyInThisRun).length;
    return { label: new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), passed, failed, flaky, passRate: total > 0 ? Math.round((passed / total) * 100) : 0 };
  });
}

// ── Suite health score ────────────────────────────────────────────────────────
// NOTE: We deliberately DO NOT use stabilityScore (flip rate) here.
// A test that always fails has flipRate=0 → stabilityScore=100 (stably failing).
// Health score must reflect actual pass/fail outcomes, not state consistency.
//
// Formula:
//   base         = (clean / total) × 100
//   flakyPenalty = (flaky / total) × 30
//   failPenalty  = (failing / total) × 40
//   criticalHit  = criticalFlaky × 3
//   highHit      = highFlaky × 1.5
function suiteHealthScore(summaries: FlakyTestSummary[]): number {
  if (!summaries.length) return 100;
  const total    = summaries.length;
  const clean    = summaries.filter(s => s.category === 'clean').length;
  const flaky    = summaries.filter(s => s.category === 'flaky').length;
  const failing  = summaries.filter(s => s.category === 'consistently_failing').length;
  const critical = summaries.filter(s => s.severity === 'critical' && s.category === 'flaky').length;
  const high     = summaries.filter(s => s.severity === 'high'     && s.category === 'flaky').length;
  const base         = (clean   / total) * 100;
  const flakyPenalty = (flaky   / total) * 30;
  const failPenalty  = (failing / total) * 40;
  const criticalHit  = critical * 3;
  const highHit      = high     * 1.5;
  return Math.max(0, Math.min(100, Math.round(base - flakyPenalty - failPenalty - criticalHit - highHit)));
}

// ── Per-test health score (TypeScript side, also mirrored in JS) ──────────────
// clean   → 100
// flaky   → 100 - (flakyRate × 100)   e.g. 50% flaky = score 50
// failing → 0
function testHealthScore(s: FlakyTestSummary): number {
  if (s.category === 'clean')                return 100;
  if (s.category === 'consistently_failing') return 0;
  return Math.max(0, Math.round(100 - s.flakyRate * 100));
}

// ── Browser breakdown ─────────────────────────────────────────────────────────
interface BrowserRow { browser: string; total: number; clean: number; flaky: number; failing: number; passRate: number; healthScore: number; }
function buildBrowserRows(summaries: FlakyTestSummary[]): BrowserRow[] {
  const map = new Map<string, BrowserRow>();
  for (const s of summaries) {
    if (!map.has(s.project)) map.set(s.project, { browser: s.project, total: 0, clean: 0, flaky: 0, failing: 0, passRate: 0, healthScore: 0 });
    const r = map.get(s.project)!;
    r.total++;
    if (s.category === 'clean') r.clean++;
    else if (s.category === 'flaky') r.flaky++;
    else r.failing++;
  }
  for (const r of map.values()) {
    r.passRate    = r.total > 0 ? Math.round((r.clean / r.total) * 100) : 0;
    const base    = r.total > 0 ? (r.clean   / r.total) * 100 : 100;
    const flakyP  = r.total > 0 ? (r.flaky   / r.total) * 30  : 0;
    const failP   = r.total > 0 ? (r.failing / r.total) * 40  : 0;
    r.healthScore = Math.max(0, Math.min(100, Math.round(base - flakyP - failP)));
  }
  return [...map.values()].sort((a, b) => b.healthScore - a.healthScore);
}

// ── HTML builder ──────────────────────────────────────────────────────────────
function buildHTML(
  summaries  : FlakyTestSummary[],
  timeline   : RunPoint[],
  latestRecs : TestRunRecord[],
  healRecs   : HealingRecord[],
  totalRuns  : number,
  latestAt   : string,
  generatedAt: string,
): string {
  const total    = summaries.length;
  const clean    = summaries.filter(s => s.category === 'clean').length;
  const flaky    = summaries.filter(s => s.category === 'flaky').length;
  const failing  = summaries.filter(s => s.category === 'consistently_failing').length;
  const critical = summaries.filter(s => s.severity === 'critical' && s.category === 'flaky').length;
  const high     = summaries.filter(s => s.severity === 'high'     && s.category === 'flaky').length;
  const rising   = summaries.filter(s => s.trend === 'rising').length;
  const health   = suiteHealthScore(summaries);
  const passRate = total > 0 ? Math.round((clean   / total) * 100) : 0;
  const flakyRate= total > 0 ? Math.round((flaky   / total) * 100) : 0;
  const failRate = total > 0 ? Math.round((failing / total) * 100) : 0;
  const avgDur   = total > 0 ? (summaries.reduce((s, x) => s + x.avgDurationMs, 0) / total / 1000).toFixed(2) : '0';
  const hColor   = health >= 70 ? '#22c55e' : health >= 40 ? '#f59e0b' : '#ef4444';
  const hLabel   = health >= 70 ? 'Healthy'  : health >= 40 ? 'Degraded' : 'Critical';
  const browsers = buildBrowserRows(summaries);

  // Latest run stats
  const lr_total  = latestRecs.length;
  const lr_passed = latestRecs.filter(r => r.finalStatus === 'passed' && !r.flakyInThisRun).length;
  const lr_flaky  = latestRecs.filter(r => r.flakyInThisRun).length;
  const lr_failed = latestRecs.filter(r => r.finalStatus === 'failed' || r.finalStatus === 'timedOut').length;
  const lr_rate   = lr_total > 0 ? Math.round((lr_passed / lr_total) * 100) : 0;

  // Health score distribution (per-test health, not stability/flip rate)
  const hs = summaries.map(s => testHealthScore(s));
  const hsDist = [
    { label: '90-100  Excellent', color: '#22c55e', cnt: hs.filter(h => h >= 90).length },
    { label: '70-89   Good',      color: '#86efac', cnt: hs.filter(h => h >= 70 && h < 90).length },
    { label: '50-69   Fair',      color: '#f59e0b', cnt: hs.filter(h => h >= 50 && h < 70).length },
    { label: '25-49   Poor',      color: '#f97316', cnt: hs.filter(h => h >= 25 && h < 50).length },
    { label: '0-24    Critical',  color: '#ef4444', cnt: hs.filter(h => h < 25).length },
  ];
  const avgHealthScore = hs.length > 0 ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : 100;
  // Average stability score (flip rate) — separate metric
  const avgStabilityScore = summaries.length > 0 ? Math.round(summaries.reduce((a, s) => a + s.stabilityScore, 0) / summaries.length) : 100;

  // Stability distribution (flip rate based — separate from health)
  const stDist = [
    { label: '90-100 Highly Stable',   color: '#22c55e', cnt: summaries.filter(s => s.stabilityScore >= 90).length },
    { label: '70-89  Mostly Stable',   color: '#86efac', cnt: summaries.filter(s => s.stabilityScore >= 70 && s.stabilityScore < 90).length },
    { label: '50-69  Moderate',        color: '#f59e0b', cnt: summaries.filter(s => s.stabilityScore >= 50 && s.stabilityScore < 70).length },
    { label: '25-49  Highly Unstable', color: '#f97316', cnt: summaries.filter(s => s.stabilityScore >= 25 && s.stabilityScore < 50).length },
    { label: '0-24   Critical',        color: '#ef4444', cnt: summaries.filter(s => s.stabilityScore < 25).length },
  ];

  const trends = [
    { label: '⬆️ Rising',     color: '#ef4444', cnt: summaries.filter(s => s.trend === 'rising').length },
    { label: '→  Stable',     color: '#64748b', cnt: summaries.filter(s => s.trend === 'stable').length },
    { label: '⬇️ Recovering', color: '#22c55e', cnt: summaries.filter(s => s.trend === 'recovering').length },
    { label: '🆕 New',        color: '#3b82f6', cnt: summaries.filter(s => s.trend === 'new').length },
  ];

  const jsonData = JSON.stringify({ summaries, timeline, healRecs });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Test Health Report</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
:root{--bg:#080c14;--bg2:#0d1420;--bg3:#121928;--bg4:#1a2235;--border:#1e2d45;--border2:#263550;--text:#e2e8f0;--text2:#94a3b8;--text3:#64748b;--green:#22c55e;--red:#ef4444;--amber:#f59e0b;--blue:#3b82f6;--purple:#a855f7;--orange:#f97316;--r:12px;--r2:8px}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'DM Mono',monospace;min-height:100vh}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:var(--bg2)}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
.shell{max-width:1400px;margin:0 auto;padding:0 24px 60px}
header{padding:36px 0 28px;border-bottom:1px solid var(--border);margin-bottom:28px;display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:12px}
h1{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;background:linear-gradient(135deg,#e2e8f0,#94a3b8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:var(--text3);font-size:11px;margin-top:5px;letter-spacing:.5px}
.badges{display:flex;gap:8px;flex-wrap:wrap}
.badge{padding:3px 10px;border-radius:20px;font-size:10px;font-weight:500;border:1px solid;text-transform:uppercase;letter-spacing:.5px}
.pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:5px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}
.lr-banner{background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:14px 22px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.lr-title{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:var(--text2)}
.lr-stats{display:flex;gap:20px;flex-wrap:wrap}
.lr-stat{text-align:center}
.lr-stat .v{font-family:'Syne',sans-serif;font-size:20px;font-weight:800}
.lr-stat .l{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px}
.health-banner{background:linear-gradient(135deg,var(--bg2),var(--bg3));border:1px solid var(--border);border-radius:var(--r);padding:24px 28px;margin-bottom:24px;display:flex;align-items:center;gap:28px;flex-wrap:wrap}
.ring{position:relative;width:110px;height:110px;flex-shrink:0}
.ring svg{transform:rotate(-90deg)}
.ring .rl{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring .rl .n{font-family:'Syne',sans-serif;font-size:22px;font-weight:800}
.ring .rl .s{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.8px}
.health-text h2{font-family:'Syne',sans-serif;font-size:18px;font-weight:700;margin-bottom:5px}
.health-text p{color:var(--text2);font-size:12px;line-height:1.6;max-width:480px}
.hbadges{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.score-explain{background:var(--bg4);border:1px solid var(--border);border-radius:var(--r2);padding:10px 14px;margin-top:10px;font-size:10px;color:var(--text3);line-height:1.9}
.score-explain b{color:var(--text2)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:14px;margin-bottom:24px}
.kpi{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;position:relative;overflow:hidden;transition:transform .15s,border-color .15s}
.kpi:hover{transform:translateY(-2px);border-color:var(--border2)}
.kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--ac,var(--blue))}
.kpi .kl{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.kpi .kv{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;line-height:1;color:var(--ac,var(--text))}
.kpi .ks{font-size:10px;color:var(--text3);margin-top:5px}
.stitle{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;display:flex;align-items:center;gap:10px}
.stitle::after{content:'';flex:1;height:1px;background:var(--border)}
.chart-row{display:grid;grid-template-columns:260px 1fr 1fr;gap:14px;margin-bottom:24px}
@media(max-width:860px){.chart-row{grid-template-columns:1fr}}
.ccard{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:18px}
.ccard h3{font-family:'Syne',sans-serif;font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px}
.chart-h{position:relative;height:180px}
.distrow{display:flex;align-items:center;gap:10px;margin-bottom:9px}
.distrow .dl{font-size:10px;color:var(--text2);width:145px;flex-shrink:0;font-variant-numeric:tabular-nums}
.distrow .dt{flex:1;height:7px;background:var(--border);border-radius:3px;overflow:hidden}
.distrow .df{height:100%;border-radius:3px;transition:width 1s ease}
.distrow .dc{font-size:11px;color:var(--text);width:24px;text-align:right;font-weight:500}
.dist-note{margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:10px;color:var(--text3);line-height:1.8}
.donut-legend{margin-top:12px;display:flex;flex-direction:column;gap:6px}
.dl-item{display:flex;align-items:center;justify-content:space-between;font-size:11px}
.dl-dot{width:9px;height:9px;border-radius:2px;flex-shrink:0;margin-right:6px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px}
@media(max-width:700px){.two-col{grid-template-columns:1fr}}
.score-summary{display:flex;align-items:center;gap:14px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)}
.score-summary .sv{font-family:'Syne',sans-serif;font-size:26px;font-weight:800}
.score-summary .sl{font-size:10px;color:var(--text3)}
.browser-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:24px}
.bcard{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px}
.bname{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;text-transform:capitalize;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}
.bname .bhs{font-size:18px;font-weight:800}
.bstats-row{display:flex;gap:12px;margin-bottom:10px}
.bstat .bv{font-family:'Syne',sans-serif;font-size:15px;font-weight:700}
.bstat .bl{font-size:9px;color:var(--text3);text-transform:uppercase}
.pbar{height:5px;background:var(--border);border-radius:3px;overflow:hidden;margin-top:6px}
.pbf{height:100%;border-radius:3px}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.search{flex:1;min-width:180px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r2);padding:7px 12px;color:var(--text);font-family:inherit;font-size:12px;outline:none;transition:border-color .15s}
.search:focus{border-color:var(--blue)}.search::placeholder{color:var(--text3)}
.pills{display:flex;gap:5px;flex-wrap:wrap}
.pill{padding:4px 10px;border-radius:20px;font-size:10px;cursor:pointer;border:1px solid var(--border);color:var(--text2);background:var(--bg3);transition:all .12s;user-select:none}
.pill:hover{border-color:var(--border2)}
.pill.active{color:#fff;border-color:transparent}
.pill.pa-all     {background:var(--blue)}
.pill.pa-failing {background:var(--red)}
.pill.pa-flaky   {background:var(--amber);color:#000}
.pill.pa-clean   {background:var(--green);color:#000}
.pill.pa-rising  {background:var(--red)}
.pill.pa-recovering{background:var(--green);color:#000}
.ssort{background:var(--bg3);border:1px solid var(--border);border-radius:var(--r2);padding:7px 10px;color:var(--text);font-family:inherit;font-size:11px;outline:none;cursor:pointer}
.twrap{overflow-x:auto;border-radius:var(--r);border:1px solid var(--border)}
table{width:100%;border-collapse:collapse;font-size:11px}
thead th{background:var(--bg3);padding:9px 12px;text-align:left;color:var(--text3);font-weight:500;text-transform:uppercase;letter-spacing:.7px;font-size:9px;border-bottom:1px solid var(--border);white-space:nowrap}
tbody tr{border-bottom:1px solid var(--border);transition:background .1s}
tbody tr:last-child{border-bottom:none}
tbody tr:hover{background:var(--bg3)}
td{padding:9px 12px;vertical-align:middle}
.td-test{max-width:200px}
.tn{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.tf{font-size:9px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;margin-top:2px}
.sbadge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap}
.sbadge.failing{background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25)}
.sbadge.flaky{background:rgba(245,158,11,.12);color:var(--amber);border:1px solid rgba(245,158,11,.25)}
.sbadge.clean{background:rgba(34,197,94,.12);color:var(--green);border:1px solid rgba(34,197,94,.25)}
.smr{position:relative;width:34px;height:34px;flex-shrink:0}
.smr svg{transform:rotate(-90deg)}
.smrl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700}
.smr-wrap{display:flex;align-items:center;gap:6px}
.smr-lbl{font-size:10px;color:var(--text3)}
.tbadge{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:20px;font-size:9px;font-weight:500;white-space:nowrap}
.tr-rising    {background:rgba(239,68,68,.1);color:#fca5a5;border:1px solid rgba(239,68,68,.2)}
.tr-stable    {background:rgba(100,116,139,.1);color:#94a3b8;border:1px solid rgba(100,116,139,.2)}
.tr-recovering{background:rgba(34,197,94,.1);color:#86efac;border:1px solid rgba(34,197,94,.2)}
.tr-new       {background:rgba(59,130,246,.1);color:#93c5fd;border:1px solid rgba(59,130,246,.2)}
.odots{display:flex;gap:2px;align-items:center}
.od{width:7px;height:7px;border-radius:50%}
.od.pass{background:#22c55e}.od.flaky{background:#f59e0b}.od.fail{background:#ef4444}
.mbar{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.mbt{width:55px;height:4px;background:var(--border);border-radius:2px;display:inline-block;overflow:hidden;vertical-align:middle}
.mbf{height:100%;border-radius:2px}
.ec{display:inline-block;background:rgba(239,68,68,.08);color:#fca5a5;font-size:9px;padding:2px 6px;border-radius:3px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid rgba(239,68,68,.15);cursor:help}
.rc{padding:8px 12px;text-align:right;color:var(--text3);font-size:10px;background:var(--bg3);border-top:1px solid var(--border)}
.empty-state{padding:32px;text-align:center;color:var(--text3);font-size:12px}
.hcard{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px 18px;border-left:3px solid var(--amber);margin-bottom:10px}
.hcard-title{font-weight:600;font-size:12px;margin-bottom:6px}
.hcard-meta{font-size:10px;color:var(--text3);margin-bottom:8px;display:flex;gap:12px;flex-wrap:wrap}
.hrow{display:flex;gap:8px;align-items:flex-start;font-size:11px;margin-bottom:5px}
.hl{width:56px;color:var(--text3);flex-shrink:0}
code{background:var(--bg4);padding:1px 6px;border-radius:3px;font-size:10px;color:var(--text2);border:1px solid var(--border)}
.hfix{margin-top:8px;background:var(--bg4);border:1px solid var(--border2);border-radius:var(--r2);padding:9px 12px}
.hfix .fxl{color:var(--green);font-size:9px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
.hfix pre{color:var(--text2);white-space:pre-wrap;word-break:break-all;line-height:1.6;font-size:10px}
footer{border-top:1px solid var(--border);padding-top:16px;margin-top:32px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
footer span{font-size:10px;color:var(--text3)}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.kpi{animation:fadeUp .35s ease both}
.kpi:nth-child(1){animation-delay:.04s}.kpi:nth-child(2){animation-delay:.08s}
.kpi:nth-child(3){animation-delay:.12s}.kpi:nth-child(4){animation-delay:.16s}
.kpi:nth-child(5){animation-delay:.20s}.kpi:nth-child(6){animation-delay:.24s}
.kpi:nth-child(7){animation-delay:.28s}.kpi:nth-child(8){animation-delay:.32s}
</style>
</head>
<body>
<div class="shell">

<!-- Header -->
<header>
  <div>
    <h1>Test Health Report</h1>
    <div class="sub"><span class="pulse"></span>Flaky Detection &amp; Stability Analysis</div>
  </div>
  <div class="badges">
    <span class="badge" style="border-color:#1e3a5f;color:var(--blue);background:rgba(59,130,246,.06)">${totalRuns} run${totalRuns !== 1 ? 's' : ''} recorded</span>
    <span class="badge" style="border-color:var(--border2);color:var(--text3);background:var(--bg3)">${generatedAt}</span>
  </div>
</header>

<!-- Latest Run Banner -->
<div class="lr-banner">
  <div>
    <div class="lr-title">Latest Run &nbsp;<span style="font-weight:400;color:var(--text3);font-size:11px">${latestAt}</span></div>
    <div style="font-size:10px;color:var(--text3);margin-top:3px">${totalRuns} total run${totalRuns !== 1 ? 's' : ''} recorded — cross-run stats below</div>
  </div>
  <div class="lr-stats">
    <div class="lr-stat"><div class="v" style="color:var(--blue)">${lr_total}</div><div class="l">Tests</div></div>
    <div class="lr-stat"><div class="v" style="color:var(--green)">${lr_passed} <span style="font-size:13px">(${lr_rate}%)</span></div><div class="l">Passed</div></div>
    <div class="lr-stat"><div class="v" style="color:var(--amber)">${lr_flaky}</div><div class="l">Flaky</div></div>
    <div class="lr-stat"><div class="v" style="color:var(--red)">${lr_failed}</div><div class="l">Failed</div></div>
  </div>
</div>

<!-- Health Score Banner -->
<div class="health-banner">
  <div class="ring">
    <svg viewBox="0 0 110 110" width="110" height="110">
      <circle fill="none" stroke="var(--border2)" stroke-width="8" cx="55" cy="55" r="46"/>
      <circle fill="none" stroke="${hColor}" stroke-width="8" stroke-linecap="round"
        cx="55" cy="55" r="46"
        stroke-dasharray="${(2 * Math.PI * 46).toFixed(2)}"
        stroke-dashoffset="${(2 * Math.PI * 46 * (1 - health / 100)).toFixed(2)}"/>
    </svg>
    <div class="rl">
      <span class="n" style="color:${hColor}">${health}</span>
      <span class="s">/100</span>
    </div>
  </div>
  <div class="health-text">
    <h2>Suite Health: <span style="color:${hColor}">${hLabel}</span></h2>
    <p>${total} unique test+browser combinations across ${totalRuns} run${totalRuns !== 1 ? 's' : ''}.
    ${clean} always clean (${passRate}%), ${flaky} non-deterministic, ${failing} consistently failing.${healRecs.length > 0 ? ` Self-healing intercepted ${healRecs.length} locator failure${healRecs.length !== 1 ? 's' : ''}.` : ''}</p>
    <div class="hbadges">
      ${critical > 0 ? `<span class="badge" style="border-color:rgba(239,68,68,.3);color:var(--red);background:rgba(239,68,68,.06)">${critical} Critical Flaky</span>` : ''}
      ${high     > 0 ? `<span class="badge" style="border-color:rgba(249,115,22,.3);color:var(--orange);background:rgba(249,115,22,.06)">${high} High</span>` : ''}
      ${rising   > 0 ? `<span class="badge" style="border-color:rgba(239,68,68,.3);color:var(--red);background:rgba(239,68,68,.06)">&#8679; ${rising} Rising</span>` : ''}
    </div>
    <div class="score-explain">
      <b>Suite Health Score</b> = based on pass/fail outcomes (not flip rate).<br>
      Formula: base (${passRate}% clean) &minus; flaky penalty (${flakyRate}% &times;30) &minus; fail penalty (${failRate}% &times;40) &minus; severity hits = <b style="color:${hColor}">${health}/100</b>
    </div>
  </div>
</div>

<!-- KPI Cards -->
<div class="kpis">
  <div class="kpi" style="--ac:var(--blue)">
    <div class="kl">Total Tests</div><div class="kv">${total}</div><div class="ks">unique test+browser</div>
  </div>
  <div class="kpi" style="--ac:var(--green)">
    <div class="kl">Pass Rate</div><div class="kv">${passRate}%</div><div class="ks">${clean} always clean</div>
  </div>
  <div class="kpi" style="--ac:var(--amber)">
    <div class="kl">Flaky Rate</div><div class="kv">${flakyRate}%</div><div class="ks">${flaky} non-deterministic</div>
  </div>
  <div class="kpi" style="--ac:var(--red)">
    <div class="kl">Fail Rate</div><div class="kv">${failRate}%</div><div class="ks">${failing} always failing</div>
  </div>
  <div class="kpi" style="--ac:${health >= 70 ? 'var(--green)' : health >= 40 ? 'var(--amber)' : 'var(--red)'}">
    <div class="kl">Suite Health</div><div class="kv">${health}/100</div><div class="ks">pass/fail health score</div>
  </div>
  <div class="kpi" style="--ac:${avgStabilityScore >= 70 ? 'var(--green)' : avgStabilityScore >= 40 ? 'var(--amber)' : 'var(--red)'}">
    <div class="kl">Avg Flip-Rate Score</div><div class="kv">${avgStabilityScore}/100</div><div class="ks">state consistency</div>
  </div>
  <div class="kpi" style="--ac:${rising > 0 ? 'var(--red)' : 'var(--green)'}">
    <div class="kl">Rising Trend</div><div class="kv">${rising}</div><div class="ks">getting worse recently</div>
  </div>
  <div class="kpi" style="--ac:${Number(avgDur) > 5 ? 'var(--amber)' : 'var(--green)'}">
    <div class="kl">Avg Duration</div><div class="kv">${avgDur}s</div><div class="ks">per test attempt</div>
  </div>
</div>

<!-- Charts Row -->
<div class="stitle">Distribution &amp; Severity</div>
<div class="chart-row">
  <div class="ccard">
    <h3>Test Distribution</h3>
    <canvas id="donut" style="max-width:160px;margin:0 auto;display:block"></canvas>
    <div class="donut-legend">
      <div class="dl-item"><span style="display:flex;align-items:center"><span class="dl-dot" style="background:#22c55e"></span>Clean (always pass)</span><span>${clean}</span></div>
      <div class="dl-item"><span style="display:flex;align-items:center"><span class="dl-dot" style="background:#f59e0b"></span>Flaky (pass on retry)</span><span>${flaky}</span></div>
      <div class="dl-item"><span style="display:flex;align-items:center"><span class="dl-dot" style="background:#ef4444"></span>Failing (all retries)</span><span>${failing}</span></div>
    </div>
  </div>
  <div class="ccard">
    <h3>Flaky Severity Breakdown</h3>
    ${[
      { label: 'Critical  >=50%', color: '#ef4444', cnt: summaries.filter(s => s.severity === 'critical' && s.category === 'flaky').length },
      { label: 'High      25-50%', color: '#f97316', cnt: summaries.filter(s => s.severity === 'high'     && s.category === 'flaky').length },
      { label: 'Medium    10-25%', color: '#f59e0b', cnt: summaries.filter(s => s.severity === 'medium'   && s.category === 'flaky').length },
      { label: 'Low       5-10%',  color: '#22c55e', cnt: summaries.filter(s => s.severity === 'low'      && s.category === 'flaky').length },
    ].map(d => `<div class="distrow">
      <span class="dl">${d.label}</span>
      <div class="dt"><div class="df" style="width:${flaky > 0 ? Math.round((d.cnt / flaky) * 100) : 0}%;background:${d.color}"></div></div>
      <span class="dc">${d.cnt}</span>
    </div>`).join('')}
    <div class="dist-note">Severity = flaky rate per test across all runs<br>Only applies to flaky tests (${flaky} total)</div>
  </div>
  <div class="ccard">
    <h3>Pass Rate Trend</h3>
    <div class="chart-h"><canvas id="passChart"></canvas></div>
  </div>
</div>

<!-- Score + Stability Distribution -->
<div class="stitle">Health Score &amp; Flip-Rate Stability</div>
<div class="two-col">

  <div class="ccard">
    <h3>Health Score Distribution <span style="color:var(--text3);font-weight:400">(pass/fail based)</span></h3>
    <div style="font-size:10px;color:var(--text3);margin-bottom:12px">
      clean=100 &nbsp;|&nbsp; flaky = 100-(flakyRate&times;100) &nbsp;|&nbsp; failing=0
    </div>
    ${hsDist.map(d => `<div class="distrow">
      <span class="dl">${d.label}</span>
      <div class="dt"><div class="df" style="width:${total > 0 ? Math.round((d.cnt / total) * 100) : 0}%;background:${d.color}"></div></div>
      <span class="dc">${d.cnt}</span>
    </div>`).join('')}
    <div class="score-summary">
      <div>
        <div class="sv" style="color:${avgHealthScore >= 70 ? '#22c55e' : avgHealthScore >= 40 ? '#f59e0b' : '#ef4444'}">${avgHealthScore}/100</div>
        <div class="sl">avg per-test health score</div>
      </div>
      <div style="font-size:10px;color:var(--text3);line-height:1.7">
        This measures <b style="color:var(--text2)">outcome reliability</b>.<br>
        A test that always fails scores <b style="color:var(--red)">0</b>.<br>
        A test that always passes scores <b style="color:var(--green)">100</b>.
      </div>
    </div>
  </div>

  <div class="ccard">
    <h3>Flip-Rate Stability <span style="color:var(--text3);font-weight:400">(Apple algorithm)</span></h3>
    <div style="font-size:10px;color:var(--text3);margin-bottom:12px">
      Measures state consistency between consecutive runs (pass↔fail changes)
    </div>
    ${stDist.map(d => `<div class="distrow">
      <span class="dl">${d.label}</span>
      <div class="dt"><div class="df" style="width:${total > 0 ? Math.round((d.cnt / total) * 100) : 0}%;background:${d.color}"></div></div>
      <span class="dc">${d.cnt}</span>
    </div>`).join('')}
    <div class="score-summary">
      <div>
        <div class="sv" style="color:${avgStabilityScore >= 70 ? '#22c55e' : avgStabilityScore >= 40 ? '#f59e0b' : '#ef4444'}">${avgStabilityScore}/100</div>
        <div class="sl">avg flip-rate score</div>
      </div>
      <div style="font-size:10px;color:var(--text3);line-height:1.7">
        <b style="color:var(--text2)">Note:</b> Always-failing tests score <b style="color:var(--green)">100</b> here<br>
        because they <em>consistently</em> fail (0 state changes).<br>
        Use Health Score for outcome quality.
      </div>
    </div>
  </div>

</div>

<!-- Trend Breakdown -->
<div class="stitle">Trend Analysis</div>
<div class="ccard" style="margin-bottom:24px">
  <h3>Trend Breakdown &nbsp;<span style="color:var(--text3);font-weight:400;font-size:10px">Compares instability rate of recent 5 runs vs prior 5 runs (needs 4+ runs per test)</span></h3>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:14px">
    ${trends.map(t => `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r2);padding:12px 14px">
      <div style="font-size:11px;color:var(--text2);margin-bottom:6px">${t.label}</div>
      <div style="font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:${t.color}">${t.cnt}</div>
      <div style="height:4px;background:var(--border);border-radius:2px;margin-top:8px;overflow:hidden">
        <div style="height:100%;border-radius:2px;width:${total > 0 ? Math.round((t.cnt/total)*100) : 0}%;background:${t.color}"></div>
      </div>
    </div>`).join('')}
  </div>
  <div class="dist-note">
    ⬆️ Rising: instability increased &gt;15% in recent runs &nbsp;|&nbsp;
    → Stable: delta &lt;15% &nbsp;|&nbsp;
    ⬇️ Recovering: instability decreased &gt;15% &nbsp;|&nbsp;
    🆕 New: fewer than 4 runs recorded (need more data)
  </div>
</div>

<!-- Run History -->
${timeline.length > 1 ? `
<div class="stitle">Run History</div>
<div class="ccard" style="margin-bottom:24px">
  <h3>Pass / Flaky / Failed per Run</h3>
  <div class="chart-h"><canvas id="timelineChart"></canvas></div>
</div>` : ''}

<!-- Browser Breakdown -->
${browsers.length > 0 ? `
<div class="stitle">Browser Breakdown</div>
<div class="browser-grid">
  ${browsers.map(b => {
    const hc = b.healthScore >= 70 ? '#22c55e' : b.healthScore >= 40 ? '#f59e0b' : '#ef4444';
    return `<div class="bcard">
      <div class="bname">
        <span style="text-transform:capitalize">${b.browser}</span>
        <span class="bhs" style="color:${hc}">${b.healthScore}/100</span>
      </div>
      <div class="bstats-row">
        <div class="bstat"><div class="bv" style="color:var(--green)">${b.clean}</div><div class="bl">Clean</div></div>
        <div class="bstat"><div class="bv" style="color:var(--amber)">${b.flaky}</div><div class="bl">Flaky</div></div>
        <div class="bstat"><div class="bv" style="color:var(--red)">${b.failing}</div><div class="bl">Failing</div></div>
        <div class="bstat"><div class="bv">${b.total}</div><div class="bl">Total</div></div>
      </div>
      <div class="pbar"><div class="pbf" style="width:${b.passRate}%;background:${hc}"></div></div>
      <div style="font-size:9px;color:var(--text3);margin-top:4px">${b.passRate}% clean pass rate &nbsp;|&nbsp; health: ${b.healthScore}/100</div>
    </div>`;
  }).join('')}
</div>` : ''}

<!-- All Tests Table -->
<div class="stitle">All Tests</div>
<div class="toolbar">
  <input class="search" id="searchBox" placeholder="Search test name or file..." oninput="render()"/>
  <div class="pills">
    <span class="pill" id="pill-all"        onclick="setf('all',this)">All</span>
    <span class="pill" id="pill-failing"    onclick="setf('failing',this)">Failing</span>
    <span class="pill" id="pill-flaky"      onclick="setf('flaky',this)">Flaky</span>
    <span class="pill" id="pill-clean"      onclick="setf('clean',this)">Clean</span>
    <span class="pill" id="pill-rising"     onclick="setf('rising',this)">&#8679; Rising</span>
    <span class="pill" id="pill-recovering" onclick="setf('recovering',this)">&#8681; Recovering</span>
  </div>
  <select class="ssort" id="sortSel" onchange="render()">
    <option value="default">Sort: Category + Health Score</option>
    <option value="health">Health Score (worst first)</option>
    <option value="stability">Flip-Rate Score (worst first)</option>
    <option value="trend">Trend (rising first)</option>
    <option value="flakyRate">Flaky Rate</option>
    <option value="failRate">Fail Rate</option>
    <option value="runs">Runs (most first)</option>
    <option value="dur">Duration (slowest first)</option>
    <option value="name">Name A-Z</option>
  </select>
</div>
<div class="twrap">
  <table>
    <thead>
      <tr>
        <th>Status</th>
        <th>Test</th>
        <th>Browser</th>
        <th>Runs</th>
        <th title="Health Score: clean=100, flaky=100-flakyRate*100, failing=0">Health Score</th>
        <th title="Flip-Rate Score: Apple algorithm — measures state consistency">Flip-Rate</th>
        <th>Trend</th>
        <th title="Last 8 runs: green=pass, amber=flaky, red=fail">History</th>
        <th>Pass%</th>
        <th>Flaky%</th>
        <th>Fail%</th>
        <th>Sev</th>
        <th>Dur</th>
        <th>Last Error</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <div class="rc" id="rc"></div>
</div>

<!-- Self-Healing -->
<div class="stitle" style="margin-top:24px">Self-Healing Events</div>
<div id="healDiv"></div>

<footer>
  <span>Test Health Report &middot; Flaky Detection System</span>
  <span>Generated ${generatedAt}</span>
</footer>
</div>

<script>
const DATA      = ${jsonData};
const SUMMARIES = DATA.summaries;
const TIMELINE  = DATA.timeline;
const HEAL      = DATA.healRecs;

let activeFilter = 'all';

// ── Per-test health score (mirrors TypeScript function) ──────────────────────
// clean=100, failing=0, flaky=100-(flakyRate*100)
function healthScore(s) {
  if (s.category === 'clean') return 100;
  if (s.category === 'consistently_failing') return 0;
  return Math.max(0, Math.round(100 - s.flakyRate * 100));
}

function pct(r)  { return (r*100).toFixed(0)+'%'; }
function dur(ms) { return (ms/1000).toFixed(2)+'s'; }

function mbar(rate, color) {
  return '<div class="mbar"><div class="mbt"><div class="mbf" style="width:'+Math.min(100,Math.round(rate*100))+'%;background:'+color+'"></div></div>'+pct(rate)+'</div>';
}

function sbadge(s) {
  if (s.category==='consistently_failing') return '<span class="sbadge failing">&#9679; Failing</span>';
  if (s.category==='flaky')               return '<span class="sbadge flaky">&#9670; Flaky</span>';
  return '<span class="sbadge clean">&#10003; Clean</span>';
}

function scoreRing(score, title) {
  var c = score>=90?'#22c55e':score>=70?'#86efac':score>=50?'#f59e0b':score>=25?'#f97316':'#ef4444';
  var circ = 2*Math.PI*13;
  var off  = circ*(1-score/100);
  return '<div class="smr-wrap" title="'+title+'">'
    +'<div class="smr"><svg viewBox="0 0 34 34" width="34" height="34">'
    +'<circle fill="none" stroke="var(--border2)" stroke-width="3" cx="17" cy="17" r="13"/>'
    +'<circle fill="none" stroke="'+c+'" stroke-width="3" stroke-linecap="round" cx="17" cy="17" r="13"'
    +' stroke-dasharray="'+circ.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/>'
    +'</svg><div class="smrl" style="color:'+c+'">'+score+'</div></div>'
    +'</div>';
}

function trendBadge(t) {
  var map  = {rising:'tr-rising',stable:'tr-stable',recovering:'tr-recovering',new:'tr-new'};
  var icon = {rising:'&#8679;',stable:'&rarr;',recovering:'&#8681;',new:'NEW'};
  return '<span class="tbadge '+(map[t]||'tr-stable')+'">'+(icon[t]||'?')+' '+t+'</span>';
}

function histDots(h) {
  if(!h||!h.length) return '<span style="color:var(--text3)">-</span>';
  return '<div class="odots">'+h.slice(-8).map(function(o){ return '<div class="od '+o+'" title="'+o+'"></div>'; }).join('')+'</div>';
}

function sevCell(s) {
  if (s.category!=='flaky') return '<span style="color:var(--text3)">-</span>';
  var m = {critical:'var(--red)',high:'var(--orange)',medium:'var(--amber)',low:'var(--green)'};
  return '<span style="font-size:10px;color:'+(m[s.severity]||'var(--text2)')+'">'+s.severity+'</span>';
}

function render() {
  var q    = (document.getElementById('searchBox').value||'').toLowerCase();
  var sort = document.getElementById('sortSel').value;
  var rows = SUMMARIES.filter(function(s) {
    var mq = !q || s.title.toLowerCase().includes(q) || s.file.toLowerCase().includes(q);
    var mf = activeFilter==='all'         ? true :
             activeFilter==='failing'     ? s.category==='consistently_failing' :
             activeFilter==='flaky'       ? s.category==='flaky' :
             activeFilter==='clean'       ? s.category==='clean' :
             activeFilter==='rising'      ? s.trend==='rising' :
             activeFilter==='recovering'  ? s.trend==='recovering' : true;
    return mq && mf;
  });

  var catOrd = {consistently_failing:0,flaky:1,clean:2};
  var tOrd   = {rising:0,stable:1,recovering:2,new:3};

  if      (sort==='health')    rows.sort(function(a,b){ return healthScore(a)-healthScore(b); });
  else if (sort==='stability') rows.sort(function(a,b){ return a.stabilityScore-b.stabilityScore; });
  else if (sort==='trend')     rows.sort(function(a,b){ return (tOrd[a.trend]||1)-(tOrd[b.trend]||1); });
  else if (sort==='flakyRate') rows.sort(function(a,b){ return b.flakyRate-a.flakyRate; });
  else if (sort==='failRate')  rows.sort(function(a,b){ return b.failureRate-a.failureRate; });
  else if (sort==='runs')      rows.sort(function(a,b){ return b.totalRuns-a.totalRuns; });
  else if (sort==='dur')       rows.sort(function(a,b){ return b.avgDurationMs-a.avgDurationMs; });
  else if (sort==='name')      rows.sort(function(a,b){ return a.title.localeCompare(b.title); });
  else rows.sort(function(a,b){
    if (catOrd[a.category]!==catOrd[b.category]) return catOrd[a.category]-catOrd[b.category];
    return healthScore(a)-healthScore(b);
  });

  var tb = document.getElementById('tbody');
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="14"><div class="empty-state">No tests match current filter.</div></td></tr>';
    document.getElementById('rc').textContent = '';
    return;
  }

  tb.innerHTML = rows.map(function(s) {
    var pr  = s.totalRuns>0 ? s.cleanPassRuns/s.totalRuns : 0;
    var hs  = healthScore(s);
    var err = s.recentErrors&&s.recentErrors[0]
      ? '<span class="ec" title="'+s.recentErrors[0].replace(/"/g,'&quot;')+'">'+s.recentErrors[0].substring(0,35)+(s.recentErrors[0].length>35?'...':'')+'</span>'
      : '-';
    return '<tr>'
      +'<td>'+sbadge(s)+'</td>'
      +'<td class="td-test"><span class="tn" title="'+s.title+'">'+s.title+'</span><span class="tf">'+s.file+'</span></td>'
      +'<td style="color:var(--text2);text-transform:capitalize;white-space:nowrap">'+s.project+'</td>'
      +'<td style="text-align:right;color:var(--text2)">'+s.totalRuns+'</td>'
      +'<td>'+scoreRing(hs, 'Health: clean=100, flaky=100-flakyRate*100, failing=0')+'</td>'
      +'<td>'+scoreRing(s.stabilityScore, 'Flip-rate: measures state consistency between runs. Always-failing tests score 100 here.')+'</td>'
      +'<td>'+trendBadge(s.trend)+'</td>'
      +'<td>'+histDots(s.outcomeHistory)+'</td>'
      +'<td>'+mbar(pr,'#22c55e')+'</td>'
      +'<td>'+(s.category==='flaky'?mbar(s.flakyRate,'#f59e0b'):'-')+'</td>'
      +'<td>'+(s.failedRuns>0?mbar(s.failureRate,'#ef4444'):'-')+'</td>'
      +'<td>'+sevCell(s)+'</td>'
      +'<td style="white-space:nowrap">'+dur(s.avgDurationMs)+'</td>'
      +'<td>'+err+'</td>'
      +'</tr>';
  }).join('');

  document.getElementById('rc').textContent = rows.length+' of '+SUMMARIES.length+' tests';
}

function setf(f, el) {
  activeFilter = f;
  document.querySelectorAll('.pill').forEach(function(p){ p.classList.remove('active','pa-all','pa-failing','pa-flaky','pa-clean','pa-rising','pa-recovering'); });
  el.classList.add('active','pa-'+f);
  render();
}

// Set initial active pill
document.getElementById('pill-all').classList.add('active','pa-all');

// Donut
(function() {
  var clean   = SUMMARIES.filter(function(s){ return s.category==='clean'; }).length;
  var flaky   = SUMMARIES.filter(function(s){ return s.category==='flaky'; }).length;
  var failing = SUMMARIES.filter(function(s){ return s.category==='consistently_failing'; }).length;
  new Chart(document.getElementById('donut'), {
    type:'doughnut',
    data:{labels:['Clean','Flaky','Failing'],datasets:[{data:[clean,flaky,failing],backgroundColor:['#22c55e','#f59e0b','#ef4444'],borderWidth:0,hoverOffset:4}]},
    options:{responsive:true,cutout:'72%',plugins:{legend:{display:false}},animation:{duration:1000}}
  });
})();

// Pass rate chart
(function() {
  if (!TIMELINE.length) return;
  new Chart(document.getElementById('passChart'), {
    type:'line',
    data:{
      labels:TIMELINE.map(function(t){ return t.label; }),
      datasets:[{label:'Pass%',data:TIMELINE.map(function(t){ return t.passRate; }),borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.08)',fill:true,tension:.4,pointRadius:3,pointHoverRadius:5,borderWidth:2}]
    },
    options:{responsive:true,maintainAspectRatio:false,scales:{x:{ticks:{color:'#64748b',font:{size:9}},grid:{color:'rgba(255,255,255,.03)'}},y:{min:0,max:100,ticks:{color:'#64748b',font:{size:9},callback:function(v){return v+'%';}},grid:{color:'rgba(255,255,255,.03)'}}},plugins:{legend:{display:false}}}
  });
})();

// Timeline
(function() {
  var el = document.getElementById('timelineChart');
  if (!el || TIMELINE.length < 2) return;
  new Chart(el, {
    type:'bar',
    data:{
      labels:TIMELINE.map(function(t){ return t.label; }),
      datasets:[
        {label:'Passed', data:TIMELINE.map(function(t){ return t.passed; }), backgroundColor:'#22c55e',borderRadius:2,stack:'s'},
        {label:'Flaky',  data:TIMELINE.map(function(t){ return t.flaky;  }), backgroundColor:'#f59e0b',borderRadius:2,stack:'s'},
        {label:'Failed', data:TIMELINE.map(function(t){ return t.failed; }), backgroundColor:'#ef4444',borderRadius:2,stack:'s'}
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,scales:{x:{ticks:{color:'#64748b',font:{size:9}},grid:{color:'rgba(255,255,255,.03)'},stacked:true},y:{ticks:{color:'#64748b',font:{size:9}},grid:{color:'rgba(255,255,255,.03)'},stacked:true}},plugins:{legend:{labels:{color:'#94a3b8',font:{size:10},boxWidth:9,padding:10}},tooltip:{mode:'index',intersect:false}}}
  });
})();

// Heal
(function() {
  var el = document.getElementById('healDiv');
  if (!HEAL || !HEAL.length) {
    el.innerHTML = '<div class="empty-state" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r)">No self-healing events recorded yet.</div>';
    return;
  }
  var byTest = new Map();
  HEAL.forEach(function(r){ if (!byTest.has(r.testId)) byTest.set(r.testId,[]); byTest.get(r.testId).push(r); });
  el.innerHTML = [...byTest.values()].map(function(recs) {
    var r = recs[0];
    var tried = r.attemptsLog.map(function(a){ return '<div style="font-size:10px;color:'+(a.succeeded?'var(--green)':'var(--text3)')+'">'+(a.succeeded?'&#10003;':'&#10007;')+' ['+a.strategy+'] '+a.selector+'</div>'; }).join('');
    return '<div class="hcard"><div class="hcard-title">&#129657; '+r.title+'</div><div class="hcard-meta"><span>'+r.file+'</span><span>'+r.project+'</span><span>Healed '+recs.length+'x</span><span>'+new Date(r.timestamp).toLocaleString()+'</span></div><div class="hrow"><span class="hl">Original</span><code>'+r.originalLocator+'</code></div><div class="hrow"><span class="hl">Healed</span><code>page.'+r.healedSelector+'</code></div><div style="margin-top:8px;font-size:10px;color:var(--text3);margin-bottom:4px">Strategies tried:</div>'+tried+'<div class="hfix"><div class="fxl">Suggested fix</div><pre>'+r.suggestedFix+'</pre></div></div>';
  }).join('');
})();

render();
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
  const timestamps = tracker.getRunTimestamps();
  const timeline   = buildTimeline(allRecords);
  const healRecs   = loadHealRecords(storeDir);
  const totalRuns  = timestamps.length;
  const latestAt   = totalRuns > 0 ? new Date(timestamps[0]).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' }) : 'N/A';
  const genAt      = new Date().toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' });

  const html = buildHTML(summaries, timeline, latestRecs, healRecs, totalRuns, latestAt, genAt);
  const dir  = path.dirname(outFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outFile, html, 'utf-8');

  console.log('\n  HTML Report generated');
  console.log('  ' + outFile);
  console.log('  Tests: ' + summaries.length + '  |  Runs: ' + totalRuns + '  |  Heals: ' + healRecs.length + '\n');
}

main();