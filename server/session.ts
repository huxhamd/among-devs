import { randomInt, randomUUID } from 'node:crypto';
import {
  COLORS,
  STATIONS,
  walkable,
  type Action,
  type Person,
  type Role,
  type Snapshot
} from '../src/lib/shared.ts';

type Member = Omit<Person, 'visible'> & {
  token: string;
  socket: string | null;
  role: Role;
  tasks: string[];
  completed: string[];
  cooldown: number;
  lastMove: number;
  meetings: number;
  disconnectedAt: number;
  notice: { x: number; y: number } | null;
};
export class Session {
  code: string;
  host = '';
  phase: Snapshot['phase'] = 'lobby';
  players: Member[] = [];
  deadline = 0;
  incident = false;
  sabotageReady = 0;
  meeting: {
    caller: string;
    deadline: number;
    started: number;
    votes: Map<string, string>;
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
    const tester = randomInt(this.players.length);
    this.players.forEach((p, i) => {
      p.role = i === tester ? 'tester' : 'dev';
      p.active = true;
      p.reported = false;
      p.notice = null;
      p.tasks = STATIONS.map((s) => s.id);
      p.completed = [];
      p.cooldown = now + 25_000;
      p.meetings = 1;
      p.lastMove = now;
      p.x = 425 + (i % 4) * 45;
      p.y = 280 + Math.floor(i / 4) * 45;
    });
    this.phase = 'work';
    this.deadline = now + 240_000;
    this.incident = false;
    this.sabotageReady = now + 20_000;
    this.meeting = null;
    this.result = '';
    this.winner = null;
  }
  end(winner: Role, result: string) {
    this.phase = 'ended';
    this.winner = winner;
    this.result = result;
    this.meeting = null;
  }
  checkWin() {
    if (this.phase === 'ended' || this.phase === 'lobby') return;
    if (!this.players.some((p) => p.active && p.role === 'tester'))
      return this.end('dev', 'The tester has been sent on mandatory training. Release approved!');
    const devs = this.players.filter((p) => p.role === 'dev');
    if (devs.every((p) => p.completed.length === p.tasks.length))
      return this.end('dev', 'All tickets closed. Somehow, this actually shipped.');
    if (this.initialCount > 3 && devs.filter((p) => p.active).length <= 1)
      this.end('tester', 'Too few devs remain. The release has been postponed indefinitely.');
  }
  nearby(a: { x: number; y: number }, b: { x: number; y: number }, distance = 80) {
    if (Math.hypot(a.x - b.x, a.y - b.y) > distance) return false;
    for (let i = 1; i < 20; i++)
      if (!walkable(a.x + ((b.x - a.x) * i) / 20, a.y + ((b.y - a.y) * i) / 20)) return false;
    return true;
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
        this.players.forEach((p) => {
          p.active = true;
          p.reported = false;
          p.role = 'dev';
          p.tasks = [];
          p.completed = [];
        });
        this.result = '';
        this.winner = null;
        this.incident = false;
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
      if (this.incident) throw new Error('Repair CI in the server cupboard first.');
      if (station.answer !== action.answer)
        throw new Error('That might need another refinement session. Try again.');
      // Testers can convincingly pretend to work, but never advance team progress.
      if (!p.completed.includes(station.id)) p.completed.push(station.id);
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
      this.sabotageReady = now + 45_000;
      return;
    }
    if (action.type === 'repair') {
      if (!this.incident || !this.nearby(p, STATIONS[1]))
        throw new Error('Move to the server cupboard to repair CI.');
      this.incident = false;
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
      this.meeting = { caller: p.name, deadline: now + 40_000, started: now, votes: new Map() };
      return;
    }
    throw new Error('Unknown action.');
  }
  resolveMeeting(now: number) {
    if (!this.meeting) return;
    const tally = new Map<string, number>();
    for (const p of this.players.filter((p) => p.active)) {
      const vote = this.meeting.votes.get(p.id) ?? 'skip';
      tally.set(vote, (tally.get(vote) ?? 0) + 1);
    }
    const ranking = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranking[0];
    this.result = 'No consensus. A very productive meeting, then.';
    if (top && top[0] !== 'skip' && (!ranking[1] || top[1] > ranking[1][1])) {
      const target = this.players.find((p) => p.id === top[0])!;
      target.active = false;
      target.reported = true;
      this.result = `${target.name} was sent on mandatory training. Their role stays confidential until the end.`;
    }
    const duration = now - this.meeting.started;
    this.deadline += duration;
    this.sabotageReady += duration;
    this.players.forEach((p) => {
      p.cooldown += duration;
      p.lastMove = now;
    });
    this.meeting = null;
    this.phase = 'work';
    this.checkWin();
  }
  tick(now = Date.now()) {
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
    if (this.phase === 'work' && now >= this.deadline)
      this.end(
        'tester',
        'The deadline arrived before the release. The tester requests one more sprint.'
      );
  }
  snapshot(id: string, now = Date.now()): Snapshot {
    const me = this.players.find((p) => p.id === id)!;
    const devs = this.players.filter((p) => p.role === 'dev');
    return {
      code: this.code,
      host: this.host,
      phase: this.phase,
      self: id,
      // Never serialize private member objects: tokens and other roles stay on the server.
      players: this.players.map((p) => {
        const position = p.id !== id && p.notice ? p.notice : p;
        const visible =
          this.phase !== 'work' || p.id === id || !me.active || this.nearby(me, position, 240);
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
      completed: me.completed,
      progress: devs.reduce((n, p) => n + p.completed.length, 0),
      total: devs.reduce((n, p) => n + p.tasks.length, 0),
      deadline: this.deadline,
      now,
      cooldown: me.cooldown,
      sabotageReady: this.sabotageReady,
      incident: this.incident,
      meetingsLeft: me.meetings,
      meeting: this.meeting
        ? {
            caller: this.meeting.caller,
            deadline: this.meeting.deadline,
            votes: [...this.meeting.votes.keys()],
            yourVote: this.meeting.votes.get(id) ?? null
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
