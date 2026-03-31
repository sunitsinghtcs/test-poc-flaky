// ─────────────────────────────────────────────────────────────────────────────
// src/flaky/scoring/types.ts  –  Types for Feature 1 & 3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The outcome of a single run for scoring purposes.
 * Used by the flip-rate algorithm to detect state changes.
 */
export type RunOutcome = 'pass' | 'flaky' | 'fail';

/**
 * Feature 1 — Per-test stability score.
 *
 * Based on Apple's flip rate algorithm:
 * "Modeling and Ranking Flaky Tests at Apple" (ICSE 2022)
 *
 * flipRate    = stateChanges / (totalRuns - 1)
 *               where stateChange = consecutive runs with different outcomes
 *
 * stabilityScore = round((1 - flipRate) * 100)
 *               100 = perfectly stable, 0 = changes every single run
 */
export interface StabilityResult {
  /** 0–100. Higher = more stable. */
  stabilityScore: number;
  /**
   * Raw flip rate: 0.0 – 1.0.
   * How often consecutive runs produce a different outcome.
   */
  flipRate: number;
  /** Number of consecutive-run state changes observed. */
  stateChanges: number;
  /** Ordered list of outcomes used to calculate the score (oldest → newest). */
  outcomeHistory: RunOutcome[];
}

/**
 * Feature 3 — Trend direction.
 *
 * Compares the instability rate of the most recent N runs
 * against the N runs before that.
 *
 * rising     — getting worse  ⬆️
 * stable     — no significant change  →
 * recovering — getting better  ⬇️
 * new        — fewer than 4 total runs, not enough data
 */
export type TrendDirection = 'rising' | 'stable' | 'recovering' | 'new';

/**
 * Feature 3 — Full trend result with context.
 */
export interface TrendResult {
  direction: TrendDirection;
  /** Instability rate in the recent window (flaky+fail / total). */
  recentInstability: number;
  /** Instability rate in the previous window. */
  prevInstability: number;
  /** Delta: recentInstability - prevInstability. Positive = worse. */
  delta: number;
  /** How many runs were in each window. */
  windowSize: number;
}