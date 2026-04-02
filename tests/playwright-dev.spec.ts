import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// tests/playwright-dev.spec.ts
// Core navigation and content tests for playwright.dev
// ─────────────────────────────────────────────────────────────────────────────

test('homepage loads with correct title', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await expect(page).toHaveTitle(/Playwright/);
});

test('homepage hero heading is displayed', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await expect(
    page.getByRole('heading', { name: /Playwright enables reliable end-to-end testing/i })
  ).toBeVisible();
});

test('get started link navigates to installation docs', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/docs\/intro/);
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
});

test('docs intro page has installation instructions', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/intro');
  await expect(page).toHaveTitle(/Installation/);
  await expect(page.getByText('npm init playwright')).toBeVisible();
});

test('docs sidebar navigation is present', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/intro');
  const sidebar = page.locator('.theme-doc-sidebar-container, nav[aria-label*="sidebar"], aside').first();
  await expect(sidebar).toBeVisible();
});

test('api docs page loads for Page class', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/api/class-page');
  await expect(page).toHaveURL(/class-page/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('community page is accessible from main nav', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await page.getByRole('link', { name: 'Community' }).click();
  await expect(page).toHaveURL(/community/);
});

test('docs page has working next navigation link', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/intro');
  const nextLink = page.getByRole('link', { name: /next/i }).last();
  await expect(nextLink).toBeVisible();
});

test('homepage footer is rendered', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await expect(page.getByRole('contentinfo')).toBeVisible();
});

test('release notes page lists changelog entries', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/release-notes');
  await expect(page).toHaveTitle(/Release notes/i);
  const versionHeadings = page.locator('article h2, article h3').first();
  await expect(versionHeadings).toBeVisible();
});

test('docs search button is visible', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/intro');
  const searchBtn = page.getByRole('button', { name: /search/i });
  await expect(searchBtn).toBeVisible();
});

test('homepage references supported browsers', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await expect(page.getByText(/Chromium/i).first()).toBeVisible();
});