// ─────────────────────────────────────────────────────────────────────────────
// index.ts  –  Public API for the flaky identification module
// ─────────────────────────────────────────────────────────────────────────────
export { FlakyTestTracker } from './FlakyTestTracker';
export { FlakyAnalyzer } from './FlakyAnalyzer';
export type { AnalyzerOptions } from './FlakyAnalyzer';
export type {
  TestAttempt,
  TestRunRecord,
  FlakyTestSummary,
  FlakyStore,
} from './types';
// Default export is the Playwright reporter – consumed by playwright.config.ts
export { default as FlakyReporter } from './FlakyReporter';