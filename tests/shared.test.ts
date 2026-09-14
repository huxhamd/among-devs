import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestWithin } from '../src/lib/shared.ts';

test('nearest player detection prefers proximity over roster order', () => {
  const player = { id: 'A', x: 515, y: 280 };
  const candidates = [
    { id: 'B', x: 470, y: 280 },
    { id: 'C', x: 515, y: 280 }
  ];

  assert.equal(nearestWithin(player, candidates, 65)?.id, 'C');
});
