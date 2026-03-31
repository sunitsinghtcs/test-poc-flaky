// ─────────────────────────────────────────────────────────────────────────────
// src/flaky/scoring/types.ts
// ─────────────────────────────────────────────────────────────────────────────
import type { RunOutcome, TrendDirection } from '../types';

export type { RunOutcome, TrendDirection };

/** Feature 1 — Result of the stability score calculation for one test. */
export interface StabilityResult {
  /** 0–100. Higher = more stable. */
  stabilityScore: number;
  /** Raw flip rate 0–1. How often consecutive runs differ. */
  flipRate: number;
  /** Number of consecutive-run state changes observed. */
  stateChanges: number;
  /** Ordered outcomes used to compute the score (oldest → newest). */
  outcomeHistory: RunOutcome[];
}

/** Feature 3 — Full trend result with comparison context. */
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