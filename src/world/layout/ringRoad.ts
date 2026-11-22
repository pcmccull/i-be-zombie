// [pure] Perimeter ring road just inside the north, west and east edges of the play area, so traffic that reaches the
// edge of the world turns onto it instead of vanishing. Inset from the edge (the world-edge boundary runs stay as
// they are) and appended after every other builder (ids, colliders and the RNG stream are untouched). The south edge
// is the coast: roads there end at the shore and cars U-turn (TrafficSystem).
import { rect, type WorldDraft } from './common';

/** Ring road: 10 m carriageway, 1 m in from the edge, 2.5 m inner sidewalk (city blocks keep >= 14 m from the edge). */
export const RING = { inset: 1, width: 10, sidewalk: 2.5 } as const;

export function ringRoadRects(play: { minX: number; maxX: number; minZ: number; maxZ: number }): {
  north: ReturnType<typeof rect>; west: ReturnType<typeof rect>; east: ReturnType<typeof rect>;
} {
  const i = RING.inset, w = RING.width;
  const north = rect(play.minX + i, play.minZ + i, play.maxX - i, play.minZ + i + w);
  // West / east run from the north ring down to just short of the shore.
  const west = rect(play.minX + i, play.minZ + i + w, play.minX + i + w, play.maxZ - 2);
  const east = rect(play.maxX - i - w, play.minZ + i + w, play.maxX - i, play.maxZ - 2);
  return { north, west, east };
}

export function buildRingRoad(world: WorldDraft): void {
  const { north, west, east } = ringRoadRects(world.playArea);
  const s = RING.sidewalk;
  world.ground.push(
    { kind: 'sidewalk', rect: rect(north.minX + RING.width, north.maxZ, north.maxX - RING.width, north.maxZ + s) },
    { kind: 'sidewalk', rect: rect(west.maxX, west.minZ + s, west.maxX + s, west.maxZ) },
    { kind: 'sidewalk', rect: rect(east.minX - s, east.minZ + s, east.minX, east.maxZ) },
  );
  // Abutting patches (never overlapping an existing carriageway: no doubled road surface, no extra render junctions).
  const roads = world.ground.filter(g => g.kind === 'road').map(g => g.rect);
  const cut = (lo: number, hi: number, holes: [number, number][]): [number, number][] => {
    let spans: [number, number][] = [[lo, hi]];
    for (const [a, b] of holes) spans = spans.flatMap(([x, y]): [number, number][] =>
      b <= x || a >= y ? [[x, y]] : [...(a > x ? [[x, a] as [number, number]] : []), ...(b < y ? [[b, y] as [number, number]] : [])]);
    return spans.filter(([x, y]) => y - x > 0.5);
  };
  const vertical = roads.filter(r => r.maxZ - r.minZ > r.maxX - r.minX && r.minZ < north.maxZ && r.maxZ > north.minZ);
  for (const [a, b] of cut(north.minX, north.maxX, vertical.map(r => [r.minX, r.maxX])))
    world.ground.push({ kind: 'road', rect: rect(a, north.minZ, b, north.maxZ) });
  for (const side of [west, east]) {
    const horizontal = roads.filter(r => r.maxX - r.minX >= r.maxZ - r.minZ && r.minX < side.maxX && r.maxX > side.minX);
    for (const [a, b] of cut(side.minZ, side.maxZ, horizontal.map(r => [r.minZ, r.maxZ])))
      world.ground.push({ kind: 'road', rect: rect(side.minX, a, side.maxX, b) });
  }
  // Centre-line dashes, skipped where other roads cross.
  const crossesX = world.ground.filter(g => g.kind === 'road' && g.rect.maxZ - g.rect.minZ > g.rect.maxX - g.rect.minX)
    .map(g => (g.rect.minX + g.rect.maxX) / 2);
  const crossesZ = world.ground.filter(g => g.kind === 'road' && g.rect.maxX - g.rect.minX >= g.rect.maxZ - g.rect.minZ)
    .map(g => (g.rect.minZ + g.rect.maxZ) / 2);
  const cz = (north.minZ + north.maxZ) / 2;
  for (let x = north.minX + RING.width + 4; x < north.maxX - RING.width - 4; x += 10) {
    if (crossesX.some(c => Math.abs(c - x - 2) < 10)) continue;
    world.markings.push({ kind: 'laneDash', rotation: 0, rect: rect(x, cz - 0.15, x + 4, cz + 0.15) });
  }
  for (const r of [west, east]) {
    const cx = (r.minX + r.maxX) / 2;
    for (let z = r.minZ + 4; z < r.maxZ - 4; z += 10) {
      if (crossesZ.some(c => Math.abs(c - z - 2) < 10)) continue;
      world.markings.push({ kind: 'laneDash', rotation: Math.PI / 2, rect: rect(cx - 0.15, z, cx + 0.15, z + 4) });
    }
  }
}
