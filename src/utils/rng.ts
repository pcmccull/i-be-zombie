import type { Rng } from '../core/types';

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function randRange(rng: Rng, a: number, b: number): number {
  return a + (b - a) * rng.next();
}

export function randInt(rng: Rng, a: number, bInclusive: number): number {
  return a + Math.floor(rng.next() * (bInclusive - a + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new RangeError('Cannot pick from an empty array');
  return arr[randInt(rng, 0, arr.length - 1)];
}
