import { test, expect } from '@playwright/test';

test('the logo reveals the maker card after seven clicks', async ({ page }) => {
  await page.goto('/');

  const logo = page.getByRole('button', { name: 'Among Devs logo' });
  for (let click = 0; click < 6; click++) await logo.click();
  await expect(page.getByRole('dialog', { name: 'Crafted by Daniel Huxham' })).toHaveCount(0);

  await logo.click();
  const card = page.getByRole('dialog', { name: 'Crafted by Daniel Huxham' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('A small thing, thoughtfully made.');
  await expect(card).toContainText(/Version 0\.1\.0/);
  await expect(card).toContainText(/Build \d{4}-\d{2}-\d{2}/);

  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});
