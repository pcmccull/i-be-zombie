import { describe, expect, it } from 'vitest';
import { BRAIN_MAX_PER_GAIN, brainCount, brainFlightAt } from '../src/visuals/brainPickupMath';
import { BRAINS_IDS, BRAINS_SFX_CHANCE, SFX, SFX_IDS } from '../src/audio/sfxRules';

describe('brain pickups', () => {
  it('sends at least one brain per gain and caps big rewards', () => {
    expect(brainCount(0)).toBe(0);
    expect(brainCount(2)).toBe(1);
    expect(brainCount(4)).toBe(1);
    expect(brainCount(15)).toBe(4);
    expect(brainCount(400)).toBe(BRAIN_MAX_PER_GAIN);
  });

  it('starts at the source, ends on the Alpha and arcs above the ground', () => {
    const out = { x: 0, y: 0, z: 0, scale: 0 };
    brainFlightAt(0, 10, -4, 0, 0, 1, out);
    expect(out.x).toBeCloseTo(10); expect(out.z).toBeCloseTo(-4);
    brainFlightAt(1, 10, -4, 3, 2, -1, out);
    expect(out.x).toBeCloseTo(3); expect(out.z).toBeCloseTo(2);
    for (let u = 0; u <= 1; u += 0.05) expect(brainFlightAt(u, 10, -4, 0, 0, 1, out).y).toBeGreaterThan(0.9);
    expect(brainFlightAt(0.5, 10, -4, 0, 0, 1, out).scale).toBe(1);
  });

  it('plays the brains clip quietly', () => {
    expect(BRAINS_IDS).toHaveLength(5);
    for (const id of BRAINS_IDS) {
      expect(SFX_IDS).toContain(id);
      expect(SFX[id].gain).toBeLessThan(0.15);
    }
    expect(BRAINS_SFX_CHANCE).toBeGreaterThan(0);
    expect(BRAINS_SFX_CHANCE).toBeLessThan(1);
  });
});
