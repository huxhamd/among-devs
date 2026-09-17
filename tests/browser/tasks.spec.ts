import { test, expect, type Page } from '@playwright/test';
import { TASK_VARIANTS } from '../../src/lib/tasks';
import { STATIONS, pageAt } from '../../src/lib/shared';

async function moveTo(page: Page, x: number, y: number) {
  const position = async () => {
    const transform = await page
      .locator('.map-panel text')
      .filter({ hasText: ' (you)' })
      .locator('..')
      .getAttribute('transform');
    const values = transform!.match(/-?[\d.]+/g)!.map(Number);
    return { x: values[0], y: values[1] };
  };
  for (const axis of ['x', 'y'] as const) {
    const target = axis === 'x' ? x : y;
    for (let attempt = 0; attempt < 40; attempt++) {
      const start = (await position())[axis];
      if (Math.abs(start - target) < 12) break;
      const key = axis === 'x' ? (start < target ? 'd' : 'a') : start < target ? 's' : 'w';
      await page.keyboard.down(key);
      try {
        await page.waitForTimeout(
          Math.min(300, Math.max(50, ((Math.abs(start - target) - 8) / 190) * 1000))
        );
      } finally {
        await page.keyboard.up(key);
      }
      // Let the rendered interpolation catch up before choosing the next movement pulse.
      await page.waitForTimeout(200);
    }
    expect(Math.abs((await position())[axis] - target)).toBeLessThan(12);
  }
}

test('all mini-task controls complete and accepted steps survive refresh', async ({ browser }) => {
  test.setTimeout(150_000);
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  try {
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await page.getByLabel('YOUR DISPLAY NAME').fill(`Task player ${index}`);
      if (index === 0) await page.getByRole('button', { name: 'Create a workspace' }).click();
      else {
        const code = (await pages[0].locator('.code-box button').innerText()).trim().slice(0, 6);
        await page.getByLabel('WORKSPACE CODE').fill(code);
        await page.getByRole('button', { name: 'Join →', exact: true }).click();
      }
    }
    await pages[0].getByRole('button', { name: 'Start sprint' }).click();
    await expect(pages[0].locator('.role-reveal-card')).toBeVisible();
    await expect(pages[0].locator('.role-reveal-card')).toBeHidden({ timeout: 5000 });
    const page = pages[0];
    await expect(page.locator('.map-panel svg')).toHaveAttribute('viewBox', '0 0 1000 620');
    await page.locator('.map-panel').screenshot({ path: 'test-results/map-centre.png' });
    // Walk through actual page exits and the wing partitions.
    const visits = [
      {
        station: 'merge',
        waypoints: [
          [800, 280],
          [800, -280],
          [620, -280],
          [420, -350]
        ]
      },
      {
        station: 'coffee',
        waypoints: [
          [620, -350],
          [620, -280],
          [800, -280],
          [800, 280],
          [500, 280],
          [500, 780],
          [730, 780],
          [730, 980]
        ]
      },
      {
        station: 'ticket',
        waypoints: [
          [730, 780],
          [500, 780],
          [500, 310],
          [-180, 310],
          [-180, 400],
          [-540, 400],
          [-540, 440]
        ]
      },
      {
        station: 'build',
        waypoints: [
          [-180, 440],
          [-180, 310],
          [1450, 310],
          [1550, 180]
        ]
      }
    ];
    for (const { station, waypoints } of visits) {
      for (const [x, y] of waypoints) await moveTo(page, x, y);
      const wing = pageAt(STATIONS.find((item) => item.id === station)!)!;
      await expect(page.locator('.map-panel svg')).toHaveAttribute(
        'viewBox',
        `${wing.x} ${wing.y} 1000 620`
      );
      await page.locator('.map-panel').screenshot({ path: `test-results/map-${wing.id}.png` });
      await page.keyboard.press('e');
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('.mini-task')).toBeVisible();
      if (station === 'merge' || station === 'ticket') {
        await page.setViewportSize({ width: 1366, height: 768 });
        await expect
          .poll(() =>
            dialog.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)
          )
          .toBe(true);
        if (station === 'merge') {
          await page.setViewportSize({ width: 390, height: 740 });
          const scrolling = await page.evaluate(() => {
            const backdrop = document.querySelector('.modal-backdrop')!;
            const modal = document.querySelector('.modal')!;
            return {
              html: getComputedStyle(document.documentElement).overflowY,
              body: getComputedStyle(document.body).overflowY,
              modal: getComputedStyle(modal).overflowY,
              backdropFits: backdrop.scrollHeight <= backdrop.clientHeight + 1
            };
          });
          expect(scrolling).toEqual({
            html: 'hidden',
            body: 'hidden',
            modal: 'auto',
            backdropFits: true
          });
          await expect(dialog).toBeInViewport({ ratio: 1 });
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      const title = await dialog.locator('h3').innerText();
      const definition = TASK_VARIANTS[station].find((variant) => variant.title === title)!;
      await page.screenshot({ path: `test-results/task-${station}.png`, fullPage: true });
      for (const [index, step] of definition.steps.entries()) {
        await expect(dialog.locator('.task-progress')).toHaveText(`${index} / 4 steps complete`);
        await expect(dialog.locator('.task-progress-segments .complete')).toHaveCount(index);
        if (station === 'merge' && index === 0) {
          await dialog
            .getByRole('button', { name: definition.steps[3].answer, exact: true })
            .click();
          await expect(dialog.getByRole('alert')).toContainText('refinement');
          await expect(dialog.locator('.task-progress')).toHaveText('0 / 4 steps complete');
        }
        await dialog
          .getByRole('button', {
            name: definition.kind === 'matching' ? `Attach to: ${step.answer}` : step.answer,
            exact: true
          })
          .click();
        if (definition.kind === 'repair')
          await dialog.getByRole('button', { name: 'Apply setting' }).click();
        if (station === 'merge' && index === 0) {
          await expect(dialog.locator('.task-progress')).toHaveText('1 / 4 steps complete');
          await page.reload();
          await expect(page.locator('.role-tag')).toBeVisible();
          await page.keyboard.press('e');
          await expect(dialog.locator('h3')).toHaveText(title);
        }
      }
      await expect(dialog).toBeHidden();
      await expect(page.locator('.toast')).toContainText('Ticket closed');
    }
    await expect(page.locator('.task-list .done')).toHaveCount(4);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
