import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../server/session.ts';
import {
  CUPBOARD_SPAWNS,
  CUPBOARD_DURATION,
  PAGES,
  STATIONS,
  pageAt,
  walkable
} from '../src/lib/shared.ts';

function setup() {
  const room = new Session('CUP123');
  for (let i = 0; i < 4; i++) room.join(`Player ${i}`, `socket-${i}`, undefined, 1000);
  room.start(1000);
  room.tick(4000);
  const tester = room.players.find((p) => p.role === 'tester')!;
  const dev = room.players.find((p) => p.role === 'dev')!;
  const cupboard = room.cupboards[0];
  Object.assign(tester, { x: cupboard.x, y: cupboard.y });
  Object.assign(dev, { x: cupboard.x + 30, y: cupboard.y });
  const enter = () => room.action(tester.id, { type: 'cupboard', id: cupboard.id }, 5000);
  return { room, tester, dev, cupboard, enter };
}

test('three cupboards on distinct pages, at valid fixed sites, initially shut', () => {
  for (let i = 0; i < 30; i++) {
    const { room } = setup();
    assert.equal(room.cupboards.length, 3);
    assert.equal(new Set(room.cupboards.map((c) => pageAt(c)?.id)).size, 3);
    for (const c of room.cupboards) {
      assert.ok(CUPBOARD_SPAWNS.some((s) => s.id === c.id && s.x === c.x && s.y === c.y));
      assert.equal(c.open, false);
    }
  }
  for (const page of PAGES)
    assert.equal(CUPBOARD_SPAWNS.filter((s) => pageAt(s)?.id === page.id).length, 2);
  for (const spot of CUPBOARD_SPAWNS) {
    assert.ok(walkable(spot.x, spot.y));
    assert.ok(STATIONS.every((s) => Math.hypot(spot.x - s.x, spot.y - s.y) > 100));
  }
});

test('observed entry and exit take time, conceal position only while hidden, and leave an open cupboard', () => {
  const { room, tester, dev, cupboard, enter } = setup();
  const visible = () => room.snapshot(dev.id).players.find((p) => p.id === tester.id)!;
  enter();
  assert.equal(visible().visible, true);
  assert.equal(cupboard.open, true);
  room.tick(5000 + CUPBOARD_DURATION - 1);
  assert.equal(visible().visible, true);
  room.tick(6000);
  assert.equal(cupboard.open, false);
  assert.equal(visible().visible, false);
  assert.equal(visible().x, 0);
  assert.equal(visible().y, 0);
  assert.equal(room.snapshot(dev.id).cupboard, null);
  assert.equal('cupboard' in visible(), false);
  room.action(tester.id, { type: 'cupboard', id: cupboard.id }, 7000);
  assert.equal(visible().visible, true);
  assert.equal(cupboard.open, true);
  room.action(tester.id, { type: 'move', dx: 1, dy: 0 }, 7500);
  assert.equal(tester.x, cupboard.x);
  room.tick(8000);
  assert.equal(tester.cupboard, null);
  assert.equal(cupboard.open, true);
  room.action(tester.id, { type: 'cupboard', id: cupboard.id }, 9000);
  room.tick(10000);
  assert.equal(cupboard.open, false);
});

test('only an active nearby Tester can enter; hiding blocks movement and other actions', () => {
  const { room, tester, dev, cupboard, enter } = setup();
  const action = { type: 'cupboard' as const, id: cupboard.id };
  assert.throws(() => room.action(dev.id, action, 5000), /Only/);
  tester.active = false;
  assert.throws(enter, /Only/);
  tester.active = true;
  tester.x += 100;
  assert.throws(enter, /closer/);
  tester.x = cupboard.x;
  assert.throws(() => room.action(tester.id, { ...action, id: 'fake' }, 5000), /closer/);
  enter();
  assert.throws(enter, /Wait/);
  for (const time of [5500, 6000]) {
    room.tick(time);
    room.action(tester.id, { type: 'move', dx: 1, dy: 1 }, time);
    assert.equal(tester.x, cupboard.x);
    assert.equal(tester.y, cupboard.y);
    assert.throws(() => room.action(tester.id, { type: 'sabotage' }, time), /Exit/);
    assert.throws(() => room.action(tester.id, { type: 'sideline', target: dev.id }, time), /Exit/);
    assert.throws(() => room.action(tester.id, { type: 'meeting' }, time), /Exit/);
    assert.throws(
      () =>
        room.action(
          tester.id,
          { type: 'task', station: 'merge', puzzle: '', step: 0, answer: '' },
          time
        ),
      /Exit/
    );
  }
});

test('hidden vision is half radius and distant cupboard activity is not broadcast', () => {
  const { room, tester, dev } = setup();
  room.cupboards = [{ id: 'test', x: 400, y: 310, open: false }];
  Object.assign(tester, { x: 400, y: 310 });
  Object.assign(dev, { x: 530, y: 310 });
  assert.equal(room.snapshot(tester.id).players.find((p) => p.id === dev.id)!.visible, true);
  room.action(tester.id, { type: 'cupboard', id: 'test' }, 5000);
  room.tick(6000);
  assert.equal(room.snapshot(tester.id).players.find((p) => p.id === dev.id)!.visible, false);
  dev.x = 519;
  assert.equal(room.snapshot(tester.id).players.find((p) => p.id === dev.id)!.visible, true);
  dev.x = 800;
  assert.equal(room.snapshot(dev.id).cupboards[0].open, null);
});

test('hiding survives reconnect, but standups, end and reset clear occupancy', () => {
  const { room, tester, dev, cupboard, enter } = setup();
  enter();
  room.tick(6000);
  room.disconnect(tester.socket!, 6100);
  room.join(tester.name, 'reconnected', tester.token, 6200);
  assert.equal(room.snapshot(tester.id).cupboard?.phase, 'hidden');
  Object.assign(dev, { x: 500, y: 310 });
  room.action(dev.id, { type: 'meeting' }, 7000);
  assert.equal(tester.cupboard, null);
  assert.equal(cupboard.open, true);
  assert.equal(room.snapshot(dev.id).players.find((p) => p.id === tester.id)!.visible, true);
  room.end('dev', 'Done');
  room.action(room.host, { type: 'reset' }, 8000);
  assert.equal(room.cupboards.length, 0);
  room.start(9000);
  assert.equal(room.cupboards.length, 3);
  assert.ok(room.cupboards.every((c) => !c.open));
});
