// ─────────────────────────────────────────────────────────────────────────────
// types.ts  –  Shared types for the flaky-test identification system
//
// NOTE: This file must NOT import from any sub-module (scoring/, healing/)
// to avoid circular dependencies. All primitive types live here.
// ─────────────────────────────────────────────────────────────────────────────

// ── Scoring primitives (defined here, re-exported by scoring/types.ts) ────────

/**
 * The outcome of a single run for scoring purposes.
 * pass   = passed on first attempt
 * flaky  = failed then passed on retry
 * fail   = failed all attempts
 */
export type RunOutcome = 'pass' | 'flaky' | 'fail';

/**
 * Trend direction for a test over time.
 * rising     = getting worse  ⬆️
 * stable     = no significant change  →
 * recovering = getting better  ⬇️
 * new        = fewer than 4 runs, not enough data  🆕
 */
export type TrendDirection = 'rising' | 'stable' | 'recovering' | 'new';

// ── Core test record types ────────────────────────────────────────────────────

/** One attempt (pass or fail) within a single test run. */
export interface TestAttempt {
  /** Attempt index within the run (0 = first try, 1 = first retry, …) */
  attemptIndex: number;
  /** Whether this attempt passed. */
  passed: boolean;
  /** Wall-clock duration of this attempt in milliseconds. */
  durationMs: number;
  /** Error message if the attempt failed. */
  errorMessage?: string;
}

/** Aggregated record for one test across one CI / local run. */
export interface TestRunRecord {
  /** Unique stable key: "<file>::<title>::<project>" */
  testId: string;
  title: string;
  file: string;
  /** Name of the Playwright project (e.g. "chromium"). */
  project: string;
  /** ISO timestamp when the run started. */
  runTimestamp: string;
  attempts: TestAttempt[];
  /** True when the test failed then passed on retry in this run. */
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
  /** flakyRuns / totalRuns  (0–1) */
  flakyRate: number;
  /** failedRuns / totalRuns  (0–1) */
  failureRate: number;

  // ── Feature 1: Stability Score ──────────────────────────────────────────────
  /**
   * 0–100. Higher = more stable.
   * Based on Apple's flip rate algorithm (ICSE 2022).
   */
  stabilityScore: number;
  /**
   * Raw flip rate 0–1.
   * Proportion of consecutive run pairs that produced a different outcome.
   */
  flipRate: number;
  /**
   * Ordered list of run outcomes used to compute the score (oldest → newest).
   */
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