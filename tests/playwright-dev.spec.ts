import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// tests/test-scenarios.spec.ts
//
// 15 test scenarios covering all four detection categories:
//   A) Always passing   — clean, stable tests
//   B) Always failing   — consistently broken tests
//   C) Flaky pass       — fails on first attempt, passes on retry
//   D) Flaky fail       — sometimes fails even after all retries
// ─────────────────────────────────────────────────────────────────────────────


// ═════════════════════════════════════════════════════════════════════════════
// CATEGORY A — ALWAYS PASSING (4 tests)
// These tests are stable and should always pass on the first attempt.
// ═════════════════════════════════════════════════════════════════════════════

test('homepage has correct page title', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await expect(page).toHaveTitle(/Playwright/);
});

test('docs page loads successfully', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/intro');
  await expect(page).toHaveTitle(/Installation/);
});

test('api reference page is accessible', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/api/class-playwright');
  await expect(page).toHaveURL(/api/);
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
});

test('get started link is present and clickable', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  const link = page.getByRole('link', { name: 'Get started' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/docs\/intro/);
});


// ═════════════════════════════════════════════════════════════════════════════
// CATEGORY B — ALWAYS FAILING (4 tests)
// These tests have incorrect assertions and will fail on every attempt.
// ═════════════════════════════════════════════════════════════════════════════

test('page should have non-existent heading', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  // This heading does not exist — will always fail
  await expect(
    page.getByRole('heading', { name: 'This Heading Does Not Exist XYZ123' })
  ).toBeVisible({ timeout: 3000 });
});

test('navigation should have exact wrong link count', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  const navLinks = page.getByRole('navigation').getByRole('link');
  // Exact count is wrong — will always fail
  await expect(navLinks).toHaveCount(999);
});

test('page should display non-existent version text', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  // This text does not exist on the page — will always fail
  await expect(page.getByText('v99.99.99-does-not-exist')).toBeVisible({ timeout: 3000 });
});

test('footer should contain invalid copyright text', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  // This exact string does not appear in the footer — will always fail
  await expect(
    page.getByText('Copyright InvalidCompany 9999')
  ).toBeVisible({ timeout: 3000 });
});


// ═════════════════════════════════════════════════════════════════════════════
// CATEGORY C — FLAKY PASS ON RETRY (4 tests)
// These tests fail on the first attempt but pass on retry.
// Uses test.info().retry — deterministic and reliable across environments.
// ═════════════════════════════════════════════════════════════════════════════

test('search icon responds to interaction', async ({ page }) => {
  // Fails on first attempt (retry=0), passes on retry (retry>=1)
  if (test.info().retry === 0) {
    throw new Error('Simulated timing issue — search not ready on first attempt');
  }
  await page.goto('https://playwright.dev/');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
});

test('homepage content renders completely', async ({ page }) => {
  // Fails on first attempt, passes on retry
  if (test.info().retry === 0) {
    throw new Error('Simulated render delay — content not fully loaded');
  }
  await page.goto('https://playwright.dev/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('navigation menu is interactive', async ({ page }) => {
  // Fails on first attempt, passes on retry
  if (test.info().retry === 0) {
    throw new Error('Simulated race condition — nav not mounted yet');
  }
  await page.goto('https://playwright.dev/');
  const nav = page.getByRole('navigation').first();
  await expect(nav).toBeVisible();
});

test('page responds to keyboard events', async ({ page }) => {
  // Fails on first attempt, passes on retry
  if (test.info().retry === 0) {
    throw new Error('Simulated focus issue — keyboard handler not attached');
  }
  await page.goto('https://playwright.dev/');
  await expect(page).toHaveTitle(/Playwright/);
});


// ═════════════════════════════════════════════════════════════════════════════
// CATEGORY D — FLAKY FAIL ON RETRY (3 tests)
// These tests fail on ALL attempts including retries — they are non-deterministic
// and broken. They show up as "consistently failing" in the report.
// ═════════════════════════════════════════════════════════════════════════════

test('changelog page has specific release entry', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/release-notes');
  // Looking for a specific old version that may not be on the page — always fails
  await expect(
    page.getByText('Version 0.0.1 Released')
  ).toBeVisible({ timeout: 3000 });
});

test('community page has exact member count text', async ({ page }) => {
  await page.goto('https://playwright.dev/community/welcome');
  // This exact text does not exist — fails every retry
  await expect(
    page.getByText('42,000,000 active members')
  ).toBeVisible({ timeout: 3000 });
});

test('docs page has non-existent code sample', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/intro');
  // This code block content does not exist — fails every retry
  await expect(
    page.getByText('playwright.magicMethod()')
  ).toBeVisible({ timeout: 3000 });
});