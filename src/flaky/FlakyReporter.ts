// ─────────────────────────────────────────────────────────────────────────────
// FlakyReporter.ts  –  Custom Playwright reporter for flaky test identification
// ─────────────────────────────────────────────────────────────────────────────
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import * as path from 'path';
import { FlakyTestTracker } from './FlakyTestTracker';
import type { TestAttempt, TestRunRecord } from './types';

interface FlakyReporterOptions {
  /**
   * Directory where `flaky-store.json` is written.
   * @default "<cwd>/flaky-results"
   */
  storeDir?: string;
  /**
   * Remove records older than this many days during this run.
   * Set to 0 to disable pruning.
   * @default 90
   */
  pruneAfterDays?: number;
  /**
   * Print a short flaky summary to stdout after the run.
   * @default true
   */
  printSummary?: boolean;
}

export default class FlakyReporter implements Reporter {
  private readonly tracker: FlakyTestTracker;
  private readonly runTimestamp: string;
  private readonly printSummary: boolean;
  private readonly pruneAfterDays: number;

  /** Accumulates one record per test as results arrive. */
  private readonly pendingRecords = new Map<string, TestRunRecord>();

  constructor(options: FlakyReporterOptions = {}) {
    const storeDir = options.storeDir;
    this.pruneAfterDays = options.pruneAfterDays ?? 90;
    this.printSummary = options.printSummary ?? true;
    this.tracker = new FlakyTestTracker(storeDir);
    this.runTimestamp = new Date().toISOString();
  }

  // ── Playwright reporter hooks ──────────────────────────────────────────────

  onBegin(_config: FullConfig, _suite: Suite): void {
    if (this.pruneAfterDays > 0) {
      this.tracker.pruneOlderThan(this.pruneAfterDays);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const testId = this.buildTestId(test);

    // Retrieve or initialise the accumulator for this test.
    const record = this.pendingRecords.get(testId) ?? this.initRecord(test, testId);

    const attempt: TestAttempt = {
      attemptIndex: result.retry,
      passed: result.status === 'passed',
      durationMs: result.duration,
      errorMessage: result.errors[0]?.message?.split('\n')[0], // first line only
    };

    record.attempts.push(attempt);

    // Update the final status with the latest result.
    record.finalStatus = this.mapStatus(result.status);

    // A test is flaky if it eventually passed but had at least one prior failure.
    const hadFailure = record.attempts.some((a) => !a.passed);
    const latestPassed = attempt.passed;
    record.flakyInThisRun = hadFailure && latestPassed;

    this.pendingRecords.set(testId, record);
  }

  onEnd(_result: FullResult): void {
    const records = [...this.pendingRecords.values()];
    if (records.length > 0) {
      this.tracker.saveRecords(records);
    }

    if (this.printSummary) {
      this.printFlakySummary(records);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private buildTestId(test: TestCase): string {
    const relFile = path.relative(process.cwd(), test.location.file);
    // Include project name so the same test on different browsers is tracked
    // separately.
    const project = test.parent?.project()?.name ?? 'default';
    return `${relFile}::${test.titlePath().join(' > ')}::${project}`;
  }

  private initRecord(test: TestCase, testId: string): TestRunRecord {
    const relFile = path.relative(process.cwd(), test.location.file);
    const project = test.parent?.project()?.name ?? 'default';
    const record: TestRunRecord = {
      testId,
      title: test.title,
      file: relFile,
      project,
      runTimestamp: this.runTimestamp,
      attempts: [],
      flakyInThisRun: false,
      finalStatus: 'skipped',
    };
    this.pendingRecords.set(testId, record);
    return record;
  }

  private mapStatus(
    status: TestResult['status']
  ): TestRunRecord['finalStatus'] {
    switch (status) {
      case 'passed':
        return 'passed';
      case 'failed':
        return 'failed';
      case 'timedOut':
        return 'timedOut';
      default:
        return 'skipped';
    }
  }

  private printFlakySummary(records: TestRunRecord[]): void {
    const flaky = records.filter((r) => r.flakyInThisRun);
    const failed = records.filter((r) => r.finalStatus === 'failed');

    console.log('\n──────────────────────────────────────');
    console.log('  🔍  Flaky Test Report (this run)');
    console.log('──────────────────────────────────────');
    console.log(`  Total tests   : ${records.length}`);
    console.log(`  Flaky (passed after retry) : ${flaky.length}`);
    console.log(`  Failed (all retries)       : ${failed.length}`);

    if (flaky.length > 0) {
      console.log('\n  Flaky tests:');
      flaky.forEach((r) => {
        const retries = r.attempts.length - 1;
        console.log(`    ⚠️  [${r.project}] ${r.title}`);
        console.log(`       File   : ${r.file}`);
        console.log(`       Retries needed : ${retries}`);
        const err = r.attempts.find((a) => !a.passed)?.errorMessage;
        if (err) console.log(`       First error    : ${err.slice(0, 120)}`);
      });
    }
    console.log('──────────────────────────────────────\n');
  }
}