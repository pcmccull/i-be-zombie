import { rect, prop, type WorldDraft } from './common';

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
