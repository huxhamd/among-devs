import { test, expect, type Page } from '@playwright/test';

async function moveAlong(page: Page, axis: 'x' | 'y', target: number) {
  const coordinate = async () => {
    const transform = await page
      .locator('.map-player')
      .filter({ hasText: '(you)' })
      .getAttribute('transform');
    return Number(transform!.match(/-?[\d.]+/g)![axis === 'x' ? 0 : 1]);
  };
  for (let attempt = 0; attempt < 30; attempt++) {
    const start = await coordinate();
    if (Math.abs(start - target) < 12) return;
    const key = axis === 'x' ? (start < target ? 'd' : 'a') : start < target ? 's' : 'w';
    await page.keyboard.down(key);
    try {
      await page.waitForTimeout(
        Math.min(250, Math.max(50, ((Math.abs(start - target) - 8) / 190) * 1000))
      );
    } finally {
      await page.keyboard.up(key);
    }
    // Allow the authoritative update and interpolation to settle before the next pulse.
    await page.waitForTimeout(200);
  }
  expect(Math.abs((await coordinate()) - target)).toBeLessThan(12);
}

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

    await moveAlong(testerPage, 'x', 500);
    const testerMap = testerPage.locator('.map-panel');
    await expect(testerMap.getByText('E • Call standup', { exact: true })).toBeVisible();
    await expect(testerMap.getByText(/^Training ready in \d+s$/)).toHaveCount(0);

    await expect(trainingButton).toBeDisabled();
    await testerPage.keyboard.press('t');
    for (const page of pages)
      await expect(page.locator('.role-tag')).not.toContainText('ON TRAINING');

    const nearbyDevIndex = testerIndex < 2 ? testerIndex + 1 : testerIndex - 1;
    // Use the open area south of standup, away from the CI interaction zone.
    await moveAlong(pages[nearbyDevIndex], 'x', 500);
    await Promise.all([
      moveAlong(testerPage, 'y', 430),
      moveAlong(pages[nearbyDevIndex], 'y', 430)
    ]);
    await expect(testerMap.getByText('E • Call standup', { exact: true })).toHaveCount(0);
    await expect(testerMap.getByText(/^Training ready in \d+s$/)).toBeVisible();

    await expect(trainingButton).toBeEnabled({ timeout: 30_000 });
    const trainingLabel = await trainingButton.innerText();
    const targetName = trainingLabel.match(/^Send (.+) on training • T$/)?.[1];
    expect(targetName).toBeTruthy();
    const targetIndex = names.indexOf(targetName!);
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    await expect(testerMap.getByText('T • Send Dev on training', { exact: true })).toBeVisible();
    await expect(testerMap.getByText('E • Call standup', { exact: true })).toHaveCount(0);

    await testerPage.keyboard.press('t');
    await expect(pages[targetIndex].locator('.role-tag')).toContainText('ON TRAINING');
    await expect(trainingButton).toBeDisabled();
    await expect(
      testerPage.getByRole('button', { name: 'Report training notice • E', exact: true })
    ).toBeVisible();
    await expect(testerMap.getByText('E • Report training notice', { exact: true })).toBeVisible();
    await expect(testerMap.getByText('E • Call standup', { exact: true })).toHaveCount(0);
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
  test.setTimeout(90_000);
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
    await expect(breakCiButton).toHaveText('Break CI • B');
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
      await expect(repairPage.getByText('E • Repair CI', { exact: true })).toBeVisible();
    } finally {
      await repairPage.keyboard.up('w');
    }
    await expect(
      repairPage.getByRole('button', { name: 'Repair CI • E', exact: true })
    ).toBeVisible();
    await repairPage.screenshot({ path: 'test-results/ci-console.png', fullPage: true });
    await repairPage.keyboard.press('e');
    const repairDialog = repairPage.getByRole('dialog', { name: 'Repair CI', exact: true });
    await expect(repairDialog.locator('.task-instructions')).toHaveText(
      'Read the incident clues. Select a recovery action, then select its destination on the board, or drag it there. Recover from left to right; everyone shares this board.'
    );
    await expect(repairDialog.locator('.incident-workbench')).toBeVisible();
    await expect(repairDialog.locator('.recovery-count')).toHaveText('0 / 3 stages resolved');
    await expect(repairDialog.locator('.progress-segments .resolved')).toHaveCount(0);
    await repairPage.setViewportSize({ width: 1366, height: 768 });
    const incidentScrolling = await repairPage.evaluate(() => {
      const backdrop = document.querySelector('.modal-backdrop')!;
      const modal = document.querySelector('.modal')!;
      return {
        html: getComputedStyle(document.documentElement).overflowY,
        body: getComputedStyle(document.body).overflowY,
        modal: getComputedStyle(modal).overflowY,
        backdropFits: backdrop.scrollHeight <= backdrop.clientHeight + 1
      };
    });
    expect(incidentScrolling).toEqual({
      html: 'hidden',
      body: 'hidden',
      modal: 'auto',
      backdropFits: true
    });
    await expect(repairDialog).toBeInViewport({ ratio: 1 });
    await repairPage.setViewportSize({ width: 1440, height: 1000 });
    await expect(repairDialog.getByRole('button', { name: 'Apply setting' })).toHaveCount(0);
    await repairDialog.getByRole('button', { name: 'Run health check', exact: true }).click();
    await repairDialog
      .getByRole('button', { name: 'Place action on Pipeline', exact: true })
      .click();
    await expect(repairDialog.getByRole('alert')).toContainText('recovery action will not resolve');
    await repairDialog.getByRole('button', { name: 'Run health check', exact: true }).click();
    // Regular snapshots must not clear an action while the player chooses a destination.
    await repairPage.waitForTimeout(350);
    await expect(
      repairDialog.getByRole('button', { name: 'Run health check', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await repairDialog.getByRole('button', { name: 'Place action on Health', exact: true }).click();
    await expect(repairDialog.getByRole('alert')).toContainText('current stage first');
    for (const [index, setting] of [
      'Pause pipeline',
      'Clear bad deployment',
      'Run health check'
    ].entries()) {
      const workerDialog =
        index === 0
          ? repairDialog
          : testerPage.getByRole('dialog', { name: 'Repair CI', exact: true });
      const action = workerDialog.getByRole('button', { name: setting, exact: true });
      const destination = workerDialog.getByRole('button', {
        name: `Place action on ${['Pipeline', 'Deployment', 'Health'][index]}`,
        exact: true
      });
      if (index === 1) await action.dragTo(destination);
      else {
        await action.focus();
        await workerDialog.page().keyboard.press('Enter');
        await destination.focus();
        await workerDialog.page().keyboard.press('Enter');
      }
      if (index < 2) {
        await expect(repairDialog.locator('.recovery-count')).toHaveText(
          `${index + 1} / 3 stages resolved`
        );
        await expect(repairDialog.locator('.progress-segments .resolved')).toHaveCount(index + 1);
        for (const page of pages)
          await expect(page.locator('.ci-banner .outage')).toContainText(
            `${index + 1}/3 repair steps saved`
          );
      }
      if (index === 0) {
        await repairPage.screenshot({ path: 'test-results/ci-repair.png', fullPage: true });
        await repairPage.keyboard.press('Escape');
        await expect(repairDialog).toBeHidden();
        await repairPage.getByRole('button', { name: 'Repair CI • E', exact: true }).click();
        await expect(repairDialog.locator('.recovery-count')).toHaveText('1 / 3 stages resolved');
        await repairPage.reload();
        await expect(
          repairPage.getByRole('button', { name: 'Repair CI • E', exact: true })
        ).toBeVisible();
        await repairPage.keyboard.press('e');
        await expect(repairDialog.locator('.recovery-count')).toHaveText('1 / 3 stages resolved');
        await testerPage.keyboard.down('w');
        try {
          await expect(
            testerPage.getByRole('button', { name: 'Repair CI • E', exact: true })
          ).toBeVisible();
        } finally {
          await testerPage.keyboard.up('w');
        }
        await testerPage.keyboard.press('e');
        await expect(
          testerPage
            .getByRole('dialog', { name: 'Repair CI', exact: true })
            .locator('.recovery-count')
        ).toHaveText('1 / 3 stages resolved');
      }
    }
    await expect(repairDialog).toBeHidden();
    await expect(testerPage.getByRole('dialog', { name: 'Repair CI', exact: true })).toBeHidden();
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
        standupPage.getByRole('button', { name: /^Call standup \(\d+ left\) • E$/ })
      ).toBeVisible();
    } finally {
      await standupPage.keyboard.up('d');
    }
    await expect(
      standupPage.locator('.map-panel').getByText('E • Call standup', { exact: true })
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
    // The map heading remains visible behind the result overlay. Wait for work to resume
    // before holding a movement key, otherwise the game correctly ignores that keydown.
    await Promise.all(missedResults.map((result) => expect(result).toBeHidden({ timeout: 5000 })));
    for (const page of pages) await expect(page.getByText('Operation: ship it.')).toBeVisible();

    const secondStandupPage = pages[testerIndex];
    await secondStandupPage.keyboard.down('s');
    try {
      await expect(
        secondStandupPage.getByRole('button', { name: /^Call standup \(\d+ left\) • E$/ })
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
