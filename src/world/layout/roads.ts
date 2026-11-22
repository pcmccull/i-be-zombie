import { rect, prop, type WorldDraft } from './common';
import { expansionRoads } from './grid';

/** Full-length streets preserve routes across all district seams. */
export function buildRoads(w: WorldDraft): void {
  for (const [axis, centers, lo, hi] of [
    ['x', [-100, 0, 100], -160, 160], ['z', [-80, 0, 80], -200, 200],
  ] as const) {
    for (const c of centers) {
      const half = c === 0 ? 7 : 5;
      const box = (a: number, b: number) => axis === 'x' ? rect(a, lo, b, hi) : rect(lo, a, hi, b);
      w.ground.push({ kind: 'sidewalk', rect: box(c - half - 3, c - half) },
        { kind: 'sidewalk', rect: box(c + half, c + half + 3) }, { kind: 'road', rect: box(c - half, c + half) });
      for (let p = lo + 5; p < hi - 5; p += 10) {
        const intersections: readonly number[] = axis === 'x' ? [-80, 0, 80] : [-100, 0, 100];
        if (intersections.some(i => Math.abs(p - i) < 12)) continue;
        w.markings.push({ kind: 'laneDash', rotation: axis === 'x' ? Math.PI / 2 : 0,
          rect: axis === 'x' ? rect(c - 0.15, p, c + 0.15, p + 4) : rect(p, c - 0.15, p + 4, c + 0.15) });
      }
      for (let p = lo + 16; p < hi - 10; p += 32) {
        if (axis === 'x') prop(w, 'streetlight', c - half - 1.5, p, Math.PI / 2);
        else prop(w, 'streetlight', p, c + half + 1.5);
      }
    }
  }
  for (const x of [-170, -100, -30, 30, 100, 170]) {
    w.markings.push({ kind: 'crosswalk', rect: rect(x - 1, -7, x + 1, 7), rotation: Math.PI / 2 });
  }
  for (const z of [-130, -80, -30, 30, 80, 130]) {
    w.markings.push({ kind: 'crosswalk', rect: rect(-7, z - 1, 7, z + 1), rotation: 0 });
  }
  for (const x of [-100, 0, 100]) for (const z of [-80, 0, 80]) {
    for (const side of [-1, 1]) {
      w.markings.push({ kind: 'crosswalk', rect: rect(x - 4, z + side * 10 - 1, x + 4, z + side * 10 + 1), rotation: 0 });
      w.markings.push({ kind: 'crosswalk', rect: rect(x + side * 10 - 1, z - 4, x + side * 10 + 1, z + 4), rotation: Math.PI / 2 });
    }
    prop(w, 'trafficLight', x - 8.5, z - 8.5);
  }
}

/** Append only after the original builders, preserving their prop/collider numbering and RNG stream. */
export function buildExpansionRoads(w: WorldDraft): void {
  const roads = expansionRoads();
  for (const road of roads) {
    const { axis, at: c, lo, hi, half } = road;
    const box = (a: number, b: number, start = lo, end = hi) => axis === 'x' ? rect(a, start, b, end) : rect(start, a, end, b);
    w.ground.push({ kind: 'sidewalk', rect: box(c - half - 3, c - half) },
      { kind: 'sidewalk', rect: box(c + half, c + half + 3) });
    // Junctions belong to their vertical carriageway. Abutting patches avoid duplicate road surfaces
    // and duplicate render-only traffic intersections (the original nine remain unchanged).
    let spans: [number, number][] = [[lo, hi]];
    if (axis === 'z') for (const patch of w.ground) {
      const r = patch.rect;
      if (patch.kind !== 'road' || r.maxZ - r.minZ <= r.maxX - r.minX || r.minZ >= c + half || r.maxZ <= c - half) continue;
      spans = spans.flatMap(([a, b]): [number, number][] => {
        if (r.minX >= b || r.maxX <= a) return [[a, b]];
        const result: [number, number][] = [];
        if (r.minX > a) result.push([a, r.minX]);
        if (r.maxX < b) result.push([r.maxX, b]);
        return result;
      });
    }
    for (const [a, b] of spans) w.ground.push({ kind: 'road', rect: box(c - half, c + half, a, b) });
    const crossings = roads.filter(r => r.axis !== axis && r.at >= lo && r.at <= hi && c >= r.lo && c <= r.hi);
    for (let p = lo + 5; p < hi - 5; p += 10) {
      if (crossings.some(r => Math.abs(p - r.at) < 13)) continue;
      w.markings.push({ kind: 'laneDash', rotation: axis === 'x' ? Math.PI / 2 : 0,
        rect: box(c - 0.15, c + 0.15, p, p + 4) });
    }
    for (let p = lo + 16; p < hi - 10; p += 32) {
      if (axis === 'x') prop(w, 'streetlight', c - half - 1.5, p, Math.PI / 2);
      else prop(w, 'streetlight', p, c + half + 1.5);
    }
    // Author each junction once, on its horizontal road.
    if (axis === 'z') for (const cross of crossings) {
      for (const side of [-1, 1]) {
        const stripes = [
          { kind: 'crosswalk' as const, rotation: 0, rect: rect(cross.at - 4, c + side * 11 - 1, cross.at + 4, c + side * 11 + 1) },
          { kind: 'crosswalk' as const, rotation: Math.PI / 2, rect: rect(cross.at + side * 11 - 1, c - 4, cross.at + side * 11 + 1, c + 4) },
        ];
        for (const stripe of stripes) {
          const r = stripe.rect;
          if (r.minX < 200 && r.maxX > -200 && r.minZ < 160 && r.maxZ > -160) continue;
          w.markings.push(stripe);
        }
      }
      prop(w, 'trafficLight', cross.at - 8.5, c - 8.5);
    }
  }
}
