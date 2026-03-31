// ─────────────────────────────────────────────────────────────────────────────
// index.ts  –  Public API for the flaky identification module
// ─────────────────────────────────────────────────────────────────────────────
export { FlakyTestTracker } from './FlakyTestTracker';
export { FlakyAnalyzer }    from './FlakyAnalyzer';
export type { AnalyzerOptions } from './FlakyAnalyzer';

export { StabilityScorer }  from './scoring/StabilityScorer';
export { TrendDetector }    from './scoring/TrendDetector';
export type { StabilityResult, TrendResult, TrendDirection, RunOutcome } from './scoring/types';

export type {
  TestAttempt,
  TestRunRecord,
  FlakyTestSummary,
  FlakyStore,
} from './types';

// Default export is the Playwright reporter
export { default as FlakyReporter } from './FlakyReporter';