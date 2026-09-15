import { test, expect, type Page } from '@playwright/test';
import { TASK_VARIANTS } from '../../src/lib/tasks';

async function moveTo(page: Page, x: number, y: number) {
  const position = async () => {
    const transform = await page
      .locator('.map-panel text')
      .filter({ hasText: ' (you)' })
      .locator('..')
      .getAttribute('transform');
    const values = transform!.match(/[\d.]+/g)!.map(Number);
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
  test.setTimeout(90_000);
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
    // Cross room dividers through their doorways.
    const visits = [
      {
        station: 'merge',
        waypoints: [
          [425, 225],
          [160, 225],
          [160, 140]
        ]
      },
      {
        station: 'coffee',
        waypoints: [
          [160, 225],
          [500, 225],
          [500, 400],
          [160, 400],
          [160, 480]
        ]
      },
      {
        station: 'ticket',
        waypoints: [
          [160, 400],
          [500, 400],
          [840, 400],
          [840, 480]
        ]
      },
      {
        station: 'build',
        waypoints: [
          [840, 400],
          [500, 400],
          [500, 225],
          [840, 225],
          [840, 140]
        ]
      }
    ];
    for (const { station, waypoints } of visits) {
      for (const [x, y] of waypoints) await moveTo(page, x, y);
      await page.keyboard.press('e');
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('.mini-task')).toBeVisible();
      const title = await dialog.locator('h3').innerText();
      const definition = TASK_VARIANTS[station].find((variant) => variant.title === title)!;
      await page.screenshot({ path: `test-results/task-${station}.png`, fullPage: true });
      for (const [index, step] of definition.steps.entries()) {
        await expect(dialog.locator('.task-progress')).toHaveText(`${index} of 4 steps saved`);
        if (station === 'merge' && index === 0) {
          await dialog
            .getByRole('button', { name: definition.steps[3].answer, exact: true })
            .click();
          await expect(dialog.getByRole('alert')).toContainText('refinement');
          await expect(dialog.locator('.task-progress')).toHaveText('0 of 4 steps saved');
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
          await expect(dialog.locator('.task-progress')).toHaveText('1 of 4 steps saved');
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
