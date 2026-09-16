import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../server/session.ts';
import { ACCESS_SPAWNS, ACCESS_PAIRS, CUPBOARD_SPAWNS, pageAt } from '../src/lib/shared.ts';

function setup() {
  const room = new Session('PAN123');
  for (let i = 0; i < 4; i++) room.join(`Player ${i}`, `socket-${i}`, undefined, 1000);
  room.start(1000);
  room.tick(4000);
  const tester = room.players.find((p) => p.role === 'tester')!;
  const dev = room.players.find((p) => p.role === 'dev')!;
  const [source, destination] = room.accessPanels;
  Object.assign(tester, { x: source.x, y: source.y });
  Object.assign(dev, { x: source.x + 20, y: source.y });
  const enter = (now = 5000) => room.action(tester.id, { type: 'access', id: source.id }, now);
  return { room, tester, dev, source, destination, enter };
}

test('one fixed opposite pair per sprint with valid, separate spawn positions', () => {
  for (let i = 0; i < 30; i++) {
    const { room } = setup();
    assert.equal(room.accessPanels.length, 2);
    const pages = room.accessPanels.map((a) => pageAt(a)?.id);
    assert.ok(ACCESS_PAIRS.some((pair) => pair.every((p, index) => pages[index] === p)));
    for (const panel of room.accessPanels) {
      assert.ok(ACCESS_SPAWNS.some((a) => a.id === panel.id && a.x === panel.x && a.y === panel.y));
      assert.equal(panel.open, false);
      assert.ok(CUPBOARD_SPAWNS.every((c) => Math.hypot(c.x - panel.x, c.y - panel.y) > 150));
    }
  }
});

test('observed travel hides only in transit, moves to paired exit, and works in reverse', () => {
  const { room, tester, dev, source, destination, enter } = setup();
  const view = () => room.snapshot(dev.id).players.find((p) => p.id === tester.id)!;
  enter();
  assert.equal(view().visible, true);
  assert.equal(source.open, true);
  assert.equal(room.snapshot(dev.id).access, null);
  room.tick(5999);
  assert.equal(tester.access?.phase, 'entering');
  room.tick(6000);
  assert.equal(tester.access?.phase, 'travelling');
  assert.equal(source.open, false);
  assert.equal(view().visible, false);
  assert.equal(view().x, 0);
  assert.equal(view().y, 0);
  assert.ok(
    room
      .snapshot(tester.id)
      .players.filter((p) => p.id !== tester.id)
      .every((p) => !p.visible)
  );
  assert.equal(room.snapshot(tester.id).accessPanels.length, 2);
  Object.assign(dev, { x: destination.x + 20, y: destination.y });
  room.tick(7000);
  assert.equal(tester.access?.phase, 'exiting');
  assert.equal(view().visible, true);
  assert.equal(tester.x, destination.x);
  assert.equal(tester.y, destination.y);
  assert.ok(source.open && destination.open);
  room.tick(7999);
  assert.equal(tester.access?.phase, 'exiting');
  room.tick(8000);
  assert.equal(tester.access, null);
  room.action(tester.id, { type: 'access', id: destination.id }, 8100);
  room.tick(9100);
  room.tick(10100);
  room.tick(11100);
  assert.equal(tester.x, source.x);
  assert.equal(tester.y, source.y);
});

test('travel requires active Tester, proximity and clear sight, and blocks other actions', () => {
  const { room, tester, dev, source, enter } = setup();
  assert.throws(() => room.action(dev.id, { type: 'access', id: source.id }, 5000), /Only/);
  tester.active = false;
  assert.throws(() => enter(), /Only/);
  tester.active = true;
  tester.x += 100;
  assert.throws(() => enter(), /closer/);
  tester.x = source.x;
  assert.throws(() => room.action(tester.id, { type: 'access', id: 'fake' }, 5000), /closer/);
  enter();
  for (const now of [5500, 6000, 7000]) {
    room.tick(now);
    const { x, y } = tester;
    room.action(tester.id, { type: 'move', dx: 1, dy: 1 }, now);
    assert.deepEqual({ x: tester.x, y: tester.y }, { x, y });
    for (const action of [
      { type: 'sabotage' as const },
      { type: 'meeting' as const },
      { type: 'report' as const },
      { type: 'access' as const, id: source.id },
      { type: 'cupboard' as const, id: room.cupboards[0].id },
      { type: 'sideline' as const, target: dev.id },
      { type: 'task' as const, station: 'merge', puzzle: '', step: 0, answer: '' },
      { type: 'repair' as const, puzzle: '', step: 0, answer: '' }
    ])
      assert.throws(() => room.action(tester.id, action, now), /Wait/);
  }
  const other = setup();
  other.room.accessPanels[0] = { id: 'wall', x: 350, y: 110, open: false };
  Object.assign(other.tester, { x: 300, y: 110 });
  assert.throws(
    () => other.room.action(other.tester.id, { type: 'access', id: 'wall' }, 5000),
    /closer/
  );
});

test('cupboards and panels cannot be combined, and panels stay discoverable across their page', () => {
  const { room, tester, dev, source } = setup();
  let panels = room.snapshot(dev.id).accessPanels;
  assert.equal(panels.length, 2);
  assert.equal(panels.find((a) => a.id === source.id)?.open, false);
  assert.equal(panels.find((a) => a.id !== source.id)?.open, null);
  Object.assign(dev, { x: 500, y: 310 });
  panels = room.snapshot(dev.id).accessPanels;
  assert.equal(panels.length, 2);
  assert.ok(panels.every((a) => a.open === null));
  const cupboard = room.cupboards[0];
  Object.assign(tester, { x: cupboard.x, y: cupboard.y });
  room.action(tester.id, { type: 'cupboard', id: cupboard.id }, 5000);
  room.tick(6000);
  assert.throws(() => room.action(tester.id, { type: 'access', id: source.id }, 6000), /Exit/);
});

test('reconnect retains travel and meetings interrupt safely in each phase', () => {
  for (const phaseTime of [5500, 6000, 7000]) {
    const { room, tester, dev, source, destination, enter } = setup();
    enter();
    if (phaseTime >= 6000) room.tick(6000);
    room.tick(phaseTime);
    room.disconnect(tester.socket!, phaseTime);
    room.join(tester.name, 'new-socket', tester.token, phaseTime);
    assert.ok(room.snapshot(tester.id).access);
    Object.assign(dev, { x: 500, y: 310 });
    room.action(dev.id, { type: 'meeting' }, phaseTime);
    assert.equal(tester.access, null);
    const expected = phaseTime === 7000 ? destination : source;
    assert.equal(tester.x, expected.x);
    assert.equal(tester.y, expected.y);
    assert.equal(expected.open, true);
    room.tick(phaseTime + 5000);
    assert.equal(tester.x, expected.x);
  }
});

test('delayed ticks preserve exit exposure; ending and resetting clear travel and panels', () => {
  const { room, tester, enter } = setup();
  enter();
  room.tick(15000);
  assert.equal(tester.access?.phase, 'travelling');
  room.tick(25000);
  assert.equal(tester.access?.phase, 'exiting');
  assert.equal(tester.access?.deadline, 26000);
  room.end('dev', 'Done');
  assert.equal(tester.access, null);
  room.action(room.host, { type: 'reset' }, 26000);
  assert.equal(room.accessPanels.length, 0);
  room.start(27000);
  assert.equal(room.accessPanels.length, 2);
  assert.ok(room.accessPanels.every((a) => !a.open));
});
