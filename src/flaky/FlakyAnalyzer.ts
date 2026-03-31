// ─────────────────────────────────────────────────────────────────────────────
// FlakyAnalyzer.ts  –  Cross-run analysis with stability scoring & trend detection
// ─────────────────────────────────────────────────────────────────────────────
import { FlakyTestTracker }  from './FlakyTestTracker';
import { StabilityScorer }   from './scoring/StabilityScorer';
import { TrendDetector }     from './scoring/TrendDetector';
import type { FlakyTestSummary, TestRunRecord } from './types';

export interface AnalyzerOptions {
  /** Only consider the N most recent runs. @default 50 */
  lookbackRuns?: number;
  /** Minimum runs before a test is included. @default 1 */
  minRuns?: number;
  /** flakyRate threshold for reporting. @default 0.05 */
  minFlakyRate?: number;
}

export class FlakyAnalyzer {
  private readonly tracker : FlakyTestTracker;
  private readonly scorer  : StabilityScorer;
  private readonly detector: TrendDetector;

  constructor(tracker: FlakyTestTracker) {
    this.tracker  = tracker;
    this.scorer   = new StabilityScorer();
    this.detector = new TrendDetector();
  }

  /**
   * Analyse ALL tests. Returns summaries sorted by:
   * 1. Category (failing → flaky → clean)
   * 2. Stability score ascending (worst first within each category)
   */
  analyze(options: AnalyzerOptions = {}): FlakyTestSummary[] {
    const { lookbackRuns = 50, minRuns = 1 } = options;
    const records   = this.tracker.getAllRecords(lookbackRuns);
    const byTestId  = this.groupByTestId(records);
    const summaries : FlakyTestSummary[] = [];

    for (const [testId, testRecords] of byTestId.entries()) {
      if (testRecords.length < minRuns) continue;
      summaries.push(this.buildSummary(testId, testRecords));
    }

    return this.sort(summaries);
  }

  /**
   * Return all tests from the last N days.
   */
  getFlakySince(days: number, options: AnalyzerOptions = {}): FlakyTestSummary[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const records   = this.tracker.getAllRecords(options.lookbackRuns)
                          .filter((r) => new Date(r.runTimestamp) >= cutoff);
    const byTestId  = this.groupByTestId(records);
    const summaries : FlakyTestSummary[] = [];

    for (const [testId, testRecords] of byTestId.entries()) {
      if (testRecords.length < (options.minRuns ?? 1)) continue;
      summaries.push(this.buildSummary(testId, testRecords));
    }

    return this.sort(summaries);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private sort(summaries: FlakyTestSummary[]): FlakyTestSummary[] {
    const catOrder = { consistently_failing: 0, flaky: 1, clean: 2 };
    return summaries.sort((a, b) => {
      if (catOrder[a.category] !== catOrder[b.category]) {
        return catOrder[a.category] - catOrder[b.category];
      }
      // Within the same category: lowest stability score first (worst first)
      return a.stabilityScore - b.stabilityScore;
    });
  }

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
    // ── Basic counts ──────────────────────────────────────────────────────────
    const totalRuns     = records.length;
    const flakyRuns     = records.filter((r) => r.flakyInThisRun).length;
    const failedRuns    = records.filter(
      (r) => r.finalStatus === 'failed' || r.finalStatus === 'timedOut'
    ).length;
    const cleanPassRuns = records.filter(
      (r) => !r.flakyInThisRun && r.finalStatus === 'passed'
    ).length;

    const flakyRate   = totalRuns > 0 ? flakyRuns   / totalRuns : 0;
    const failureRate = totalRuns > 0 ? failedRuns  / totalRuns : 0;

    // ── Category ──────────────────────────────────────────────────────────────
    let category: FlakyTestSummary['category'];
    if (failedRuns === totalRuns) {
      category = 'consistently_failing';
    } else if (flakyRuns > 0 || (failedRuns > 0 && cleanPassRuns > 0)) {
      category = 'flaky';
    } else {
      category = 'clean';
    }

    // ── Feature 1: Stability Score ────────────────────────────────────────────
    const stability = this.scorer.score(records);

    // ── Feature 3: Trend Detection ────────────────────────────────────────────
    const trend = this.detector.detect(records);

    // ── Errors & duration ─────────────────────────────────────────────────────
    const errors = records
      .flatMap((r) => r.attempts.filter((a) => !a.passed).map((a) => a.errorMessage))
      .filter((e): e is string => !!e);
    const recentErrors = [...new Set(errors)].slice(0, 5);

    const allAttempts  = records.flatMap((r) => r.attempts);
    const avgDurationMs = allAttempts.length > 0
      ? allAttempts.reduce((s, a) => s + a.durationMs, 0) / allAttempts.length
      : 0;

    const latest = records[0]; // newest-first

    return {
      testId,
      title          : latest.title,
      file           : latest.file,
      project        : latest.project,
      totalRuns,
      flakyRuns,
      failedRuns,
      cleanPassRuns,
      flakyRate,
      failureRate,
      // Feature 1
      stabilityScore : stability.stabilityScore,
      flipRate       : stability.flipRate,
      outcomeHistory : stability.outcomeHistory,
      // Feature 3
      trend          : trend.direction,
      recentInstability : trend.recentInstability,
      prevInstability   : trend.prevInstability,
      trendDelta        : trend.delta,
      // Severity
      severity       : this.classifySeverity(flakyRate),
      category,
      recentErrors,
      avgDurationMs  : Math.round(avgDurationMs),
    };
  }

  private classifySeverity(flakyRate: number): FlakyTestSummary['severity'] {
    if (flakyRate >= 0.5)  return 'critical';
    if (flakyRate >= 0.25) return 'high';
    if (flakyRate >= 0.1)  return 'medium';
    return 'low';
  }
}