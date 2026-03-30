# Flaky Test Identification System

A TypeScript-based flaky test detection system built on top of Playwright. It automatically tracks test results across runs, identifies non-deterministic tests, and generates a full health report — both locally and in GitHub Actions CI.

---

## What Is a Flaky Test?

A flaky test is one that produces inconsistent results without any code change — sometimes passing, sometimes failing. Flaky tests erode trust in your test suite and slow down development.

This system identifies three categories of tests:

| Category | Description |
|---|---|
| 🔴 Consistently Failing | Fails on every run even after all retries |
| ⚠️ Flaky | Fails on first attempt but passes on retry — non-deterministic |
| ✅ Clean | Always passes on the first attempt |

---

## Project Structure

```
test-poc-flaky/
├── src/
│   └── flaky/
│       ├── types.ts              # Shared TypeScript interfaces
│       ├── FlakyTestTracker.ts   # Reads/writes flaky-store.json
│       ├── FlakyReporter.ts      # Custom Playwright reporter
│       ├── FlakyAnalyzer.ts      # Cross-run analysis engine
│       └── index.ts              # Barrel exports
├── scripts/
│   └── analyze-flaky.ts          # CLI report tool
├── tests/
│   ├── example.spec.ts           # Original tests
│   └── playwright-dev.spec.ts    # Additional test scenarios
├── .github/
│   └── workflows/
│       └── flaky-detection.yml   # GitHub Actions CI workflow
├── playwright.config.ts          # Playwright config with FlakyReporter wired in
├── tsconfig.json
└── package.json
```

---

## How It Works

```
npx playwright test
        ↓
FlakyReporter hooks into every test result
        ↓
Captures pass/fail per attempt including retries
        ↓
Writes results to flaky-results/flaky-store.json
        ↓
npm run flaky:analyze
        ↓
FlakyAnalyzer reads store → prints full health report
```

The store accumulates data across multiple runs. The more runs recorded, the more accurate the flakiness rates become.

---

## Getting Started

### Install dependencies

```bash
npm install
npx playwright install --with-deps
```

### Run tests

```bash
npx playwright test
```

After every run, the `FlakyReporter` automatically prints a per-run summary:

```
──────────────────────────────────────
  🔍  Flaky Test Report (this run)
──────────────────────────────────────
  Total tests                : 12
  Flaky (passed after retry) : 2
  Failed (all retries)       : 1
──────────────────────────────────────
```

Results are saved to `flaky-results/flaky-store.json`.

### Analyse cross-run trends

```bash
# Full history
npm run flaky:analyze

# Last 7 days only
npm run flaky:analyze:recent

# Stricter threshold — minimum 5 runs
npm run flaky:analyze:strict
```

---

## Sample Report Output

```
────────────────────────────────────────────────────────────────────────────────
  📊  Full Test Health Report
────────────────────────────────────────────────────────────────────────────────
  Total tests tracked      : 12
  🔴 Consistently failing  : 1
  ⚠️  Flaky                : 2
  ✅ Clean                 : 9

────────────────────────────────────────────────────────────────────────────────
  🔴  CONSISTENTLY FAILING
────────────────────────────────────────────────────────────────────────────────

    Test   : get community link
    File   : tests/example.spec.ts
    Project: chromium
    Runs   : 4 total  |  4 failed  |  0 flaky  |  0 clean
    Fail rate: ████████████████████ 100.0%

────────────────────────────────────────────────────────────────────────────────
  ⚠️   FLAKY  (passed on retry after failing)
────────────────────────────────────────────────────────────────────────────────
  Severity thresholds:
    🔴 Critical — flaky 50%+ of the time
    🟠 High     — flaky 25–50% of the time
    🟡 Medium   — flaky 10–25% of the time
    🟢 Low      — flaky  5–10% of the time

  🔴 [CRITICAL]
    Test   : search opens via keyboard shortcut
    File   : tests/playwright-dev.spec.ts
    Project: chromium
    Runs   : 4 total  |  0 failed  |  4 flaky  |  0 clean
    Flaky rt: ████████████████████ 100.0%

────────────────────────────────────────────────────────────────────────────────
  ✅  CLEAN  (always passed on first attempt)
────────────────────────────────────────────────────────────────────────────────

    ✅ has title
    ✅ get started link
    ...
```

---

## Severity Thresholds

Flaky tests are assigned a severity based on how often they fail:

| Severity | Flaky Rate | Icon |
|---|---|---|
| Critical | 50% or more | 🔴 |
| High | 25% – 50% | 🟠 |
| Medium | 10% – 25% | 🟡 |
| Low | 5% – 10% | 🟢 |

---
## github flaky report

npm run report:html  
open flaky-results/report.html

## GitHub Actions CI

The workflow runs automatically on every push to `main`, every pull request, and nightly at 2am UTC.

### What the workflow does

1. Restores the flaky store from cache (preserves history across runs)
2. Installs dependencies and Playwright browsers
3. Runs the full test suite with retries enabled
4. Runs the flaky analyzer and prints the report
5. Uploads the Playwright HTML report as a downloadable artifact
6. Uploads the flaky store JSON as a downloadable artifact
7. Writes the flaky report to the GitHub Actions job summary

### Viewing results in GitHub

After a workflow run navigate to:

```
Actions → <workflow run> → Summary
```

The full flaky report is embedded directly in the job summary — no need to download any artifacts.

### Artifacts available per run

| Artifact | Contents | Retained for |
|---|---|---|
| `playwright-report-<run_id>` | HTML test report | 14 days |
| `flaky-store-<run_id>` | Raw JSON store | 30 days |

### Flaky store caching

The `flaky-results/flaky-store.json` file is cached between workflow runs using `actions/cache`. This is what enables cross-run trend analysis — without it, history would reset on every run.

The cache is scoped per branch so `main` and feature branches track flakiness independently.

---

## npm Scripts

| Script | Description |
|---|---|
| `npm test` | Run tests locally |
| `npm run test:ci` | Run tests in CI mode (retries: 2, workers: 1) |
| `npm run flaky:analyze` | Full cross-run flaky report |
| `npm run flaky:analyze:recent` | Report for the last 7 days |
| `npm run flaky:analyze:strict` | Report with minimum 5 runs threshold |

---

## Configuration

### Playwright config

`FlakyReporter` is wired in via `playwright.config.ts`:

```ts
reporter: [
  ['html'],
  [
    './src/flaky/FlakyReporter',
    {
      storeDir: './flaky-results',   // where store is written
      pruneAfterDays: 90,            // auto-remove records older than 90 days
      printSummary: true,            // print summary after each run
    },
  ],
],
```

### Retries

Retries must be enabled for flaky detection to work:

```ts
retries: process.env.CI ? 2 : 1,
```

A test can only be identified as flaky if it gets at least one retry to recover on.

---

## Important Notes

- **Do not commit `flaky-results/`** — it is in `.gitignore` and persisted via GitHub Actions cache instead
- **Clear the store** if you want to reset history: `rm flaky-results/flaky-store.json`
- **Minimum runs** — a test needs at least 1 run recorded before it appears in the report. Use `--min-runs 3` for more reliable rates
