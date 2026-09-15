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
export const CI_CONSOLE = { x: 500, y: 45, width: 200, interactionHeight: 160 } as const;
export function atCiConsole(position: { x: number; y: number }) {
  return (
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
    x: 160,
    y: 130,
    symbol: '⌘'
  },
  {
    id: 'build',
    name: 'Restart the server',
    room: 'Server cupboard',
    x: 840,
    y: 130,
    symbol: '▥'
  },
  {
    id: 'coffee',
    name: 'Refill the coffee machine',
    room: 'Kitchen',
    x: 160,
    y: 490,
    symbol: '☕'
  },
  {
    id: 'ticket',
    name: 'Find the acceptance criteria',
    room: 'Product corner',
    x: 840,
    y: 490,
    symbol: '✓'
  }
] as const;
// Dividers have wide, visible doorways. Server and client share collision geometry.
export const WALLS = [
  { x: 315, y: 0, w: 18, h: 185 },
  { x: 315, y: 265, w: 18, h: 95 },
  { x: 315, y: 440, w: 18, h: 180 },
  { x: 667, y: 0, w: 18, h: 185 },
  { x: 667, y: 265, w: 18, h: 95 },
  { x: 667, y: 440, w: 18, h: 180 },
  { x: 0, y: 302, w: 315, h: 16 },
  { x: 685, y: 302, w: 315, h: 16 }
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
    x >= 20 &&
    y >= 20 &&
    x <= WIDTH - 20 &&
    y <= HEIGHT - 20 &&
    !WALLS.some((w) => x > w.x - 15 && x < w.x + w.w + 15 && y > w.y - 15 && y < w.y + w.h + 15)
  );
}
