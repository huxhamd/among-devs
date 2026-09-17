import type { TaskView } from './tasks.ts';
import { FIXTURE_TYPES, OFFICE_LAYOUTS, type Fixture } from './office.ts';

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
export const STANDUP = { x: 500, y: 310, reach: 80 } as const;
export const PLAYER_INTERACTION_REACH = 65;
export const PLAYER_START_RADIUS = 110;
// Fill a fixed ten-seat ring from the top, alternating clockwise and anticlockwise.
const PLAYER_START_SLOT_ORDER = [0, 1, 9, 2, 8, 3, 7, 4, 6, 5] as const;
export function playerStartPositions(count: number) {
  // Partial even rings have one extra clockwise slot. A half-slot rotation centres the arc.
  const offset = count < 10 && count % 2 === 0 ? -Math.PI / 10 : 0;
  return PLAYER_START_SLOT_ORDER.slice(0, count).map((slot) => {
    const angle = -Math.PI / 2 + (slot * Math.PI * 2) / 10 + offset;
    return {
      x: STANDUP.x + Math.cos(angle) * PLAYER_START_RADIUS,
      y: STANDUP.y + Math.sin(angle) * PLAYER_START_RADIUS
    };
  });
}
export const PLAYER_STARTS = playerStartPositions(10);
// Keep the visual light boundary aligned with server-authoritative visibility.
export const VISIBILITY_RADIUS = 240;
export const CUPBOARD_DURATION = 1000;
export const CUPBOARD_REACH = 60;
export const ACCESS_DURATION = 1000;
export const ACCESS_REACH = 60;
export const ACCESS_PAIRS = [
  ['north', 'south'],
  ['east', 'west']
] as const;
// Separate floor positions keep panels away from cupboard entrances.
export const ACCESS_SPAWNS = [
  { id: 'access-north-top', x: 430, y: -520 },
  { id: 'access-north-bottom', x: 530, y: -100 },
  { id: 'access-south-top', x: 700, y: 720 },
  { id: 'access-south-bottom', x: 260, y: 1170 },
  { id: 'access-east-top', x: 1140, y: 150 },
  { id: 'access-east-bottom', x: 1810, y: 500 },
  { id: 'access-west-top', x: -480, y: 100 },
  { id: 'access-west-bottom', x: -800, y: 530 }
] as const;
export type AccessPanel = { id: string; x: number; y: number; open: boolean };
export type AccessUse = {
  from: string;
  to: string;
  phase: 'entering' | 'travelling' | 'exiting';
  deadline: number;
};
// Coordinates mark the floor directly in front of each cupboard.
export const CUPBOARD_SPAWNS = [
  { id: 'centre-left', x: 220, y: 160 },
  { id: 'centre-right', x: 900, y: 550 },
  { id: 'north-left', x: 110, y: -410 },
  { id: 'north-right', x: 870, y: -230 },
  { id: 'east-bottom', x: 1230, y: 560 },
  { id: 'east-right', x: 1880, y: 240 },
  { id: 'south-left', x: 150, y: 790 },
  { id: 'south-right', x: 900, y: 1140 },
  { id: 'west-left', x: -860, y: 250 },
  { id: 'west-bottom', x: -300, y: 550 }
] as const;
export type CupboardUse = {
  id: string;
  phase: 'entering' | 'hidden' | 'exiting';
  deadline: number;
};
export type Cupboard = { id: string; x: number; y: number; open: boolean };
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
    x: 470,
    y: -320,
    symbol: '⌘'
  },
  {
    id: 'build',
    name: 'Restart the server',
    room: 'Server cupboard',
    x: 1520,
    y: 320,
    symbol: '▥'
  },
  {
    id: 'coffee',
    name: 'Refill the coffee machine',
    room: 'Kitchen',
    x: 780,
    y: 930,
    symbol: '☕'
  },
  {
    id: 'ticket',
    name: 'Find the acceptance criteria',
    room: 'Product corner',
    x: -520,
    y: 330,
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
  ...PAGES.flatMap((page) =>
    OFFICE_LAYOUTS[page.id].walls.map((wall) => ({
      ...wall,
      x: page.x + wall.x,
      y: page.y + wall.y
    }))
  )
];
export const FIXTURES: Fixture[] = PAGES.flatMap((page) =>
  OFFICE_LAYOUTS[page.id].fixtures.map((fixture, index) => ({
    ...FIXTURE_TYPES[fixture.kind],
    ...fixture,
    id: `${page.id}-${fixture.kind}-${index}`,
    x: page.x + fixture.x,
    y: page.y + fixture.y
  }))
);
export const OFFICE_ZONES = PAGES.flatMap((page) =>
  OFFICE_LAYOUTS[page.id].zones.map((zone) => ({
    ...zone,
    page: page.id,
    x: page.x + zone.x,
    y: page.y + zone.y
  }))
);
// Low furniture stops feet, but only walls and tall shelving stop sight and light.
export const MOVEMENT_BLOCKERS = [...WALLS, ...FIXTURES.filter((fixture) => fixture.blocking)];
export const SIGHT_BLOCKERS = [...WALLS, ...FIXTURES.filter((fixture) => fixture.opaque)];
// These cast a visual penumbra without changing server-authoritative sight.
export const PARTIAL_LIGHT_BLOCKERS = FIXTURES.filter(
  (fixture) => fixture.blocking && !fixture.opaque
);
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
  accessPanels: (Omit<AccessPanel, 'open'> & { open: boolean | null })[];
  access: AccessUse | null;
  cupboards: (Omit<Cupboard, 'open'> & { open: boolean | null })[];
  cupboard: CupboardUse | null;
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
  testerName: string | null;
  winner: Role | null;
};
export type Action =
  | { type: 'access'; id: string }
  | { type: 'cupboard'; id: string }
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
    !MOVEMENT_BLOCKERS.some(
      (w) => x > w.x - 15 && x < w.x + w.w + 15 && y > w.y - 15 && y < w.y + w.h + 15
    )
  );
}
