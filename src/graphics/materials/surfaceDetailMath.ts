// [pure] Surface ids + tileable detail atlas generation for world-space city material detail
// (docs/8_visual_polish.md §3; ARCHITECTURE §VP-2). No three import: the 3D side wraps the bytes in a DataTexture.
import type { Rng } from '../../core/types';
import { mulberry32 } from '../../utils/rng';

/** Per-vertex surface class (`aSurface` attribute). 0 = no detail (props, trims, markings). */
export const SURFACE = {
  none: 0,
  asphalt: 1,
  sidewalk: 2,
  grass: 3,
  building: 4,
  concrete: 5,
  sand: 6,
} as const;
export type SurfaceId = (typeof SURFACE)[keyof typeof SURFACE];

/** World metres covered by one repeat of the atlas, per surface (texel density, VP-2). */
export const SURFACE_TILE_M: Readonly<Record<SurfaceId, number>> = {
  0: 4,
  1: 4,
  2: 6, // 4 joints per repeat => 1.5 m slabs
  3: 5,
  4: 2.5,
  5: 4,
  6: 5,
};

/** Detail fades out between these camera distances (m) to avoid shimmer (VP-2 readability). */
export const DETAIL_FADE_NEAR = 45;
export const DETAIL_FADE_FAR = 80;

export interface DetailAtlas {
  size: number;
  /** RGBA8: R fine grain (mean ~128), G crack mask (0 none .. 255 crack), B slab-joint mask, A low-frequency blotch (mean ~128). */
  data: Uint8Array;
}

/** Joint lines per repeat in the B channel. */
export const JOINTS_PER_TILE = 4;

function hash2(ix: number, iy: number, period: number, seed: number): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Periodic value noise in [0,1] at (u,v) ∈ [0,1)² with `period` lattice cells per repeat (tileable). */
export function periodicNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, period, seed);
  const b = hash2(ix + 1, iy, period, seed);
  const c = hash2(ix, iy + 1, period, seed);
  const d = hash2(ix + 1, iy + 1, period, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += periodicNoise(u, v, period, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/** Draw wrap-around crack polylines into a float mask (max blend). */
function drawCracks(mask: Float32Array, size: number, rng: Rng, count: number): void {
  for (let c = 0; c < count; c++) {
    let x = rng.next() * size;
    let y = rng.next() * size;
    let dir = rng.next() * Math.PI * 2;
    const steps = 40 + Math.floor(rng.next() * 90);
    const width = 0.7 + rng.next() * 0.9;
    for (let s = 0; s < steps; s++) {
      dir += (rng.next() - 0.5) * 0.7;
      x += Math.cos(dir) * 1.6;
      y += Math.sin(dir) * 1.6;
      const fx = Math.floor(x);
      const fy = Math.floor(y);
      const r = Math.ceil(width + 1);
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          const px = (((fx + ox) % size) + size) % size;
          const py = (((fy + oy) % size) + size) % size;
          const d = Math.hypot(ox + (fx - x), oy + (fy - y));
          const v = Math.max(0, 1 - d / (width + 0.6));
          const i = py * size + px;
          if (v > mask[i]) mask[i] = v;
        }
      }
      if (rng.next() < 0.03) dir += (rng.next() < 0.5 ? -1 : 1) * 0.9; // occasional kink
    }
  }
}

/**
 * Builds the shared tileable detail atlas. Deterministic for a seed. `size` must be a power of two (mipmaps).
 * Contrast is deliberately low: the shader scales each channel to <= ~12 % luminance on the ground.
 */
export function buildDetailAtlas(size = 512, seed = 1337): DetailAtlas {
  if (size < 16 || (size & (size - 1)) !== 0) throw new Error('detail atlas size must be a power of two >= 16');
  const n = size * size;
  const data = new Uint8Array(n * 4);
  const cracks = new Float32Array(n);
  drawCracks(cracks, size, mulberry32(seed), Math.max(3, Math.round(size / 64)));
  const jointPeriod = size / JOINTS_PER_TILE;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const grain = fbm(u, v, 64, 2, seed) * 0.7 + hash2(x, y, size, seed + 7) * 0.3;
      const blotch = fbm(u, v, 4, 3, seed + 101);
      const jx = Math.abs(((x + jointPeriod / 2) % jointPeriod) - jointPeriod / 2);
      const jy = Math.abs(((y + jointPeriod / 2) % jointPeriod) - jointPeriod / 2);
      const joint = Math.max(0, 1 - Math.min(jx, jy) / 1.6);
      data[i * 4] = Math.round(grain * 255);
      data[i * 4 + 1] = Math.round(Math.min(1, cracks[i]) * 255);
      data[i * 4 + 2] = Math.round(joint * 255);
      data[i * 4 + 3] = Math.round(blotch * 255);
    }
  }
  return { size, data };
}

/** Detail multiplier fade by camera distance (mirrors the GLSL). 1 = full detail, 0 = none. */
export function detailFade(distance: number): number {
  if (distance <= DETAIL_FADE_NEAR) return 1;
  if (distance >= DETAIL_FADE_FAR) return 0;
  const t = (distance - DETAIL_FADE_NEAR) / (DETAIL_FADE_FAR - DETAIL_FADE_NEAR);
  return 1 - t * t * (3 - 2 * t);
}
