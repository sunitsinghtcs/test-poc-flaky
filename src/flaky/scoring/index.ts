// ─────────────────────────────────────────────────────────────────────────────
// src/flaky/scoring/index.ts
// ─────────────────────────────────────────────────────────────────────────────
export { StabilityScorer } from './StabilityScorer';
export { TrendDetector }   from './TrendDetector';
export type { StabilityResult, TrendResult } from './types';
// RunOutcome and TrendDirection live in ../types to avoid circular deps
export type { RunOutcome, TrendDirection } from '../types';