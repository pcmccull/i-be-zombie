import { describe, expect, it } from 'vitest';
import {
  DETAIL_FADE_FAR,
  DETAIL_FADE_NEAR,
  JOINTS_PER_TILE,
  SURFACE,
  SURFACE_TILE_M,
  buildDetailAtlas,
  detailFade,
  periodicNoise,
} from '../src/graphics/materials/surfaceDetailMath';

describe('surface detail atlas (VP-T004)', () => {
  const atlas = buildDetailAtlas(64, 7);
  const at = (x: number, y: number, c: number): number => atlas.data[(y * atlas.size + x) * 4 + c];

  it('is deterministic and sized', () => {
    expect(atlas.data.length).toBe(64 * 64 * 4);
    expect(buildDetailAtlas(64, 7).data).toEqual(atlas.data);
    expect(buildDetailAtlas(64, 8).data).not.toEqual(atlas.data);
    expect(() => buildDetailAtlas(100)).toThrow();
  });

  it('noise tiles seamlessly', () => {
    for (const v of [0, 0.25, 0.6]) {
      expect(periodicNoise(0, v, 8, 3)).toBeCloseTo(periodicNoise(1, v, 8, 3), 9);
      expect(periodicNoise(v, 0, 8, 3)).toBeCloseTo(periodicNoise(v, 1, 8, 3), 9);
    }
  });

  it('keeps grain/blotch centred (low contrast) and draws joints + cracks', () => {
    let grain = 0;
    let blotch = 0;
    let crackTexels = 0;
    for (let i = 0; i < 64 * 64; i++) {
      grain += atlas.data[i * 4];
      blotch += atlas.data[i * 4 + 3];
      if (atlas.data[i * 4 + 1] > 128) crackTexels++;
    }
    expect(grain / 4096).toBeGreaterThan(90);
    expect(grain / 4096).toBeLessThan(165);
    expect(blotch / 4096).toBeGreaterThan(80);
    expect(blotch / 4096).toBeLessThan(175);
    expect(crackTexels).toBeGreaterThan(0);
    expect(crackTexels).toBeLessThan(4096 * 0.3);
    const period = 64 / JOINTS_PER_TILE;
    expect(at(0, 5, 2)).toBe(255);
    expect(at(period, 7, 2)).toBe(255);
    expect(at(period / 2, period / 2, 2)).toBe(0);
  });

  it('fades detail with distance', () => {
    expect(detailFade(0)).toBe(1);
    expect(detailFade(DETAIL_FADE_NEAR)).toBe(1);
    expect(detailFade(DETAIL_FADE_FAR)).toBe(0);
    const mid = detailFade((DETAIL_FADE_NEAR + DETAIL_FADE_FAR) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  it('has a tile size for every surface', () => {
    for (const id of Object.values(SURFACE)) expect(SURFACE_TILE_M[id]).toBeGreaterThan(0);
  });
});
