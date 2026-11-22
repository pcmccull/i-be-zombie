import { describe, expect, it } from 'vitest';
import { humanProfile } from '../src/visuals/humanProfiles';

describe('humanProfiles', () => {
  it('is deterministic per id, role, post, and weapon', () => {
    for (const id of [1, 7, 42, 199, 500]) {
      expect(humanProfile(id, 'civilian', 'patrol', 'none')).toEqual(
        humanProfile(id, 'civilian', 'patrol', 'none'),
      );
      expect(humanProfile(id, 'soldier', 'stronghold', 'none')).toEqual(
        humanProfile(id, 'soldier', 'stronghold', 'none'),
      );
    }
  });

  it('maps soldier to defender always and police/barricade to security', () => {
    for (let id = 1; id <= 100; id++) {
      const s1 = humanProfile(id, 'soldier', 'checkpoint');
      const s2 = humanProfile(id, 'soldier', 'stronghold');
      const s3 = humanProfile(id, 'soldier', 'patrol');
      expect(s1.archetype).toBe('defender');
      expect(s2.archetype).toBe('defender');
      expect(s3.archetype).toBe('defender');
      expect(s1.palette.shirtAccent).toBe(0xe0782a);
      expect(s1.palette.shirt).toBe(0x2c3e66);

      const p1 = humanProfile(id, 'police', 'patrol');
      const p2 = humanProfile(id, 'police', 'stronghold');
      const b1 = humanProfile(id, 'civilian', 'barricade');
      expect(p1.archetype).toBe('security');
      expect(p2.archetype).toBe('security');
      expect(b1.archetype).toBe('security');
    }
  });

  it('reaches tourist, resident, and worker over civilian ids 1..500 with >= 6 skin tones and >= 5 hair styles', () => {
    const archetypes = new Set<string>();
    const skins = new Set<number>();
    const hairs = new Set<string>();
    const builds = new Set<string>();

    for (let id = 1; id <= 500; id++) {
      const prof = humanProfile(id, 'civilian', 'patrol', 'none');
      archetypes.add(prof.archetype);
      skins.add(prof.skinTone);
      hairs.add(prof.hairStyle);
      builds.add(prof.build);
    }

    expect(archetypes).toEqual(new Set(['tourist', 'resident', 'worker']));
    expect(skins.size).toBeGreaterThanOrEqual(6);
    expect(hairs.size).toBeGreaterThanOrEqual(5);
    expect(builds.size).toBe(4);
  });

  it('never gives a civilian palette both faction orange (#e0782a) and navy (#2c3e66)', () => {
    for (let id = 1; id <= 500; id++) {
      const prof = humanProfile(id, 'civilian', 'patrol', 'none');
      const colors = [
        prof.palette.shirt,
        prof.palette.shirtAccent,
        prof.palette.pants,
        prof.palette.shoes,
        prof.palette.hat,
        prof.palette.prop,
      ];
      const hasOrange = colors.includes(0xe0782a);
      const hasNavy = colors.includes(0x2c3e66);
      expect(hasOrange && hasNavy).toBe(false);
    }
  });
});
