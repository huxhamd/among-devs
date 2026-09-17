import { randomInt, randomUUID } from 'node:crypto';
import { canSee } from '../src/lib/visibility.ts';
import { CI_REPAIR, TASK_VARIANTS, taskView, type TaskDefinition } from '../src/lib/tasks.ts';
import {
  COLORS,
  ACCESS_DURATION,
  ACCESS_REACH,
  ACCESS_PAIRS,
  ACCESS_SPAWNS,
  type AccessPanel,
  type AccessUse,
  CUPBOARD_SPAWNS,
  CUPBOARD_DURATION,
  CUPBOARD_REACH,
  PAGES,
  type Cupboard,
  type CupboardUse,
  STATIONS,
  VISIBILITY_RADIUS,
  atCiConsole,
  walkable,
  pageAt,
  type Action,
  type Person,
  type Role,
  type Snapshot
} from '../src/lib/shared.ts';

const ROLE_REVEAL_DURATION = 3_000;
const SPRINT_DURATION = 240_000;

type Member = Omit<Person, 'visible'> & {
  access: AccessUse | null;
  cupboard: CupboardUse | null;
  token: string;
  socket: string | null;
  role: Role;
  tasks: string[];
  puzzles: Record<
    string,
    { id: string; definition: TaskDefinition; step: number; order: number[] }
  >;
  completed: string[];
  cooldown: number;
  lastMove: number;
  meetings: number;
  disconnectedAt: number;
  notice: { x: number; y: number } | null;
};
export class Session {
  accessPanels: AccessPanel[] = [];
  cupboards: Cupboard[] = [];
  code: string;
  host = '';
  phase: Snapshot['phase'] = 'lobby';
  players: Member[] = [];
  roleRevealDeadline = 0;
  deadline = 0;
  incident = false;
  repair: { id: string; step: number } | null = null;
  sabotageReady = 0;
  meeting: {
    caller: string;
    deadline: number;
    started: number;
    votes: Map<string, string>;
  } | null = null;
  meetingResult: {
    testerIdentified: boolean;
    message: string;
    deadline: number;
    started: number;
    continues: boolean;
  } | null = null;
  result = '';
  winner: Role | null = null;
  created = Date.now();
  initialCount = 0;
  constructor(code: string) {
    this.code = code;
  }

  join(name: string, socket: string, token?: string, now = Date.now()) {
    const existing = this.players.find((p) => p.token === token);
    if (existing) {
      if (existing.socket) throw new Error('This seat is already connected in another tab.');
      existing.socket = socket;
      existing.connected = true;
      existing.disconnectedAt = 0;
      return existing;
    }
    if (this.phase !== 'lobby')
      throw new Error('This sprint has already started. Join the next one.');
    if (this.players.length >= 10) throw new Error('This workspace is full (10 people).');
    if (!name.trim() || name.trim().length > 20)
      throw new Error('Use a display name of 1–20 characters.');
    if (this.players.some((p) => p.name.toLowerCase() === name.trim().toLowerCase()))
      throw new Error('That display name is already taken.');
    const p: Member = {
      access: null,
      cupboard: null,
      id: randomUUID(),
      token: randomUUID(),
      socket,
      name: name.trim(),
      color: COLORS.find((c) => !this.players.some((p) => p.color === c))!,
      x: 425 + (this.players.length % 4) * 45,
      y: 280 + Math.floor(this.players.length / 4) * 45,
      active: true,
      connected: true,
      reported: false,
      role: 'dev',
      tasks: [],
      puzzles: {},
      completed: [],
      cooldown: 0,
      lastMove: now,
      meetings: 1,
      disconnectedAt: 0,
      notice: null
    };
    this.players.push(p);
    if (!this.host) this.host = p.id;
    return p;
  }
  disconnect(socket: string, now = Date.now()) {
    const p = this.players.find((p) => p.socket === socket);
    if (!p) return;
    p.socket = null;
    p.connected = false;
    p.disconnectedAt = now;
    if (this.host === p.id) this.host = this.players.find((p) => p.connected)?.id ?? p.id;
  }
  start(now = Date.now()) {
    if (this.players.length < 3 || this.players.some((p) => !p.connected))
      throw new Error('Start with 3–10 connected people.');
    this.initialCount = this.players.length;
    this.accessPanels = ACCESS_PAIRS[randomInt(ACCESS_PAIRS.length)].map((id) => {
      const spots = ACCESS_SPAWNS.filter((spot) => pageAt(spot)?.id === id);
      return { ...spots[randomInt(spots.length)], open: false };
    });
    const pages = [...PAGES];
    this.cupboards = Array.from({ length: 3 }, () => {
      const [page] = pages.splice(randomInt(pages.length), 1);
      const spots = CUPBOARD_SPAWNS.filter((spot) => pageAt(spot)?.id === page.id);
      return { ...spots[randomInt(spots.length)], open: false };
    });
    const tester = randomInt(this.players.length);
    this.players.forEach((p, i) => {
      p.role = i === tester ? 'tester' : 'dev';
      p.cupboard = null;
      p.access = null;
      p.active = true;
      p.reported = false;
      p.notice = null;
      p.tasks = STATIONS.map((s) => s.id);
      p.puzzles = Object.fromEntries(
        STATIONS.map((station) => {
          const variants = TASK_VARIANTS[station.id];
          const order = [0, 1, 2, 3];
          for (let j = order.length - 1; j > 0; j--) {
            const k = randomInt(j + 1);
            [order[j], order[k]] = [order[k], order[j]];
          }
          return [
            station.id,
            { id: randomUUID(), definition: variants[randomInt(variants.length)], step: 0, order }
          ];
        })
      );
      p.completed = [];
      p.cooldown = now + ROLE_REVEAL_DURATION + 25_000;
      p.meetings = 1;
      p.lastMove = now + ROLE_REVEAL_DURATION;
      p.x = 425 + (i % 4) * 45;
      p.y = 280 + Math.floor(i / 4) * 45;
    });
    this.phase = 'role-reveal';
    this.roleRevealDeadline = now + ROLE_REVEAL_DURATION;
    this.deadline = this.roleRevealDeadline + SPRINT_DURATION;
    this.incident = false;
    this.repair = null;
    this.sabotageReady = this.roleRevealDeadline + 20_000;
    this.meeting = null;
    this.meetingResult = null;
    this.result = '';
    this.winner = null;
  }
  end(winner: Role, result: string) {
    this.clearAccess();
    this.clearCupboards();
    this.phase = 'ended';
    this.roleRevealDeadline = 0;
    this.winner = winner;
    this.result = result;
    this.meeting = null;
    this.meetingResult = null;
  }
  checkWin() {
    if (this.phase === 'ended' || this.phase === 'lobby' || this.phase === 'role-reveal') return;
    if (!this.players.some((p) => p.active && p.role === 'tester'))
      return this.end('dev', 'The tester has been sent on mandatory training. Release approved!');
    const devs = this.players.filter((p) => p.role === 'dev');
    if (devs.every((p) => p.completed.length === p.tasks.length))
      return this.end('dev', 'All tickets closed. Somehow, this actually shipped.');
    if (this.initialCount > 3 && devs.filter((p) => p.active).length <= 1)
      this.end('tester', 'Too few devs remain. The release has been postponed indefinitely.');
  }
  nearby(a: { x: number; y: number }, b: { x: number; y: number }, distance = 80) {
    return canSee(a, b, distance);
  }
  clearCupboards() {
    for (const p of this.players) {
      const cupboard = this.cupboards.find((c) => c.id === p.cupboard?.id);
      if (cupboard) cupboard.open = true;
      p.cupboard = null;
    }
  }
  clearAccess() {
    // Meetings interrupt travel at the source unless the exit has already begun.
    for (const p of this.players) {
      if (!p.access) continue;
      const panel = this.accessPanels.find(
        (a) => a.id === (p.access!.phase === 'exiting' ? p.access!.to : p.access!.from)
      );
      if (panel) {
        p.x = panel.x;
        p.y = panel.y;
        panel.open = true;
      }
      p.access = null;
    }
  }
  action(id: string, action: Action, now = Date.now()) {
    const p = this.players.find((p) => p.id === id);
    if (!p || !p.connected) throw new Error('Reconnect to your workspace.');
    if (action.type === 'start' || action.type === 'reset') {
      if (p.id !== this.host) throw new Error('Only the host can do that.');
      if (action.type === 'start' && this.phase === 'lobby') {
        this.start(now);
        return;
      }
      if (action.type === 'reset' && this.phase === 'ended') {
        this.players = this.players.filter((p) => p.connected);
        this.phase = 'lobby';
        this.clearCupboards();
        this.clearAccess();
        this.accessPanels = [];
        this.cupboards = [];
        this.roleRevealDeadline = 0;
        this.players.forEach((p) => {
          p.active = true;
          p.reported = false;
          p.role = 'dev';
          p.tasks = [];
          p.puzzles = {};
          p.completed = [];
        });
        this.result = '';
        this.winner = null;
        this.incident = false;
        this.repair = null;
        this.meetingResult = null;
        return;
      }
      throw new Error('That action is unavailable right now.');
    }
    if (action.type === 'vote') {
      if (this.phase !== 'meeting' || !this.meeting || !p.active)
        throw new Error('You cannot vote right now.');
      if (now >= this.meeting.deadline) throw new Error('Voting has closed.');
      if (this.meeting.votes.has(p.id)) throw new Error('Your vote has already been submitted.');
      if (action.target !== 'skip' && !this.players.some((t) => t.id === action.target && t.active))
        throw new Error('Choose an active colleague or skip.');
      this.meeting.votes.set(p.id, action.target);
      if (this.players.filter((p) => p.active).every((p) => this.meeting!.votes.has(p.id)))
        this.resolveMeeting(now);
      return;
    }
    if (this.phase !== 'work') throw new Error('Wait until the sprint resumes.');
    if (p.access) {
      if (action.type === 'move') {
        p.lastMove = now;
        return;
      }
      throw new Error('Wait until you finish using the maintenance route.');
    }
    if (action.type === 'cupboard') {
      if (p.role !== 'tester' || !p.active)
        throw new Error('Only the active Tester can use cupboards.');
      const cupboard = this.cupboards.find((c) => c.id === action.id);
      if (!cupboard || !this.nearby(p, cupboard, CUPBOARD_REACH))
        throw new Error('Move closer to that supply cupboard.');
      if (p.cupboard) {
        if (p.cupboard.id !== cupboard.id || p.cupboard.phase !== 'hidden')
          throw new Error('Wait until you finish entering or exiting.');
        p.cupboard = { id: cupboard.id, phase: 'exiting', deadline: now + CUPBOARD_DURATION };
        cupboard.open = true;
      } else {
        p.x = cupboard.x;
        p.y = cupboard.y;
        p.cupboard = { id: cupboard.id, phase: 'entering', deadline: now + CUPBOARD_DURATION };
        cupboard.open = true;
      }
      p.lastMove = now;
      return;
    }
    if (p.cupboard) {
      if (action.type === 'move') {
        p.lastMove = now;
        return;
      }
      throw new Error('Exit the supply cupboard first.');
    }
    if (action.type === 'access') {
      if (p.role !== 'tester' || !p.active)
        throw new Error('Only the active Tester can use access panels.');
      const panel = this.accessPanels.find((a) => a.id === action.id);
      if (!panel || !this.nearby(p, panel, ACCESS_REACH))
        throw new Error('Move closer to that access panel.');
      const destination = this.accessPanels.find((a) => a.id !== panel.id)!;
      p.x = panel.x;
      p.y = panel.y;
      panel.open = true;
      p.access = {
        from: panel.id,
        to: destination.id,
        phase: 'entering',
        deadline: now + ACCESS_DURATION
      };
      p.lastMove = now;
      return;
    }
    if (action.type === 'move') {
      if (!Number.isFinite(action.dx) || !Number.isFinite(action.dy)) return;
      const magnitude = Math.hypot(action.dx, action.dy);
      if (!magnitude) return;
      const distance = Math.min(0.1, Math.max(0, (now - p.lastMove) / 1000)) * 190;
      p.lastMove = now;
      const dx = (action.dx / magnitude) * distance,
        dy = (action.dy / magnitude) * distance;
      if (walkable(p.x + dx, p.y)) p.x += dx;
      if (walkable(p.x, p.y + dy)) p.y += dy;
      return;
    }
    if (action.type === 'task') {
      const station = STATIONS.find((s) => s.id === action.station);
      if (!station || !this.nearby(p, station)) throw new Error('Move closer to that workstation.');
      if (this.incident)
        throw new Error(
          'Repair CI at the CI Control Console at the top of the central office first.'
        );
      const puzzle = p.puzzles[station.id];
      if (!puzzle || action.puzzle !== puzzle.id || !Number.isInteger(action.step))
        throw new Error('Reopen this ticket to load its current task.');
      // Retrying an acknowledged step is harmless; it never advances a second time.
      if (action.step < puzzle.step) return;
      if (action.step !== puzzle.step || puzzle.step >= puzzle.definition.steps.length)
        throw new Error('Wait for the current step.');
      if (puzzle.definition.steps[puzzle.step].answer !== action.answer)
        throw new Error('That might need another refinement session. Try again.');
      puzzle.step++;
      // Testers can convincingly pretend to work, but never advance team progress.
      if (puzzle.step === puzzle.definition.steps.length && !p.completed.includes(station.id))
        p.completed.push(station.id);
      this.checkWin();
      return;
    }
    if (!p.active) throw new Error('You are on training. You can still finish your tickets.');
    if (action.type === 'sideline') {
      if (this.initialCount === 3)
        throw new Error('Training is disabled with three people. Delay the release instead.');
      const target = this.players.find((t) => t.id === action.target);
      if (
        p.role !== 'tester' ||
        p.cooldown > now ||
        !target?.active ||
        target.id === p.id ||
        !this.nearby(p, target, 65)
      )
        throw new Error('Training is unavailable. Move closer or wait for the cooldown.');
      target.active = false;
      target.reported = false;
      target.notice = { x: target.x, y: target.y };
      p.cooldown = now + 30_000;
      this.checkWin();
      return;
    }
    if (action.type === 'sabotage') {
      if (p.role !== 'tester' || this.incident || now < this.sabotageReady)
        throw new Error('The pipeline is not ready for another incident.');
      this.incident = true;
      this.repair = { id: randomUUID(), step: 0 };
      this.sabotageReady = now + 45_000;
      return;
    }
    if (action.type === 'repair') {
      if (!this.incident) throw new Error('CI is already operational.');
      if (!atCiConsole(p))
        throw new Error(
          'Move to the CI Control Console at the top of the central office to repair CI.'
        );
      const repair = this.repair;
      if (
        !repair ||
        action.puzzle !== repair.id ||
        !Number.isInteger(action.step) ||
        action.step < 0
      )
        throw new Error('Reopen CI repair to load the current incident.');
      if (action.step < repair.step) return;
      if (action.step !== repair.step)
        throw new Error(
          'Resolve the current stage first: pause the pipeline before clearing the deployment, then check health.'
        );
      if (CI_REPAIR.steps[repair.step].answer !== action.answer)
        throw new Error(
          'That recovery action will not resolve this stage. Read its incident clue and try again.'
        );
      repair.step++;
      if (repair.step === CI_REPAIR.steps.length) {
        this.incident = false;
        this.repair = null;
      }
      return;
    }
    if (action.type === 'meeting' || action.type === 'report') {
      if (action.type === 'meeting') {
        if (!this.nearby(p, { x: 500, y: 310 }) || p.meetings < 1 || this.incident)
          throw new Error('Use your standup at the central table while CI is healthy.');
        p.meetings--;
      } else {
        const report = this.players.find(
          (t) => !t.active && !t.reported && this.nearby(p, t.notice ?? t)
        );
        if (!report) throw new Error('No training notice nearby.');
      }
      this.players.filter((p) => !p.active).forEach((p) => (p.reported = true));
      this.phase = 'meeting';
      this.clearAccess();
      this.clearCupboards();
      this.meeting = { caller: p.name, deadline: now + 40_000, started: now, votes: new Map() };
      return;
    }
    throw new Error('Unknown action.');
  }
  resolveMeeting(now: number) {
    if (!this.meeting) return;
    const meetingStarted = this.meeting.started;
    const tally = new Map<string, number>();
    for (const p of this.players.filter((p) => p.active)) {
      const vote = this.meeting.votes.get(p.id) ?? 'skip';
      tally.set(vote, (tally.get(vote) ?? 0) + 1);
    }
    const ranking = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranking[0];
    let testerIdentified = false;
    this.result = 'No consensus. No one was sent on mandatory training.';
    if (top && top[0] !== 'skip' && (!ranking[1] || top[1] > ranking[1][1])) {
      const target = this.players.find((p) => p.id === top[0])!;
      target.active = false;
      target.reported = true;
      testerIdentified = target.role === 'tester';
      this.result = testerIdentified
        ? `${target.name} was identified as the tester.`
        : `${target.name} was sent on mandatory training, but the tester remains at large.`;
    }
    this.pauseTimers(now - meetingStarted, now);
    this.meeting = null;
    const testerWins =
      !testerIdentified &&
      this.initialCount > 3 &&
      this.players.filter((p) => p.role === 'dev' && p.active).length <= 1;
    this.meetingResult = {
      testerIdentified,
      message: this.result,
      deadline: now + 3_000,
      started: now,
      continues: !testerIdentified && !testerWins
    };
    this.phase = 'meeting-result';
  }
  pauseTimers(duration: number, now: number) {
    this.deadline += duration;
    this.sabotageReady += duration;
    this.players.forEach((p) => {
      p.cooldown += duration;
      p.lastMove = now;
    });
  }
  finishMeetingResult(now: number) {
    if (!this.meetingResult) return;
    this.pauseTimers(now - this.meetingResult.started, now);
    this.meetingResult = null;
    this.phase = 'work';
    this.checkWin();
  }
  finishRoleReveal(now: number) {
    if (this.phase !== 'role-reveal') return;
    this.phase = 'work';
    this.roleRevealDeadline = 0;
    this.players.forEach((p) => (p.lastMove = now));
  }
  tick(now = Date.now()) {
    if (this.phase === 'work') {
      for (const p of this.players) {
        // Advance one phase per tick so a delayed server never skips a visible exit.
        const use = p.access;
        if (!use || now < use.deadline) continue;
        const source = this.accessPanels.find((a) => a.id === use.from)!;
        const destination = this.accessPanels.find((a) => a.id === use.to)!;
        if (use.phase === 'entering') {
          source.open = false;
          p.access = { ...use, phase: 'travelling', deadline: now + ACCESS_DURATION };
        } else if (use.phase === 'travelling') {
          source.open = true;
          destination.open = true;
          p.x = destination.x;
          p.y = destination.y;
          p.access = { ...use, phase: 'exiting', deadline: now + ACCESS_DURATION };
        } else p.access = null;
        p.lastMove = now;
      }
      for (const p of this.players) {
        const use = p.cupboard;
        if (!use || use.phase === 'hidden' || now < use.deadline) continue;
        const cupboard = this.cupboards.find((c) => c.id === use.id)!;
        if (use.phase === 'entering') {
          cupboard.open = false;
          p.cupboard = { id: use.id, phase: 'hidden', deadline: 0 };
        } else {
          cupboard.open = true;
          p.cupboard = null;
        }
        p.lastMove = now;
      }
    }
    for (const p of [...this.players]) {
      if (!p.connected && now - p.disconnectedAt > 60_000) {
        if (this.phase === 'lobby' || this.phase === 'ended')
          this.players = this.players.filter((t) => t !== p);
        else {
          this.end(
            'dev',
            `${p.name} did not reconnect within 60 seconds. Sprint cancelled; regroup in the lobby.`
          );
          this.winner = null;
        }
      }
    }
    if (this.phase === 'meeting' && this.meeting && now >= this.meeting.deadline)
      this.resolveMeeting(now);
    if (this.phase === 'role-reveal' && this.roleRevealDeadline && now >= this.roleRevealDeadline)
      this.finishRoleReveal(now);
    if (this.phase === 'meeting-result' && this.meetingResult && now >= this.meetingResult.deadline)
      this.finishMeetingResult(now);
    if (this.phase === 'work' && now >= this.deadline)
      this.end(
        'tester',
        'The deadline arrived before the release. The tester requests one more sprint.'
      );
  }
  snapshot(id: string, now = Date.now()): Snapshot {
    const me = this.players.find((p) => p.id === id)!;
    const devs = this.players.filter((p) => p.role === 'dev');
    const travelling = me.access?.phase === 'travelling';
    return {
      access: me.access ? { ...me.access } : null,
      accessPanels: this.accessPanels.map((a) => ({
        ...a,
        // Locations are map infrastructure and always known. Door activity is only
        // disclosed while the viewer is on that panel's page.
        open: this.phase !== 'work' || pageAt(me)?.id === pageAt(a)?.id ? a.open : null
      })),
      cupboard: me.cupboard ? { ...me.cupboard } : null,
      cupboards: this.cupboards.map((c) => ({
        ...c,
        open:
          this.phase !== 'work' ||
          (!travelling && !me.active) ||
          this.nearby(
            me,
            c,
            travelling
              ? 0
              : me.cupboard?.phase === 'hidden'
                ? VISIBILITY_RADIUS / 2
                : VISIBILITY_RADIUS
          )
            ? c.open
            : null
      })),
      code: this.code,
      host: this.host,
      phase: this.phase,
      self: id,
      // Never serialize private member objects: tokens and other roles stay on the server.
      players: this.players.map((p) => {
        const position = p.id !== id && p.notice ? p.notice : p;
        const visible =
          this.phase !== 'work' ||
          p.id === id ||
          (p.cupboard?.phase !== 'hidden' &&
            p.access?.phase !== 'travelling' &&
            !travelling &&
            (!me.active ||
              this.nearby(
                me,
                position,
                me.cupboard?.phase === 'hidden' ? VISIBILITY_RADIUS / 2 : VISIBILITY_RADIUS
              )));
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          x: visible ? position.x : 0,
          y: visible ? position.y : 0,
          active: visible ? p.active : true,
          connected: p.connected,
          reported: visible ? p.reported : false,
          visible
        };
      }),
      role: this.phase === 'lobby' ? null : me.role,
      tasks: me.tasks,
      puzzles: Object.fromEntries(
        Object.entries(me.puzzles).map(([station, puzzle]) => [
          station,
          taskView(puzzle.definition, puzzle.id, puzzle.step, puzzle.order)
        ])
      ),
      completed: me.completed,
      progress: devs.reduce((n, p) => n + p.completed.length, 0),
      total: devs.reduce((n, p) => n + p.tasks.length, 0),
      roleRevealDeadline: this.roleRevealDeadline,
      deadline: this.deadline,
      now,
      cooldown: me.cooldown,
      sabotageReady: this.sabotageReady,
      incident: this.incident,
      repair: this.repair ? taskView(CI_REPAIR, this.repair.id, this.repair.step, [0, 1, 2]) : null,
      meetingsLeft: me.meetings,
      meeting: this.meeting
        ? {
            caller: this.meeting.caller,
            deadline: this.meeting.deadline,
            votes: [...this.meeting.votes.keys()],
            yourVote: this.meeting.votes.get(id) ?? null
          }
        : null,
      meetingResult: this.meetingResult
        ? {
            testerIdentified: this.meetingResult.testerIdentified,
            message: this.meetingResult.message,
            deadline: this.meetingResult.deadline,
            continues: this.meetingResult.continues
          }
        : null,
      result:
        this.phase === 'ended'
          ? `${this.result} Tester: ${this.players.find((p) => p.role === 'tester')?.name ?? 'unassigned'}.`
          : this.result,
      winner: this.winner
    };
  }
}
