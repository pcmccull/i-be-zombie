import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALANCE } from '../config/balance';
import type { AnimAction, GuardState, HumanPost, HumanRole, LeaderAttackPhase } from '../core/types';

export type CharacterKind = 'leader' | 'walker' | 'guard' | 'civilian' | 'police';

export interface CharacterRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Object3D;
  torso: THREE.Object3D;
  pelvis: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  materials: THREE.Material[];
}

export interface PoseParams {
  kind: CharacterKind;
  anim: AnimAction;
  animTime: number;
  speed: number;
  time: number;
  phase: number;
  guardState?: GuardState;
  /** Leader only: direct-attack state machine (see LeaderState). */
  attackPhase?: LeaderAttackPhase;
  /** 0..1 progress through the current windup/recovery. */
  attackT?: number;
  /** 0 = bite, 1..3 = claw combo hit index. */
  comboStep?: number;
  /** Leader hit stun seconds remaining. */
  hitStun?: number;
  /** Human stagger seconds remaining (claw finisher). */
  stagger?: number;
}

/** Subtle baseline emissive of the Alpha (hit flash / frenzy override it, EntityRenderer restores it). */
export const LEADER_GLOW = 0x1b3d0c;

export interface Pose {
  bodyY: number;
  bodyPitch: number;
  bodyRoll: number;
  headPitch: number;
  headYaw: number;
  armLPitch: number;
  armRPitch: number;
  armLRoll: number;
  armRRoll: number;
  legLPitch: number;
  legRPitch: number;
  lunge: number;
  deathTilt: number;
}

export const ZOMBIE_PART_NAMES = [
  'head',
  'torso',
  'pelvis',
  'armL',
  'armR',
  'legL',
  'legR',
  'accessory',
] as const;

export type ZombiePartName = (typeof ZOMBIE_PART_NAMES)[number];

export const WALKER_VARIANTS: {
  skin: number;
  shirt: number;
  pants: number;
  accessory: number;
}[] = [
  { skin: 0x7d9a6a, shirt: 0x8a5a4c, pants: 0x3b444f, accessory: 0x5c4738 },
  { skin: 0x6f8a72, shirt: 0x4d6b6e, pants: 0x363b42, accessory: 0x786b59 },
  { skin: 0x798f64, shirt: 0x96824b, pants: 0x424954, accessory: 0x4b5742 },
  { skin: 0x68806c, shirt: 0x546478, pants: 0x2f353d, accessory: 0x6e4b42 },
  { skin: 0x82996e, shirt: 0x5e694b, pants: 0x3d3934, accessory: 0x4f565e },
  { skin: 0x657c66, shirt: 0x6b5b6e, pants: 0x353c45, accessory: 0x7a6248 },
];

const GUARD_SKIN_TONES: readonly number[] = [
  0xdba885,
  0xc68e68,
  0x8d5b3c,
  0xe2b696,
];

// Joint positions in character space (y=0 at feet on ground, +Z forward, +X left)
const JOINT_HEAD_Y = 1.33;
const JOINT_TORSO_Y = 1.07;
const JOINT_PELVIS_Y = 0.77;
const JOINT_SHOULDER_X = 0.27;
const JOINT_SHOULDER_Y = 1.26;
const JOINT_HIP_X = 0.13;
const JOINT_HIP_Y = 0.72;

function paintGeometry(geom: THREE.BufferGeometry, hexColor: number): THREE.BufferGeometry {
  const nonIndexed = geom.index ? geom.toNonIndexed() : geom.clone();
  nonIndexed.deleteAttribute('uv');
  nonIndexed.deleteAttribute('uv2');
  const posAttr = nonIndexed.getAttribute('position');
  const count = posAttr.count;
  const color = new THREE.Color(hexColor);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

function makePartBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hexColor: number,
  rotX = 0,
  rotY = 0,
  rotZ = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotX !== 0) g.rotateX(rotX);
  if (rotY !== 0) g.rotateY(rotY);
  if (rotZ !== 0) g.rotateZ(rotZ);
  g.translate(x, y, z);
  const painted = paintGeometry(g, hexColor);
  g.dispose();
  return painted;
}

function mergePartGeoms(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) {
    p.dispose();
  }
  return merged;
}

let cachedZombieGeometries: Record<ZombiePartName, THREE.BufferGeometry> | null = null;

/**
 * Shared flat-shaded part geometries for instanced zombies.
 * Pivots are at each joint origin; vertex colors are white/modulated so instanceColor tints cleanly.
 */
export function getZombiePartGeometries(): Record<ZombiePartName, THREE.BufferGeometry> {
  if (cachedZombieGeometries) {
    return cachedZombieGeometries;
  }

  // Head: pivot at neck (0,0,0), extends up to +0.34. Pale yellow glowing eyes on +Z face.
  const headGeo = mergePartGeoms([
    makePartBox(0.28, 0.3, 0.28, 0, 0.16, 0, 0xffffff),
    // Brow ridge & jaw
    makePartBox(0.3, 0.07, 0.12, 0, 0.25, 0.11, 0xd8dfd0),
    makePartBox(0.22, 0.08, 0.16, 0, 0.04, 0.06, 0xc8d2c0),
    // Glowing pale-yellow zombie eyes
    makePartBox(0.065, 0.05, 0.04, 0.07, 0.18, 0.145, 0xf6ff9c),
    makePartBox(0.065, 0.05, 0.04, -0.07, 0.18, 0.145, 0xf6ff9c),
    // Dark mouth slit
    makePartBox(0.12, 0.035, 0.04, 0, 0.08, 0.138, 0x2c332b),
  ]);

  // Torso: centered around joint (0,0,0), height 0.46
  const torsoGeo = mergePartGeoms([
    makePartBox(0.42, 0.44, 0.25, 0, 0.02, 0, 0xffffff),
    // Tattered lower shirt hem & collar detail
    makePartBox(0.44, 0.1, 0.27, 0, -0.16, 0, 0xd4d4d4),
    makePartBox(0.22, 0.08, 0.26, 0, 0.22, 0.01, 0xbababa),
  ]);

  // Pelvis: centered around (0,0,0), height 0.18
  const pelvisGeo = mergePartGeoms([
    makePartBox(0.38, 0.18, 0.23, 0, 0, 0, 0xffffff),
  ]);

  // Arms: pivot at shoulder (0,0,0), hanging down to -0.58
  const armLGeo = mergePartGeoms([
    // Upper torn sleeve
    makePartBox(0.14, 0.28, 0.14, 0, -0.13, 0, 0xe8e8e8),
    // Forearm & claw hand
    makePartBox(0.12, 0.3, 0.12, 0, -0.4, 0.02, 0xffffff),
    makePartBox(0.13, 0.09, 0.15, 0, -0.55, 0.03, 0xd0dcc8),
  ]);

  const armRGeo = mergePartGeoms([
    makePartBox(0.14, 0.28, 0.14, 0, -0.13, 0, 0xe8e8e8),
    makePartBox(0.12, 0.3, 0.12, 0, -0.4, 0.02, 0xffffff),
    makePartBox(0.13, 0.09, 0.15, 0, -0.55, 0.03, 0xd0dcc8),
  ]);

  // Legs: pivot at hip (0,0,0), extending down to -0.72 so foot sole sits at y = 0
  const legLGeo = mergePartGeoms([
    makePartBox(0.16, 0.36, 0.17, 0, -0.18, 0, 0xffffff),
    makePartBox(0.14, 0.3, 0.15, 0, -0.5, 0, 0xe2e2e2),
    // Shoe/boot extending slightly forward (+Z)
    makePartBox(0.16, 0.1, 0.25, 0, -0.67, 0.04, 0x45484c),
  ]);

  const legRGeo = mergePartGeoms([
    makePartBox(0.16, 0.36, 0.17, 0, -0.18, 0, 0xffffff),
    makePartBox(0.14, 0.3, 0.15, 0, -0.5, 0, 0xe2e2e2),
    makePartBox(0.16, 0.1, 0.25, 0, -0.67, 0.04, 0x45484c),
  ]);

  // Accessory: asymmetric shoulder pad + small tattered sling/pack attached to torso frame
  const accessoryGeo = mergePartGeoms([
    makePartBox(0.18, 0.12, 0.28, 0.18, 0.2, 0, 0xffffff, 0, 0, -0.18),
    makePartBox(0.28, 0.26, 0.12, -0.04, 0.04, -0.16, 0xdcdcdc),
  ]);

  cachedZombieGeometries = {
    head: headGeo,
    torso: torsoGeo,
    pelvis: pelvisGeo,
    armL: armLGeo,
    armR: armRGeo,
    legL: legLGeo,
    legR: legRGeo,
    accessory: accessoryGeo,
  };

  return cachedZombieGeometries;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Humans knocked off balance by a claw finisher: lean back and wobble. */
function applyStagger(p: PoseParams, out: Pose): void {
  const st = p.stagger ?? 0;
  if (st <= 0) return;
  const f = Math.min(1, st / 0.25);
  const wob = Math.sin(p.time * 11 + p.phase);
  out.bodyPitch = -0.3 * f + out.bodyPitch * (1 - f);
  out.bodyRoll += wob * 0.16 * f;
  out.headPitch = -0.25 * f;
  out.headYaw = wob * 0.3 * f;
  out.armLPitch = mix(out.armLPitch, -0.5, f);
  out.armRPitch = mix(out.armRPitch, -0.5, f);
  out.armLRoll = mix(out.armLRoll, 0.7, f);
  out.armRRoll = mix(out.armRRoll, -0.7, f);
  out.lunge = -0.1 * f;
}

/**
 * Alpha direct attack overlay: bite lunge, alternating claw swipes (hit 1 = right, 2 = left),
 * overhead finisher (hit 3). Windup telegraphs, recovery is the follow-through.
 */
function applyLeaderAttack(p: PoseParams, out: Pose): void {
  const phase = p.attackPhase;
  if (phase !== 'windup' && phase !== 'recovery') return;
  const t = Math.max(0, Math.min(1, p.attackT ?? 0));
  const step = p.comboStep ?? 0;
  const winding = phase === 'windup';

  if (step <= 0) {
    // Bite: rear back, then lunge head-first.
    if (winding) {
      const e = easeOut(t);
      out.bodyPitch += -0.32 * e;
      out.headPitch += -0.4 * e;
      out.lunge = -0.14 * e;
      out.armLPitch = mix(out.armLPitch, -1.5, e);
      out.armRPitch = mix(out.armRPitch, -1.5, e);
      out.armLRoll = 0.5 * e;
      out.armRRoll = -0.5 * e;
    } else {
      const s = (1 - t) * (1 - t);
      out.bodyPitch += 0.55 * s;
      out.headPitch += 0.5 * s;
      out.lunge = 0.5 * s;
      out.armLPitch = mix(out.armLPitch, -1.7, s);
      out.armRPitch = mix(out.armRPitch, -1.7, s);
      out.armLRoll = 0.2 * s;
      out.armRRoll = -0.2 * s;
    }
    return;
  }

  if (step === 3) {
    // Overhead finisher: both claws raised, then slammed down.
    if (winding) {
      const e = easeOut(t);
      out.bodyPitch += -0.3 * e;
      out.headPitch += -0.3 * e;
      out.lunge = -0.1 * e;
      out.armLPitch = mix(out.armLPitch, -3.05, e);
      out.armRPitch = mix(out.armRPitch, -3.05, e);
      out.armLRoll = 0.3;
      out.armRRoll = -0.3;
    } else {
      const slam = Math.min(1, t / 0.35);
      const hold = 1 - Math.max(0, (t - 0.35) / 0.65);
      out.bodyPitch += 0.62 * hold;
      out.headPitch += 0.35 * hold;
      out.lunge = 0.42 * hold;
      const arm = mix(-3.05, -0.35, easeOut(slam));
      out.armLPitch = mix(out.armLPitch, arm, hold);
      out.armRPitch = mix(out.armRPitch, arm, hold);
      out.armLRoll = 0.15;
      out.armRRoll = -0.15;
    }
    return;
  }

  // Claw swipes: right arm (step 1) or left arm (step 2) cuts across the body.
  const right = step === 1;
  const side = right ? -1 : 1; // outward roll sign for the swinging arm
  let pitch: number;
  let roll: number;
  let twist: number;
  if (winding) {
    const e = easeOut(t);
    pitch = mix(-0.7, -2.3, e);
    roll = side * mix(0.14, 0.95, e);
    twist = -side * 0.22 * e;
    out.lunge = -0.06 * e;
  } else {
    const sweep = easeOut(Math.min(1, t / 0.6));
    const hold = 1 - t;
    pitch = mix(-2.3, -0.9, sweep);
    roll = side * mix(0.95, -0.75, sweep);
    twist = side * 0.28 * hold;
    out.lunge = 0.25 * hold;
  }
  out.bodyRoll += twist * 0.5;
  out.bodyPitch += 0.12;
  out.headYaw = twist;
  if (right) {
    out.armRPitch = pitch;
    out.armRRoll = roll;
    out.armLPitch = -0.95;
  } else {
    out.armLPitch = pitch;
    out.armLRoll = roll;
    out.armRPitch = -0.95;
  }
}

function applyLeaderHitStun(p: PoseParams, out: Pose): void {
  const hs = p.hitStun ?? 0;
  if (hs <= 0) return;
  const f = Math.min(1, hs / Math.max(0.01, BALANCE.alpha.hitStunTime));
  out.bodyPitch = -0.42 * f + out.bodyPitch * (1 - f);
  out.headPitch = -0.45 * f;
  out.lunge = -0.2 * f;
  out.bodyRoll += Math.sin(p.time * 40) * 0.1 * f;
  out.armLPitch = mix(out.armLPitch, -0.35, f);
  out.armRPitch = mix(out.armRPitch, -0.35, f);
  out.armLRoll = mix(out.armLRoll, 0.8, f);
  out.armRRoll = mix(out.armRRoll, -0.8, f);
}

export function computePose(p: PoseParams, out: Pose): Pose {
  const { kind, anim, animTime, speed, time, phase } = p;

  // Reset defaults
  out.bodyY = 0;
  out.bodyPitch = 0;
  out.bodyRoll = 0;
  out.headPitch = 0;
  out.headYaw = 0;
  out.armLPitch = 0;
  out.armRPitch = 0;
  out.armLRoll = 0;
  out.armRRoll = 0;
  out.legLPitch = 0;
  out.legRPitch = 0;
  out.lunge = 0;
  out.deathTilt = 0;

  // 1. Dead state: fall forward/sideways over 0.5 s and stay down
  if (anim === 'dead') {
    const t = Math.max(0, Math.min(1, animTime / 0.5));
    const ease = 1 - (1 - t) * (1 - t);
    out.deathTilt = ease;
    out.bodyPitch = 0.15 * ease;
    out.bodyRoll = (phase > Math.PI ? 0.25 : -0.25) * ease;
    out.headPitch = -0.25 * ease;
    out.headYaw = 0.35 * ease;
    out.armLPitch = -0.55 * ease;
    out.armRPitch = -0.35 * ease;
    out.armLRoll = 0.45 * ease;
    out.armRRoll = -0.45 * ease;
    out.legLPitch = 0.2 * ease;
    out.legRPitch = -0.15 * ease;
    return out;
  }

  // 2. Rising state: reverse fall over riseDuration (1.2 s) with jerky undead twitching
  if (anim === 'rise') {
    const dur = BALANCE.conversion.riseDuration;
    const u = Math.max(0, Math.min(1, animTime / dur));
    const smooth = u * u * (3 - 2 * u);
    const twitch = Math.sin(animTime * 24 + phase) * (1 - u) * 0.18;
    out.deathTilt = 1 - smooth;
    out.bodyPitch = (1 - smooth) * 0.45 + 0.16 + twitch;
    out.bodyRoll = Math.cos(animTime * 19 + phase) * (1 - u) * 0.22;
    out.headPitch = -0.3 * (1 - smooth) + twitch;
    out.headYaw = Math.sin(animTime * 15) * (1 - u) * 0.4;
    out.armLPitch = -1.25 + 0.25 * smooth + twitch;
    out.armRPitch = -1.15 + 0.2 * smooth - twitch;
    out.armLRoll = 0.22;
    out.armRRoll = -0.22;
    out.legLPitch = 0.45 * (1 - smooth);
    out.legRPitch = -0.35 * (1 - smooth);
    return out;
  }

  // 2b. Climbing a watchtower leg: alternating overhead reaches, knees pulling up, chest to the frame
  if (anim === 'climb') {
    const c = time * 7.5 + phase;
    const s = Math.sin(c);
    out.bodyPitch = -0.12;
    out.headPitch = -0.35;
    out.armLPitch = -2.6 + s * 0.45;
    out.armRPitch = -2.6 - s * 0.45;
    out.armLRoll = 0.18;
    out.armRRoll = -0.18;
    out.legLPitch = -0.55 - s * 0.45;
    out.legRPitch = -0.55 + s * 0.45;
    out.bodyY = Math.abs(Math.cos(c)) * 0.05;
    return out;
  }

  // 3. Human Civilian posture & animation (casual walk + arms-up flee/cower when RETREAT)
  if (kind === 'civilian') {
    const moveBlend = Math.min(1, speed / 2.8);
    const cycle = time * (5.2 + speed * 1.4) + phase;
    const stride = Math.sin(cycle) * 0.68 * moveBlend;
    const bob = Math.abs(Math.cos(cycle)) * 0.045 * moveBlend;

    out.bodyY = bob;
    out.legLPitch = stride;
    out.legRPitch = -stride;

    if (p.guardState === 'RETREAT') {
      if (speed > 0.15) {
        // Frantic arms-up flee pose
        out.bodyPitch = 0.16 + 0.06 * moveBlend;
        out.bodyRoll = Math.cos(cycle) * 0.08 * moveBlend;
        out.headPitch = -0.06;
        out.headYaw = Math.sin(time * 9.5 + phase) * 0.24;
        out.armLPitch = -2.35 + Math.sin(cycle) * 0.35;
        out.armRPitch = -2.35 - Math.sin(cycle) * 0.35;
        out.armLRoll = 0.32;
        out.armRRoll = -0.32;
      } else {
        // Stationary cower pose with hands raised shielding head
        const tremble = Math.sin(time * 16.0 + phase) * 0.06;
        out.bodyY = -0.05;
        out.bodyPitch = 0.24;
        out.bodyRoll = tremble * 0.5;
        out.headPitch = 0.18;
        out.headYaw = tremble * 1.6;
        out.armLPitch = -2.1 + tremble;
        out.armRPitch = -2.1 - tremble;
        out.armLRoll = 0.26;
        out.armRRoll = -0.26;
      }
    } else {
      // Casual calm walk / idle
      out.bodyPitch = 0.03 * moveBlend;
      out.bodyRoll = Math.cos(cycle) * 0.025 * moveBlend;
      out.headPitch = 0.0;
      out.headYaw = moveBlend < 0.15 ? Math.sin(time * 1.3 + phase) * 0.2 : 0;
      out.armLPitch = -0.08 - stride * 0.55;
      out.armRPitch = -0.08 + stride * 0.55;
      out.armLRoll = 0.08;
      out.armRRoll = -0.08;
    }

    if (anim === 'hit') {
      const flinch = Math.max(0, 1 - animTime / 0.25);
      out.bodyPitch -= 0.28 * flinch;
      out.headPitch -= 0.25 * flinch;
      out.bodyRoll += 0.18 * flinch;
    }
    applyStagger(p, out);
    return out;
  }

  // 3b. Human Guard / Barricade Police posture & animation
  if (kind === 'guard' || kind === 'police') {
    const isPolice = kind === 'police';
    const moveBlend = Math.min(1, speed / 2.6);
    const cycle = time * (5.5 + speed * 1.15) + phase;
    const stride = Math.sin(cycle) * 0.65 * moveBlend;
    const bob = Math.abs(Math.cos(cycle)) * 0.045 * moveBlend;

    out.bodyY = bob;
    out.bodyPitch = 0.04 + 0.06 * moveBlend;
    out.bodyRoll = Math.cos(cycle) * 0.03 * moveBlend;
    out.headPitch = 0.02;
    out.headYaw = moveBlend < 0.15 ? Math.sin(time * 1.4 + phase) * 0.18 : 0;

    if (isPolice) {
      // Pistol ready stance
      out.armRPitch = -1.08 + Math.sin(cycle) * 0.06 * moveBlend;
      out.armRRoll = -0.12;
      out.armLPitch = -0.95 + Math.sin(cycle) * 0.06 * moveBlend;
      out.armLRoll = 0.24;
    } else {
      // Rifle held across chest by default
      out.armRPitch = -0.92 + Math.sin(cycle) * 0.06 * moveBlend;
      out.armRRoll = -0.22;
      out.armLPitch = -1.02 + Math.sin(cycle) * 0.06 * moveBlend;
      out.armLRoll = 0.36;
    }

    out.legLPitch = stride;
    out.legRPitch = -stride;

    if (anim === 'attack') {
      // Aim weapon at shoulder height with recoil kick at start of shot
      const recoil = Math.max(0, 1 - animTime / 0.18);
      out.bodyPitch = 0.06 - recoil * 0.09;
      out.headPitch = 0.05;
      out.headYaw = 0;
      out.armRPitch = (isPolice ? -1.48 : -1.42) + recoil * 0.18;
      out.armRRoll = isPolice ? -0.06 : -0.12;
      out.armLPitch = (isPolice ? -1.42 : -1.38) + recoil * 0.16;
      out.armLRoll = isPolice ? 0.18 : 0.28;
    } else if (anim === 'hit') {
      const flinch = Math.max(0, 1 - animTime / 0.25);
      out.bodyPitch -= 0.28 * flinch;
      out.headPitch -= 0.25 * flinch;
      out.bodyRoll += 0.18 * flinch;
    }

    applyStagger(p, out);
    return out;
  }

  // 4. Zombie Walker & Leader posture & animation
  const isLeader = kind === 'leader';
  const moveFactor = Math.min(1.35, speed / 3.4);
  const isRunning = anim === 'run' || speed > 4.6;
  const freq = isRunning ? 9.2 : 6.2;
  const cycle = time * freq + phase;

  // Asymmetric shambling limp
  const limpSin = Math.sin(cycle);
  const limpCos = Math.cos(cycle);
  const idleSway = Math.sin(time * 2.1 + phase);
  const idleBreath = Math.cos(time * 1.7 + phase);

  const baseHunch = isLeader ? 0.27 : 0.21;
  const asymRoll = isLeader ? -0.05 : (phase > Math.PI ? 0.09 : -0.09);

  if (speed > 0.15 || anim === 'walk' || anim === 'run') {
    out.bodyY = Math.abs(limpCos) * 0.055 * moveFactor;
    out.bodyPitch = baseHunch + (isRunning ? 0.12 : 0.04) + Math.sin(cycle * 2) * 0.04;
    out.bodyRoll = asymRoll + limpCos * (isLeader ? 0.07 : 0.13) * moveFactor;
    out.headPitch = -0.08 + Math.sin(cycle * 2) * 0.05;
    out.headYaw = limpSin * 0.1 * moveFactor;

    // Walkers hold arms outstretched forward; leader swings menacingly
    if (isLeader) {
      out.armLPitch = -0.68 + limpSin * 0.52 * moveFactor;
      out.armRPitch = -0.68 - limpSin * 0.52 * moveFactor;
      out.armLRoll = 0.14;
      out.armRRoll = -0.14;
    } else {
      out.armLPitch = -1.08 + limpSin * 0.24 * moveFactor;
      out.armRPitch = -0.96 - limpCos * 0.22 * moveFactor;
      out.armLRoll = 0.12 + limpCos * 0.05;
      out.armRRoll = -0.12 - limpSin * 0.05;
    }

    // Asymmetric leg stride (one leg drags slightly on walkers)
    const dragAsym = isLeader ? 1.0 : 0.78;
    out.legLPitch = limpSin * 0.68 * moveFactor;
    out.legRPitch = -limpSin * 0.68 * dragAsym * moveFactor;
  } else {
    // Idle shambling sway
    out.bodyY = Math.abs(idleBreath) * 0.015;
    out.bodyPitch = baseHunch + idleBreath * 0.03;
    out.bodyRoll = asymRoll + idleSway * 0.05;
    out.headPitch = -0.06 + idleBreath * 0.04;
    out.headYaw = idleSway * 0.14;
    out.armLPitch = isLeader ? -0.45 + idleSway * 0.08 : -0.95 + idleSway * 0.08;
    out.armRPitch = isLeader ? -0.4 + idleBreath * 0.08 : -0.88 - idleSway * 0.08;
    out.armLRoll = 0.14;
    out.armRRoll = -0.14;
    out.legLPitch = 0.05;
    out.legRPitch = -0.05;
  }

  // Attack lunge (0.35 s clip): arms raise & slash forward with body lunge
  if (anim === 'attack') {
    const atkDur = 0.35;
    const t = Math.max(0, Math.min(1, animTime / atkDur));
    const slash = Math.sin(t * Math.PI);
    out.lunge = slash * 0.32;
    out.bodyPitch += slash * 0.28;
    out.headPitch -= slash * 0.15;
    // Wind up briefly then swipe down
    const armSwipe = t < 0.35 ? -1.75 : -0.55;
    out.armLPitch = armSwipe * slash + out.armLPitch * (1 - slash);
    out.armRPitch = (armSwipe - 0.1) * slash + out.armRPitch * (1 - slash);
    out.armLRoll = 0.25 * (1 - slash);
    out.armRRoll = -0.25 * (1 - slash);
  } else if (anim === 'hit') {
    const flinch = Math.max(0, 1 - animTime / 0.25);
    out.bodyPitch -= 0.32 * flinch;
    out.headPitch -= 0.28 * flinch;
    out.armLRoll += 0.35 * flinch;
    out.armRRoll -= 0.35 * flinch;
    out.lunge = -0.12 * flinch;
  }

  if (isLeader) {
    applyLeaderAttack(p, out);
    applyLeaderHitStun(p, out);
  }

  return out;
}

export function applyPose(rig: CharacterRig, pose: Pose): void {
  const fallAngle = pose.deathTilt * (Math.PI * 0.48);

  rig.body.position.set(
    0,
    pose.bodyY + pose.deathTilt * 0.16,
    pose.lunge,
  );
  rig.body.rotation.set(pose.bodyPitch + fallAngle, 0, pose.bodyRoll);

  rig.head.rotation.set(pose.headPitch, pose.headYaw, 0);
  rig.armL.rotation.set(pose.armLPitch, 0, pose.armLRoll);
  rig.armR.rotation.set(pose.armRPitch, 0, pose.armRRoll);
  rig.legL.rotation.set(pose.legLPitch, 0, 0);
  rig.legR.rotation.set(pose.legRPitch, 0, 0);
}

// Pre-allocated scratch transforms for zero-allocation composeZombiePartMatrix
const _bodyMat = new THREE.Matrix4();
const _partMat = new THREE.Matrix4();
const _posVec = new THREE.Vector3();
const _scaleVec = new THREE.Vector3();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _unitScale = new THREE.Vector3(1, 1, 1);

export function composeZombiePartMatrix(
  part: ZombiePartName,
  rootMatrix: THREE.Matrix4,
  pose: Pose,
  scale: number,
  out: THREE.Matrix4,
  widthScale = 1,
): THREE.Matrix4 {
  const fallAngle = pose.deathTilt * (Math.PI * 0.48);

  // 1. Body transform relative to root
  _posVec.set(0, (pose.bodyY + pose.deathTilt * 0.16) * scale, pose.lunge * scale);
  _euler.set(pose.bodyPitch + fallAngle, 0, pose.bodyRoll, 'XYZ');
  _quat.setFromEuler(_euler);
  _scaleVec.set(scale * widthScale, scale, scale);
  _bodyMat.compose(_posVec, _quat, _scaleVec);
  out.multiplyMatrices(rootMatrix, _bodyMat);

  // 2. Part local joint offset + joint rotation
  switch (part) {
    case 'head':
      _posVec.set(0, JOINT_HEAD_Y, 0);
      _euler.set(pose.headPitch, pose.headYaw, 0, 'XYZ');
      break;
    case 'torso':
    case 'accessory':
      _posVec.set(0, JOINT_TORSO_Y, 0);
      _euler.set(0, 0, 0, 'XYZ');
      break;
    case 'pelvis':
      _posVec.set(0, JOINT_PELVIS_Y, 0);
      _euler.set(0, 0, 0, 'XYZ');
      break;
    case 'armL':
      _posVec.set(JOINT_SHOULDER_X, JOINT_SHOULDER_Y, 0);
      _euler.set(pose.armLPitch, 0, pose.armLRoll, 'XYZ');
      break;
    case 'armR':
      _posVec.set(-JOINT_SHOULDER_X, JOINT_SHOULDER_Y, 0);
      _euler.set(pose.armRPitch, 0, pose.armRRoll, 'XYZ');
      break;
    case 'legL':
      _posVec.set(JOINT_HIP_X, JOINT_HIP_Y, 0);
      _euler.set(pose.legLPitch, 0, 0, 'XYZ');
      break;
    case 'legR':
      _posVec.set(-JOINT_HIP_X, JOINT_HIP_Y, 0);
      _euler.set(pose.legRPitch, 0, 0, 'XYZ');
      break;
  }

  _quat.setFromEuler(_euler);
  _partMat.compose(_posVec, _quat, _unitScale);
  out.multiply(_partMat);
  return out;
}

/**
 * Zombie Leader (~1.85 m tall): darker green skin #4f6b3a, torn red-brown jacket,
 * asymmetric spiked/armored shoulder pad + hood collar, glowing yellow eyes.
 */
export function createLeaderRig(): CharacterRig {
  const root = new THREE.Group();
  root.name = 'LeaderRig';

  const body = new THREE.Group();
  // Scale slightly taller (~1.85 m)
  body.scale.setScalar(1.22);
  root.add(body);

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.emissive.setHex(LEADER_GLOW);
  const materials: THREE.Material[] = [mat];

  const skinCol = 0x56803a;
  const jacketCol = 0x6b1f2e;
  const jacketTrimCol = 0x4d1e16;
  const shirtCol = 0x34383b;
  const pantsCol = 0x2a313b;
  const padCol = 0x8f7952;

  const makePartGroup = (
    name: string,
    jx: number,
    jy: number,
    jz: number,
    geoms: THREE.BufferGeometry[],
  ): THREE.Group => {
    const grp = new THREE.Group();
    grp.name = name;
    grp.position.set(jx, jy, jz);
    const merged = mergePartGeoms(geoms);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grp.add(mesh);
    body.add(grp);
    return grp;
  };

  const head = makePartGroup('head', 0, JOINT_HEAD_Y, 0, [
    makePartBox(0.29, 0.31, 0.29, 0, 0.16, 0, skinCol),
    // Torn dark hood / collar framing the head
    makePartBox(0.34, 0.24, 0.22, 0, 0.12, -0.07, jacketTrimCol),
    makePartBox(0.31, 0.08, 0.12, 0, 0.26, 0.11, 0x3d542c),
    // Glowing yellow eyes
    makePartBox(0.07, 0.055, 0.04, 0.075, 0.18, 0.148, 0xfff275),
    makePartBox(0.07, 0.055, 0.04, -0.075, 0.18, 0.148, 0xfff275),
    makePartBox(0.14, 0.04, 0.04, 0, 0.07, 0.142, 0x232b1e),
  ]);

  const torso = makePartGroup('torso', 0, JOINT_TORSO_Y, 0, [
    // Broad chest & red-brown torn jacket
    makePartBox(0.45, 0.46, 0.27, 0, 0.02, 0, jacketCol),
    makePartBox(0.2, 0.44, 0.28, 0, 0.02, 0.01, shirtCol),
    // Distinctive asymmetric spiked/plated shoulder pad on left shoulder + bandolier strap
    makePartBox(0.24, 0.15, 0.32, 0.22, 0.23, 0, padCol, 0, 0, -0.25),
    makePartBox(0.08, 0.14, 0.08, 0.25, 0.34, 0, 0xb8a47e, 0, 0, -0.2),
    makePartBox(0.47, 0.1, 0.29, 0, -0.17, 0, jacketTrimCol),
    // Second (right) shoulder plate and a ridge of bone spikes down the back: reads as the Alpha from afar
    makePartBox(0.22, 0.13, 0.3, -0.22, 0.23, 0, padCol, 0, 0, 0.25),
    makePartBox(0.07, 0.16, 0.07, -0.25, 0.35, 0, 0xb8a47e, 0, 0, 0.2),
    makePartBox(0.07, 0.17, 0.08, 0, 0.26, -0.18, 0xd9cfae, 0.5),
    makePartBox(0.07, 0.15, 0.08, 0, 0.08, -0.19, 0xd9cfae, 0.5),
    makePartBox(0.07, 0.13, 0.08, 0, -0.1, -0.18, 0xd9cfae, 0.5),
  ]);

  const pelvis = makePartGroup('pelvis', 0, JOINT_PELVIS_Y, 0, [
    makePartBox(0.4, 0.19, 0.24, 0, 0, 0, pantsCol),
    makePartBox(0.42, 0.06, 0.25, 0, 0.06, 0, 0x4f3b2b),
  ]);

  const armL = makePartGroup('armL', JOINT_SHOULDER_X + 0.02, JOINT_SHOULDER_Y, 0, [
    makePartBox(0.15, 0.3, 0.15, 0, -0.14, 0, jacketCol),
    makePartBox(0.13, 0.3, 0.13, 0, -0.41, 0.02, skinCol),
    makePartBox(0.14, 0.1, 0.16, 0, -0.57, 0.03, 0x3b522b),
  ]);

  const armR = makePartGroup('armR', -(JOINT_SHOULDER_X + 0.02), JOINT_SHOULDER_Y, 0, [
    makePartBox(0.15, 0.24, 0.15, 0, -0.11, 0, jacketTrimCol),
    makePartBox(0.13, 0.34, 0.13, 0, -0.39, 0.02, skinCol),
    makePartBox(0.14, 0.1, 0.16, 0, -0.57, 0.03, 0x3b522b),
  ]);

  const legL = makePartGroup('legL', JOINT_HIP_X, JOINT_HIP_Y, 0, [
    makePartBox(0.17, 0.37, 0.18, 0, -0.18, 0, pantsCol),
    makePartBox(0.15, 0.3, 0.16, 0, -0.5, 0, pantsCol),
    makePartBox(0.17, 0.1, 0.26, 0, -0.67, 0.04, 0x22252a),
  ]);

  const legR = makePartGroup('legR', -JOINT_HIP_X, JOINT_HIP_Y, 0, [
    makePartBox(0.17, 0.37, 0.18, 0, -0.18, 0, pantsCol),
    makePartBox(0.15, 0.3, 0.16, 0, -0.5, 0, skinCol),
    makePartBox(0.17, 0.1, 0.26, 0, -0.67, 0.04, 0x22252a),
  ]);

  return {
    root,
    body,
    head,
    torso,
    pelvis,
    armL,
    armR,
    legL,
    legR,
    materials,
  };
}

const CIVILIAN_SHIRT_PALETTE: readonly number[] = [
  0xb84a42, // terracotta red jacket
  0x477a5c, // teal-green sweater
  0xc9a648, // mustard ochre shirt
  0x7a5c8f, // plum hoodie
  0xd6cfc2, // cream tee
  0x527d85, // muted slate-teal top
];

const CIVILIAN_PANTS_PALETTE: readonly number[] = [
  0x8c7b65, // khaki tan
  0x3b3e42, // charcoal
  0x4d5446, // olive drab
  0x594638, // warm brown
];

const CIVILIAN_HAIR_PALETTE: readonly number[] = [
  0x3b2a1e,
  0x6e4f32,
  0x22201e,
  0x9c7a4c,
];

/**
 * Human Character Rig:
 * - role === 'civilian': casual clothes (varied shirts/pants, no helmet/vest/weapon, styled hair).
 * - role === 'soldier' && post === 'barricade': police look (navy + light-blue shirt, peaked cap, pistol).
 * - default ('soldier', 'checkpoint'): navy uniform #2c3e66, orange tactical vest #e0782a, helmet with visor, rifle.
 */
export function createGuardRig(
  variantIndex = 0,
  role: HumanRole = 'soldier',
  post: HumanPost = 'checkpoint',
): CharacterRig {
  const root = new THREE.Group();
  root.name = 'GuardRig';

  const body = new THREE.Group();
  root.add(body);

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const materials: THREE.Material[] = [mat];

  const idx = Math.abs(variantIndex);
  const skinCol = GUARD_SKIN_TONES[idx % GUARD_SKIN_TONES.length];
  const bootCol = 0x1e2229;
  const gunSteelCol = 0x242930;

  const makePartGroup = (
    name: string,
    jx: number,
    jy: number,
    jz: number,
    geoms: THREE.BufferGeometry[],
  ): THREE.Group => {
    const grp = new THREE.Group();
    grp.name = name;
    grp.position.set(jx, jy, jz);
    const merged = mergePartGeoms(geoms);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grp.add(mesh);
    body.add(grp);
    return grp;
  };

  if (role === 'civilian') {
    const shirtCol = CIVILIAN_SHIRT_PALETTE[idx % CIVILIAN_SHIRT_PALETTE.length];
    const pantsCol = CIVILIAN_PANTS_PALETTE[idx % CIVILIAN_PANTS_PALETTE.length];
    const hairCol = CIVILIAN_HAIR_PALETTE[idx % CIVILIAN_HAIR_PALETTE.length];
    const shoeCol = idx % 2 === 0 ? 0xd8d6ce : 0x36393e;

    const head = makePartGroup('head', 0, JOINT_HEAD_Y, 0, [
      makePartBox(0.26, 0.28, 0.26, 0, 0.15, 0, skinCol),
      // Casual hair crown & sideburns (no helmet)
      makePartBox(0.28, 0.1, 0.28, 0, 0.27, -0.01, hairCol),
      makePartBox(0.28, 0.16, 0.14, 0, 0.2, -0.08, hairCol),
      // Eyes
      makePartBox(0.05, 0.04, 0.03, 0.06, 0.17, 0.13, 0x1e2228),
      makePartBox(0.05, 0.04, 0.03, -0.06, 0.17, 0.13, 0x1e2228),
    ]);

    const torso = makePartGroup('torso', 0, JOINT_TORSO_Y, 0, [
      makePartBox(0.4, 0.43, 0.23, 0, 0.02, 0, shirtCol),
      // Casual collar / undershirt trim (no tactical vest)
      makePartBox(0.18, 0.1, 0.24, 0, 0.19, 0.01, 0xeae6dc),
      makePartBox(0.41, 0.08, 0.24, 0, -0.16, 0, shirtCol),
    ]);

    const pelvis = makePartGroup('pelvis', 0, JOINT_PELVIS_Y, 0, [
      makePartBox(0.38, 0.18, 0.22, 0, 0, 0, pantsCol),
    ]);

    const armL = makePartGroup('armL', JOINT_SHOULDER_X, JOINT_SHOULDER_Y, 0, [
      makePartBox(0.13, 0.25, 0.13, 0, -0.12, 0, shirtCol),
      makePartBox(0.11, 0.27, 0.11, 0, -0.37, 0, skinCol),
      makePartBox(0.12, 0.09, 0.12, 0, -0.52, 0, skinCol),
    ]);

    // Unarmed right arm (no weapon)
    const armR = makePartGroup('armR', -JOINT_SHOULDER_X, JOINT_SHOULDER_Y, 0, [
      makePartBox(0.13, 0.25, 0.13, 0, -0.12, 0, shirtCol),
      makePartBox(0.11, 0.27, 0.11, 0, -0.37, 0, skinCol),
      makePartBox(0.12, 0.09, 0.12, 0, -0.52, 0, skinCol),
    ]);

    const legL = makePartGroup('legL', JOINT_HIP_X, JOINT_HIP_Y, 0, [
      makePartBox(0.15, 0.36, 0.16, 0, -0.18, 0, pantsCol),
      makePartBox(0.14, 0.28, 0.15, 0, -0.49, 0, pantsCol),
      makePartBox(0.15, 0.11, 0.24, 0, -0.66, 0.04, shoeCol),
    ]);

    const legR = makePartGroup('legR', -JOINT_HIP_X, JOINT_HIP_Y, 0, [
      makePartBox(0.15, 0.36, 0.16, 0, -0.18, 0, pantsCol),
      makePartBox(0.14, 0.28, 0.15, 0, -0.49, 0, pantsCol),
      makePartBox(0.15, 0.11, 0.24, 0, -0.66, 0.04, shoeCol),
    ]);

    return { root, body, head, torso, pelvis, armL, armR, legL, legR, materials };
  }

  if (role === 'police' || post === 'barricade') {
    // Police officer look: light-blue shirt + dark navy pants + peaked police cap + compact pistol
    const policeNavy = 0x223252;
    const policeShirt = 0x6ca0dc;
    const badgeGold = 0xf2c94c;

    const head = makePartGroup('head', 0, JOINT_HEAD_Y, 0, [
      makePartBox(0.27, 0.28, 0.27, 0, 0.15, 0, skinCol),
      // Peaked police cap (crown + visor brim + gold badge)
      makePartBox(0.3, 0.11, 0.3, 0, 0.27, -0.01, policeNavy),
      makePartBox(0.32, 0.06, 0.32, 0, 0.32, 0.01, policeNavy),
      makePartBox(0.26, 0.04, 0.14, 0, 0.23, 0.16, 0x141a24),
      makePartBox(0.07, 0.07, 0.04, 0, 0.28, 0.16, badgeGold),
    ]);

    const torso = makePartGroup('torso', 0, JOINT_TORSO_Y, 0, [
      makePartBox(0.42, 0.44, 0.24, 0, 0.02, 0, policeShirt),
      // Dark navy tie, shoulder epaulets & gold chest badge
      makePartBox(0.07, 0.28, 0.26, 0, 0.04, 0.01, policeNavy),
      makePartBox(0.12, 0.05, 0.25, -0.15, 0.23, 0, policeNavy),
      makePartBox(0.12, 0.05, 0.25, 0.15, 0.23, 0, policeNavy),
      makePartBox(0.07, 0.08, 0.26, -0.11, 0.11, 0.01, badgeGold),
    ]);

    const pelvis = makePartGroup('pelvis', 0, JOINT_PELVIS_Y, 0, [
      makePartBox(0.39, 0.18, 0.23, 0, 0, 0, policeNavy),
      makePartBox(0.41, 0.07, 0.25, 0, 0.05, 0, bootCol),
    ]);

    const armL = makePartGroup('armL', JOINT_SHOULDER_X, JOINT_SHOULDER_Y, 0, [
      makePartBox(0.14, 0.22, 0.14, 0, -0.11, 0, policeShirt),
      makePartBox(0.12, 0.28, 0.12, 0, -0.37, 0, skinCol),
      makePartBox(0.13, 0.1, 0.13, 0, -0.53, 0, skinCol),
    ]);

    // Right arm holds a compact pistol-size sidearm
    const armR = makePartGroup('armR', -JOINT_SHOULDER_X, JOINT_SHOULDER_Y, 0, [
      makePartBox(0.14, 0.22, 0.14, 0, -0.11, 0, policeShirt),
      makePartBox(0.12, 0.28, 0.12, 0, -0.37, 0, skinCol),
      makePartBox(0.13, 0.1, 0.13, 0, -0.53, 0, skinCol),
      // Pistol grip + slide
      makePartBox(0.06, 0.14, 0.14, 0.02, -0.56, 0.03, gunSteelCol),
      makePartBox(0.06, 0.26, 0.08, 0.02, -0.66, 0.07, gunSteelCol),
    ]);

    const legL = makePartGroup('legL', JOINT_HIP_X, JOINT_HIP_Y, 0, [
      makePartBox(0.16, 0.36, 0.17, 0, -0.18, 0, policeNavy),
      makePartBox(0.15, 0.28, 0.16, 0, -0.49, 0, policeNavy),
      makePartBox(0.16, 0.12, 0.25, 0, -0.66, 0.04, bootCol),
    ]);

    const legR = makePartGroup('legR', -JOINT_HIP_X, JOINT_HIP_Y, 0, [
      makePartBox(0.16, 0.36, 0.17, 0, -0.18, 0, policeNavy),
      makePartBox(0.15, 0.28, 0.16, 0, -0.49, 0, policeNavy),
      makePartBox(0.16, 0.12, 0.25, 0, -0.66, 0.04, bootCol),
    ]);

    return { root, body, head, torso, pelvis, armL, armR, legL, legR, materials };
  }

  // Soldier: olive-drab fatigues, orange hi-vis vest, tactical helmet, rifle
  const navyCol = 0x4f5a34;
  const vestCol = 0xe0782a;
  const helmetCol = 0x3a4528;

  const head = makePartGroup('head', 0, JOINT_HEAD_Y, 0, [
    makePartBox(0.27, 0.28, 0.27, 0, 0.15, 0, skinCol),
    // Tactical helmet & orange stripe + dark visor
    makePartBox(0.32, 0.18, 0.33, 0, 0.25, -0.01, helmetCol),
    makePartBox(0.33, 0.05, 0.34, 0, 0.24, -0.01, vestCol),
    makePartBox(0.26, 0.07, 0.05, 0, 0.18, 0.135, 0x18202c),
  ]);

  const torso = makePartGroup('torso', 0, JOINT_TORSO_Y, 0, [
    makePartBox(0.42, 0.44, 0.24, 0, 0.02, 0, navyCol),
    // High-visibility orange tactical vest + pouches
    makePartBox(0.45, 0.34, 0.28, 0, 0.04, 0, vestCol),
    makePartBox(0.14, 0.12, 0.31, -0.1, -0.02, 0.02, 0x353c45),
    makePartBox(0.14, 0.12, 0.31, 0.1, -0.02, 0.02, 0x353c45),
  ]);

  const pelvis = makePartGroup('pelvis', 0, JOINT_PELVIS_Y, 0, [
    makePartBox(0.39, 0.18, 0.23, 0, 0, 0, navyCol),
    makePartBox(0.41, 0.06, 0.25, 0, 0.05, 0, bootCol),
  ]);

  const armL = makePartGroup('armL', JOINT_SHOULDER_X, JOINT_SHOULDER_Y, 0, [
    makePartBox(0.14, 0.28, 0.14, 0, -0.13, 0, navyCol),
    makePartBox(0.12, 0.26, 0.12, 0, -0.38, 0, skinCol),
    makePartBox(0.13, 0.1, 0.13, 0, -0.53, 0, bootCol),
  ]);

  // Right arm holds the low-poly assault rifle pointing along forearm
  const armR = makePartGroup('armR', -JOINT_SHOULDER_X, JOINT_SHOULDER_Y, 0, [
    makePartBox(0.14, 0.28, 0.14, 0, -0.13, 0, navyCol),
    makePartBox(0.12, 0.26, 0.12, 0, -0.38, 0, skinCol),
    makePartBox(0.13, 0.1, 0.13, 0, -0.53, 0, bootCol),
    // Low-poly rifle attached to right hand (points forward when arm is raised)
    makePartBox(0.08, 0.72, 0.12, 0.08, -0.62, 0.06, gunSteelCol),
    makePartBox(0.05, 0.34, 0.06, 0.08, -0.98, 0.06, 0x454d59),
    makePartBox(0.07, 0.12, 0.22, 0.08, -0.56, -0.05, gunSteelCol),
    makePartBox(0.09, 0.14, 0.09, 0.08, -0.72, 0.08, vestCol),
  ]);

  const legL = makePartGroup('legL', JOINT_HIP_X, JOINT_HIP_Y, 0, [
    makePartBox(0.16, 0.36, 0.17, 0, -0.18, 0, navyCol),
    makePartBox(0.15, 0.28, 0.16, 0, -0.49, 0, navyCol),
    makePartBox(0.16, 0.12, 0.25, 0, -0.66, 0.04, bootCol),
  ]);

  const legR = makePartGroup('legR', -JOINT_HIP_X, JOINT_HIP_Y, 0, [
    makePartBox(0.16, 0.36, 0.17, 0, -0.18, 0, navyCol),
    makePartBox(0.15, 0.28, 0.16, 0, -0.49, 0, navyCol),
    makePartBox(0.16, 0.12, 0.25, 0, -0.66, 0.04, bootCol),
  ]);

  return {
    root,
    body,
    head,
    torso,
    pelvis,
    armL,
    armR,
    legL,
    legR,
    materials,
  };
}
