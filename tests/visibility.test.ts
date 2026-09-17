import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, VISIBILITY_RADIUS, pageAt, walkable } from '../src/lib/shared.ts';
import { canSee, lightPolygon } from '../src/lib/visibility.ts';

type Point = { x: number; y: number };
function insidePolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

test('sight stops at actual walls, but passes clear corners without a collision buffer', () => {
  assert.equal(canSee({ x: 290, y: 100 }, { x: 355, y: 100 }), false);
  assert.equal(canSee({ x: 290, y: 195 }, { x: 355, y: 195 }), true);
  assert.equal(canSee({ x: 290, y: 185 }, { x: 355, y: 185 }), false);
  assert.equal(canSee({ x: 425, y: 280 }, { x: 665, y: 280 }), true);
  assert.equal(canSee({ x: 425, y: 280 }, { x: 665.01, y: 280 }), false);
  assert.equal(canSee({ x: 800, y: -10 }, { x: 800, y: 10 }), false);
  assert.equal(canSee({ x: 425, y: 280 }, { x: 425, y: 280 }), true);
});

test('low desks block movement only; tall bookcases block sight and light', () => {
  assert.equal(walkable(130, 215), false);
  assert.equal(canSee({ x: 60, y: 215 }, { x: 215, y: 215 }), true);
  const origin = { x: 900, y: 45 },
    target = { x: 900, y: 145 };
  assert.equal(canSee(origin, target), false);
  assert.equal(insidePolygon(target, lightPolygon(origin)), false);
});

test('light and server sight agree across partitions, doorways and all five pages', () => {
  for (const origin of [
    { x: 425, y: 280 },
    { x: 290, y: 100 },
    { x: 355, y: 100 },
    { x: 610, y: -310 },
    { x: 800, y: -10 },
    { x: 800, y: 10 },
    { x: 1338, y: 260 },
    { x: 580, y: 980 },
    { x: -180, y: 310 },
    { x: -520, y: 330 }
  ]) {
    assert.ok(walkable(origin.x, origin.y), JSON.stringify(origin));
    const polygon = lightPolygon(origin);
    const page = pageAt(origin)!;
    assert.ok(polygon.length >= 3);
    for (const vertex of polygon) {
      assert.ok(Number.isFinite(vertex.x) && Number.isFinite(vertex.y));
      assert.ok(vertex.x >= page.x - 1e-8 && vertex.x <= page.x + 1000 + 1e-8);
      assert.ok(vertex.y >= page.y - 1e-8 && vertex.y <= page.y + 620 + 1e-8);
    }
    for (const candidatePage of PAGES) {
      for (let x = candidatePage.x + 13; x < candidatePage.x + 1000; x += 29) {
        for (let y = candidatePage.y + 17; y < candidatePage.y + 620; y += 31) {
          const target = { x, y };
          if (!walkable(x, y)) continue;
          const lit =
            Math.hypot(x - origin.x, y - origin.y) <= VISIBILITY_RADIUS &&
            insidePolygon(target, polygon);
          assert.equal(
            lit,
            canSee(origin, target),
            `${JSON.stringify(origin)} -> ${JSON.stringify(target)}`
          );
        }
      }
    }
  }
});
