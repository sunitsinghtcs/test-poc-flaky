// ─────────────────────────────────────────────────────────────────────────────
// FlakyAnalyzer.ts  –  Cross-run flakiness analysis
// ─────────────────────────────────────────────────────────────────────────────
import { FlakyTestTracker } from './FlakyTestTracker';
import type { FlakyTestSummary, TestRunRecord } from './types';

export interface AnalyzerOptions {
  /**
   * Only consider the N most recent runs.
   * @default 50
   */
  lookbackRuns?: number;
  /**
   * Minimum number of runs a test must appear in before it is included.
   * @default 1
   */
  minRuns?: number;
  /**
   * flakyRate threshold above which a test is reported as flaky.
   * @default 0.05  (5%)
   */
  minFlakyRate?: number;
}

export class FlakyAnalyzer {
  private readonly tracker: FlakyTestTracker;

  constructor(tracker: FlakyTestTracker) {
    this.tracker = tracker;
  }

  /**
   * Analyse the stored records and return summaries for ALL tests,
   * grouped into: consistently_failing | flaky | clean.
   * Sorted by: failing first, then flaky by rate, then clean.
   */
  analyze(options: AnalyzerOptions = {}): FlakyTestSummary[] {
    const { lookbackRuns = 50, minRuns = 1 } = options;

    const records = this.tracker.getAllRecords(lookbackRuns);
    const byTestId = this.groupByTestId(records);

    const summaries: FlakyTestSummary[] = [];

    for (const [testId, testRecords] of byTestId.entries()) {
      if (testRecords.length < minRuns) continue;
      summaries.push(this.buildSummary(testId, testRecords));
    }

    // Sort: consistently_failing → flaky (by rate desc) → clean
    return summaries.sort((a, b) => {
      const order = { consistently_failing: 0, flaky: 1, clean: 2 };
      if (order[a.category] !== order[b.category]) {
        return order[a.category] - order[b.category];
      }
      return b.flakyRate - a.flakyRate;
    });
  }

  /**
   * Return all tests from the last N days.
   */
  getFlakySince(days: number, options: AnalyzerOptions = {}): FlakyTestSummary[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const records = this.tracker
      .getAllRecords(options.lookbackRuns)
      .filter((r) => new Date(r.runTimestamp) >= cutoff);

    const byTestId = this.groupByTestId(records);
    const summaries: FlakyTestSummary[] = [];

    for (const [testId, testRecords] of byTestId.entries()) {
      if (testRecords.length < (options.minRuns ?? 1)) continue;
      summaries.push(this.buildSummary(testId, testRecords));
    }

    return summaries.sort((a, b) => {
      const order = { consistently_failing: 0, flaky: 1, clean: 2 };
      if (order[a.category] !== order[b.category]) {
        return order[a.category] - order[b.category];
      }
      return b.flakyRate - a.flakyRate;
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private groupByTestId(records: TestRunRecord[]): Map<string, TestRunRecord[]> {
    const map = new Map<string, TestRunRecord[]>();
    for (const record of records) {
      const bucket = map.get(record.testId) ?? [];
      bucket.push(record);
      map.set(record.testId, bucket);
    }
    return map;
  }

  private buildSummary(testId: string, records: TestRunRecord[]): FlakyTestSummary {
    const totalRuns = records.length;
    const flakyRuns = records.filter((r) => r.flakyInThisRun).length;
    const failedRuns = records.filter((r) => r.finalStatus === 'failed' || r.finalStatus === 'timedOut').length;
    const cleanPassRuns = records.filter(
      (r) => !r.flakyInThisRun && r.finalStatus === 'passed'
    ).length;

    const flakyRate = totalRuns > 0 ? flakyRuns / totalRuns : 0;
    const failureRate = totalRuns > 0 ? failedRuns / totalRuns : 0;

    // Determine category
    let category: FlakyTestSummary['category'];
    if (failedRuns === totalRuns) {
      category = 'consistently_failing';
    } else if (flakyRuns > 0 || (failedRuns > 0 && cleanPassRuns > 0)) {
      category = 'flaky';
    } else {
      category = 'clean';
    }

    // Collect error messages, deduplicate, keep at most 5.
    const errors = records
      .flatMap((r) => r.attempts.filter((a) => !a.passed).map((a) => a.errorMessage))
      .filter((e): e is string => !!e);
    const recentErrors = [...new Set(errors)].slice(0, 5);

    // Average duration across all individual attempts.
    const allAttempts = records.flatMap((r) => r.attempts);
    const avgDurationMs =
      allAttempts.length > 0
        ? allAttempts.reduce((sum, a) => sum + a.durationMs, 0) / allAttempts.length
        : 0;

    const latest = records[0]; // records are stored newest-first

    return {
      testId,
      title: latest.title,
      file: latest.file,
      project: latest.project,
      totalRuns,
      flakyRuns,
      failedRuns,
      cleanPassRuns,
      flakyRate,
      failureRate,
      severity: this.classifySeverity(flakyRate),
      category,
      recentErrors,
      avgDurationMs: Math.round(avgDurationMs),
    };
  }

  private classifySeverity(flakyRate: number): FlakyTestSummary['severity'] {
    if (flakyRate >= 0.5) return 'critical';
    if (flakyRate >= 0.25) return 'high';
    if (flakyRate >= 0.1) return 'medium';
    return 'low';
  }
}