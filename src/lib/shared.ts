import type { TaskView } from './tasks.ts';

export const COLORS = [
  '#a5b4fc',
  '#fda4af',
  '#5eead4',
  '#fcd34d',
  '#c4b5fd',
  '#fdba74',
  '#7dd3fc',
  '#bef264',
  '#f0abfc',
  '#cbd5e1'
];
export const WIDTH = 1000;
export const HEIGHT = 620;
// One continuous world; the camera shows exactly one office page at a time.
export const PAGES = [
  { id: 'centre', name: 'The Open Plan', x: 0, y: 0, color: '#303744' },
  { id: 'north', name: 'Development', x: 0, y: -HEIGHT, color: '#333144' },
  { id: 'east', name: 'Server Cupboard', x: WIDTH, y: 0, color: '#233c3c' },
  { id: 'south', name: 'Kitchen', x: 0, y: HEIGHT, color: '#423a2d' },
  { id: 'west', name: 'Product Corner', x: -WIDTH, y: 0, color: '#353149' }
] as const;
export function pageAt(position: { x: number; y: number }) {
  return PAGES.find(
    (page) =>
      position.x >= page.x &&
      position.x < page.x + WIDTH &&
      position.y >= page.y &&
      position.y < page.y + HEIGHT
  );
}
// Shared door openings keep both sides of each transition aligned.
export const EXITS = [
  { from: 'centre', to: 'north', x: 800, y: 0, vertical: false, label: 'Development ↑' },
  { from: 'north', to: 'centre', x: 800, y: 0, vertical: false, label: 'Open Plan ↓' },
  { from: 'centre', to: 'east', x: WIDTH, y: 310, vertical: true, label: 'Servers →' },
  { from: 'east', to: 'centre', x: WIDTH, y: 310, vertical: true, label: '← Open Plan' },
  { from: 'centre', to: 'south', x: 500, y: HEIGHT, vertical: false, label: 'Kitchen ↓' },
  { from: 'south', to: 'centre', x: 500, y: HEIGHT, vertical: false, label: 'Open Plan ↑' },
  { from: 'centre', to: 'west', x: 0, y: 310, vertical: true, label: '← Product' },
  { from: 'west', to: 'centre', x: 0, y: 310, vertical: true, label: 'Open Plan →' }
] as const;
export const CI_CONSOLE = { x: 500, y: 45, width: 200, interactionHeight: 160 } as const;
export function atCiConsole(position: { x: number; y: number }) {
  return (
    pageAt(position)?.id === 'centre' &&
    Math.abs(position.x - CI_CONSOLE.x) <= CI_CONSOLE.width / 2 &&
    Math.abs(position.y - CI_CONSOLE.y) <= CI_CONSOLE.interactionHeight / 2
  );
}
export function nearestWithin<T extends { x: number; y: number }>(
  position: { x: number; y: number },
  candidates: readonly T[],
  distance: number
) {
  let nearest: T | undefined;
  let nearestDistance = distance;
  for (const candidate of candidates) {
    const candidateDistance = Math.hypot(candidate.x - position.x, candidate.y - position.y);
    if (candidateDistance <= distance && (!nearest || candidateDistance < nearestDistance)) {
      nearest = candidate;
      nearestDistance = candidateDistance;
    }
  }
  return nearest;
}
export const STATIONS = [
  {
    id: 'merge',
    name: 'Resolve a merge conflict',
    room: 'Development',
    x: 420,
    y: -350,
    symbol: '⌘'
  },
  {
    id: 'build',
    name: 'Restart the server',
    room: 'Server cupboard',
    x: 1550,
    y: 180,
    symbol: '▥'
  },
  {
    id: 'coffee',
    name: 'Refill the coffee machine',
    room: 'Kitchen',
    x: 730,
    y: 980,
    symbol: '☕'
  },
  {
    id: 'ticket',
    name: 'Find the acceptance criteria',
    room: 'Product corner',
    x: -540,
    y: 440,
    symbol: '✓'
  }
] as const;
type Wall = { x: number; y: number; w: number; h: number };
const boundaryWalls: Wall[] = PAGES.flatMap((page) => {
  const walls: Wall[] = [];
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const vertical = side === 'left' || side === 'right';
    const fixed = vertical
      ? page.x + (side === 'right' ? WIDTH : 0)
      : page.y + (side === 'bottom' ? HEIGHT : 0);
    const start = vertical ? page.y : page.x;
    const length = vertical ? HEIGHT : WIDTH;
    const door = EXITS.find(
      (exit) =>
        exit.from === page.id &&
        exit.vertical === vertical &&
        (vertical ? exit.x : exit.y) === fixed
    );
    const opening = door ? (vertical ? door.y : door.x) : 0;
    const spans = door
      ? [
          [start, opening - 70],
          [opening + 70, start + length]
        ]
      : [[start, start + length]];
    for (const [a, b] of spans)
      walls.push(
        vertical ? { x: fixed - 8, y: a, w: 16, h: b - a } : { x: a, y: fixed - 8, w: b - a, h: 16 }
      );
  }
  return walls;
});
export const WALLS: Wall[] = [
  ...boundaryWalls,
  // Central circulation stays open around the standup table.
  { x: 315, y: 60, w: 18, h: 125 },
  { x: 667, y: 60, w: 18, h: 125 },
  { x: 315, y: 440, w: 18, h: 120 },
  { x: 667, y: 440, w: 18, h: 120 },
  // Development: two doors into a work area, with a loop around the partition.
  { x: 220, y: -440, w: 18, h: 260 },
  { x: 220, y: -180, w: 210, h: 18 },
  { x: 560, y: -180, w: 130, h: 18 },
  { x: 690, y: -440, w: 18, h: 100 },
  { x: 690, y: -220, w: 18, h: 58 },
  // Servers: a narrow entrance and a genuine dead-end workstation bay.
  { x: 1300, y: 80, w: 448, h: 18 },
  { x: 1300, y: 80, w: 18, h: 160 },
  { x: 1300, y: 360, w: 18, h: 180 },
  { x: 1318, y: 360, w: 430, h: 18 },
  { x: 1730, y: 80, w: 18, h: 280 },
  // Kitchen: a central island provides two approaches.
  { x: 360, y: 860, w: 200, h: 100 },
  { x: 100, y: 1060, w: 260, h: 18 },
  // Product: offset partitions create a winding corridor and a quiet alcove.
  { x: -700, y: 150, w: 440, h: 18 },
  { x: -260, y: 150, w: 18, h: 150 },
  { x: -700, y: 300, w: 18, h: 210 },
  { x: -450, y: 300, w: 190, h: 18 }
];
export type Phase = 'lobby' | 'role-reveal' | 'work' | 'meeting' | 'meeting-result' | 'ended';
export type Role = 'dev' | 'tester';
export type Person = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  active: boolean;
  connected: boolean;
  reported: boolean;
  visible: boolean;
};
export type Snapshot = {
  code: string;
  host: string;
  phase: Phase;
  players: Person[];
  self: string;
  role: Role | null;
  tasks: string[];
  puzzles: Record<string, TaskView>;
  completed: string[];
  progress: number;
  total: number;
  roleRevealDeadline: number;
  deadline: number;
  now: number;
  cooldown: number;
  sabotageReady: number;
  incident: boolean;
  repair: TaskView | null;
  meetingsLeft: number;
  meeting: { caller: string; deadline: number; votes: string[]; yourVote: string | null } | null;
  meetingResult: {
    testerIdentified: boolean;
    message: string;
    deadline: number;
    continues: boolean;
  } | null;
  result: string;
  winner: Role | null;
};
export type Action =
  | { type: 'start' | 'reset' | 'meeting' | 'sabotage' | 'report' }
  | { type: 'repair'; puzzle: string; step: number; answer: string }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'sideline'; target: string }
  | { type: 'task'; station: string; puzzle: string; step: number; answer: string }
  | { type: 'vote'; target: string };
export type Reply = { error?: string; token?: string; code?: string };
export function walkable(x: number, y: number) {
  return (
    !!pageAt({ x, y }) &&
    !WALLS.some((w) => x > w.x - 15 && x < w.x + w.w + 15 && y > w.y - 15 && y < w.y + w.h + 15)
  );
}
