import { test, expect, type Page } from '@playwright/test';

async function expectFittedGame(page: Page) {
  const size = page.viewportSize()!;
  const documentSize = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    scroll: window.scrollY
  }));
  expect(documentSize.width).toBeLessThanOrEqual(size.width);
  expect(documentSize.height).toBeLessThanOrEqual(size.height);
  expect(documentSize.scroll).toBe(0);
  for (const selector of ['.game-hud', '.map-panel', '.map-footer', '.task-panel']) {
    await expect(page.locator(selector)).toBeInViewport({ ratio: 1 });
  }
  for (const button of await page.locator('.context-actions button').all()) {
    await expect(button).toBeInViewport({ ratio: 1 });
  }
  // Check the actual room bounds, including pages with a non-zero viewBox origin.
  const room = await page.locator('.map-panel > svg').evaluate((element) => {
    const svg = element as SVGSVGElement;
    const box = svg.viewBox.baseVal;
    const matrix = svg.getScreenCTM()!;
    const start = new DOMPoint(box.x, box.y).matrixTransform(matrix);
    const end = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix);
    const bounds = svg.getBoundingClientRect();
    const marginPoints = [
      [bounds.left + 2, (bounds.top + bounds.bottom) / 2],
      [bounds.right - 2, (bounds.top + bounds.bottom) / 2],
      [(bounds.left + bounds.right) / 2, bounds.top + 2],
      [(bounds.left + bounds.right) / 2, bounds.bottom - 2]
    ].filter(([x, y]) => x < start.x || x > end.x || y < start.y || y > end.y);
    return {
      marginsEmpty: marginPoints.every(([x, y]) => document.elementFromPoint(x, y) === svg),
      contained:
        start.x >= bounds.left - 1 &&
        start.y >= bounds.top - 1 &&
        end.x <= bounds.right + 1 &&
        end.y <= bounds.bottom + 1,
      width: end.x - start.x,
      height: end.y - start.y
    };
  });
  expect(room.contained).toBe(true);
  expect(room.marginsEmpty).toBe(true);
  expect(room.height).toBeGreaterThan(100);
  expect(room.width / room.height).toBeCloseTo(1000 / 620);
}

test('gameplay fits desktop viewports and keeps the HUD visible in scrolling layouts', async ({
  browser
}) => {
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 1366, height: 650 } }))
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  try {
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await page.getByLabel('YOUR DISPLAY NAME').fill(`Layout player ${index}`);
      if (index === 0) await page.getByRole('button', { name: 'Create a workspace' }).click();
      else {
        const code = (await pages[0].locator('.code-box button').innerText()).trim().slice(0, 6);
        await page.getByLabel('WORKSPACE CODE').fill(code);
        await page.getByRole('button', { name: 'Join →', exact: true }).click();
      }
    }
    // Starting from a scrolled lobby must not leave the HUD above the viewport.
    await pages[0].evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await pages[0].getByRole('button', { name: 'Start sprint' }).click();
    await expect(pages[0].locator('.role-reveal-card')).toBeVisible();
    await expect(pages[0].locator('.role-reveal-card')).toBeHidden({ timeout: 5000 });
    const roles = await Promise.all(pages.map((page) => page.locator('.role-tag').innerText()));
    const tester = pages[roles.findIndex((role) => role.includes('THE TESTER'))];
    const dev = pages.find((page) => page !== tester)!;
    for (const viewport of [
      { width: 1366, height: 650 },
      { width: 1280, height: 600 },
      { width: 1024, height: 768 },
      { width: 800, height: 600 },
      { width: 1920, height: 1080 }
    ]) {
      for (const page of [tester, dev]) {
        await page.setViewportSize(viewport);
        await expectFittedGame(page);
      }
    }
    await tester.setViewportSize({ width: 1366, height: 650 });
    const mapBefore = await tester.locator('.map-panel').boundingBox();
    const tickets = tester.getByRole('region', { name: 'Sprint tickets' });
    await tickets.focus();
    await tester.keyboard.press('End');
    await expect.poll(() => tickets.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expectFittedGame(tester);
    await tester.screenshot({ path: 'test-results/gameplay-laptop.png' });

    const breakCi = tester.getByRole('button', { name: 'Break CI • B', exact: true });
    await expect(breakCi).toBeEnabled({ timeout: 25_000 });
    await breakCi.click();
    await expect(tester.locator('.ci-banner')).toHaveClass(/offline/);
    await expectFittedGame(tester);
    expect(await tester.locator('.map-panel').boundingBox()).toEqual(mapBefore);
    await tester.screenshot({ path: 'test-results/gameplay-laptop-ci-down.png' });

    for (const viewport of [
      { width: 390, height: 740 },
      { width: 1366, height: 450 }
    ]) {
      await tester.setViewportSize(viewport);
      await tester.evaluate(() => window.scrollTo(0, 300));
      await expect.poll(() => tester.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(tester.locator('.game-hud')).toBeInViewport({ ratio: 1 });
      expect(await tester.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width
      );
      await tester.locator('.context-actions button').last().scrollIntoViewIfNeeded();
      await expect(tester.locator('.game-hud')).toBeInViewport({ ratio: 1 });
    }
    await tester.setViewportSize({ width: 1366, height: 650 });
    await expectFittedGame(tester);
    await tester.getByRole('button', { name: 'Leave workspace' }).click();
    await expect(tester.getByRole('button', { name: 'Create a workspace' })).toBeVisible();
    await expect(tester.locator('footer')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
