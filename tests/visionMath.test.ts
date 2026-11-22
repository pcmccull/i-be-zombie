import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { Awareness, VisionTier } from '../src/core/types';
import {
  hazeFactor,
  humanVisual,
  lerpProfile,
  tierBlend,
  type HumanVisualMode,
  type VisionHazeProfile,
} from '../src/core/visionMath';
import { visionProfile } from '../src/systems/AwarenessSystem';

const VISIBILITY_RANK: Record<HumanVisualMode, number> = {
  hidden: 0,
  silhouette: 1,
  full: 2,
};

describe('visionMath', () => {
  it('hazeFactor is bounded, monotonic, and continuous at clearRadius and hazeRadius', () => {
    const clear = 18;
    const haze = 46;
    const strength = 0.82;

    expect(hazeFactor(-5, clear, haze, strength)).toBe(0);
    expect(hazeFactor(0, clear, haze, strength)).toBe(0);
    expect(hazeFactor(clear, clear, haze, strength)).toBe(0);
    expect(hazeFactor(haze, clear, haze, strength)).toBe(strength);
    expect(hazeFactor(haze + 40, clear, haze, strength)).toBe(strength);

    // Continuity at boundaries
    const eps = 1e-4;
    expect(hazeFactor(clear + eps, clear, haze, strength)).toBeLessThan(1e-6);
    expect(hazeFactor(haze - eps, clear, haze, strength)).toBeGreaterThan(strength - 1e-6);

    // Monotonic non-decreasing and bounded across 0..150
    let prev = -Infinity;
    for (let d = 0; d <= 150; d += 0.5) {
      const v = hazeFactor(d, clear, haze, strength);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(strength);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('hazeFactor handles degenerate hazeRadius <= clearRadius without NaN', () => {
    expect(hazeFactor(10, 20, 20, 0.8)).toBe(0);
    expect(hazeFactor(20, 20, 20, 0.8)).toBe(0);
    expect(hazeFactor(21, 20, 20, 0.8)).toBe(0.8);
    expect(hazeFactor(10, 30, 10, 0.6)).toBe(0);
    expect(hazeFactor(35, 30, 10, 0.6)).toBe(0.6);
    expect(Number.isNaN(hazeFactor(20, 20, 10, 0.8))).toBe(false);
  });

  it('tierBlend eases 0 -> 1 over tierBlendTime (midpoint != 0.5, monotonic)', () => {
    const T = BALANCE.vision.tierBlendTime;
    expect(tierBlend(-0.5, T)).toBe(0);
    expect(tierBlend(0, T)).toBe(0);
    expect(tierBlend(T, T)).toBe(1);
    expect(tierBlend(T * 2, T)).toBe(1);
    expect(tierBlend(0, 0)).toBe(1);
    expect(tierBlend(0.5, -1)).toBe(1);

    const mid = tierBlend(T * 0.5, T);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(mid).not.toBeCloseTo(0.5, 4);

    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const v = tierBlend((T * i) / 20, T);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBe(1);
  });

  it('lerpProfile hits exact endpoints and clamps t', () => {
    const a: VisionHazeProfile = { clearRadius: 18, hazeRadius: 46, hazeStrength: 0.82 };
    const b: VisionHazeProfile = { clearRadius: 60, hazeRadius: 110, hazeStrength: 0.22 };
    const out: VisionHazeProfile = { clearRadius: 0, hazeRadius: 0, hazeStrength: 0 };

    lerpProfile(a, b, 0, out);
    expect(out).toEqual(a);

    lerpProfile(a, b, -0.5, out);
    expect(out).toEqual(a);

    lerpProfile(a, b, 1, out);
    expect(out).toEqual(b);

    lerpProfile(a, b, 2, out);
    expect(out).toEqual(b);

    lerpProfile(a, b, 0.5, out);
    expect(out.clearRadius).toBeCloseTo(39, 6);
    expect(out.hazeRadius).toBeCloseTo(78, 6);
    expect(out.hazeStrength).toBeCloseTo(0.52, 6);
  });

  it('humanVisual handles every awareness x distance band', () => {
    const p = visionProfile(1); // clear 18, haze 46
    const bands = [
      { label: 'inside clear', dist: 10 },
      { label: 'inside haze', dist: 30 },
      { label: 'at haze boundary', dist: p.hazeRadius },
      { label: 'beyond haze', dist: p.hazeRadius + 5 },
    ];
    const expected: Record<Awareness, HumanVisualMode[]> = {
      identified: ['full', 'full', 'full', 'full'],
      seen: ['silhouette', 'silhouette', 'silhouette', 'silhouette'],
      heard: ['hidden', 'hidden', 'hidden', 'hidden'],
      sensed: ['hidden', 'hidden', 'hidden', 'hidden'],
      none: ['hidden', 'hidden', 'hidden', 'hidden'],
    };

    for (const awareness of Object.keys(expected) as Awareness[]) {
      bands.forEach((band, idx) => {
        expect(humanVisual(awareness, band.dist, p)).toBe(expected[awareness][idx]);
      });
    }
  });

  it('higher vision tiers never hide more than lower tiers', () => {
    const tiers: VisionTier[] = [1, 2, 3, 4];
    const profiles = tiers.map((t) => visionProfile(t));
    const awarenesses: Awareness[] = ['none', 'heard', 'sensed', 'seen', 'identified'];

    for (const awareness of awarenesses) {
      for (let d = 0; d <= 160; d += 2) {
        let prevRank = -1;
        for (const p of profiles) {
          const rank = VISIBILITY_RANK[humanVisual(awareness, d, p)];
          expect(rank).toBeGreaterThanOrEqual(prevRank);
          prevRank = rank;
        }
      }
    }
  });
});

describe('vision limit', () => {
  it('is fully visible inside the haze radius and fully hidden past the edge band', async () => {
    const { visionVisibility, isBeyondVision, VISION_EDGE_BAND } = await import('../src/core/visionMath');
    for (const tier of BALANCE.vision.tiers) {
      const r = tier.hazeRadius;
      expect(visionVisibility(0, r)).toBe(1);
      expect(visionVisibility(r, r)).toBe(1);
      expect(visionVisibility(r * (1 + VISION_EDGE_BAND), r)).toBe(0);
      expect(visionVisibility(r * 3, r)).toBe(0);
      let prev = 1;
      for (let d = r; d <= r * 1.2; d += r / 200) {
        const v = visionVisibility(d, r);
        expect(v).toBeLessThanOrEqual(prev + 1e-12);
        prev = v;
      }
      expect(isBeyondVision(r, r)).toBe(false);
      expect(isBeyondVision(r * (1 + VISION_EDGE_BAND), r)).toBe(true);
    }
  });

  it('a higher tier never hides more', async () => {
    const { visionVisibility } = await import('../src/core/visionMath');
    const tiers = BALANCE.vision.tiers;
    for (let t = 1; t < tiers.length; t++) {
      for (let d = 0; d < 200; d += 2.5) {
        expect(visionVisibility(d, tiers[t].hazeRadius)).toBeGreaterThanOrEqual(visionVisibility(d, tiers[t - 1].hazeRadius));
      }
    }
  });
});
