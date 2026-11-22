import { describe, expect, it } from 'vitest';
import {
  applyClip,
  applyClipAuthored,
  BITE_SNAP_T,
  CLIPS,
  clipDuration,
  hitSign,
} from '../src/graphics/characters/characterClips';
import { CLIP_NAMES, type ClipName } from '../src/graphics/characters/characterTypes';
import { createPose, POSE_FIELDS, type ZombiePose } from '../src/visuals/zombieRig';

function sample(name: ClipName, t: number, weight = 1, variation = 0.5, mirror = false): ZombiePose {
  const out = createPose();
  applyClip(out, CLIPS[name], t, weight, variation, mirror);
  return out;
}

function maxDiff(a: ZombiePose, b: ZombiePose): number {
  let d = 0;
  for (const f of POSE_FIELDS) d = Math.max(d, Math.abs(a[f] - b[f]));
  return d;
}

describe('character clips', () => {
  it('defines all 8 clips with consistent names and sorted keys inside the duration', () => {
    expect(Object.keys(CLIPS).sort()).toEqual([...CLIP_NAMES].sort());
    for (const name of CLIP_NAMES) {
      const c = CLIPS[name];
      expect(c.name).toBe(name);
      expect(c.duration).toBeGreaterThan(0.3);
      let last = -1;
      for (const key of c.keys) {
        expect(key.t).toBeGreaterThanOrEqual(last);
        expect(key.t).toBeLessThanOrEqual(c.duration + 1e-9);
        last = key.t;
      }
    }
    expect(BITE_SNAP_T).toBeGreaterThan(0);
    expect(BITE_SNAP_T).toBeLessThan(CLIPS.bite.duration);
  });

  it('is deterministic and finite over [0, duration] for every clip and variation', () => {
    for (const name of CLIP_NAMES) {
      for (const v of [0, 0.37, 0.99]) {
        const dur = clipDuration(name, v);
        for (let i = 0; i <= 60; i++) {
          const t = (i / 60) * dur;
          const a = sample(name, t, 1, v);
          const b = sample(name, t, 1, v);
          for (const f of POSE_FIELDS) {
            expect(Number.isFinite(a[f])).toBe(true);
            expect(a[f]).toBe(b[f]);
          }
        }
      }
    }
  });

  it('loops continuously and wraps; additive one-shots start and end on the base pose', () => {
    for (const name of CLIP_NAMES) {
      const c = CLIPS[name];
      const dur = clipDuration(name, 0.5);
      if (c.loop) {
        expect(maxDiff(sample(name, 0), sample(name, dur - 1e-6))).toBeLessThan(1e-3);
        expect(maxDiff(sample(name, 0.4), sample(name, 0.4 + dur))).toBeLessThan(1e-9);
        let prev = sample(name, 0);
        for (let i = 1; i <= 400; i++) {
          const cur = sample(name, (i / 400) * dur);
          expect(maxDiff(prev, cur)).toBeLessThan(0.12);
          prev = cur;
        }
      } else if (c.additive) {
        const base = createPose();
        expect(maxDiff(sample(name, 0), base)).toBeLessThan(1e-9);
        expect(maxDiff(sample(name, dur), base)).toBeLessThan(1e-9);
      }
    }
  });

  it('variation changes timing (±12 %) and amplitude', () => {
    for (const name of CLIP_NAMES) {
      const slow = clipDuration(name, 0);
      const fast = clipDuration(name, 0.999);
      expect(slow / fast).toBeGreaterThan(1.2);
      expect(slow / fast).toBeLessThan(1.3);
      expect(slow).toBeCloseTo(CLIPS[name].duration / 0.88, 6);
    }
    const t = 0.15;
    expect(maxDiff(sample('hitReact', t, 1, 0.1), sample('hitReact', t, 1, 0.9))).toBeGreaterThan(0.01);
  });

  it('weight 0 changes nothing; additive scales linearly, non-additive blends toward the clip', () => {
    for (const name of CLIP_NAMES) {
      const base = createPose();
      base.armLPitch = -0.7;
      const out = createPose();
      out.armLPitch = -0.7;
      applyClip(out, CLIPS[name], 0.3, 0, 0.5);
      expect(maxDiff(out, base)).toBe(0);
    }
    const full = createPose();
    const half = createPose();
    applyClipAuthored(full, CLIPS.bite, BITE_SNAP_T, 1, 0.5);
    applyClipAuthored(half, CLIPS.bite, BITE_SNAP_T, 0.5, 0.5);
    const base0 = createPose();
    for (const f of POSE_FIELDS) expect(half[f] - base0[f]).toBeCloseTo((full[f] - base0[f]) * 0.5, 9);
    const onTop = createPose();
    onTop.neckPitch = 0.4;
    applyClipAuthored(onTop, CLIPS.bite, BITE_SNAP_T, 1, 0.5);
    expect(onTop.neckPitch).toBeCloseTo(0.4 + (full.neckPitch - base0.neckPitch), 9);

    expect(CLIPS.lunge.additive).toBe(false);
    const a = createPose(); a.armLPitch = 0.2;
    const b = createPose(); b.armLPitch = 0.2;
    const c = createPose(); c.armLPitch = 0.2;
    applyClipAuthored(a, CLIPS.lunge, 0.32, 1, 0.5);
    applyClipAuthored(b, CLIPS.lunge, 0.32, 0.5, 0.5);
    applyClipAuthored(c, CLIPS.lunge, 0.32, 0, 0.5);
    expect(a.armLPitch).toBeLessThan(-1.2);
    expect(b.armLPitch).toBeCloseTo((a.armLPitch + 0.2) / 2, 9);
    expect(c.armLPitch).toBe(0.2);
  });

  it('snaps the jaw shut at BITE_SNAP_T and mirrors turn / hit clips left-right', () => {
    const before = sample('bite', (BITE_SNAP_T - 0.12) / 1.0, 1, 0.5);
    const at = createPose();
    applyClipAuthored(at, CLIPS.bite, BITE_SNAP_T, 1, 0.5);
    expect(before.jaw).toBeGreaterThan(0.1);
    expect(at.jaw).toBeLessThan(-0.15);
    const l = createPose();
    const r = createPose();
    applyClipAuthored(l, CLIPS.turnL, 0.28, 1, 0.5);
    applyClipAuthored(r, CLIPS.turnR, 0.28, 1, 0.5);
    expect(l.neckYaw).toBeGreaterThan(0.2);
    expect(r.neckYaw).toBeCloseTo(-l.neckYaw, 9);
    const hl = createPose();
    const hr = createPose();
    applyClipAuthored(hl, CLIPS.hitReact, 0.06, 1, 0.5, false);
    applyClipAuthored(hr, CLIPS.hitReact, 0.06, 1, 0.5, true);
    expect(hr.spineRoll).toBeCloseTo(-hl.spineRoll, 9);
    expect(hitSign(1, 0)).toBe(1);
    expect(hitSign(-0.4, 0)).toBe(-1);
    expect(hitSign(0, -1)).toBe(-1);
    expect(hitSign(0, 1)).toBe(1);
  });
});
