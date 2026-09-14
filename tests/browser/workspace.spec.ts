import { test, expect } from '@playwright/test';

test('the tester can send a nearby colleague on training with T when ready', async ({
  browser
}) => {
  const names = ['Ada', 'Linus', 'Grace', 'Ken'];
  const contexts = await Promise.all(names.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  pages.forEach((page) => page.on('pageerror', (error) => errors.push(error.message)));
  try {
    for (const page of pages) await page.goto('/');
    await pages[0].getByLabel('YOUR DISPLAY NAME').fill(names[0]);
    await pages[0].getByRole('button', { name: 'Create a workspace' }).click();
    const codeText = await pages[0].locator('.code-box button').innerText();
    const code = codeText.trim().slice(0, 6);
    for (let i = 1; i < pages.length; i++) {
      await pages[i].getByLabel('YOUR DISPLAY NAME').fill(names[i]);
      await pages[i].getByLabel('WORKSPACE CODE').fill(code);
      await pages[i].getByRole('button', { name: 'Join →', exact: true }).click();
    }
    await pages[0].getByRole('button', { name: 'Start sprint' }).click();
    for (const page of pages) await expect(page.getByText('Operation: ship it.')).toBeVisible();

    const roleReveals = pages.map((page) => page.locator('.role-reveal-card'));
    await Promise.all(roleReveals.map((reveal) => expect(reveal).toBeVisible()));
    await Promise.all(roleReveals.map((reveal) => expect(reveal).toBeHidden({ timeout: 5000 })));

    const roles = await Promise.all(pages.map((page) => page.locator('.role-tag').innerText()));
    const testerIndex = roles.findIndex((role) => role.includes('THE TESTER'));
    expect(testerIndex).toBeGreaterThanOrEqual(0);
    const testerPage = pages[testerIndex];
    const trainingButton = testerPage.locator('.context-actions button.sabotage').nth(1);

    await testerPage.keyboard.down(testerIndex < 2 ? 'd' : 'a');
    await testerPage.waitForTimeout(400);
    await testerPage.keyboard.up(testerIndex < 2 ? 'd' : 'a');
    const testerMap = testerPage.locator('.map-panel');
    await expect(testerMap.getByText('E — Call standup', { exact: true })).toBeVisible();
    await expect(testerMap.getByText(/^Training ready in \d+s$/)).toHaveCount(0);

    await expect(trainingButton).toBeDisabled();
    await testerPage.keyboard.press('t');
    for (const page of pages)
      await expect(page.locator('.role-tag')).not.toContainText('ON TRAINING');

    const nearbyDevIndex = testerIndex < 2 ? testerIndex + 1 : testerIndex - 1;
    await Promise.all([testerPage.keyboard.down('w'), pages[nearbyDevIndex].keyboard.down('w')]);
    await testerPage.waitForTimeout(700);
    await Promise.all([testerPage.keyboard.up('w'), pages[nearbyDevIndex].keyboard.up('w')]);
    await expect(testerMap.getByText('E — Call standup', { exact: true })).toHaveCount(0);
    await expect(testerMap.getByText(/^Training ready in \d+s$/)).toBeVisible();

    await expect(trainingButton).toBeEnabled({ timeout: 30_000 });
    const trainingLabel = await trainingButton.innerText();
    const targetName = trainingLabel.match(/^Send (.+) on training · T$/)?.[1];
    expect(targetName).toBeTruthy();
    const targetIndex = names.indexOf(targetName!);
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    await expect(testerMap.getByText('T — Send Dev on training', { exact: true })).toBeVisible();
    await expect(testerMap.getByText('E — Call standup', { exact: true })).toHaveCount(0);

    await testerPage.keyboard.press('t');
    await expect(pages[targetIndex].locator('.role-tag')).toContainText('ON TRAINING');
    await expect(trainingButton).toBeDisabled();
    await expect(
      testerPage.getByRole('button', { name: 'Report training notice · E', exact: true })
    ).toBeVisible();
    await expect(testerMap.getByText('E — Report training notice', { exact: true })).toBeVisible();
    await expect(testerMap.getByText('E — Call standup', { exact: true })).toHaveCount(0);
    await testerPage.keyboard.press('e');
    for (const page of pages)
      await expect(page.getByText('Who’s blocking the release?')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

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
    const roleReveals = pages.map((page) => page.locator('.role-reveal-card'));
    await Promise.all(roleReveals.map((reveal) => expect(reveal).toBeVisible()));
    const revealTitles = await Promise.all(
      roleReveals.map((reveal) => reveal.locator('h2').innerText())
    );
    expect(revealTitles.filter((title) => title === 'You are the Tester')).toHaveLength(1);
    const revealedTesterIndex = revealTitles.indexOf('You are the Tester');
    await expect(roleReveals[revealedTesterIndex]).toHaveClass(/tester/);
    await expect(pages[revealedTesterIndex].locator('.role-tag')).toHaveCSS(
      'color',
      'rgb(186, 230, 253)'
    );
    await Promise.all(roleReveals.map((reveal) => expect(reveal).toBeHidden({ timeout: 5000 })));
    await pages[0].screenshot({ path: 'test-results/office.png', fullPage: true });
    const tester = await Promise.all(pages.map((page) => page.locator('.role-tag').innerText()));
    const testerIndex = tester.findIndex((role) => role.includes('THE TESTER'));
    expect(testerIndex).toBeGreaterThanOrEqual(0);
    const repairIndex = pages.findIndex((_, index) => index !== 0 && index !== testerIndex);
    const repairPage = pages[repairIndex];
    await expect(
      repairPage.locator('.map-panel').getByText('CI operational', { exact: true })
    ).toBeVisible();
    await expect(repairPage.getByText('Restart the server', { exact: true }).first()).toBeVisible();
    const ciBanner = repairPage.locator('.ci-banner');
    await expect(ciBanner.locator('.online')).toBeVisible();
    await expect(ciBanner.locator('.outage')).toBeHidden();
    const mapTopBeforeIncident = await repairPage
      .locator('.map-panel')
      .evaluate((element) => element.getBoundingClientRect().top);
    const bannerHeightBeforeIncident = await ciBanner.evaluate(
      (element) => element.getBoundingClientRect().height
    );
    const testerPage = pages[testerIndex];
    const testerMap = testerPage.locator('.map-panel');
    const breakCiButton = testerPage.locator('.context-actions button.sabotage').first();
    await expect(breakCiButton).toBeDisabled();
    await expect(breakCiButton).toBeEnabled({ timeout: 25_000 });
    await expect(breakCiButton).toHaveText('Break CI · B');
    await testerPage.keyboard.press('b');
    await expect(repairPage.getByText('CI DOWN — REPAIR REQUIRED', { exact: true })).toBeVisible();
    await testerPage.keyboard.press('b');
    await expect(repairPage.getByText('CI DOWN — REPAIR REQUIRED', { exact: true })).toBeVisible();
    await expect(ciBanner).toHaveClass(/offline/);
    await expect(ciBanner.locator('.online')).toBeHidden();
    await expect(ciBanner.locator('.outage')).toContainText(
      'An active colleague must restore CI before tickets can continue.'
    );
    await expect(ciBanner.locator('.outage')).toBeVisible();
    const mapTopDuringIncident = await repairPage
      .locator('.map-panel')
      .evaluate((element) => element.getBoundingClientRect().top);
    const bannerHeightDuringIncident = await ciBanner.evaluate(
      (element) => element.getBoundingClientRect().height
    );
    expect(Math.abs(mapTopDuringIncident - mapTopBeforeIncident)).toBeLessThan(1);
    expect(Math.abs(bannerHeightDuringIncident - bannerHeightBeforeIncident)).toBeLessThan(1);
    await expect(repairPage.getByRole('button', { name: 'Repair CI', exact: true })).toHaveCount(0);
    await repairPage.keyboard.down('w');
    try {
      await expect(repairPage.getByText('E — Repair CI', { exact: true })).toBeVisible();
    } finally {
      await repairPage.keyboard.up('w');
    }
    await expect(
      repairPage.getByRole('button', { name: 'Repair CI · E', exact: true })
    ).toBeVisible();
    await repairPage.screenshot({ path: 'test-results/ci-console.png', fullPage: true });
    await repairPage.keyboard.press('e');
    for (const page of pages)
      await expect(
        page.locator('.map-panel').getByText('CI operational', { exact: true })
      ).toBeVisible();
    await expect(ciBanner).not.toHaveClass(/offline/);
    await expect(ciBanner.locator('.online')).toBeVisible();
    await expect(ciBanner.locator('.outage')).toBeHidden();
    await expect(
      repairPage.locator('.map-panel').getByText('CI operational ✓', { exact: true })
    ).toBeVisible();
    await expect(repairPage.getByRole('button', { name: 'Repair CI', exact: true })).toHaveCount(0);
    await expect(breakCiButton).toBeDisabled();
    await testerPage.keyboard.press('b');
    await expect(
      repairPage.locator('.map-panel').getByText('CI operational', { exact: true })
    ).toBeVisible();
    const mapTopAfterIncident = await repairPage
      .locator('.map-panel')
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(mapTopAfterIncident - mapTopBeforeIncident)).toBeLessThan(1);
    const repairToast = repairPage.locator('.toast[role="status"]');
    await expect(repairToast).toContainText('CI restored. Tickets are available again.');
    await expect(repairToast.locator('.toast-progress')).toBeVisible();
    await repairToast.hover();
    await expect(repairToast.locator('.toast-progress')).toHaveCSS(
      'animation-play-state',
      'paused'
    );
    await repairPage.waitForTimeout(4200);
    await expect(repairToast).toBeVisible();
    await repairPage.mouse.move(0, 0);
    await expect(repairToast).toBeHidden({ timeout: 5000 });
    await pages[2].reload();
    await expect(pages[2].getByText('Operation: ship it.')).toBeVisible();
    await expect(pages[2].locator('.role-tag')).toHaveText(tester[2]);
    const standupIndex = pages.findIndex(
      (_, index) => index !== testerIndex && index !== repairIndex
    );
    const standupPage = pages[standupIndex];
    await standupPage.keyboard.down('d');
    try {
      await expect(
        standupPage.getByRole('button', { name: /^Call standup \(\d+ left\) · E$/ })
      ).toBeVisible();
    } finally {
      await standupPage.keyboard.up('d');
    }
    await expect(
      standupPage.locator('.map-panel').getByText('E — Call standup', { exact: true })
    ).toBeVisible();
    await standupPage.keyboard.press('e');
    for (const page of pages)
      await expect(page.getByText('Who’s blocking the release?')).toBeVisible();
    await pages[0].screenshot({ path: 'test-results/standup.png', fullPage: true });
    for (const page of pages)
      await page.getByRole('button', { name: 'Skip · insufficient evidence' }).click();
    const missedResults = pages.map((page) =>
      page.getByRole('dialog', { name: 'Tester not identified' })
    );
    await Promise.all(missedResults.map((result) => expect(result).toBeVisible()));
    await Promise.all(
      missedResults.map(async (result) => {
        await expect(result.locator('.meeting-result-icon')).toHaveText('×');
        await expect(result).toContainText(/Resuming in [123]…/);
      })
    );
    await pages[0].screenshot({ path: 'test-results/standup-result-missed.png', fullPage: true });
    for (const page of pages) await expect(page.getByText('Operation: ship it.')).toBeVisible();

    const secondStandupPage = pages[testerIndex];
    await secondStandupPage.keyboard.down('s');
    try {
      await expect(
        secondStandupPage.getByRole('button', { name: /^Call standup \(\d+ left\) · E$/ })
      ).toBeVisible();
    } finally {
      await secondStandupPage.keyboard.up('s');
    }
    await secondStandupPage.keyboard.press('e');
    for (const page of pages)
      await expect(page.getByText('Who’s blocking the release?')).toBeVisible();
    for (const page of pages)
      await page
        .getByRole('button', { name: new RegExp(['Alex', 'Sam', 'Jo'][testerIndex]) })
        .click();
    const results = pages.map((page) => page.getByRole('dialog', { name: 'Tester identified' }));
    await Promise.all(results.map((result) => expect(result).toBeVisible()));
    await Promise.all(
      results.map(async (result) => {
        await expect(result.locator('.meeting-result-icon')).toHaveText('✓');
        await expect(result).toContainText(/Sprint ending in [123]…/);
      })
    );
    await pages[0].screenshot({
      path: 'test-results/standup-result-identified.png',
      fullPage: true
    });
    for (const page of pages)
      await expect(page.getByText('Against all odds, shipped.')).toBeVisible();
    await pages[0].getByRole('button', { name: 'Back to lobby' }).click();
    for (const page of pages) await expect(page.getByText('The team is assembling.')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
