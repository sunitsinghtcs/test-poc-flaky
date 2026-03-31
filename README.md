# Flaky Test Identification System

A TypeScript system built on Playwright that automatically tracks test results, scores each test for stability, detects trend direction, and generates an interactive executive HTML report.

---

## Features

| Feature | Description |
|---|---|
| ✅ Flaky detection | Identifies tests that fail then pass on retry |
| 🔴 Category scoring | Consistently Failing / Flaky / Clean |
| ⭐ **Stability Score** | Per-test 0–100 score (Apple flip rate algorithm) |
| 📈 **Trend Detection** | Rising / Stable / Recovering / New per test |
| 🩹 Self-healing | Auto-recovers broken locators using 11 fallback strategies |
| 📊 HTML Dashboard | Interactive executive report with charts, scoring, filtering |
| 🔁 CI/CD ready | GitHub Actions workflow with store caching |

---

## Project Structure

```
test-poc-flaky/
├── src/
│   └── flaky/
│       ├── scoring/
│       │   ├── types.ts              ← StabilityResult, TrendResult, RunOutcome
│       │   ├── StabilityScorer.ts    ← Feature 1: Apple flip rate algorithm
│       │   ├── TrendDetector.ts      ← Feature 3: Rising/Stable/Recovering
│       │   └── index.ts
│       ├── healing/
│       │   ├── types.ts
│       │   ├── HealingStore.ts
│       │   ├── SelfHealingLocator.ts
│       │   └── selfHealingTest.ts
│       ├── types.ts                  ← All shared interfaces
│       ├── FlakyTestTracker.ts       ← Reads/writes flaky-store.json
│       ├── FlakyReporter.ts          ← Custom Playwright reporter
│       ├── FlakyAnalyzer.ts          ← Analysis engine (uses scorer + detector)
│       └── index.ts
├── scripts/
│   ├── analyze-flaky.ts              ← CLI report with scores & trends
│   ├── analyze-healing.ts            ← CLI healing events report
│   └── generate-html-report.ts      ← Interactive HTML dashboard generator
├── tests/
│   ├── example.spec.ts
│   └── playwright-dev.spec.ts
├── .github/workflows/
│   └── flaky-detection.yml
├── playwright.config.ts
├── tsconfig.json
└── package.json
```

---

## Feature 1 — Stability Score (0–100)

Based on Apple's flip rate algorithm from *"Modeling and Ranking Flaky Tests at Apple"* (ICSE 2022).

### How it works

```
1. Convert each run to an outcome: pass | flaky | fail
2. Walk consecutive pairs — count how many times the outcome changed
3. flipRate = stateChanges / (totalRuns - 1)
4. stabilityScore = round((1 - flipRate) * 100)
```

### Score bands

| Score | Label | Meaning |
|---|---|---|
| 90–100 | Highly Stable | Rarely or never changes outcome |
| 70–89 | Mostly Stable | Occasional inconsistency |
| 50–69 | Moderately Unstable | Worth investigating |
| 25–49 | Highly Unstable | Fix soon |
| 0–24 | Critical | Changes on almost every consecutive run |

### Example

```
Runs (oldest → newest): pass, pass, flaky, pass, fail, pass
Outcome history:        P  P  F  P  X  P
State changes:             0  1  1  1  1  = 4 changes out of 5 pairs
flipRate = 4/5 = 0.80
stabilityScore = round((1 - 0.80) × 100) = 20  → Critical
```

---

## Feature 3 — Trend Detection

Compares the instability rate of the most recent 5 runs against the 5 runs before that.

```
instabilityRate = (flaky + failed) / total  per window

delta = recentInstability - prevInstability

delta > +0.15  →  Rising     (getting worse)    ⬆️
delta < -0.15  →  Recovering (getting better)   ⬇️
else           →  Stable                         →
totalRuns < 4  →  New        (not enough data)  🆕
```

### Why this matters

A test that was flaky 3 months ago but has been clean for 2 weeks has a **Recovering** trend — low urgency. A test that just started flaking this week has a **Rising** trend — high urgency, fix now.

---

## CLI Report Output

Running `npm run flaky:analyze` now shows:

```
#1  Score: 0/100   Trend: ⬆️ rising       ⚠️ Flaky    🔴 critical   4 runs   search opens via keyboard shortcut
#2  Score: 0/100   Trend: → stable        🔴 Failing  —             4 runs   navigation bar has expected number of links
#3  Score: 100/100 Trend: → stable        ✅ Clean    —             4 runs   community page has welcome heading

  History : ⚠️ ⚠️ ⚠️ ⚠️  (oldest → newest)
  Score   : 🔴 0/100  ████████░░░░░░░░░░░░  (Critical)
  Flip Rt : ████████████░░░░░░░░ 60.0%
  Trend   : ⬆️ Rising  (recent 100% vs prev 80% — +20% worse)
```

---

## HTML Report

The interactive HTML dashboard now includes:

- **Latest Run Banner** — matches exactly what FlakyReporter printed
- **KPIs** — Avg Stability Score, Rising Trend count
- **Stability Score Distribution** — bar chart bucketed into 5 bands
- **Trend Breakdown** — Rising / Stable / Recovering / New counts
- **Test Table** with new columns:
  - Score ring (animated, color-coded)
  - Trend badge (Rising / Stable / Recovering / New)
  - Outcome history dots (last 8 runs: 🟢pass / 🟡flaky / 🔴fail)
- **Filter pills** — now includes ⬆️ Rising and ⬇️ Recovering filters
- **Sort options** — sort by Score ↑ (worst first) or Trend

```bash
npm run report:html
open flaky-results/report.html
```

---

## npm Scripts

| Script | Description |
|---|---|
| `npm test` | Run tests locally |
| `npm run test:ci` | Run in CI mode (retries: 2) |
| `npm run flaky:analyze` | Full CLI report with scores + trends |
| `npm run flaky:analyze:recent` | Last 7 days |
| `npm run flaky:analyze:strict` | Min 5 runs |
| `npm run healing:analyze` | Self-healing events report |
| `npm run report:html` | Generate interactive HTML dashboard |
| `npm run report:open` | Generate + open in browser (Mac) |

---

## How Retries Enable Detection

```
Attempt 1  →  ❌ FAIL
Attempt 2  →  ✅ PASS  ←  flaky! same code, different result
```

`retries: 1` is required in `playwright.config.ts`. Without retries a flaky test looks identical to a broken test.

---

## Store Files

| File | Contents | Committed? |
|---|---|---|
| `flaky-results/flaky-store.json` | All run records | ❌ gitignored, cached in CI |
| `flaky-results/heal-store.json` | Self-healing events | ❌ gitignored, cached in CI |
| `flaky-results/report.html` | Generated dashboard | ❌ gitignored, uploaded as artifact |

---

## Clear Store

```bash
rm flaky-results/flaky-store.json
```

Use this when old records from renamed test files are polluting the report.