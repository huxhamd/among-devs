import { test, expect, type Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import type { Snapshot, Reply } from '../../src/lib/shared';

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

test('Tester can hide, see half the normal radius, and leave an open cupboard', async ({
  page
}) => {
  test.setTimeout(120_000);
  const sockets: Socket[] = [];
  const states: Snapshot[] = [];
  const seats: { name: string; code: string; token: string }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (let i = 0; i < 3; i++) {
      const socket = io('http://localhost:3000');
      sockets.push(socket);
      socket.on('state', (state: Snapshot) => {
        states[i] = state;
      });
      await new Promise<void>((resolve) => socket.on('connect', resolve));
      const name = `Cupboard player ${i}`;
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
    const cupboard =
      states[tester].cupboards.find((c) => c.id.startsWith('north')) ??
      states[tester].cupboards.find((c) => c.id.startsWith('south')) ??
      states[tester].cupboards.find((c) => c.id.startsWith('east'))!;
    sockets[tester].disconnect();
    await page.addInitScript(
      (seat) => sessionStorage.setItem('among-devs-seat', JSON.stringify(seat)),
      seats[tester]
    );
    await page.goto('/');
    await expect(page.locator('.map-player').filter({ hasText: '(you)' })).toBeVisible();
    if (cupboard.id.startsWith('north')) {
      await moveTo(page, 800, 310);
      await moveTo(page, 800, -100);
      await moveTo(page, cupboard.x, -100);
    } else if (cupboard.id.startsWith('south')) {
      await moveTo(page, 500, 310);
      await moveTo(page, 500, 750);
      await moveTo(page, cupboard.x, 750);
    } else {
      await moveTo(page, 1150, 310);
      await moveTo(page, 1150, 510);
      await moveTo(page, cupboard.x, 510);
    }
    await moveTo(page, cupboard.x, cupboard.y);
    const cabinet = page.locator(`[data-cupboard-id="${cupboard.id}"]`);
    await expect(cabinet).toHaveAttribute('data-door', 'closed');
    await page.keyboard.press('e');
    await expect(page.getByRole('button', { name: 'Entering cupboard…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Leave cupboard · E' })).toBeEnabled();
    await expect(page.locator('#visibility-light')).toHaveAttribute('r', '120');
    await expect(page.locator('.map-player').filter({ hasText: '(you)' })).toHaveCount(0);
    await expect(cabinet).toHaveAttribute('data-door', 'closed');
    await page.locator('.map-panel').screenshot({ path: 'test-results/cupboard-hidden.png' });
    await page.getByRole('button', { name: 'Leave cupboard · E' }).click();
    await expect(page.getByRole('button', { name: 'Exiting cupboard…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Hide in cupboard · E' })).toBeEnabled();
    await expect(page.locator('#visibility-light')).toHaveAttribute('r', '240');
    await expect(cabinet).toHaveAttribute('data-door', 'open');
    await expect(page.locator('.map-player').filter({ hasText: '(you)' })).toBeVisible();
    await page.locator('.map-panel').screenshot({ path: 'test-results/cupboard-open.png' });
    expect(errors).toEqual([]);
  } finally {
    sockets.forEach((socket) => socket.disconnect());
  }
});
