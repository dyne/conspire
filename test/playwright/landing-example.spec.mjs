import { test, expect } from '@playwright/test';

test('landing example opens the configured room URL from an external script', async ({ page }) => {
  await page.route('https://chat.example.org/**', (route) => route.fulfill({
    contentType: 'text/html', body: '<title>Conspire room</title>',
  }));
  await page.goto(new URL('../../docs/landing-example/index.html', import.meta.url).href);
  await expect(page.getByRole('button', { name: 'Start a New Room' })).toBeVisible();
  await page.getByRole('button', { name: 'Start a New Room' }).click();
  await expect(page).toHaveURL(/^https:\/\/chat\.example\.org\/room\/[1-9A-HJ-NP-Za-km-z]+$/);
});
