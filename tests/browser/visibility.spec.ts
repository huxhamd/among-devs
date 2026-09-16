import { test, expect, type Page } from '@playwright/test';

async function moveAlong(page: Page, axis: 'x' | 'y', target: number) {
  const coordinate = () =>
    page
      .locator('.map-player')
      .filter({ hasText: '(you)' })
      .evaluate((el, axis) => {
        const values = el
          .getAttribute('transform')!
          .match(/-?[\d.]+/g)!
          .map(Number);
        return values[axis === 'x' ? 0 : 1];
      }, axis);
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
    // Let the authoritative movement reach the render buffer before the next pulse.
    await page.waitForTimeout(200);
  }
  expect(Math.abs((await coordinate()) - target)).toBeLessThan(12);
}

test('light follows your player and colleague glows disappear and return with visibility', async ({
  browser
}) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  try {
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await page.getByLabel('YOUR DISPLAY NAME').fill(`Light player ${index}`);
      if (index === 0) await page.getByRole('button', { name: 'Create a workspace' }).click();
      else {
        const code = (await pages[0].locator('.code-box button').innerText()).trim().slice(0, 6);
        await page.getByLabel('WORKSPACE CODE').fill(code);
        await page.getByRole('button', { name: 'Join →', exact: true }).click();
      }
    }
    const viewer = pages[0];
    const colleague = pages[2];
    await viewer.getByRole('button', { name: 'Start sprint' }).click();
    await expect(viewer.locator('.role-reveal-card')).toBeVisible();
    await expect(viewer.locator('.role-reveal-card')).toBeHidden({ timeout: 5000 });
    await expect(viewer.locator('.visibility-shade')).toBeVisible();
    const otherAvatar = viewer.locator('.map-player').filter({ hasText: 'Light player 2' });
    await expect(otherAvatar.locator('.player-glow')).toBeVisible();
    await viewer.locator('.map-panel').screenshot({ path: 'test-results/visibility-nearby.png' });

    // An open horizontal corridor lets a colleague cross the distance boundary.
    await colleague.keyboard.down('d');
    try {
      await expect(otherAvatar).toHaveCount(0);
    } finally {
      await colleague.keyboard.up('d');
    }
    await expect(viewer.locator('.player-glow')).toHaveCount(2);
    await viewer.locator('.map-panel').screenshot({ path: 'test-results/visibility-distant.png' });
    await colleague.keyboard.down('a');
    try {
      await expect(otherAvatar.locator('.player-glow')).toBeVisible();
    } finally {
      await colleague.keyboard.up('a');
    }

    const light = viewer.locator('#visibility-light');
    const initialY = Number(await light.getAttribute('cy'));
    await viewer.keyboard.down('s');
    try {
      await expect
        .poll(async () => Number(await light.getAttribute('cy')))
        .toBeGreaterThan(initialY + 50);
    } finally {
      await viewer.keyboard.up('s');
    }
    await expect
      .poll(async () =>
        viewer.evaluate(() => {
          const avatar = [...document.querySelectorAll('.map-player')].find((el) =>
            el.textContent?.includes('(you)')
          )!;
          const position = avatar
            .getAttribute('transform')!
            .match(/-?[\d.]+/g)!
            .map(Number);
          const gradient = document.querySelector('#visibility-light')!;
          return (
            position[0] === Number(gradient.getAttribute('cx')) &&
            position[1] === Number(gradient.getAttribute('cy'))
          );
        })
      )
      .toBe(true);

    // Put two colleagues within range on opposite sides of the north-west partition.
    await moveAlong(colleague, 'x', 280);
    await moveAlong(colleague, 'y', 105);
    await moveAlong(viewer, 'y', 105);
    await expect(otherAvatar).toHaveCount(0);
    await expect(viewer.locator('.player-glow')).toHaveCount(2);
    const litAt = (x: number, y: number) =>
      viewer.evaluate(
        ({ x, y }) => {
          const polygon = document.querySelector('#visibility-area polygon') as SVGPolygonElement;
          return polygon.isPointInFill(new DOMPoint(x, y));
        },
        { x, y }
      );
    expect(await litAt(280, 100)).toBe(false);
    expect(await litAt(355, 100)).toBe(true);
    await viewer
      .locator('.map-panel')
      .screenshot({ path: 'test-results/visibility-wall-shadow.png' });

    // Walking around the partition restores both the colleague and their glow.
    await moveAlong(colleague, 'y', 280);
    await expect(otherAvatar.locator('.player-glow')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
