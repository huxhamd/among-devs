import { test, expect, type Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { pageAt, type Snapshot, type Reply } from '../../src/lib/shared';

async function moveTo(page: Page, x: number, y: number) {
  for (const [axis, target] of [
    [0, x],
    [1, y]
  ]) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const position = await page
        .locator('.map-player')
        .filter({ hasText: '(you)' })
        .getAttribute('transform');
      const coordinate = Number(position!.match(/-?[\d.]+/g)![axis]);
      if (Math.abs(coordinate - target) < 15) break;
      const key = axis === 0 ? (coordinate < target ? 'd' : 'a') : coordinate < target ? 's' : 'w';
      await page.keyboard.down(key);
      await page.waitForTimeout(
        Math.min(400, Math.max(80, ((Math.abs(coordinate - target) - 8) / 190) * 1000))
      );
      await page.keyboard.up(key);
      await page.waitForTimeout(180);
      if (attempt === 79) throw new Error(`Could not reach ${x},${y}`);
    }
  }
}

test('maintenance travel changes pages, blocks actions and supports the return journey', async ({
  page
}) => {
  test.setTimeout(120_000);
  const sockets: Socket[] = [];
  const states: Snapshot[] = [];
  const seats: { name: string; code: string; token: string }[] = [];
  let panels: Snapshot['accessPanels'] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (let i = 0; i < 3; i++) {
      const socket = io('http://localhost:3000');
      sockets.push(socket);
      socket.on('state', (state: Snapshot) => {
        states[i] = state;
        if (state.phase === 'role-reveal') panels = state.accessPanels;
      });
      await new Promise<void>((resolve) => socket.on('connect', resolve));
      const name = `Panel player ${i}`;
      const reply = (await socket.emitWithAck('enter', {
        name,
        ...(i ? { code: seats[0].code } : {})
      })) as Reply;
      expect(reply.error).toBeUndefined();
      seats.push({ name, code: reply.code!, token: reply.token! });
    }
    await sockets[0].emitWithAck('action', { type: 'start' });
    await expect.poll(() => states.filter((s) => s.phase === 'work').length).toBe(3);
    const tester = states.findIndex((s) => s.role === 'tester');
    const [source, destination] = panels;
    expect(source).toBeTruthy();
    sockets[tester].disconnect();
    await page.addInitScript(
      (seat) => sessionStorage.setItem('among-devs-seat', JSON.stringify(seat)),
      seats[tester]
    );
    await page.goto('/');
    await expect(page.locator('.map-player').filter({ hasText: '(you)' })).toBeVisible();
    await expect(page.locator('.access-panel')).toHaveCount(0);
    if (pageAt(source)?.id === 'north') {
      await moveTo(page, 800, 310);
      await moveTo(page, 800, -30);
      await moveTo(page, 950, -30);
      expect(Math.hypot(source.x - 950, source.y + 30)).toBeGreaterThan(240);
      await expect(page.locator(`[data-panel-id="${source.id}"]`)).toBeVisible();
      await moveTo(page, 800, -30);
      await moveTo(page, 800, source.y);
    } else {
      await moveTo(page, 1150, 310);
      await moveTo(page, 1050, 550);
      expect(Math.hypot(source.x - 1050, source.y - 550)).toBeGreaterThan(240);
      await expect(page.locator(`[data-panel-id="${source.id}"]`)).toBeVisible();
      if (source.x > 1300) {
        await moveTo(page, 1150, 570);
        await moveTo(page, source.x, 570);
      } else {
        await moveTo(page, 1240, 550);
        await moveTo(page, 1240, source.y);
      }
    }
    await moveTo(page, source.x, source.y);
    await expect(page.locator(`[data-panel-id="${source.id}"]`)).toHaveAttribute(
      'data-door',
      'closed'
    );
    await page.locator('.map-panel').screenshot({ path: 'test-results/access-entrance.png' });
    await page.keyboard.press('e');
    await expect(page.getByRole('button', { name: 'Entering access panel…' })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Travelling through maintenance route…' })
    ).toBeDisabled();
    await expect(page.locator('#visibility-light')).toHaveAttribute('r', '0');
    await expect(page.locator('.map-player').filter({ hasText: '(you)' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Exiting access panel…' })).toBeDisabled();
    const destinationPage = pageAt(destination)!;
    await expect(page.locator('.map-panel svg')).toHaveAttribute(
      'viewBox',
      `${destinationPage.x} ${destinationPage.y} 1000 620`
    );
    await expect(page.getByText('E • Use access panel', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use access panel • E' })).toBeEnabled();
    await expect(page.locator(`[data-panel-id="${destination.id}"]`)).toHaveAttribute(
      'data-door',
      'open'
    );
    await expect(page.locator('#visibility-light')).toHaveAttribute('r', '240');
    await page.locator('.map-panel').screenshot({ path: 'test-results/access-exit.png' });
    await page.getByRole('button', { name: 'Use access panel • E' }).click();
    await expect(page.getByRole('button', { name: 'Entering access panel…' })).toBeDisabled();
    const sourcePage = pageAt(source)!;
    await expect(page.locator('.map-panel svg')).toHaveAttribute(
      'viewBox',
      `${sourcePage.x} ${sourcePage.y} 1000 620`
    );
    await expect(page.getByRole('button', { name: 'Use access panel • E' })).toBeEnabled();
    await expect(page.locator(`[data-panel-id="${source.id}"]`)).toHaveAttribute(
      'data-door',
      'open'
    );
    expect(errors).toEqual([]);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
  }
});
