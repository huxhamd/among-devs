import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestWithin,
  PAGES,
  STATIONS,
  EXITS,
  pageAt,
  walkable,
  atCiConsole
} from '../src/lib/shared.ts';
import { PositionInterpolator } from '../src/lib/interpolation.ts';

test('five pages have reachable workstations and paired unobstructed exits', () => {
  assert.equal(atCiConsole({ x: 500, y: -25 }), false, 'CI cannot be used from the north page');
  assert.equal(atCiConsole({ x: 500, y: 100 }), true);
  assert.equal(PAGES.length, 5);
  assert.equal(new Set(STATIONS.map((station) => pageAt(station)?.id)).size, 4);
  for (const exit of EXITS) {
    assert.ok(
      EXITS.some(
        (other) =>
          other.from === exit.to &&
          other.to === exit.from &&
          other.x === exit.x &&
          other.y === exit.y
      )
    );
    for (const offset of [-30, -10, 0, 10, 30]) {
      assert.ok(
        walkable(exit.x + (exit.vertical ? offset : 0), exit.y + (exit.vertical ? 0 : offset))
      );
    }
  }
  const queue = [{ x: 500, y: 310 }];
  const visited = new Set(['500,310']);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dy] of [
      [10, 0],
      [-10, 0],
      [0, 10],
      [0, -10]
    ]) {
      const x = p.x + dx,
        y = p.y + dy,
        key = `${x},${y}`;
      if (!visited.has(key) && walkable(x, y)) {
        visited.add(key);
        queue.push({ x, y });
      }
    }
  }
  for (const station of STATIONS) assert.ok(visited.has(`${station.x},${station.y}`), station.id);
  assert.equal(walkable(-500, -310), false, 'missing corners are outside the office');
  assert.equal(walkable(500, -615), false, 'outer walls stop movement');
});

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
