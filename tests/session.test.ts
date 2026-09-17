import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../server/session.ts';
import { CI_CONSOLE, STATIONS, EXITS, playerStartPositions, pageAt } from '../src/lib/shared.ts';
import { CI_REPAIR } from '../src/lib/tasks.ts';

function setup(count = 4) {
  const room = new Session('ABC234');
  for (let i = 0; i < count; i++) room.join(`Person ${i}`, `socket-${i}`, undefined, 1000);
  room.action(room.host, { type: 'start' }, 1000);
  room.tick(4000);
  return room;
}
function taskAction(person: Session['players'][number], station: string, answer?: string) {
  const puzzle = person.puzzles[station];
  return {
    type: 'task' as const,
    station,
    puzzle: puzzle.id,
    step: puzzle.step,
    answer:
      answer ??
      puzzle.definition.steps[Math.min(puzzle.step, puzzle.definition.steps.length - 1)].answer
  };
}
function finishTask(room: Session, person: Session['players'][number], station: string) {
  while (!person.completed.includes(station))
    room.action(person.id, taskAction(person, station), 30000);
}
function repairAction(room: Session) {
  const repair = room.repair!;
  return {
    type: 'repair' as const,
    puzzle: repair.id,
    step: repair.step,
    answer: CI_REPAIR.steps[repair.step].answer
  };
}

test('server movement crosses every page doorway and returns without teleporting', () => {
  const room = setup();
  const person = room.players[0];
  let now = 4000;
  for (const exit of EXITS.filter((exit) => exit.from === 'centre')) {
    const sign = exit.to === 'north' || exit.to === 'west' ? -1 : 1;
    const dx = exit.vertical ? sign : 0;
    const dy = exit.vertical ? 0 : sign;
    person.x = exit.x - dx * 5;
    person.y = exit.y - dy * 5;
    room.action(person.id, { type: 'move', dx, dy }, (now += 100));
    assert.equal(pageAt(person)?.id, exit.to);
    room.action(person.id, { type: 'move', dx: -dx, dy: -dy }, (now += 100));
    assert.equal(pageAt(person)?.id, 'centre');
  }
});

test('players on opposite sides of a page edge cannot see or train each other', () => {
  const room = setup();
  const tester = room.players.find((p) => p.role === 'tester')!;
  const dev = room.players.find((p) => p.role === 'dev')!;
  Object.assign(tester, { x: 995, y: 310 });
  Object.assign(dev, { x: 1005, y: 310 });
  const hidden = room.snapshot(tester.id, 30000).players.find((p) => p.id === dev.id)!;
  assert.equal(hidden.visible, false);
  assert.equal(hidden.x, 0);
  assert.throws(
    () => room.action(tester.id, { type: 'sideline', target: dev.id }, 30000),
    /unavailable/
  );
});
function finishRepair(room: Session, id: string, now: number) {
  while (room.incident) room.action(id, repairAction(room), now);
}
test('lobbies enforce minimum, maximum, unique names and host control', () => {
  const room = new Session('ABC234');
  const host = room.join('Host', 'one');
  assert.throws(() => room.action(host.id, { type: 'start' }), /3–10/);
  assert.throws(() => room.join('host', 'two'), /already taken/);
  for (let i = 1; i < 10; i++) room.join(`P${i}`, `s${i}`);
  assert.throws(() => room.join('Extra', 'extra'), /full/);
  assert.throws(() => room.action(room.players[1].id, { type: 'start' }), /host/);
});
test('exactly one tester; snapshots do not disclose credentials or other roles', () => {
  const room = setup(10);
  assert.equal(room.players.filter((p) => p.role === 'tester').length, 1);
  const snapshot = room.snapshot(room.host, 4000);
  for (const person of snapshot.players) {
    assert.equal('role' in person, false);
    assert.equal('token' in person, false);
    assert.equal('socket' in person, false);
  }
  assert.equal(snapshot.total, 36);
  assert.equal(snapshot.testerName, null);
});
test('starting a sprint reveals roles for three seconds before work begins', () => {
  const room = new Session('ABC234');
  for (let i = 0; i < 4; i++) room.join(`Person ${i}`, `socket-${i}`, undefined, 1000);
  room.action(room.host, { type: 'start' }, 1000);
  assert.equal(room.phase, 'role-reveal');
  assert.equal(room.snapshot(room.host, 1000).roleRevealDeadline, 4000);
  assert.ok(room.snapshot(room.host, 1000).role);
  assert.throws(() => room.action(room.host, { type: 'move', dx: 1, dy: 0 }, 3999), /resumes/);
  room.tick(3999);
  assert.equal(room.phase, 'role-reveal');
  room.tick(4000);
  assert.equal(room.phase, 'work');
  assert.equal(room.deadline, 244000);
});
test('players start simultaneously in count-aware symmetric ring positions', () => {
  for (let count = 3; count <= 10; count++) {
    const room = new Session('ABC234');
    for (let i = 0; i < count; i++) room.join(`Person ${i}`, `socket-${i}`, undefined, 1000);
    room.action(room.host, { type: 'start' }, 1000);
    assert.deepEqual(
      room.players.map(({ x, y }) => ({ x, y })),
      playerStartPositions(count)
    );
  }
});
test('movement is bounded by elapsed time and walls', () => {
  const room = setup();
  const person = room.players[0];
  person.x = 290;
  person.y = 100;
  room.action(person.id, { type: 'move', dx: 999999, dy: 0 }, 4100);
  assert.equal(person.x, 290);
  room.action(person.id, { type: 'move', dx: 0, dy: 999999 }, 4200);
  assert.equal(person.y, 119);
  room.action(person.id, { type: 'move', dx: NaN, dy: 0 }, 4300);
  assert.equal(person.x, 290);
});
test('task proximity, answers, deduplication, sabotage and dev victory', () => {
  const room = setup();
  const tester = room.players.find((p) => p.role === 'tester')!;
  const dev = room.players.find((p) => p.role === 'dev')!;
  assert.throws(() => room.action(dev.id, taskAction(dev, 'merge'), 30000), /closer/);
  dev.x = STATIONS[0].x;
  dev.y = STATIONS[0].y;
  assert.throws(() => room.action(dev.id, taskAction(dev, 'merge', 'wrong'), 30000), /refinement/);
  room.action(tester.id, { type: 'sabotage' }, 30000);
  assert.throws(() => room.action(dev.id, taskAction(dev, 'merge'), 30000), /Repair/);
  dev.x = 840;
  assert.throws(() => room.action(dev.id, repairAction(room), 30000), /CI Control Console/);
  assert.equal(room.incident, true);
  dev.x = CI_CONSOLE.x;
  dev.y = CI_CONSOLE.y + 60;
  finishRepair(room, dev.id, 30000);
  assert.equal(room.incident, false);

  for (const [index, edge] of [-1, 1].entries()) {
    const now = 80000 + index * 50000;
    room.action(tester.id, { type: 'sabotage' }, now);
    dev.x = CI_CONSOLE.x + edge * (CI_CONSOLE.width / 2);
    dev.y = CI_CONSOLE.y + 60;
    finishRepair(room, dev.id, now);
    assert.equal(room.incident, false);
  }
  tester.x = STATIONS[0].x;
  tester.y = STATIONS[0].y;
  finishTask(room, tester, 'merge');
  assert.equal(room.snapshot(dev.id).progress, 0);
  for (const person of room.players.filter((p) => p.role === 'dev'))
    for (const station of STATIONS) {
      person.x = station.x;
      person.y = station.y;
      finishTask(room, person, station.id);
      if (room.phase !== 'ended')
        room.action(person.id, { ...taskAction(person, station.id), step: 0 }, 30000);
    }
  assert.equal(room.winner, 'dev');
  const snapshot = room.snapshot(dev.id);
  assert.equal(snapshot.progress, 12);
  assert.equal(snapshot.result, 'All tickets closed. Somehow, this actually shipped.');
  assert.equal(snapshot.testerName, tester.name);
});
test('CI repair is shared by active devs and testers, rejects stale steps, and never closes tickets', () => {
  const room = setup(5);
  const tester = room.players.find((p) => p.role === 'tester')!;
  const devs = room.players.filter((p) => p.role === 'dev');
  for (const person of room.players) {
    person.x = CI_CONSOLE.x;
    person.y = CI_CONSOLE.y + 60;
  }
  room.action(tester.id, { type: 'sabotage' }, 30000);
  const first = repairAction(room);
  assert.throws(
    () => room.action(devs[0].id, { ...first, answer: 'wrong' }, 30000),
    /recovery action/
  );
  assert.throws(() => room.action(devs[0].id, { ...first, step: 2 }, 30000), /current/);
  assert.throws(() => room.action(devs[0].id, { ...first, step: -1 }, 30000), /Reopen/);
  room.action(devs[0].id, first, 30000);
  room.action(tester.id, first, 30000); // Same step, submitted concurrently.
  assert.equal(room.repair?.step, 1);
  assert.equal(room.incident, true);
  assert.deepEqual(room.snapshot(devs[1].id).repair, room.snapshot(tester.id).repair);
  assert.equal('answer' in room.snapshot(tester.id).repair!.steps[0], false);
  room.action(tester.id, { type: 'sideline', target: devs[0].id }, 31000);
  assert.throws(() => room.action(devs[0].id, repairAction(room), 31000), /training/);
  room.action(devs[1].id, { type: 'report' }, 32000);
  assert.throws(() => room.action(tester.id, repairAction(room), 33000), /resumes/);
  room.tick(72000);
  room.tick(75000);
  assert.equal(room.repair?.step, 1);
  room.disconnect(tester.socket!, 76000);
  room.join(tester.name, 'resumed-tester', tester.token, 77000);
  room.action(tester.id, repairAction(room), 78000);
  assert.equal(room.repair?.step, 2);
  assert.equal(room.incident, true);
  const final = repairAction(room);
  room.action(devs[1].id, final, 79000);
  assert.equal(room.incident, false);
  assert.equal(room.snapshot(tester.id).repair, null);
  assert.equal(room.snapshot(tester.id).progress, 0);
  assert.ok(room.players.every((p) => p.completed.length === 0));
  assert.throws(() => room.action(tester.id, { type: 'sabotage' }, 80000), /not ready/);
  room.action(tester.id, { type: 'sabotage' }, room.sabotageReady);
  assert.notEqual(room.repair?.id, first.puzzle);
  assert.equal(room.repair?.step, 0);
  assert.throws(() => room.action(devs[1].id, final, room.sabotageReady), /Reopen/);
  assert.throws(
    () => room.action(tester.id, { type: 'sabotage' }, room.sabotageReady),
    /not ready/
  );
  finishRepair(room, tester.id, room.sabotageReady);
  assert.equal(room.incident, false);
  room.end('dev', 'test');
  room.action(room.host, { type: 'reset' });
  assert.equal(room.repair, null);
});

test('a successful vote shows a synchronized result before ending the sprint', () => {
  const room = setup();
  const caller = room.players[0];
  caller.x = 500;
  caller.y = 310;
  const tester = room.players.find((p) => p.role === 'tester')!;
  room.action(caller.id, { type: 'meeting' }, 30000);
  const original = room.deadline;
  room.action(caller.id, { type: 'vote', target: tester.id }, 31000);
  assert.throws(() => room.action(caller.id, { type: 'vote', target: 'skip' }, 31000), /already/);
  assert.equal(room.snapshot(room.players[1].id).meeting?.yourVote, null);
  for (const person of room.players.slice(1))
    room.action(person.id, { type: 'vote', target: tester.id }, 35000);
  assert.equal(room.phase, 'meeting-result');
  assert.equal(room.winner, null);
  assert.deepEqual(room.snapshot(caller.id, 35000).meetingResult, {
    testerIdentified: true,
    message: `${tester.name} was identified as the tester.`,
    deadline: 38000,
    continues: false
  });
  assert.throws(() => room.action(caller.id, { type: 'move', dx: 1, dy: 0 }, 36000), /resumes/);
  room.tick(37999);
  assert.equal(room.phase, 'meeting-result');
  room.tick(38000);
  assert.equal(room.winner, 'dev');
  assert.equal(room.deadline, original + 8000);
});
test('a tied vote and abstentions send nobody on training', () => {
  const room = setup();
  const caller = room.players[0];
  caller.x = 500;
  caller.y = 310;
  room.action(caller.id, { type: 'meeting' }, 30000);
  room.players.forEach((p, i) =>
    room.action(p.id, { type: 'vote', target: room.players[i % 2].id }, 31000)
  );
  assert.equal(
    room.players.every((p) => p.active),
    true
  );
  assert.deepEqual(room.snapshot(caller.id, 31000).meetingResult, {
    testerIdentified: false,
    message: 'No consensus. No one was sent on mandatory training.',
    deadline: 34000,
    continues: true
  });
  room.tick(34000);
  assert.equal(room.phase, 'work');
  const other = room.players[1];
  other.x = 500;
  other.y = 310;
  room.action(other.id, { type: 'meeting' }, 35000);
  room.action(other.id, { type: 'vote', target: room.players[2].id }, 36000);
  room.tick(75000);
  assert.equal(room.phase, 'meeting-result');
  room.tick(78000);
  assert.equal(
    room.players.every((p) => p.active),
    true
  );
});
test('voting out a dev reports that the tester was not identified, then resumes', () => {
  const room = setup();
  const caller = room.players[0];
  const target = room.players.find((p) => p.role === 'dev' && p !== caller)!;
  caller.x = 500;
  caller.y = 310;
  room.action(caller.id, { type: 'meeting' }, 30000);
  for (const person of room.players)
    room.action(person.id, { type: 'vote', target: target.id }, 31000);
  assert.equal(target.active, false);
  assert.deepEqual(room.snapshot(caller.id, 31000).meetingResult, {
    testerIdentified: false,
    message: `${target.name} was sent on mandatory training, but the tester remains at large.`,
    deadline: 34000,
    continues: true
  });
  room.tick(34000);
  assert.equal(room.phase, 'work');
  assert.equal(room.winner, null);
});
test('three-person rounds cannot end on the first training action', () => {
  const room = setup(3);
  const tester = room.players.find((p) => p.role === 'tester')!;
  assert.throws(
    () =>
      room.action(
        tester.id,
        { type: 'sideline', target: room.players.find((p) => p.role === 'dev')!.id },
        30000
      ),
    /three/
  );
  room.tick(244000);
  assert.equal(room.winner, 'tester');
});
test('training requires the tester and cooldown; trainees can still work', () => {
  const room = setup(5);
  const tester = room.players.find((p) => p.role === 'tester')!;
  const dev = room.players.find((p) => p.role === 'dev')!;
  dev.x = tester.x;
  dev.y = tester.y;
  assert.throws(
    () => room.action(dev.id, { type: 'sideline', target: tester.id }, 30000),
    /unavailable/
  );
  assert.throws(
    () => room.action(tester.id, { type: 'sideline', target: dev.id }, 5000),
    /unavailable/
  );
  room.action(tester.id, { type: 'sideline', target: dev.id }, 30000);
  assert.equal(dev.active, false);
  assert.throws(() => room.action(dev.id, { type: 'meeting' }, 30000), /training/);
  dev.x = STATIONS[0].x;
  dev.y = STATIONS[0].y;
  finishTask(room, dev, 'merge');
  assert.equal(dev.completed.length, 1);
});
test('task steps reject forged instances and out-of-order steps, persist, and stay private', () => {
  const room = setup();
  const [person, other] = room.players;
  person.x = STATIONS[0].x;
  person.y = STATIONS[0].y;
  const first = taskAction(person, 'merge');
  assert.throws(
    () => room.action(person.id, { ...first, puzzle: other.puzzles.merge.id }, 30000),
    /Reopen/
  );
  assert.throws(() => room.action(person.id, { ...first, step: 2 }, 30000), /current step/);
  assert.throws(() => room.action(person.id, { ...first, step: NaN }, 30000), /Reopen/);
  assert.throws(() => room.action(person.id, { ...first, answer: 'wrong' }, 30000), /refinement/);
  assert.equal(person.puzzles.merge.step, 0);
  room.action(person.id, first, 30000);
  room.action(person.id, first, 30000);
  assert.equal(person.puzzles.merge.step, 1);
  assert.equal(person.completed.length, 0);
  const snapshot = room.snapshot(person.id);
  assert.equal(snapshot.puzzles.merge.step, 1);
  assert.equal('answer' in snapshot.puzzles.merge.steps[0], false);
  assert.ok(!JSON.stringify(snapshot).includes(other.puzzles.merge.id));
  room.disconnect(person.socket!, 31000);
  room.join(person.name, 'resumed', person.token, 32000);
  assert.equal(room.snapshot(person.id).puzzles.merge.step, 1);
  room.incident = true;
  assert.throws(() => room.action(person.id, taskAction(person, 'merge'), 33000), /Repair/);
  room.incident = false;
  other.x = 500;
  other.y = 310;
  room.action(other.id, { type: 'meeting' }, 34000);
  assert.throws(() => room.action(person.id, taskAction(person, 'merge'), 35000), /resumes/);
  room.tick(74000);
  room.tick(77000);
  assert.equal(person.puzzles.merge.step, 1);
  finishTask(room, person, 'merge');
  assert.equal(person.completed.length, 1);
  const oldId = person.puzzles.merge.id;
  room.end('dev', 'test');
  room.action(room.host, { type: 'reset' }, 80000);
  assert.deepEqual(person.puzzles, {});
  room.action(room.host, { type: 'start' }, 81000);
  assert.notEqual(person.puzzles.merge.id, oldId);
});

test('reconnect restores a seat and disconnected host transfers ownership', () => {
  const room = setup();
  const oldHost = room.players[0];
  room.disconnect(oldHost.socket!, 30000);
  assert.notEqual(room.host, oldHost.id);
  const resumed = room.join(oldHost.name, 'new-socket', oldHost.token, 35000);
  assert.equal(resumed.id, oldHost.id);
  assert.equal(room.players.length, 4);
  assert.throws(() => room.join(oldHost.name, 'duplicate', oldHost.token), /already connected/);
  room.disconnect('new-socket', 36000);
  room.tick(96001);
  assert.equal(room.phase, 'ended');
  assert.equal(room.winner, null);
});

test('distant colleagues and colleagues behind walls are hidden by the server', () => {
  const room = setup();
  const [viewer, other] = room.players;
  viewer.x = 290;
  viewer.y = 100;
  other.x = 355;
  other.y = 100;
  const hidden = room.snapshot(viewer.id).players.find((p) => p.id === other.id)!;
  assert.equal(hidden.visible, false);
  assert.equal(hidden.x, 0);
  assert.equal(hidden.y, 0);
  assert.equal(room.nearby(viewer, other, 80), false);
  viewer.y = 225;
  other.y = 225;
  assert.equal(room.snapshot(viewer.id).players.find((p) => p.id === other.id)!.visible, true);
  other.x = 840;
  assert.equal(room.snapshot(viewer.id).players.find((p) => p.id === other.id)!.visible, false);
});

test('training notices stay in place while a trainee moves', () => {
  const room = setup(5);
  const tester = room.players.find((p) => p.role === 'tester')!;
  const dev = room.players.find((p) => p.role === 'dev')!;
  dev.x = tester.x;
  dev.y = tester.y;
  const position = { x: dev.x, y: dev.y };
  room.action(tester.id, { type: 'sideline', target: dev.id }, 30000);
  room.action(dev.id, { type: 'move', dx: 0, dy: 1 }, 30100);
  assert.notEqual(dev.y, position.y);
  assert.equal(room.snapshot(tester.id).players.find((p) => p.id === dev.id)!.y, position.y);
  room.action(tester.id, { type: 'report' }, 30200);
  assert.equal(room.phase, 'meeting');
});
