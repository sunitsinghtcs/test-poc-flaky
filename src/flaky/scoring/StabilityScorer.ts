// ─────────────────────────────────────────────────────────────────────────────
// src/flaky/scoring/StabilityScorer.ts
//
// Feature 1 — Per-test stability score (0–100) using Apple's flip rate.
//
// Reference: "Modeling and Ranking Flaky Tests at Apple", ICSE 2022.
//
// Algorithm:
//   1. Convert each run record to a RunOutcome (pass | flaky | fail)
//   2. Walk consecutive pairs and count state changes
//   3. flipRate = stateChanges / (totalRuns - 1)
//   4. stabilityScore = round((1 - flipRate) * 100)
// ─────────────────────────────────────────────────────────────────────────────
import type { TestRunRecord, RunOutcome } from '../types';
import type { StabilityResult } from './types';

export class StabilityScorer {
  /**
   * Calculate the stability score for a test given its ordered run records.
   * Records must be sorted newest-first (as stored in FlakyTestTracker).
   */
  score(records: TestRunRecord[]): StabilityResult {
    if (records.length === 0) {
      return { stabilityScore: 100, flipRate: 0, stateChanges: 0, outcomeHistory: [] };
    }

    if (records.length === 1) {
      const outcome = this.toOutcome(records[0]);
      return {
        stabilityScore: outcome === 'pass' ? 100 : 0,
        flipRate: 0,
        stateChanges: 0,
        outcomeHistory: [outcome],
      };
    }

    // Reverse so we walk oldest → newest
    const chronological  = [...records].reverse();
    const outcomeHistory: RunOutcome[] = chronological.map((r) => this.toOutcome(r));

    let stateChanges = 0;
    for (let i = 1; i < outcomeHistory.length; i++) {
      if (outcomeHistory[i] !== outcomeHistory[i - 1]) stateChanges++;
    }

    const flipRate       = stateChanges / (records.length - 1);
    const stabilityScore = Math.max(0, Math.min(100, Math.round((1 - flipRate) * 100)));

    return { stabilityScore, flipRate, stateChanges, outcomeHistory };
  }

  /** Human-readable label for a stability score. */
  static label(score: number): string {
    if (score >= 90) return 'Highly Stable';
    if (score >= 70) return 'Mostly Stable';
    if (score >= 50) return 'Moderately Unstable';
    if (score >= 25) return 'Highly Unstable';
    return 'Critical';
  }

  /** Color category for the HTML report. */
  static colorCategory(score: number): 'green' | 'lime' | 'amber' | 'orange' | 'red' {
    if (score >= 90) return 'green';
    if (score >= 70) return 'lime';
    if (score >= 50) return 'amber';
    if (score >= 25) return 'orange';
    return 'red';
  }

  private toOutcome(record: TestRunRecord): RunOutcome {
    if (record.flakyInThisRun) return 'flaky';
    if (record.finalStatus === 'failed' || record.finalStatus === 'timedOut') return 'fail';
    return 'pass';
  }
}