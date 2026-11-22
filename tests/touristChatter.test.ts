import { describe, expect, it } from 'vitest';
import { createChatterState, nextClip, TOURIST_CHATTER, updateChatter, type ChatterHuman } from '../src/audio/touristChatter';
import { mulberry32 } from '../src/utils/rng';

const tourist = (id: number, x: number, z = 0, extra: Partial<ChatterHuman> = {}): ChatterHuman =>
  ({ id, role: 'civilian', hp: 10, dormant: false, pos: { x, z }, ...extra });
const always = () => 0;

describe('tourist chatter', () => {
  it('plays on approach only after the initial delay, then respects the cooldown', () => {
    const s = createChatterState(0);
    const leader = { x: 0, z: 0 };
    expect(updateChatter(s, 1, leader, [tourist(1, 3)], 3, always)).toBeNull();
    // tourist 1 was "near" during the delay; a new tourist after the delay talks
    const hit = updateChatter(s, TOURIST_CHATTER.initialDelay + 1, leader, [tourist(1, 3), tourist(2, 4)], 3, always);
    expect(hit?.humanId).toBe(2);
    const t = TOURIST_CHATTER.initialDelay + 2;
    expect(updateChatter(s, t, leader, [tourist(3, 2)], 3, always)).toBeNull(); // cooldown
    expect(s.nextAllowedAt - (TOURIST_CHATTER.initialDelay + 1)).toBeGreaterThanOrEqual(TOURIST_CHATTER.cooldownMin);
  });

  it('ignores soldiers, dead, dormant and far civilians; each tourist rolls once', () => {
    const s = createChatterState(-100);
    const leader = { x: 0, z: 0 };
    const humans = [
      tourist(1, 2, 0, { role: 'soldier' }), tourist(2, 2, 0, { hp: 0 }), tourist(3, 2, 0, { dormant: true }), tourist(4, 30),
    ];
    expect(updateChatter(s, 0, leader, humans, 3, always)).toBeNull();
    // failed roll: same tourist never rolls again, even after leaving and returning
    const never = () => 0.99;
    expect(updateChatter(s, 0, leader, [tourist(5, 2)], 3, never)).toBeNull();
    updateChatter(s, 1, { x: 100, z: 0 }, [tourist(5, 2)], 3, always);
    expect(updateChatter(s, 2, leader, [tourist(5, 2)], 3, always)).toBeNull();
  });

  it('cycles every clip before repeating and never repeats back-to-back', () => {
    const s = createChatterState();
    const rng = mulberry32(7);
    const rand = () => rng.next();
    const seq: number[] = [];
    for (let i = 0; i < 30; i++) seq.push(nextClip(s, 3, rand));
    for (let i = 0; i < 30; i += 3) expect(new Set(seq.slice(i, i + 3)).size).toBe(3);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });
});
