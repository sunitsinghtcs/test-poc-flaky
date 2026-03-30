import { test, expect } from '@playwright/test';

test('search opens via keyboard shortcut', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeVisible();
});

test('navigation bar has expected number of links', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  const navLinks = page.getByRole('navigation').getByRole('link');
  await expect(navLinks).toHaveCount(7);
});

test('homepage displays current release version', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await expect(page.getByText('v1.')).toBeVisible();
});

test('community page has welcome heading', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  await page.getByRole('link', { name: 'Community' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});

test('docs sidebar is visible on introduction page', async ({ page }) => {
  await page.goto('https://playwright.dev/docs/intro', { waitUntil: 'commit' });
  await expect(page.getByRole('navigation', { name: 'Docs sidebar' })).toBeVisible();
});