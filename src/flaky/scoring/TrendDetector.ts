// ─────────────────────────────────────────────────────────────────────────────
// src/flaky/scoring/TrendDetector.ts
//
// Feature 3 — Trend detection: rising / stable / recovering / new
//
// Algorithm:
//   Split run history into two equal windows (default: 5 each).
//   instabilityRate = (flaky + failed) / total per window
//   delta = recentInstability - prevInstability
//   delta > +threshold  → rising   ⬆️
//   delta < -threshold  → recovering ⬇️
//   else                → stable   →
//   totalRuns < 4       → new      🆕
// ─────────────────────────────────────────────────────────────────────────────
import type { TestRunRecord, TrendDirection } from '../types';
import type { TrendResult } from './types';

const DEFAULT_WINDOW    = 5;
const DEFAULT_THRESHOLD = 0.15;

export class TrendDetector {
  private readonly windowSize : number;
  private readonly threshold  : number;

  constructor(windowSize = DEFAULT_WINDOW, threshold = DEFAULT_THRESHOLD) {
    this.windowSize = windowSize;
    this.threshold  = threshold;
  }

  /**
   * Detect trend for a test given its run records (newest-first).
   */
  detect(records: TestRunRecord[]): TrendResult {
    const totalRuns = records.length;

    if (totalRuns < 4) {
      return {
        direction         : 'new',
        recentInstability : this.instabilityRate(records),
        prevInstability   : 0,
        delta             : 0,
        windowSize        : totalRuns,
      };
    }

    // records are newest-first
    const recentWindow = records.slice(0, this.windowSize);
    const prevWindow   = records.slice(this.windowSize, this.windowSize * 2);

    const recentInstability = this.instabilityRate(recentWindow);
    const prevInstability   = prevWindow.length > 0
      ? this.instabilityRate(prevWindow)
      : recentInstability;

    const delta     = recentInstability - prevInstability;
    const direction = this.classify(delta, prevWindow.length);

    return { direction, recentInstability, prevInstability, delta, windowSize: this.windowSize };
  }

  /** Full display label for a trend direction. */
  static label(direction: TrendDirection): string {
    switch (direction) {
      case 'rising'    : return '⬆️  Rising';
      case 'recovering': return '⬇️  Recovering';
      case 'stable'    : return '→  Stable';
      case 'new'       : return '🆕 New';
    }
  }

  /** Short icon for compact display. */
  static icon(direction: TrendDirection): string {
    switch (direction) {
      case 'rising'    : return '⬆️';
      case 'recovering': return '⬇️';
      case 'stable'    : return '→';
      case 'new'       : return '🆕';
    }
  }

  private instabilityRate(records: TestRunRecord[]): number {
    if (!records.length) return 0;
    const unstable = records.filter(
      (r) => r.flakyInThisRun ||
             r.finalStatus === 'failed' ||
             r.finalStatus === 'timedOut'
    ).length;
    return unstable / records.length;
  }

  private classify(delta: number, prevLen: number): TrendDirection {
    if (prevLen === 0)          return 'stable';
    if (delta > this.threshold)  return 'rising';
    if (delta < -this.threshold) return 'recovering';
    return 'stable';
  }
}