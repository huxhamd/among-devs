import { test, expect } from '@playwright/test';

test('three colleagues join, move, vote, reconnect and return to the lobby', async ({
  browser
}) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  pages.forEach((page) => page.on('pageerror', (error) => errors.push(error.message)));
  try {
    for (const page of pages) await page.goto('/');
    await expect(pages[0].getByText('Workspace online')).toBeVisible();
    await pages[0].screenshot({ path: 'test-results/welcome.png', fullPage: true });
    await pages[0].getByLabel('YOUR DISPLAY NAME').fill('Alex');
    await pages[0].getByRole('button', { name: 'Create a workspace' }).click();
    await expect(pages[0].getByText('The team is assembling.')).toBeVisible();
    const codeText = await pages[0].locator('.code-box button').innerText();
    const code = codeText.trim().slice(0, 6);
    for (let i = 1; i < pages.length; i++) {
      await pages[i].getByLabel('YOUR DISPLAY NAME').fill(['Alex', 'Sam', 'Jo'][i]);
      await pages[i].getByLabel('WORKSPACE CODE').fill(code);
      await pages[i].getByRole('button', { name: 'Join →', exact: true }).click();
      await expect(pages[i].getByText('The team is assembling.')).toBeVisible();
    }
    await pages[0].getByRole('button', { name: 'Start sprint' }).click();
    for (const page of pages) await expect(page.getByText('Operation: ship it.')).toBeVisible();
    await pages[0].screenshot({ path: 'test-results/office.png', fullPage: true });
    const tester = await Promise.all(pages.map((page) => page.locator('.role-tag').innerText()));
    const testerIndex = tester.findIndex((role) => role.includes('THE TESTER'));
    expect(testerIndex).toBeGreaterThanOrEqual(0);
    await pages[2].reload();
    await expect(pages[2].getByText('Operation: ship it.')).toBeVisible();
    await expect(pages[2].locator('.role-tag')).toHaveText(tester[2]);
    await pages[0].keyboard.down('d');
    await pages[0].waitForTimeout(350);
    await pages[0].keyboard.up('d');
    await pages[0].getByRole('button', { name: 'Call standup' }).click();
    for (const page of pages)
      await expect(page.getByText('Who’s blocking the release?')).toBeVisible();
    await pages[0].screenshot({ path: 'test-results/standup.png', fullPage: true });
    for (const page of pages)
      await page
        .getByRole('button', { name: new RegExp(['Alex', 'Sam', 'Jo'][testerIndex]) })
        .click();
    for (const page of pages)
      await expect(page.getByText('Against all odds, shipped.')).toBeVisible();
    await pages[0].getByRole('button', { name: 'Back to lobby' }).click();
    for (const page of pages) await expect(page.getByText('The team is assembling.')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
