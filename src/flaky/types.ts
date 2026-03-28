// ─────────────────────────────────────────────────────────────────────────────
// types.ts  –  Shared types for the flaky-test identification system
// ─────────────────────────────────────────────────────────────────────────────

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
  /** Unique stable key: "<file>::<title>" */
  testId: string;
  /** Human-readable test title. */
  title: string;
  /** Source file path relative to project root. */
  file: string;
  /** Name of the Playwright project (e.g. "chromium"). */
  project: string;
  /** ISO timestamp when the run started. */
  runTimestamp: string;
  /** All attempts in this run. */
  attempts: TestAttempt[];
  /**
   * True when the test passed on a *retry* after having failed at least once
   * – the canonical definition of a flaky test in a single run.
   */
  flakyInThisRun: boolean;
  /** Final status after all retries. */
  finalStatus: 'passed' | 'failed' | 'skipped' | 'timedOut';
}

/** Cross-run statistics for one test. */
export interface FlakyTestSummary {
  testId: string;
  title: string;
  file: string;
  project: string;
  /** Total number of runs recorded. */
  totalRuns: number;
  /** Runs in which the test was flaky (passed only after a retry). */
  flakyRuns: number;
  /** Runs in which the test ultimately failed. */
  failedRuns: number;
  /** Runs in which the test passed on the first try. */
  cleanPassRuns: number;
  /** flakyRuns / totalRuns expressed as a percentage. */
  flakyRate: number;
  /** failedRuns / totalRuns expressed as a percentage. */
  failureRate: number;
  /** Flakiness severity bucket derived from flakyRate. */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /**
   * Behavioural category:
   *  - 'consistently_failing' – fails in every run (never passes even with retries)
   *  - 'flaky'                – mixed: sometimes passes after retry
   *  - 'clean'                – always passes on first attempt
   */
  category: 'consistently_failing' | 'flaky' | 'clean';
  /** The most recently seen error messages (deduplicated). */
  recentErrors: string[];
  /** Average duration in ms across all attempts. */
  avgDurationMs: number;
}

/** The full persisted store written to disk after each run. */
export interface FlakyStore {
  /** Schema version – increment when the shape changes. */
  version: number;
  /** All run records ever saved, newest first. */
  records: TestRunRecord[];
}