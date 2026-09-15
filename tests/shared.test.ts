import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestWithin } from '../src/lib/shared.ts';
import { PositionInterpolator } from '../src/lib/interpolation.ts';

test('nearest player detection prefers proximity over roster order', () => {
  const player = { id: 'A', x: 515, y: 280 };
  const candidates = [
    { id: 'B', x: 470, y: 280 },
    { id: 'C', x: 515, y: 280 }
  ];

  assert.equal(nearestWithin(player, candidates, 65)?.id, 'C');
});

test('movement positions interpolate one server update behind', () => {
  const movement = new PositionInterpolator(100);
  movement.addSnapshot([{ id: 'A', x: 0, y: 20, visible: true }], 1000, 10);
  movement.addSnapshot([{ id: 'A', x: 20, y: 40, visible: true }], 1100, 110);

  assert.deepEqual(movement.positions(110), { A: { x: 0, y: 20 } });
  assert.deepEqual(movement.positions(160), { A: { x: 10, y: 30 } });
  assert.deepEqual(movement.positions(260), { A: { x: 20, y: 40 } });
});

test('movement tracks reset while a player is hidden', () => {
  const movement = new PositionInterpolator(100);
  movement.addSnapshot([{ id: 'A', x: 10, y: 20, visible: true }], 1000, 10);
  movement.addSnapshot([{ id: 'A', x: 0, y: 0, visible: false }], 1100, 110);
  assert.deepEqual(movement.positions(160), {});

  movement.addSnapshot([{ id: 'A', x: 200, y: 220, visible: true }], 1200, 210);
  assert.deepEqual(movement.positions(210), { A: { x: 200, y: 220 } });
});
