// ─────────────────────────────────────────────────────────────────────────────
// FlakyTestTracker.ts  –  Reads / writes the JSON store on disk
// ─────────────────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import type { FlakyStore, TestRunRecord } from './types';

const STORE_VERSION = 1;

export class FlakyTestTracker {
  private readonly storePath: string;
  private store: FlakyStore;

  /**
   * @param storeDir  Directory in which `flaky-store.json` is kept.
   *                  Defaults to `<cwd>/flaky-results`.
   */
  constructor(storeDir: string = path.join(process.cwd(), 'flaky-results')) {
    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }
    this.storePath = path.join(storeDir, 'flaky-store.json');
    this.store = this.load();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Append a batch of records (one per test) and persist to disk. */
  saveRecords(records: TestRunRecord[]): void {
    // Prepend so newest is first – friendlier for manual inspection.
    this.store.records = [...records, ...this.store.records];
    this.persist();
  }

  /** Return every record whose testId matches. */
  getRecordsForTest(testId: string): TestRunRecord[] {
    return this.store.records.filter((r) => r.testId === testId);
  }

  /** Return all records, optionally limited to the N most recent runs. */
  getAllRecords(limit?: number): TestRunRecord[] {
    if (!limit) return this.store.records;
    // Grab the N most recent *run timestamps* and return records for them.
    const timestamps = [...new Set(this.store.records.map((r) => r.runTimestamp))];
    const recent = timestamps.slice(0, limit);
    return this.store.records.filter((r) => recent.includes(r.runTimestamp));
  }

  /** Remove records older than `days`. Useful for housekeeping in CI. */
  pruneOlderThan(days: number): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    this.store.records = this.store.records.filter(
      (r) => new Date(r.runTimestamp) >= cutoff
    );
    this.persist();
  }

  /** Return the total number of stored records. */
  get recordCount(): number {
    return this.store.records.length;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private load(): FlakyStore {
    if (fs.existsSync(this.storePath)) {
      try {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        const parsed = JSON.parse(raw) as FlakyStore;
        if (parsed.version === STORE_VERSION) return parsed;
        // Version mismatch – start fresh but keep a backup.
        const backup = this.storePath.replace('.json', `.v${parsed.version}.bak.json`);
        fs.copyFileSync(this.storePath, backup);
        console.warn(`[FlakyTracker] Store version mismatch – backed up to ${backup}`);
      } catch {
        console.warn('[FlakyTracker] Could not parse store – starting fresh.');
      }
    }
    return { version: STORE_VERSION, records: [] };
  }

  private persist(): void {
    fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), 'utf-8');
  }
}