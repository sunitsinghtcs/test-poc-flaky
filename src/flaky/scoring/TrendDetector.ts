// ─────────────────────────────────────────────────────────────────────────────
// src/flaky/scoring/TrendDetector.ts
//
// Feature 3 — Trend detection: is a test getting worse, stable, or recovering?
//
// Algorithm:
//   Split the run history into two windows of equal size (default: 5 runs each).
//   Calculate instabilityRate for each window = (flaky + failed) / total
//   Compare them:
//     delta > +THRESHOLD  → rising   (getting worse)  ⬆️
//     delta < -THRESHOLD  → recovering (getting better) ⬇️
//     else                → stable   →
//     totalRuns < 4       → new      🆕
//
// The threshold prevents noise from a single run flipping the trend label.
// ─────────────────────────────────────────────────────────────────────────────
import type { TestRunRecord } from '../types';
import type { TrendResult, TrendDirection } from './types';

const DEFAULT_WINDOW  = 5;   // runs per window
const DEFAULT_THRESHOLD = 0.15; // 15% delta needed to call a trend

export class TrendDetector {
  private readonly windowSize  : number;
  private readonly threshold   : number;

  constructor(windowSize = DEFAULT_WINDOW, threshold = DEFAULT_THRESHOLD) {
    this.windowSize = windowSize;
    this.threshold  = threshold;
  }

  /**
   * Detect the trend for a test given its run records (newest-first).
   */
  detect(records: TestRunRecord[]): TrendResult {
    const totalRuns = records.length;

    // Not enough data to determine a trend
    if (totalRuns < 4) {
      return {
        direction        : 'new',
        recentInstability: this.instabilityRate(records),
        prevInstability  : 0,
        delta            : 0,
        windowSize       : totalRuns,
      };
    }

    // Records are newest-first; take the most recent window first
    const recentWindow = records.slice(0, this.windowSize);
    const prevWindow   = records.slice(this.windowSize, this.windowSize * 2);

    const recentInstability = this.instabilityRate(recentWindow);
    const prevInstability   = prevWindow.length > 0
      ? this.instabilityRate(prevWindow)
      : recentInstability; // only one window available

    const delta     = recentInstability - prevInstability;
    const direction = this.classify(delta, prevWindow.length);

    return {
      direction,
      recentInstability,
      prevInstability,
      delta,
      windowSize: this.windowSize,
    };
  }

  /**
   * Return a display string for a trend direction.
   */
  static label(direction: TrendDirection): string {
    switch (direction) {
      case 'rising'    : return '⬆️  Rising';
      case 'recovering': return '⬇️  Recovering';
      case 'stable'    : return '→  Stable';
      case 'new'       : return '🆕 New';
    }
  }

  /**
   * Return a short emoji for compact display.
   */
  static icon(direction: TrendDirection): string {
    switch (direction) {
      case 'rising'    : return '⬆️';
      case 'recovering': return '⬇️';
      case 'stable'    : return '→';
      case 'new'       : return '🆕';
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private instabilityRate(records: TestRunRecord[]): number {
    if (records.length === 0) return 0;
    const unstable = records.filter(
      (r) => r.flakyInThisRun ||
             r.finalStatus === 'failed' ||
             r.finalStatus === 'timedOut'
    ).length;
    return unstable / records.length;
  }

  private classify(delta: number, prevWindowLength: number): TrendDirection {
    // If there's no previous window we can't compare
    if (prevWindowLength === 0) return 'stable';
    if (delta > this.threshold)  return 'rising';
    if (delta < -this.threshold) return 'recovering';
    return 'stable';
  }
}