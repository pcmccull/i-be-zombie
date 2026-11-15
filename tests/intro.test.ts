import { describe, expect, it } from 'vitest';
import { buildIntroScript } from '../src/content/intro';
import {
  activeCue, advanceScriptClock, catmullRom1, createPose, ease, narrationTimeScale, sampleCameraPath, type CameraKey,
} from '../src/core/cinematicMath';
import {
  cinematicInputLock, gameplayHudVisible, gameplayInputEnabled, shouldPlayIntro, transitionFlow, type GameFlowState,
} from '../src/core/gameFlow';
import type { ColliderDef, Vec3 } from '../src/core/types';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { buildTropicalLayout } from '../src/world/tropicalLayout';

const layout = buildDistrictLayout();
const script = buildIntroScript(layout);
const solid = layout.colliders.filter(c => ['building', 'wall', 'tower', 'vehicle', 'breakable', 'gate'].includes(c.kind));

describe('game flow state', () => {
  it('locks every gameplay input during LOADING and INTRO_CINEMATIC only', () => {
    const all: GameFlowState[] = ['LOADING', 'INTRO_CINEMATIC', 'PLAYING', 'PAUSED'];
    expect(all.filter(gameplayInputEnabled)).toEqual(['PLAYING']);
    expect(all.filter(cinematicInputLock)).toEqual(['LOADING', 'INTRO_CINEMATIC']);
    expect(gameplayHudVisible('INTRO_CINEMATIC')).toBe(false);
    expect(gameplayHudVisible('PLAYING')).toBe(true);
  });

  it('plays the intro only for a new game or an explicit replay', () => {
    expect(shouldPlayIntro({ hasSave: false })).toBe(true);
    expect(shouldPlayIntro({ hasSave: true })).toBe(false);
    expect(shouldPlayIntro({ hasSave: true, replay: true })).toBe(true);
  });

  it('ignores illegal transitions (cannot pause during the cinematic)', () => {
    expect(transitionFlow('INTRO_CINEMATIC', 'PAUSED')).toBe('INTRO_CINEMATIC');
    expect(transitionFlow('LOADING', 'PAUSED')).toBe('LOADING');
    expect(transitionFlow('INTRO_CINEMATIC', 'PLAYING')).toBe('PLAYING');
    expect(transitionFlow('PLAYING', 'PAUSED')).toBe('PAUSED');
  });
});

describe('cinematic math', () => {
  const keys: CameraKey[] = [
    { t: 0, pos: { x: 0, y: 10, z: 0 }, look: { x: 0, y: 0, z: 10 }, fov: 50 },
    { t: 2, pos: { x: 10, y: 8, z: 0 }, look: { x: 10, y: 0, z: 10 }, fov: 50 },
    { t: 4, pos: { x: 10, y: 8, z: 0 }, look: { x: 10, y: 0, z: 10 }, fov: 40, ease: 'inOut' },
    { t: 6, pos: { x: 20, y: 4, z: 5 }, look: { x: 0, y: 0, z: 0 }, fov: 55 },
  ];

  it('passes through every key and clamps outside the range', () => {
    const out = createPose();
    for (const k of keys) {
      sampleCameraPath(keys, k.t, out);
      expect(out.pos.x).toBeCloseTo(k.pos.x, 6);
      expect(out.pos.y).toBeCloseTo(k.pos.y, 6);
      expect(out.fov).toBeCloseTo(k.fov, 6);
    }
    expect(sampleCameraPath(keys, -1, out).pos.x).toBe(0);
    expect(sampleCameraPath(keys, 99, out).pos.x).toBe(20);
  });

  it('holds still between identical keys (no spline overshoot)', () => {
    const out = createPose();
    for (let t = 2; t <= 4; t += 0.25) {
      sampleCameraPath(keys, t, out);
      expect(out.pos).toEqual({ x: 10, y: 8, z: 0 });
    }
  });

  it('is continuous: tiny time steps give tiny position steps', () => {
    const a = createPose(), b = createPose();
    for (let t = 0; t < 6; t += 0.01) {
      sampleCameraPath(keys, t, a);
      sampleCameraPath(keys, t + 0.01, b);
      expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)).toBeLessThan(0.2);
    }
  });

  it('eases and splines have the right endpoints', () => {
    for (const k of ['linear', 'in', 'out', 'inOut'] as const) {
      expect(ease(k, 0)).toBeCloseTo(0, 9);
      expect(ease(k, 1)).toBeCloseTo(1, 9);
    }
    expect(catmullRom1(0, 1, 2, 3, 0.5)).toBeCloseTo(1.5, 9);
  });

  it('adapts timing to the narration length and follows the audio clock', () => {
    expect(narrationTimeScale(40, 44)).toBeCloseTo(1.1, 9);
    expect(narrationTimeScale(40, null)).toBe(1);
    expect(narrationTimeScale(40, 400)).toBe(1); // absurd metadata ignored
    expect(advanceScriptClock(1, 0.5, null)).toBe(1.5);
    // Audio far ahead (seek / resume) snaps; small drift is corrected gradually.
    expect(advanceScriptClock(1, 0.016, { playing: true, time: 10, narrationStart: 0.4, scale: 1 })).toBeCloseTo(10.4, 9);
    const c = advanceScriptClock(5, 0.016, { playing: true, time: 4.7, narrationStart: 0.4, scale: 1 });
    expect(c).toBeGreaterThan(5.016);
    expect(c).toBeLessThan(5.1);
  });

  it('finds the active subtitle cue', () => {
    const cues = [{ start: 1, end: 2, text: 'a' }, { start: 3, end: 4, text: 'b' }];
    expect(activeCue(cues, 1.5)?.text).toBe('a');
    expect(activeCue(cues, 2.5)).toBeNull();
    expect(activeCue(cues, 3)?.text).toBe('b');
  });
});

/** True when the segment a->b (3D) passes through a collider volume (LOS height rule). */
function segmentBlocked(a: Vec3, b: Vec3, colliders: readonly ColliderDef[]): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
  for (let i = 1; i < steps; i++) {
    const u = i / steps;
    const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, z = a.z + (b.z - a.z) * u;
    for (const c of colliders) if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && y < c.height) return true;
  }
  return false;
}

describe('opening cinematic script', () => {
  it('keys and cues are ordered and inside the timeline', () => {
    for (let i = 1; i < script.keys.length; i++) expect(script.keys[i].t).toBeGreaterThan(script.keys[i - 1].t);
    expect(script.keys[script.keys.length - 1].t).toBeLessThan(script.endTime);
    for (let i = 0; i < script.cues.length; i++) {
      const c = script.cues[i];
      expect(c.end).toBeGreaterThan(c.start);
      if (i > 0) expect(c.start).toBeGreaterThanOrEqual(script.cues[i - 1].end);
      expect(c.end).toBeLessThanOrEqual(script.endTime);
    }
    expect(script.skipAvailableAt).toBeGreaterThanOrEqual(script.fadeIn);
    expect(script.music.buildFrom).toBeLessThan(script.music.cut);
  });

  it('camera path never passes through buildings, walls or vehicles', () => {
    const out = createPose();
    const last = script.keys[script.keys.length - 1].t;
    for (let t = 0; t <= last; t += 0.05) {
      sampleCameraPath(script.keys, t, out);
      const { x, y, z } = out.pos;
      expect(y).toBeGreaterThan(1.2);
      for (const c of solid) {
        const inside = x > c.minX - 0.4 && x < c.maxX + 0.4 && z > c.minZ - 0.4 && z < c.maxZ + 0.4 && y < c.height + 0.6;
        if (inside) throw new Error(`camera inside ${c.kind} ${c.tag ?? ""} at t=${t.toFixed(2)}`);
      }
    }
  });

  it('keeps the zombie hidden (out of frame or behind scenery) until the reveal orbit', () => {
    const p = layout.playerStart;
    const head: Vec3 = { x: p.x, y: 1.6, z: p.z };
    const revealAt = script.keys.find(k => k.fov <= 42)!.t - 2.3; // orbit starts ~2.3 s before the zoom key
    const out = createPose();
    for (let t = 0; t < revealAt; t += 0.1) {
      sampleCameraPath(script.keys, t, out);
      const fx = out.look.x - out.pos.x, fy = out.look.y - out.pos.y, fz = out.look.z - out.pos.z;
      const lx = head.x - out.pos.x, ly = head.y - out.pos.y, lz = head.z - out.pos.z;
      const dist = Math.hypot(lx, ly, lz);
      const cos = (fx * lx + fy * ly + fz * lz) / (Math.hypot(fx, fy, fz) * dist);
      // Widest frame we support (21:9) at this FOV.
      const halfH = Math.atan(Math.tan((out.fov * Math.PI) / 360) * (21 / 9));
      const inFrame = Math.acos(Math.min(1, cos)) < halfH + 0.05;
      const tiny = dist > 70;
      if (inFrame && !tiny && !segmentBlocked(out.pos, head, layout.colliders.filter(c => c.blocksSight))) {
        throw new Error(`zombie visible at t=${t.toFixed(1)} from (${out.pos.x.toFixed(1)}, ${out.pos.y.toFixed(1)}, ${out.pos.z.toFixed(1)})`);
      }
    }
  });
});

describe('tropical dressing', () => {
  const tropical = buildTropicalLayout(layout);
  const roads = layout.ground.filter(g => g.kind === 'road').map(g => g.rect);

  it('puts palms off roads and clear of colliders', () => {
    expect(tropical.palms.length).toBeGreaterThan(40);
    for (const palm of tropical.palms) {
      const { x, z } = palm.pos;
      expect(layout.colliders.some(c => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ)).toBe(false);
      expect(roads.some(r => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ)).toBe(false);
    }
  });

  it('beach and ocean lie beyond the playable south edge; lanes run inside roads', () => {
    expect(tropical.beach.minZ).toBeGreaterThanOrEqual(layout.bounds.maxZ);
    expect(tropical.ocean.minZ).toBeGreaterThan(layout.bounds.maxZ);
    expect(tropical.lanes.length).toBe(roads.length * 2);
    for (const lane of tropical.lanes) {
      const mid = { x: (lane.from.x + lane.to.x) / 2, z: (lane.from.z + lane.to.z) / 2 };
      expect(roads.some(r => mid.x >= r.minX && mid.x <= r.maxX && mid.z >= r.minZ && mid.z <= r.maxZ)).toBe(true);
    }
    expect(tropical.intersections.length).toBe(9);
  });
});
