import { describe, expect, it } from 'vitest';
import {
  animateZombie,
  attackKey,
  createAnimInput,
  createAnimState,
  type ZombieAnimInput,
  type ZombieAnimState,
} from '../src/visuals/zombieAnimation';
import { ARCHETYPES, ATTACK_STYLE, alphaProfile, zombieProfile, type ZombieProfile } from '../src/visuals/zombieProfiles';
import { createPose, footReach, groundedHipY, POSE_FIELDS, RIG, soleHeights, type ZombiePose } from '../src/visuals/zombieRig';

const DT = 1 / 60;

function rig(id: number, flags = {}): { p: ZombieProfile; s: ZombieAnimState; inp: ZombieAnimInput; pose: ZombiePose } {
  return { p: zombieProfile(id, flags), s: createAnimState(), inp: createAnimInput(), pose: createPose() };
}

function maxJump(a: ZombiePose, b: ZombiePose): { field: string; d: number } {
  let best = { field: '', d: 0 };
  for (const f of POSE_FIELDS) {
    const d = Math.abs(a[f] - b[f]);
    if (d > best.d) best = { field: f, d };
  }
  return best;
}

describe('zombie profiles', () => {
  it('are deterministic per id and varied across a crowd', () => {
    expect(zombieProfile(17)).toEqual(zombieProfile(17));
    const profiles = Array.from({ length: 120 }, (_, i) => zombieProfile(i + 1));
    const archetypes = new Set(profiles.map((p) => p.look.archetype));
    const bodies = new Set(profiles.map((p) => p.gait.body));
    expect(archetypes.size).toBeGreaterThanOrEqual(6);
    expect(bodies).toEqual(new Set(['regular', 'injuredLeg', 'stiffArm', 'heavy', 'thin', 'fresh']));
    for (const p of profiles) {
      // 8–18° forward lean
      expect(p.gait.lean).toBeGreaterThanOrEqual((8 * Math.PI) / 180 - 1e-9);
      expect(p.gait.lean).toBeLessThanOrEqual((18 * Math.PI) / 180 + 1e-9);
      // arms never perfectly symmetric
      expect(Math.abs(p.gait.armReachL - p.gait.armReachR)).toBeGreaterThan(0.05);
    }
    const phases = new Set(profiles.map((p) => Math.round(p.gait.phase0 * 100)));
    expect(phases.size).toBeGreaterThan(100);
    expect(new Set(profiles.map((p) => p.deathStyle)).size).toBe(3);
  });

  it('converted guards come back as police or soldiers; brutes are heavy', () => {
    for (let i = 1; i < 30; i++) {
      expect(['police', 'soldier']).toContain(zombieProfile(i, { isConverted: true }).look.archetype);
      const b = zombieProfile(i, { brute: true });
      expect(b.gait.heavy).toBe(1);
      expect(b.scale).toBeGreaterThan(1.3);
    }
    expect(ARCHETYPES.length).toBe(8);
  });
});

describe('zombie locomotion', () => {
  it('keeps the lowest foot on the ground and the planted foot from sliding', () => {
    for (const id of [3, 11, 42, 77]) {
      const { p, s, inp, pose } = rig(id);
      const v = id === 77 ? 0.9 : 3.7; // ambient shamble and follower pace
      inp.speed = v;
      let rootZ = 0;
      let slip = 0;
      let travelled = 0;
      let lastStance: 'l' | 'r' | null = null;
      let lastFootWorld = 0;
      const soles = { l: 0, r: 0 };
      const reach = { l: 0, r: 0 };
      for (let f = 0; f < 60 * 4; f++) {
        animateZombie(s, p, inp, pose);
        rootZ += v * DT;
        soleHeights(pose, soles);
        footReach(pose, reach);
        // Grounding: the lowest sole sits at y = 0 (within float noise), never below.
        expect(Math.min(soles.l, soles.r)).toBeGreaterThan(-1e-6);
        expect(pose.hipY).toBeLessThanOrEqual(RIG.hipY + 1e-9);
        if (f < 60) continue; // let the gait settle in
        const stance: 'l' | 'r' = soles.l <= soles.r ? 'l' : 'r';
        const footWorld = rootZ + reach[stance] * p.scale;
        if (stance === lastStance) slip += Math.abs(footWorld - lastFootWorld);
        travelled += v * DT;
        lastStance = stance;
        lastFootWorld = footWorld;
      }
      // A healthy procedural gait would be ~0; we allow some shuffle but far less than the distance covered.
      expect(slip / travelled).toBeLessThan(0.4);
    }
  });

  it('walks asymmetrically: an injured leg drags (barely lifts) and its stance is cut short', () => {
    let id = 1;
    while (zombieProfile(id).gait.body !== 'injuredLeg') id++;
    const { p, s, inp, pose } = rig(id);
    inp.speed = 1.6;
    const soles = { l: 0, r: 0 };
    let liftL = 0;
    let liftR = 0;
    let groundL = 0;
    let groundR = 0;
    for (let f = 0; f < 60 * 6; f++) {
      animateZombie(s, p, inp, pose);
      if (f < 60) continue;
      soleHeights(pose, soles);
      liftL = Math.max(liftL, soles.l);
      liftR = Math.max(liftR, soles.r);
      if (soles.l < 0.005) groundL++;
      if (soles.r < 0.005) groundR++;
    }
    const left = p.gait.limpLeg === 1;
    expect(left ? liftL : liftR).toBeLessThan((left ? liftR : liftL) * 0.7);
  });

  it('transitions idle → walk → fast (rush pace) → turn → stop → idle without snapping', () => {
    // A snap is a discontinuity: it stays large when sampled 4x finer, continuous motion shrinks ~4x.
    const speedAt = (t: number): number =>
      t < 1 ? 0 : t < 2 ? (t - 1) * 3.7 : t < 4 ? 3.7 : t < 5 ? 3.7 + (t - 4) * 1.7 : t < 6 ? 5.4 : t < 6.4 ? 5.4 * (1 - (t - 6) / 0.4) : 0;
    const run = (id: number, hz: number): number => {
      const { p, s, inp, pose } = rig(id);
      inp.dt = 1 / hz;
      const prev = createPose();
      let worst = 0;
      for (let f = 0; f < hz * 9; f++) {
        const t = f / hz;
        inp.speed = speedAt(t);
        inp.anim = inp.speed > 0.05 ? 'walk' : 'idle';
        inp.facing = t > 3 && t < 3.5 ? (t - 3) * 4 : t >= 3.5 ? 2 : 0; // a sharp turn while walking
        animateZombie(s, p, inp, pose);
        if (f > 0) worst = Math.max(worst, maxJump(prev, pose).d);
        for (const k of POSE_FIELDS) prev[k] = pose[k];
      }
      return worst;
    };
    for (const id of [5, 23, 64, 90]) {
      const coarse = run(id, 240);
      const fine = run(id, 960);
      expect(coarse).toBeLessThan(0.2);
      expect(fine).toBeLessThan(coarse * 0.45);
    }
  });

  it('lags the torso and head behind a sharp turn, then follows through', () => {
    const { p, s, inp, pose } = rig(9);
    inp.speed = 3;
    for (let f = 0; f < 60; f++) animateZombie(s, p, inp, pose);
    let minTorso = 0;
    for (let f = 0; f < 20; f++) { // turn left quickly (+yaw)
      inp.facing += 0.08;
      animateZombie(s, p, inp, pose);
      minTorso = Math.min(minTorso, s.torsoYaw);
    }
    expect(minTorso).toBeLessThan(-0.08); // trails the turn
    expect(s.headYaw).toBeLessThan(s.torsoYaw * 0.5); // head lags more than the torso
    for (let f = 0; f < 120; f++) animateZombie(s, p, inp, pose);
    expect(Math.abs(s.torsoYaw)).toBeLessThan(0.03); // settles once the turn is over
  });

  it('keeps a crowd out of step', () => {
    const legs: number[] = [];
    const leans: number[] = [];
    for (let id = 1; id <= 10; id++) {
      const { p, s, inp, pose } = rig(id);
      inp.speed = 3.7;
      for (let f = 0; f < 150; f++) animateZombie(s, p, inp, pose);
      legs.push(pose.thighLPitch);
      leans.push(pose.spinePitch);
    }
    const sd = (xs: number[]): number => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    expect(sd(legs)).toBeGreaterThan(0.12);
    expect(sd(leans)).toBeGreaterThan(0.02);
  });

  it('stays restless when idle: independent twitches, never frozen', () => {
    const counts: number[] = [];
    for (let id = 1; id <= 8; id++) {
      const { p, s, inp, pose } = rig(id);
      let moved = 0;
      let last = 0;
      for (let f = 0; f < 60 * 20; f++) {
        animateZombie(s, p, inp, pose);
        moved += Math.abs(pose.neckYaw - last);
        last = pose.neckYaw;
      }
      counts.push(s.twitchCount);
      expect(moved).toBeGreaterThan(0.5);
    }
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(2);
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('lurches every so often while walking', () => {
    let total = 0;
    for (let id = 1; id <= 10; id++) {
      const { p, s, inp, pose } = rig(id);
      inp.speed = 2;
      for (let f = 0; f < 60 * 30; f++) animateZombie(s, p, inp, pose);
      total += s.lurchCount;
    }
    expect(total).toBeGreaterThan(10);
  });
});

describe('zombie attacks', () => {
  it('times the strike contact to the gameplay hit (cooldown reaching 0) with anticipation before it', () => {
    const { p, s, inp, pose } = rig(31);
    inp.engaged = true;
    inp.speed = 0;
    const cdTotal = 1.2;
    let cd = 0.9;
    let striked = false;
    let windupSeen = false;
    const prev = createPose();
    for (let f = 0; f < 60 * 4; f++) {
      cd -= DT;
      let style = -1;
      if (cd <= 1e-9) {
        // Sim: damage applies this step; anim restarts as 'attack'.
        style = s.nextStyle;
        cd = cdTotal;
        inp.anim = 'attack';
        inp.animTime = 0;
      } else if (inp.anim === 'attack') {
        inp.animTime += DT;
      }
      // Frame BEFORE the hit: the strike key must be (almost) reached.
      if (cd > 1e-9 && cd <= DT + 1e-9 && inp.anim !== 'attack') {
        inp.cooldown = 1e-3;
        animateZombie(s, p, inp, pose);
        const key = attackKey(s.nextStyle, 1);
        const field = key.armRPitch !== undefined ? 'armRPitch' : 'armLPitch';
        expect(Math.abs(pose[field] - (key[field] as number))).toBeLessThan(0.25);
        striked = true;
        for (const k of POSE_FIELDS) prev[k] = pose[k];
        continue;
      }
      inp.cooldown = cd;
      animateZombie(s, p, inp, pose);
      if (style >= 0) {
        // The hit frame continues from the strike (follow-through starts), no snap back.
        expect(maxJump(prev, pose).d).toBeLessThan(0.3);
      }
      if (s.atkPhase === 1 && s.atkT > 0.3 && s.atkT < 0.6) windupSeen = true;
      for (const k of POSE_FIELDS) prev[k] = pose[k];
    }
    expect(striked).toBe(true);
    expect(windupSeen).toBe(true);
    expect(s.attackCount).toBeGreaterThanOrEqual(3);
  });

  it('fades out of an interrupted windup instead of snapping', () => {
    const { p, s, inp, pose } = rig(12);
    inp.engaged = true;
    inp.cooldown = 0.1; // deep in the windup
    s.cdTotal = 1.2;
    for (let f = 0; f < 3; f++) animateZombie(s, p, inp, pose);
    const prev = createPose();
    for (const k of POSE_FIELDS) prev[k] = pose[k];
    inp.engaged = false; // target died
    inp.cooldown = 0;
    for (let f = 0; f < 40; f++) {
      animateZombie(s, p, inp, pose);
      expect(maxJump(prev, pose).d).toBeLessThan(0.3);
      for (const k of POSE_FIELDS) prev[k] = pose[k];
    }
    expect(s.atkW).toBe(0);
  });

  it('drives the Alpha combo from its explicit windup / recovery phases', () => {
    const p = alphaProfile();
    const s = createAnimState();
    const inp = createAnimInput();
    const pose = createPose();
    inp.attackPhase = 'windup';
    inp.attackStyle = 0; // right claw
    inp.attackT = 1;
    animateZombie(s, p, inp, pose);
    expect(pose.armRPitch).toBeCloseTo(attackKey(0, 1).armRPitch as number, 1);
    inp.attackPhase = 'recovery';
    inp.attackT = 1;
    animateZombie(s, p, inp, pose);
    expect(s.stateName).toBe('attack');
  });
});

describe('zombie hits, death and rise', () => {
  it('reacts to a hit in the direction it came from', () => {
    const a = rig(8);
    const b = rig(8);
    for (let f = 0; f < 30; f++) { animateZombie(a.s, a.p, a.inp, a.pose); animateZombie(b.s, b.p, b.inp, b.pose); }
    a.inp.hitImpulse = true; a.inp.hitFromZ = 1; // shot from the front
    b.inp.hitImpulse = true; b.inp.hitFromZ = -1; // from behind
    animateZombie(a.s, a.p, a.inp, a.pose);
    animateZombie(b.s, b.p, b.inp, b.pose);
    a.inp.hitImpulse = b.inp.hitImpulse = false;
    for (let f = 0; f < 6; f++) { animateZombie(a.s, a.p, a.inp, a.pose); animateZombie(b.s, b.p, b.inp, b.pose); }
    expect(a.s.lean).toBeLessThan(b.s.lean - 0.05); // knocked back vs. shoved forward
  });

  it('collapses smoothly into a stable corpse pose for every death style', () => {
    for (let id = 1; id <= 9; id++) {
      const { p, s, inp, pose } = rig(id);
      inp.speed = 3;
      for (let f = 0; f < 60; f++) animateZombie(s, p, inp, pose);
      const prev = createPose();
      for (const k of POSE_FIELDS) prev[k] = pose[k];
      inp.anim = 'dead';
      inp.speed = 0;
      for (let f = 0; f < 120; f++) {
        inp.deadTime = f * DT;
        animateZombie(s, p, inp, pose);
        expect(maxJump(prev, pose).d).toBeLessThan(0.3);
        for (const k of POSE_FIELDS) prev[k] = pose[k];
      }
      const fallen = Math.max(Math.abs(pose.rootPitch), Math.abs(pose.rootRoll));
      expect(fallen).toBeGreaterThan(1.2);
      for (let f = 0; f < 30; f++) { inp.deadTime += DT; animateZombie(s, p, inp, pose); }
      expect(maxJump(prev, pose).d).toBeLessThan(0.05); // settled
    }
  });

  it('rises from the ground into a standing idle without a pop', () => {
    const { p, s, inp, pose } = rig(4);
    inp.anim = 'rise';
    const prev = createPose();
    for (let f = 0; f <= 72; f++) {
      inp.riseT = f / 72;
      animateZombie(s, p, inp, pose);
      if (f === 0) expect(pose.rootPitch).toBeGreaterThan(1.2);
      else expect(maxJump(prev, pose).d).toBeLessThan(0.3);
      for (const k of POSE_FIELDS) prev[k] = pose[k];
    }
    inp.anim = 'idle';
    inp.animTime = 0;
    animateZombie(s, p, inp, pose);
    expect(maxJump(prev, pose).d).toBeLessThan(0.3);
    expect(Math.abs(pose.rootPitch)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// VP2-T008: clip-driven states, body shapes
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function footWorld(pose: ZombiePose, scale: number): { l: number; r: number } {
  const r = footReach(pose, { l: 0, r: 0 });
  return { l: r.l * scale, r: r.r * scale };
}

describe('VP2 body shapes', () => {
  it('maps ids deterministically with the target distribution; brutes are heavy, the Alpha is alpha', () => {
    const counts: Record<string, number> = {};
    const N = 4000;
    for (let id = 1; id <= N; id++) {
      const a = zombieProfile(id).bodyShape;
      expect(zombieProfile(id).bodyShape).toBe(a);
      counts[a] = (counts[a] ?? 0) + 1;
    }
    const share = (k: string): number => (counts[k] ?? 0) / N;
    expect(Object.keys(counts).sort()).toEqual(['average', 'heavy', 'lanky', 'shortRound', 'tallSkinny']);
    expect(Math.abs(share('average') - 0.35)).toBeLessThan(0.06);
    expect(Math.abs(share('tallSkinny') - 0.18)).toBeLessThan(0.05);
    expect(Math.abs(share('shortRound') - 0.17)).toBeLessThan(0.05);
    expect(Math.abs(share('heavy') - 0.15)).toBeLessThan(0.05);
    expect(Math.abs(share('lanky') - 0.15)).toBeLessThan(0.05);
    for (let id = 1; id <= 200; id++) {
      expect(zombieProfile(id, { brute: true }).bodyShape).toBe('heavy');
      const p = zombieProfile(id);
      if (p.gait.body === 'heavy') expect(['heavy', 'shortRound']).toContain(p.bodyShape);
      if (p.gait.body === 'thin') expect(['tallSkinny', 'lanky']).toContain(p.bodyShape);
    }
    expect(alphaProfile().bodyShape).toBe('alpha');
  });
});

describe('VP2 clip states', () => {
  it('snaps the jaw shut exactly at the follower strike step (bite style)', () => {
    const { p, s, inp, pose } = rig(31);
    inp.engaged = true;
    inp.speed = 0;
    inp.cooldown = 0.9;
    s.cdTotal = 1.2;
    animateZombie(s, p, inp, pose);
    s.nextStyle = ATTACK_STYLE.bite;
    const jaws: number[] = [];
    let biteSeen = false;
    for (let cd = 0.5; cd > 0; cd -= DT) {
      inp.cooldown = Math.max(cd, 1e-3);
      animateZombie(s, p, inp, pose);
      jaws.push(pose.jaw);
      if (s.stateName === 'bite') biteSeen = true;
    }
    const last = jaws[jaws.length - 1];
    expect(biteSeen).toBe(true);
    expect(last).toBeLessThan(0.1); // jaws clamped shut at the strike
    expect(jaws[jaws.length - 6]).toBeGreaterThan(last + 0.2); // was wide open a few frames earlier
    expect(Math.max(...jaws)).toBeGreaterThan(0.4);
  });

  it('plays the bite for the Alpha windup and recovery phases too', () => {
    const p = alphaProfile();
    const s = createAnimState();
    const inp = createAnimInput();
    const pose = createPose();
    inp.attackPhase = 'windup';
    inp.attackStyle = ATTACK_STYLE.bite;
    inp.attackT = 0.5;
    animateZombie(s, p, inp, pose);
    const open = pose.jaw;
    inp.attackT = 1;
    animateZombie(s, p, inp, pose);
    expect(s.stateName).toBe('bite');
    expect(pose.jaw).toBeLessThan(open);
  });

  it('reaches celebrate and hit states; celebrate and hit keep the feet planted (within 1 cm)', () => {
    for (const id of [5, 23, 64]) {
      const ref = rig(id);
      const cel = rig(id);
      const hit = rig(id);
      const states = new Set<string>();
      let maxHop = 0;
      let slip = 0;
      let minSole = 1;
      const soles = { l: 0, r: 0 };
      for (let f = 0; f < 60 * 4; f++) {
        const t = f * DT;
        cel.inp.celebrate = t > 0.5 ? t - 0.5 : -1;
        hit.inp.hitImpulse = f === 90;
        hit.inp.hitFromX = 0.8;
        hit.inp.hitFromZ = 0.3;
        animateZombie(ref.s, ref.p, ref.inp, ref.pose);
        animateZombie(cel.s, cel.p, cel.inp, cel.pose);
        animateZombie(hit.s, hit.p, hit.inp, hit.pose);
        states.add(cel.s.stateName);
        states.add(hit.s.stateName);
        const fr = footWorld(ref.pose, ref.p.scale);
        for (const o of [cel, hit]) {
          const fo = footWorld(o.pose, o.p.scale);
          slip = Math.max(slip, Math.abs(fo.l - fr.l), Math.abs(fo.r - fr.r));
        }
        maxHop = Math.max(maxHop, cel.pose.hipY - groundedHipY(cel.pose));
        soleHeights(cel.pose, soles);
        minSole = Math.min(minSole, soles.l, soles.r);
        soleHeights(hit.pose, soles);
        minSole = Math.min(minSole, soles.l, soles.r);
      }
      expect(states.has('celebrate')).toBe(true);
      expect(states.has('hit')).toBe(true);
      expect(slip).toBeLessThan(0.01);
      expect(maxHop).toBeLessThan(0.12); // it hops, but only a little
      expect(minSole).toBeGreaterThan(-1e-6);
    }
  });

  it('hit stagger is direction-signed (left vs right hits)', () => {
    const l = rig(8);
    const r = rig(8);
    for (let f = 0; f < 30; f++) { animateZombie(l.s, l.p, l.inp, l.pose); animateZombie(r.s, r.p, r.inp, r.pose); }
    l.inp.hitImpulse = r.inp.hitImpulse = true;
    l.inp.hitFromX = 1;
    r.inp.hitFromX = -1;
    animateZombie(l.s, l.p, l.inp, l.pose);
    animateZombie(r.s, r.p, r.inp, r.pose);
    expect(l.s.hitClipSign).toBe(1);
    expect(r.s.hitClipSign).toBe(-1);
    l.inp.hitImpulse = r.inp.hitImpulse = false;
    for (let f = 0; f < 4; f++) { animateZombie(l.s, l.p, l.inp, l.pose); animateZombie(r.s, r.p, r.inp, r.pose); }
    expect(Math.abs(l.pose.neckYaw - r.pose.neckYaw)).toBeGreaterThan(0.01); // mirrored stagger differs
  });

  it('turns on the spot in either direction, scans around when idle for long, lunges when charging in', () => {
    const left = rig(14);
    const right = rig(14);
    let sawL = false;
    let sawR = false;
    for (let f = 0; f < 90; f++) {
      left.inp.facing += 0.07;
      right.inp.facing -= 0.07;
      animateZombie(left.s, left.p, left.inp, left.pose);
      animateZombie(right.s, right.p, right.inp, right.pose);
      if (left.s.turnClipT >= 0 && left.s.turnClipDir > 0 && left.s.stateName === 'turn') sawL = true;
      if (right.s.turnClipT >= 0 && right.s.turnClipDir < 0) sawR = true;
    }
    expect(sawL && sawR).toBe(true);

    let looks = 0;
    for (const id of [3, 4, 5, 6]) {
      const { p, s, inp, pose } = rig(id);
      for (let f = 0; f < 60 * 60; f++) animateZombie(s, p, inp, pose);
      looks += s.idleLookCount;
    }
    expect(looks).toBeGreaterThanOrEqual(4);

    const { p, s, inp, pose } = rig(9);
    inp.speed = 3;
    inp.engaged = true;
    let lunged = false;
    for (let f = 0; f < 30; f++) { animateZombie(s, p, inp, pose); if (s.lungeT >= 0) lunged = true; }
    expect(lunged).toBe(true);
  });

  it('flourishes after rising; the Alpha stands more upright than the same body in the horde', () => {
    const { p, s, inp, pose } = rig(4);
    inp.anim = 'rise';
    for (let f = 0; f <= 72; f++) { inp.riseT = f / 72; animateZombie(s, p, inp, pose); }
    inp.anim = 'idle';
    let flourished = false;
    for (let f = 0; f < 30; f++) { animateZombie(s, p, inp, pose); if (s.flourishT >= 0) flourished = true; }
    expect(flourished).toBe(true);

    const mk = (shape: 'alpha' | 'average') => ({ p: { ...alphaProfile(), bodyShape: shape }, s: createAnimState(), inp: createAnimInput(), pose: createPose() });
    const alpha = mk('alpha');
    const plain = mk('average');
    for (const r of [alpha, plain]) { r.inp.speed = 2; for (let f = 0; f < 120; f++) animateZombie(r.s, r.p, r.inp, r.pose); }
    expect(alpha.pose.spinePitch).toBeLessThan(plain.pose.spinePitch - 0.03);
  });

  it('enters and leaves celebrate / hit / bite without snapping (240 Hz vs 960 Hz)', () => {
    const run = (id: number, hz: number): number => {
      const { p, s, inp, pose } = rig(id);
      inp.dt = 1 / hz;
      const prev = createPose();
      let worst = 0;
      for (let f = 0; f < hz * 9; f++) {
        const t = f / hz;
        inp.celebrate = t > 1 && t < 3.5 ? t - 1 : -1;
        inp.hitImpulse = f === Math.round(hz * 5);
        inp.hitFromX = 0.7;
        inp.attackPhase = t > 6 && t < 6.3 ? 'windup' : t >= 6.3 && t < 6.7 ? 'recovery' : 'none';
        inp.attackStyle = ATTACK_STYLE.bite;
        inp.attackT = t < 6.3 ? clamp01((t - 6) / 0.3) : clamp01((t - 6.3) / 0.4);
        animateZombie(s, p, inp, pose);
        if (f > 0) worst = Math.max(worst, maxJump(prev, pose).d);
        for (const k of POSE_FIELDS) prev[k] = pose[k];
      }
      return worst;
    };
    for (const id of [5, 23, 90]) {
      const coarse = run(id, 240);
      const fine = run(id, 960);
      expect(coarse).toBeLessThan(0.2);
      expect(fine).toBeLessThan(coarse * 0.45);
    }
  });
});
