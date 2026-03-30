#!/usr/bin/env ts-node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/analyze-flaky.ts
//
// Usage:
//   npx ts-node scripts/analyze-flaky.ts
//   npx ts-node scripts/analyze-flaky.ts --days 30 --min-runs 1
//
// Flags:
//   --days      N    Only analyse records from the last N days  (default: all)
//   --min-runs  N    Minimum runs before a test is reported     (default: 1)
//   --store-dir DIR  Directory of flaky-store.json              (default: ./flaky-results)
// ─────────────────────────────────────────────────────────────────────────────
import * as path from 'path';
import { FlakyTestTracker } from '../src/flaky/FlakyTestTracker';
import { FlakyAnalyzer } from '../src/flaky/FlakyAnalyzer';
import type { FlakyTestSummary } from '../src/flaky/types';

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(): { days?: number; minRuns: number; storeDir: string } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  return {
    days: get('--days') ? Number(get('--days')) : undefined,
    minRuns: Number(get('--min-runs') ?? 1),
    storeDir: get('--store-dir') ?? path.join(process.cwd(), 'flaky-results'),
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function pct(rate: number): string {
  return (rate * 100).toFixed(1) + '%';
}

function bar(rate: number, width = 20): string {
  const filled = Math.round(rate * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const SEP = '─'.repeat(80);

function printTestDetail(s: FlakyTestSummary, rateLabel: string, rate: number): void {
  console.log(`\n    Test   : ${s.title}`);
  console.log(`    File   : ${s.file}`);
  console.log(`    Project: ${s.project}`);
  console.log(
    `    Runs   : ${s.totalRuns} total  |  ` +
    `${s.failedRuns} failed  |  ` +
    `${s.flakyRuns} flaky  |  ` +
    `${s.cleanPassRuns} clean`
  );
  console.log(`    ${rateLabel.padEnd(8)}: ${bar(rate)} ${pct(rate)}`);
  console.log(`    Avg dur: ${(s.avgDurationMs / 1000).toFixed(2)}s`);
  if (s.recentErrors.length > 0) {
    console.log('    Errors :');
    s.recentErrors.forEach((e) => console.log(`             • ${e.slice(0, 100)}`));
  }
}

function printReport(summaries: FlakyTestSummary[]): void {
  const failing = summaries.filter((s) => s.category === 'consistently_failing');
  const flaky   = summaries.filter((s) => s.category === 'flaky');
  const clean   = summaries.filter((s) => s.category === 'clean');

  console.log(`\n${SEP}`);
  console.log('  📊  Full Test Health Report');
  console.log(SEP);
  console.log(`  Total tests tracked : ${summaries.length}`);
  console.log(`  🔴 Consistently failing : ${failing.length}`);
  console.log(`  ⚠️  Flaky               : ${flaky.length}`);
  console.log(`  ✅ Clean               : ${clean.length}`);

  // ── Section 1: Consistently Failing ────────────────────────────────────────
  console.log(`\n${SEP}`);
  console.log('  🔴  CONSISTENTLY FAILING');
  console.log(`  These tests failed on every run (all retries exhausted)`);
  console.log(SEP);

  if (failing.length === 0) {
    console.log('  ✅  None — no consistently failing tests!\n');
  } else {
    failing.forEach((s) => printTestDetail(s, 'Fail rate', s.failureRate));
    console.log('');
  }

  // ── Section 2: Flaky ───────────────────────────────────────────────────────
  console.log(SEP);
  console.log('  ⚠️   FLAKY  (passed on retry after failing)');
  console.log(`  These tests are non-deterministic — sometimes pass, sometimes fail`);
  console.log(SEP);
  console.log('  Severity thresholds:');
  console.log('    🔴 Critical — flaky 50%+ of the time');
  console.log('    🟠 High     — flaky 25–50% of the time');
  console.log('    🟡 Medium   — flaky 10–25% of the time');
  console.log('    🟢 Low      — flaky  5–10% of the time');
  console.log('');

  if (flaky.length === 0) {
    console.log('  ✅  None — no flaky tests!\n');
  } else {
    const SEVERITY_ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
    flaky.forEach((s) => {
      console.log(`  ${SEVERITY_ICON[s.severity]} [${s.severity.toUpperCase()}]`);
      printTestDetail(s, 'Flaky rt', s.flakyRate);
    });
    console.log('');
  }

  // ── Section 3: Clean ───────────────────────────────────────────────────────
  console.log(SEP);
  console.log('  ✅  CLEAN  (always passed on first attempt)');
  console.log(SEP);

  if (clean.length === 0) {
    console.log('  (no clean tests recorded yet)\n');
  } else {
    clean.forEach((s) => {
      console.log(`\n    ✅ ${s.title}`);
      console.log(`       File   : ${s.file}  |  Project: ${s.project}`);
      console.log(`       Runs   : ${s.totalRuns}  |  Avg dur: ${(s.avgDurationMs / 1000).toFixed(2)}s`);
    });
    console.log('');
  }

  // ── Summary Table ──────────────────────────────────────────────────────────
  console.log(SEP);
  console.log('  SUMMARY TABLE');
  console.log(SEP);
  console.log(
    '  ' +
    'Status'.padEnd(24) +
    'Severity'.padEnd(12) +
    'Rate'.padEnd(14) +
    'Runs'.padEnd(7) +
    'Title'
  );
  console.log('  ' + '─'.repeat(80));

  const categoryLabel: Record<FlakyTestSummary['category'], string> = {
    consistently_failing: '🔴 Consistently Failing',
    flaky:                '⚠️  Flaky              ',
    clean:                '✅ Clean              ',
  };

  const SEVERITY_ICON_TABLE = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };

  summaries.forEach((s) => {
    let rateStr: string;
    if (s.category === 'consistently_failing') {
      rateStr = `Fail ${pct(s.failureRate)}`;
    } else if (s.category === 'flaky') {
      rateStr = `Flaky ${pct(s.flakyRate)}`;
    } else {
      rateStr = `Pass ${pct(s.cleanPassRuns / s.totalRuns)}`;
    }
    const severityStr = s.category === 'flaky'
      ? `${SEVERITY_ICON_TABLE[s.severity]} ${s.severity}`.padEnd(12)
      : '—'.padEnd(12);
    console.log(
      '  ' +
      categoryLabel[s.category] + '  ' +
      severityStr +
      rateStr.padEnd(14) +
      String(s.totalRuns).padEnd(7) +
      s.title.slice(0, 40)
    );
  });

  console.log(SEP + '\n');
}

// ── Latest run snapshot ───────────────────────────────────────────────────────

function printLatestRunSnapshot(tracker: FlakyTestTracker): void {
  const latest = tracker.getLatestRunRecords();
  if (latest.length === 0) return;

  const ts        = latest[0].runTimestamp;
  const flaky     = latest.filter((r) => r.flakyInThisRun);
  const failed    = latest.filter((r) => r.finalStatus === 'failed' || r.finalStatus === 'timedOut');
  const passed    = latest.filter((r) => !r.flakyInThisRun && r.finalStatus === 'passed');
  const passRate  = Math.round((passed.length / latest.length) * 100);

  console.log(`\n${SEP}`);
  console.log('  🕐  LATEST RUN SNAPSHOT');
  console.log(`  ${new Date(ts).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`);
  console.log(SEP);
  console.log(`  Total tests run : ${latest.length}  (this run only — per browser)`);
  console.log(`  ✅ Passed clean  : ${passed.length}   (${passRate}%)`);
  console.log(`  ⚠️  Flaky         : ${flaky.length}   (failed then passed on retry)`);
  console.log(`  🔴 Failed        : ${failed.length}   (all retries exhausted)`);
  if (flaky.length > 0) {
    console.log('\n  Flaky in this run:');
    flaky.forEach((r) => {
      const failedAttempts = r.attempts.filter((a) => !a.passed).length;
      console.log(`    ⚠️  [${r.project}] ${r.title}`);
      console.log(`       Failed ${failedAttempts} attempt(s) before passing`);
    });
  }
  console.log(SEP);
  console.log('  ↓  Cross-run analysis below compares ALL recorded runs');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const { days, minRuns, storeDir } = parseArgs();

  const tracker = new FlakyTestTracker(storeDir);
  const analyzer = new FlakyAnalyzer(tracker);
  const timestamps = tracker.getRunTimestamps();

  console.log(`\n  Store        : ${storeDir}`);
  console.log(`  Total records: ${tracker.recordCount}`);
  console.log(`  Runs recorded: ${timestamps.length}`);
  if (timestamps.length > 0) {
    console.log(`  First run    : ${new Date(timestamps[timestamps.length - 1]).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`);
    console.log(`  Latest run   : ${new Date(timestamps[0]).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`);
  }

  // Show latest run snapshot first so it matches what FlakyReporter printed
  printLatestRunSnapshot(tracker);

  let summaries: FlakyTestSummary[];

  if (days !== undefined) {
    console.log(`\n  Scope: last ${days} day(s), min ${minRuns} run(s)`);
    summaries = analyzer.getFlakySince(days, { minRuns });
  } else {
    console.log(`\n  Scope: all ${timestamps.length} run(s), min ${minRuns} run(s)`);
    summaries = analyzer.analyze({ minRuns });
  }

  printReport(summaries);

  // Exit non-zero if there are any failing or critical/high flaky tests.
  const hasProblems = summaries.some(
    (s) =>
      s.category === 'consistently_failing' ||
      (s.category === 'flaky' && (s.severity === 'critical' || s.severity === 'high'))
  );
  process.exit(hasProblems ? 1 : 0);
}

main();