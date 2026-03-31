#!/usr/bin/env ts-node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/analyze-flaky.ts
//
// Usage:
//   npx ts-node scripts/analyze-flaky.ts
//   npx ts-node scripts/analyze-flaky.ts --days 7 --min-runs 3
// ─────────────────────────────────────────────────────────────────────────────
import * as path from 'path';
import { FlakyTestTracker } from '../src/flaky/FlakyTestTracker';
import { FlakyAnalyzer }    from '../src/flaky/FlakyAnalyzer';
import { StabilityScorer }  from '../src/flaky/scoring/StabilityScorer';
import { TrendDetector }    from '../src/flaky/scoring/TrendDetector';
import type { FlakyTestSummary } from '../src/flaky/types';

// ── Args ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : undefined; };
  return {
    days    : get('--days')      ? Number(get('--days'))      : undefined,
    minRuns : Number(get('--min-runs') ?? 1),
    storeDir: get('--store-dir') ?? path.join(process.cwd(), 'flaky-results'),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const SEP  = '─'.repeat(80);
const SEP2 = '─'.repeat(40);

function pct(r: number)  { return (r * 100).toFixed(1) + '%'; }
function dur(ms: number) { return (ms / 1000).toFixed(2) + 's'; }

function bar(rate: number, width = 20): string {
  const filled = Math.round(rate * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function scoreBar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function scoreColor(score: number): string {
  if (score >= 90) return '✅';
  if (score >= 70) return '🟢';
  if (score >= 50) return '🟡';
  if (score >= 25) return '🟠';
  return '🔴';
}

// ── Latest run snapshot ───────────────────────────────────────────────────────
function printLatestRunSnapshot(tracker: FlakyTestTracker): void {
  const latest = tracker.getLatestRunRecords();
  if (!latest.length) return;

  const ts       = latest[0].runTimestamp;
  const flaky    = latest.filter((r) => r.flakyInThisRun);
  const failed   = latest.filter((r) => r.finalStatus === 'failed' || r.finalStatus === 'timedOut');
  const passed   = latest.filter((r) => !r.flakyInThisRun && r.finalStatus === 'passed');
  const passRate = Math.round((passed.length / latest.length) * 100);

  console.log(`\n${SEP}`);
  console.log('  🕐  LATEST RUN SNAPSHOT');
  console.log(`  ${new Date(ts).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' })}`);
  console.log(SEP);
  console.log(`  Total  : ${latest.length}  |  ✅ Passed: ${passed.length} (${passRate}%)  |  ⚠️  Flaky: ${flaky.length}  |  🔴 Failed: ${failed.length}`);
  if (flaky.length > 0) {
    console.log('\n  Flaky in this run:');
    flaky.forEach((r) => {
      const failedAttempts = r.attempts.filter((a) => !a.passed).length;
      console.log(`    ⚠️  [${r.project}] ${r.title} — ${failedAttempts} failed attempt(s) before passing`);
    });
  }
  console.log(SEP);
  console.log('  ↓  Cross-run analysis below');
}

// ── Print one test detail ─────────────────────────────────────────────────────
const SEVERITY_ICON = { critical:'🔴', high:'🟠', medium:'🟡', low:'🟢' } as const;

function printTestDetail(s: FlakyTestSummary): void {
  const trendLabel = TrendDetector.label(s.trend);
  const scoreLbl   = StabilityScorer.label(s.stabilityScore);

  console.log(`\n    Test    : ${s.title}`);
  console.log(`    File    : ${s.file}  |  Project: ${s.project}`);
  console.log(`    Runs    : ${s.totalRuns} total  |  ${s.failedRuns} failed  |  ${s.flakyRuns} flaky  |  ${s.cleanPassRuns} clean`);

  // Feature 1 — Stability Score
  console.log(`    Score   : ${scoreColor(s.stabilityScore)} ${s.stabilityScore}/100  ${scoreBar(s.stabilityScore)}  (${scoreLbl})`);
  console.log(`    Flip Rt : ${bar(s.flipRate)} ${pct(s.flipRate)}  — changes outcome ${pct(s.flipRate)} of consecutive runs`);

  // Outcome history visualised
  const histStr = s.outcomeHistory
    .map((o) => o === 'pass' ? '✅' : o === 'flaky' ? '⚠️' : '❌')
    .join(' ');
  console.log(`    History : ${histStr}  (oldest → newest)`);

  // Feature 3 — Trend
  const deltaStr = s.trendDelta > 0
    ? `+${pct(s.trendDelta)} worse`
    : s.trendDelta < 0
      ? `${pct(s.trendDelta)} better`
      : 'no change';
  console.log(`    Trend   : ${trendLabel}  (recent ${pct(s.recentInstability)} vs prev ${pct(s.prevInstability)} — ${deltaStr})`);

  if (s.category === 'flaky' || s.category === 'consistently_failing') {
    const rate = s.category === 'flaky' ? s.flakyRate : s.failureRate;
    const label = s.category === 'flaky' ? 'Flaky rt' : 'Fail rt ';
    console.log(`    ${label}: ${bar(rate)} ${pct(rate)}`);
  }

  console.log(`    Avg dur : ${dur(s.avgDurationMs)}`);

  if (s.recentErrors.length > 0) {
    console.log('    Errors  :');
    s.recentErrors.forEach((e) => console.log(`              • ${e.slice(0, 100)}`));
  }
}

// ── Full report ───────────────────────────────────────────────────────────────
function printReport(summaries: FlakyTestSummary[]): void {
  const failing = summaries.filter((s) => s.category === 'consistently_failing');
  const flaky   = summaries.filter((s) => s.category === 'flaky');
  const clean   = summaries.filter((s) => s.category === 'clean');

  console.log(`\n${SEP}`);
  console.log('  📊  FULL TEST HEALTH REPORT');
  console.log(SEP);
  console.log(`  Total tests tracked : ${summaries.length}`);
  console.log(`  🔴 Consistently failing : ${failing.length}`);
  console.log(`  ⚠️  Flaky               : ${flaky.length}`);
  console.log(`  ✅ Clean               : ${clean.length}`);

  // ── Consistently Failing ─────────────────────────────────────────────────
  console.log(`\n${SEP}`);
  console.log('  🔴  CONSISTENTLY FAILING');
  console.log(SEP);
  if (!failing.length) {
    console.log('  ✅  None!\n');
  } else {
    failing.forEach((s) => printTestDetail(s));
    console.log('');
  }

  // ── Flaky ────────────────────────────────────────────────────────────────
  console.log(SEP);
  console.log('  ⚠️   FLAKY  (passed on retry after failing)');
  console.log(SEP);
  console.log('  Severity:  🔴 Critical ≥50%  🟠 High 25–50%  🟡 Medium 10–25%  🟢 Low 5–10%');
  console.log('  Score   :  ✅ 90–100  🟢 70–89  🟡 50–69  🟠 25–49  🔴 0–24');
  console.log('  Trend   :  ⬆️ Rising  → Stable  ⬇️ Recovering  🆕 New');
  console.log('');
  if (!flaky.length) {
    console.log('  ✅  None!\n');
  } else {
    flaky.forEach((s) => {
      console.log(`  ${SEVERITY_ICON[s.severity]} [${s.severity.toUpperCase()}]`);
      printTestDetail(s);
    });
    console.log('');
  }

  // ── Clean ────────────────────────────────────────────────────────────────
  console.log(SEP);
  console.log('  ✅  CLEAN');
  console.log(SEP);
  if (!clean.length) {
    console.log('  (none yet)\n');
  } else {
    clean.forEach((s) => {
      const trendLabel = TrendDetector.label(s.trend);
      console.log(`\n    ✅ ${s.title}  [${s.project}]`);
      console.log(`       Score: ${s.stabilityScore}/100  |  Trend: ${trendLabel}  |  Runs: ${s.totalRuns}  |  Avg: ${dur(s.avgDurationMs)}`);
    });
    console.log('');
  }

  // ── Ranked summary table ─────────────────────────────────────────────────
  console.log(SEP);
  console.log('  RANKED SUMMARY  (sorted by stability score — worst first within category)');
  console.log(SEP);
  console.log(
    '  ' +
    'Rank'.padEnd(6) +
    'Score'.padEnd(8) +
    'Trend'.padEnd(16) +
    'Status'.padEnd(24) +
    'Sev'.padEnd(10) +
    'Runs'.padEnd(7) +
    'Title'
  );
  console.log('  ' + '─'.repeat(90));

  summaries.forEach((s, i) => {
    const catLabel: Record<string,string> = {
      consistently_failing: '🔴 Failing ',
      flaky                : '⚠️  Flaky  ',
      clean                : '✅ Clean  ',
    };
    const sevStr = s.category === 'flaky'
      ? `${SEVERITY_ICON[s.severity]} ${s.severity}`.padEnd(10)
      : '—'.padEnd(10);
    console.log(
      '  ' +
      `#${i+1}`.padEnd(6) +
      `${s.stabilityScore}/100`.padEnd(8) +
      `${TrendDetector.icon(s.trend)} ${s.trend}`.padEnd(16) +
      catLabel[s.category].padEnd(24) +
      sevStr +
      String(s.totalRuns).padEnd(7) +
      s.title.slice(0, 42)
    );
  });

  console.log(SEP + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main(): void {
  const { days, minRuns, storeDir } = parseArgs();

  const tracker    = new FlakyTestTracker(storeDir);
  const analyzer   = new FlakyAnalyzer(tracker);
  const timestamps = tracker.getRunTimestamps();

  console.log(`\n  Store        : ${storeDir}`);
  console.log(`  Records      : ${tracker.recordCount}`);
  console.log(`  Runs recorded: ${timestamps.length}`);
  if (timestamps.length > 0) {
    console.log(`  First run    : ${new Date(timestamps[timestamps.length-1]).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}`);
    console.log(`  Latest run   : ${new Date(timestamps[0]).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}`);
  }

  printLatestRunSnapshot(tracker);

  const summaries = days !== undefined
    ? analyzer.getFlakySince(days, { minRuns })
    : analyzer.analyze({ minRuns });

  console.log(`\n  Scope: ${days !== undefined ? `last ${days} day(s)` : `all ${timestamps.length} run(s)`}, min ${minRuns} run(s)`);

  printReport(summaries);

  const hasProblems = summaries.some(
    (s) => s.category === 'consistently_failing' ||
           (s.category === 'flaky' && (s.severity === 'critical' || s.severity === 'high'))
  );
  process.exit(hasProblems ? 1 : 0);
}

main();