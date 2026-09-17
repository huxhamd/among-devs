import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestWithin,
  CUPBOARD_SPAWNS,
  ACCESS_SPAWNS,
  PAGES,
  STATIONS,
  EXITS,
  FIXTURES,
  WIDTH,
  HEIGHT,
  PLAYER_INTERACTION_REACH,
  PLAYER_STARTS,
  PLAYER_START_RADIUS,
  STANDUP,
  playerStartPositions,
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
  for (const cupboard of CUPBOARD_SPAWNS)
    assert.ok(visited.has(`${cupboard.x},${cupboard.y}`), cupboard.id);
  for (const panel of ACCESS_SPAWNS) assert.ok(visited.has(`${panel.x},${panel.y}`), panel.id);
  for (const page of PAGES) {
    for (let x = page.x + 30; x < page.x + WIDTH - 20; x += 10) {
      for (let y = page.y + 30; y < page.y + HEIGHT - 20; y += 10) {
        if (walkable(x, y)) assert.ok(visited.has(`${x},${y}`), `Isolated floor at ${x},${y}`);
      }
    }
  }
  assert.equal(walkable(-500, -310), false, 'missing corners are outside the office');
  assert.equal(walkable(500, -615), false, 'outer walls stop movement');
});

test('layout preserves spawn candidates per page and clear interaction space', () => {
  // Keep the main hub routes broad enough for movement pulses and groups of players.
  for (const offset of [-20, 0, 20]) {
    for (let x = 0; x <= WIDTH; x += 10) assert.ok(walkable(x, 310 + offset));
    for (let y = 0; y <= 310; y += 10) assert.ok(walkable(800 + offset, y));
    for (let y = 310; y <= HEIGHT; y += 10) assert.ok(walkable(500 + offset, y));
  }
  for (const page of PAGES) {
    assert.equal(CUPBOARD_SPAWNS.filter((s) => pageAt(s)?.id === page.id).length, 2);
    assert.equal(
      ACCESS_SPAWNS.filter((s) => pageAt(s)?.id === page.id).length,
      page.id === 'centre' ? 0 : 2
    );
  }
  for (const spot of [...STATIONS, ...CUPBOARD_SPAWNS, ...ACCESS_SPAWNS]) {
    for (const [dx, dy] of [
      [0, 0],
      [-25, 0],
      [25, 0],
      [0, -25],
      [0, 25]
    ]) {
      assert.ok(
        walkable(spot.x + dx, spot.y + dy),
        `${spot.id}: interaction clearance ${dx},${dy}`
      );
    }
  }
  for (const panel of ACCESS_SPAWNS) {
    assert.ok(
      CUPBOARD_SPAWNS.every(
        (cupboard) => Math.hypot(panel.x - cupboard.x, panel.y - cupboard.y) > 150
      ),
      `${panel.id}: keep every cupboard candidate separate from maintenance access`
    );
  }
  for (let count = 3; count <= 10; count++) {
    const starts = playerStartPositions(count);
    assert.equal(starts.length, count);
    for (const [index, start] of starts.entries()) {
      assert.ok(walkable(start.x, start.y), `${count}-player start ${index} is walkable`);
      assert.ok(
        Math.hypot(start.x - STANDUP.x, start.y - STANDUP.y) > STANDUP.reach,
        `${count}-player start ${index} is outside standup range`
      );
      assert.ok(
        Math.abs(Math.hypot(start.x - STANDUP.x, start.y - STANDUP.y) - PLAYER_START_RADIUS) < 1e-9,
        `${count}-player start ${index} stays on the fixed ring`
      );
      assert.ok(
        starts.some(
          (other) =>
            Math.abs(other.x - (STANDUP.x * 2 - start.x)) < 1e-9 &&
            Math.abs(other.y - start.y) < 1e-9
        ),
        `${count}-player start ${index} is mirrored across the top-centre axis`
      );
      for (const [otherIndex, other] of starts.entries()) {
        if (otherIndex <= index) continue;
        assert.ok(
          Math.hypot(start.x - other.x, start.y - other.y) > PLAYER_INTERACTION_REACH,
          `${count}-player starts ${index} and ${otherIndex} cannot interact immediately`
        );
      }
    }
  }
  assert.equal(PLAYER_STARTS.length, 10);
  assert.deepEqual(
    PLAYER_STARTS.map(({ x, y }) => [Math.round(x), Math.round(y)]),
    [
      [500, 200],
      [565, 221],
      [435, 221],
      [605, 276],
      [395, 276],
      [605, 344],
      [395, 344],
      [565, 399],
      [435, 399],
      [500, 420]
    ]
  );
});

test('fixed fixtures fit their pages and only solid furniture blocks movement', () => {
  assert.equal(new Set(FIXTURES.map((f) => f.id)).size, FIXTURES.length);
  for (const fixture of FIXTURES) {
    const page = pageAt(fixture)!;
    assert.ok(page, fixture.id);
    assert.ok(
      fixture.x + fixture.w < page.x + WIDTH && fixture.y + fixture.h < page.y + HEIGHT,
      fixture.id
    );
    assert.equal(
      walkable(fixture.x + fixture.w / 2, fixture.y + fixture.h / 2),
      !fixture.blocking,
      fixture.id
    );
  }
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
