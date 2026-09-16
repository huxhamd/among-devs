import { HEIGHT, WIDTH, WALLS, VISIBILITY_RADIUS, pageAt } from './shared.ts';

type Point = { x: number; y: number };
type Wall = (typeof WALLS)[number];

// Intersect a finite ray with the actual wall, without the movement collision buffer.
// Both the server's sight checks and the client's light rays use this calculation.
function wallHit(origin: Point, direction: Point, limit: number, wall: Wall): number | null {
  let enter = 0;
  let leave = limit;
  for (const axis of ['x', 'y'] as const) {
    const min = wall[axis];
    const max = min + (axis === 'x' ? wall.w : wall.h);
    if (Math.abs(direction[axis]) < 1e-12) {
      if (origin[axis] < min || origin[axis] > max) return null;
      continue;
    }
    const a = (min - origin[axis]) / direction[axis];
    const b = (max - origin[axis]) / direction[axis];
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return null;
  }
  return enter;
}

export function canSee(origin: Point, target: Point, radius = VISIBILITY_RADIUS): boolean {
  const page = pageAt(origin);
  if (!page || page.id !== pageAt(target)?.id) return false;
  const distance = Math.hypot(target.x - origin.x, target.y - origin.y);
  if (distance > radius) return false;
  const direction = distance
    ? { x: (target.x - origin.x) / distance, y: (target.y - origin.y) / distance }
    : { x: 0, y: 0 };
  return !WALLS.some((wall) => wallHit(origin, direction, distance, wall) !== null);
}

// A visibility polygon bounded by the current page and the radius's bounding square.
// The radial gradient supplies the circular edge, so no circle tessellation is needed.
export function lightPolygon(origin: Point, radius = VISIBILITY_RADIUS): Point[] {
  const page = pageAt(origin);
  if (!page || radius <= 0) return [];
  const left = Math.max(page.x, origin.x - radius);
  const right = Math.min(page.x + WIDTH, origin.x + radius);
  const top = Math.max(page.y, origin.y - radius);
  const bottom = Math.min(page.y + HEIGHT, origin.y + radius);
  const walls = WALLS.filter(
    (wall) =>
      wall.x <= right && wall.x + wall.w >= left && wall.y <= bottom && wall.y + wall.h >= top
  );
  const angles: number[] = [];
  for (const rect of [...walls, { x: left, y: top, w: right - left, h: bottom - top }]) {
    for (const x of [rect.x, rect.x + rect.w]) {
      for (const y of [rect.y, rect.y + rect.h]) {
        const angle = Math.atan2(y - origin.y, x - origin.x);
        // Cast on either side of corners to reveal the space immediately past an edge.
        angles.push(angle - 1e-7, angle, angle + 1e-7);
      }
    }
  }
  return angles
    .sort((a, b) => a - b)
    .map((angle) => {
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      let distance = Math.min(
        Math.abs(direction.x) < 1e-12
          ? Infinity
          : ((direction.x > 0 ? right : left) - origin.x) / direction.x,
        Math.abs(direction.y) < 1e-12
          ? Infinity
          : ((direction.y > 0 ? bottom : top) - origin.y) / direction.y
      );
      for (const wall of walls) {
        const hit = wallHit(origin, direction, distance, wall);
        if (hit !== null) distance = hit;
      }
      return { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
    });
}
