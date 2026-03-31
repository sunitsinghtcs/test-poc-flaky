// ─────────────────────────────────────────────────────────────────────────────
// types.ts  –  Shared types for the flaky-test identification system
// ─────────────────────────────────────────────────────────────────────────────
import type { TrendDirection, RunOutcome } from './scoring/types';

/** One attempt (pass or fail) within a single test run. */
export interface TestAttempt {
  attemptIndex: number;
  passed: boolean;
  durationMs: number;
  errorMessage?: string;
}

/** Aggregated record for one test across one CI / local run. */
export interface TestRunRecord {
  testId: string;
  title: string;
  file: string;
  project: string;
  runTimestamp: string;
  attempts: TestAttempt[];
  flakyInThisRun: boolean;
  finalStatus: 'passed' | 'failed' | 'skipped' | 'timedOut';
}

/** Cross-run statistics for one test — includes Feature 1 & 3 fields. */
export interface FlakyTestSummary {
  testId: string;
  title: string;
  file: string;
  project: string;

  // ── Run counts ──────────────────────────────────────────────────────────────
  totalRuns: number;
  flakyRuns: number;
  failedRuns: number;
  cleanPassRuns: number;

  // ── Rates ───────────────────────────────────────────────────────────────────
  flakyRate: number;
  failureRate: number;

  // ── Feature 1: Stability Score (Apple flip rate algorithm) ──────────────────
  /** 0–100. Higher = more stable. 100 = never changes between runs. */
  stabilityScore: number;
  /** Raw flip rate 0–1. Proportion of consecutive run pairs that differ. */
  flipRate: number;
  /** Ordered run outcomes oldest→newest used to compute the score. */
  outcomeHistory: RunOutcome[];

  // ── Feature 3: Trend ────────────────────────────────────────────────────────
  /** rising | stable | recovering | new */
  trend: TrendDirection;
  /** Instability rate in the most recent window (0–1). */
  recentInstability: number;
  /** Instability rate in the previous window (0–1). */
  prevInstability: number;
  /** recentInstability - prevInstability. Positive = getting worse. */
  trendDelta: number;

  // ── Severity & category ─────────────────────────────────────────────────────
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'consistently_failing' | 'flaky' | 'clean';

  // ── Other ───────────────────────────────────────────────────────────────────
  recentErrors: string[];
  avgDurationMs: number;
}

/** The full persisted store written to disk after each run. */
export interface FlakyStore {
  version: number;
  records: TestRunRecord[];
}