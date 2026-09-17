import {
  HEIGHT,
  WIDTH,
  PARTIAL_LIGHT_BLOCKERS,
  SIGHT_BLOCKERS,
  VISIBILITY_RADIUS,
  pageAt
} from './shared.ts';

type Point = { x: number; y: number };
type Wall = (typeof SIGHT_BLOCKERS)[number];

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
  return !SIGHT_BLOCKERS.some((wall) => wallHit(origin, direction, distance, wall) !== null);
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
  const walls = SIGHT_BLOCKERS.filter(
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

// Project a soft, visual-only shadow from low furniture. These polygons never
// participate in canSee(), so players remain visible through every penumbra.
export function partialShadowPolygons(origin: Point, radius = VISIBILITY_RADIUS): Point[][] {
  const page = pageAt(origin);
  if (!page || radius <= 0) return [];
  return PARTIAL_LIGHT_BLOCKERS.filter((blocker) => {
    if (pageAt(blocker)?.id !== page.id) return false;
    const nearestX = Math.max(blocker.x, Math.min(origin.x, blocker.x + blocker.w));
    const nearestY = Math.max(blocker.y, Math.min(origin.y, blocker.y + blocker.h));
    return Math.hypot(nearestX - origin.x, nearestY - origin.y) <= radius;
  }).map((blocker) => {
    const corners = [
      { x: blocker.x, y: blocker.y },
      { x: blocker.x + blocker.w, y: blocker.y },
      { x: blocker.x + blocker.w, y: blocker.y + blocker.h },
      { x: blocker.x, y: blocker.y + blocker.h }
    ];
    const aroundOrigin = corners
      .map((point) => ({
        point,
        angle: (Math.atan2(point.y - origin.y, point.x - origin.x) + Math.PI * 2) % (Math.PI * 2)
      }))
      .sort((a, b) => a.angle - b.angle);
    let largestGap = -1;
    let gapStart = 0;
    for (let index = 0; index < aroundOrigin.length; index++) {
      const next =
        index === aroundOrigin.length - 1
          ? aroundOrigin[0].angle + Math.PI * 2
          : aroundOrigin[index + 1].angle;
      const gap = next - aroundOrigin[index].angle;
      if (gap > largestGap) {
        largestGap = gap;
        gapStart = index;
      }
    }
    const first = aroundOrigin[(gapStart + 1) % aroundOrigin.length].point;
    const last = aroundOrigin[gapStart].point;
    const shadowAngle = Math.PI * 2 - largestGap;
    // A fixed projection distance can leave the far chord inside the light circle
    // when nearby furniture occupies a wide angle. Extend wide shadows further so
    // clipping always ends them at the visibility radius instead of at that chord.
    const farDistance =
      (radius * 1.05) / Math.max(Math.cos(Math.min(shadowAngle, Math.PI) / 2), 0.01);
    const project = (point: Point): Point => {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const distance = Math.hypot(dx, dy) || 1;
      return {
        x: origin.x + (dx / distance) * farDistance,
        y: origin.y + (dy / distance) * farDistance
      };
    };
    return [first, last, project(last), project(first)];
  });
}
