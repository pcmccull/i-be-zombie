import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALANCE } from '../config/balance';
import type { AnimAction, CivilianWeapon, GuardState, HumanPost, HumanRole, LeaderAttackPhase } from '../core/types';
import { humanProfile, type HairStyle, type HumanProfile, type HumanProp } from './humanProfiles';

/** Human rigs only — zombies use visuals/zombieModel.ts + zombieAnimation.ts. */
export type CharacterKind = 'guard' | 'civilian' | 'police';

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
  /** todos #12: what an armed civilian carries (fight poses while COMBAT). */
  weapon?: CivilianWeapon;
  /** Optional panic reaction (fleeing civilians: arms flailing overhead, faster cadence). */
  panic?: boolean;
  /** Optional alert reaction (head snap + weapon raise). */
  alert?: boolean;
  /** Optional hit recoil strength 0..1 (torso snap back for ~0.2 s on hitFlash rising edge). */
  hitRecoil?: number;
  /** Optional per-id cadence multiplier so crowds never walk in sync. */
  cadenceScale?: number;
}

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

// Joint positions in character space (y=0 at feet on ground, +Z forward, +X left)
const JOINT_HEAD_Y = 1.33;
const JOINT_TORSO_Y = 1.07;
const JOINT_PELVIS_Y = 0.77;
const JOINT_SHOULDER_X = 0.27;
const JOINT_SHOULDER_Y = 1.26;
const JOINT_HIP_X = 0.13;
const JOINT_HIP_Y = 0.72;

const _paintCol = new THREE.Color();

function paintGeometry(geom: THREE.BufferGeometry, hexColor: number): THREE.BufferGeometry {
  const nonIndexed = geom.index ? geom.toNonIndexed() : geom.clone();
  nonIndexed.deleteAttribute('uv');
  nonIndexed.deleteAttribute('uv2');
  const posAttr = nonIndexed.getAttribute('position');
  const count = posAttr.count;
  _paintCol.setHex(hexColor);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = _paintCol.r;
    colors[i * 3 + 1] = _paintCol.g;
    colors[i * 3 + 2] = _paintCol.b;
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

function makePartCyl(
  rTop: number,
  rBot: number,
  h: number,
  x: number,
  y: number,
  z: number,
  hexColor: number,
  sides = 6,
  sx = 1,
  sz = 1,
  rotX = 0,
  rotY = 0,
  rotZ = 0,
): THREE.BufferGeometry {
  // Blocky by design (user feedback): humans are boxes so their outline never reads as a rounded zombie.
  void sides;
  const g = new THREE.BoxGeometry((rTop + rBot) * sx, h, (rTop + rBot) * sz);
  if (rotX !== 0) g.rotateX(rotX);
  if (rotY !== 0) g.rotateY(rotY);
  if (rotZ !== 0) g.rotateZ(rotZ);
  g.translate(x, y, z);
  const painted = paintGeometry(g, hexColor);
  g.dispose();
  return painted;
}

function makePartSphere(
  radius: number,
  x: number,
  y: number,
  z: number,
  hexColor: number,
  wSeg = 7,
  hSeg = 5,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  // Blocky by design: "spheres" are boxes of the same extents (see makePartCyl).
  void wSeg;
  void hSeg;
  const g = new THREE.BoxGeometry(2 * radius * sx, 2 * radius * sy, 2 * radius * sz);
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

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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

/** Brief torso/head snap back on hitFlash rising edge (~0.2 s). */
function applyHitRecoil(p: PoseParams, out: Pose): void {
  const r = p.hitRecoil ?? 0;
  if (r <= 0) return;
  const f = Math.min(1, r);
  out.bodyPitch -= 0.34 * f;
  out.headPitch -= 0.28 * f;
  out.bodyRoll += 0.18 * f;
  out.armLPitch -= 0.22 * f;
  out.armRPitch -= 0.22 * f;
  out.lunge -= 0.08 * f;
}

export function computePose(p: PoseParams, out: Pose): Pose {
  const { kind, anim, animTime, speed, time, phase } = p;
  const cadence = p.cadenceScale ?? 1;

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

  // 3. Human Civilian posture & animation (casual walk + panic flee/cower)
  if (kind === 'civilian') {
    const isPanic = p.panic === true || p.guardState === 'RETREAT';
    const moveBlend = Math.min(1, speed / 2.8);
    const rate = isPanic ? 7.2 + speed * 1.7 : 5.2 + speed * 1.4;
    const cycle = time * rate * cadence + phase;
    const stride = Math.sin(cycle) * (isPanic ? 0.78 : 0.68) * moveBlend;
    const bob = Math.abs(Math.cos(cycle)) * (isPanic ? 0.06 : 0.045) * moveBlend;

    out.bodyY = bob;
    out.legLPitch = stride;
    out.legRPitch = -stride;

    if (isPanic) {
      if (speed > 0.15) {
        // Frantic arms-flailing-overhead panic flee pose
        const flail = Math.sin(cycle * 1.35);
        out.bodyPitch = 0.18 + 0.07 * moveBlend;
        out.bodyRoll = Math.cos(cycle) * 0.1 * moveBlend;
        out.headPitch = -0.08;
        out.headYaw = Math.sin(time * 10.5 + phase) * 0.3;
        out.armLPitch = -2.45 + flail * 0.55;
        out.armRPitch = -2.45 - flail * 0.55;
        out.armLRoll = 0.35 + Math.cos(cycle) * 0.14;
        out.armRRoll = -0.35 - Math.cos(cycle) * 0.14;
      } else {
        // Stationary cower pose with hands raised shielding head
        const tremble = Math.sin(time * 16.0 + phase) * 0.07;
        out.bodyY = -0.05;
        out.bodyPitch = 0.24;
        out.bodyRoll = tremble * 0.5;
        out.headPitch = 0.18;
        out.headYaw = tremble * 1.8;
        out.armLPitch = -2.1 + tremble;
        out.armRPitch = -2.1 - tremble;
        out.armLRoll = 0.26;
        out.armRRoll = -0.26;
      }
    } else if (p.guardState === 'COMBAT' && p.weapon && p.weapon !== 'none') {
      // todos #12: armed citizen standing its ground
      out.bodyPitch = 0.08;
      out.headPitch = 0.04;
      if (p.weapon === 'bat') {
        const swing = anim === 'attack' ? Math.min(1, animTime / 0.22) : 0;
        const back = anim === 'attack' ? Math.max(0, 1 - Math.max(0, animTime - 0.22) / 0.3) : 1;
        out.armRPitch = -2.5 + swing * 2.0 * back;
        out.armRRoll = -0.35 + swing * 0.5 * back;
        out.armLPitch = -1.2 + swing * 0.5 * back;
        out.armLRoll = 0.2;
        out.bodyRoll = -0.06 + swing * 0.14 * back;
        out.bodyPitch = 0.08 + swing * 0.18 * back;
      } else {
        const kick = anim === 'attack' ? Math.max(0, 1 - animTime / 0.2) * (p.weapon === 'shotgun' ? 1.6 : 1) : 0;
        out.armRPitch = -1.46 + kick * 0.18;
        out.armRRoll = -0.06;
        out.armLPitch = -1.38 + kick * 0.16;
        out.armLRoll = 0.2;
        out.bodyPitch = 0.06 - kick * 0.08;
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
    applyHitRecoil(p, out);
    applyStagger(p, out);
    return out;
  }

  // 3b. Human Guard / Barricade Police posture & animation
  if (kind === 'guard' || kind === 'police') {
    const isPolice = kind === 'police';
    const isAlert = p.alert === true || p.guardState === 'ALERT';
    const moveBlend = Math.min(1, speed / 2.6);
    const cycle = time * (5.5 + speed * 1.15) * cadence + phase;
    const stride = Math.sin(cycle) * 0.65 * moveBlend;
    const bob = Math.abs(Math.cos(cycle)) * 0.045 * moveBlend;

    out.bodyY = bob;
    out.bodyPitch = 0.04 + 0.06 * moveBlend;
    out.bodyRoll = Math.cos(cycle) * 0.03 * moveBlend;
    out.headPitch = isAlert ? -0.04 : 0.02;
    out.headYaw = isAlert
      ? Math.sin(time * 4.2 + phase) * 0.28
      : moveBlend < 0.15
        ? Math.sin(time * 1.4 + phase) * 0.18
        : 0;

    if (isPolice) {
      // Pistol ready stance (raised higher on alert)
      const raise = isAlert ? -0.22 : 0;
      out.armRPitch = -1.08 + raise + Math.sin(cycle) * 0.06 * moveBlend;
      out.armRRoll = -0.12;
      out.armLPitch = -0.95 + raise + Math.sin(cycle) * 0.06 * moveBlend;
      out.armLRoll = 0.24;
    } else {
      // Rifle held across chest by default (raised toward shoulder on alert)
      const raise = isAlert ? -0.3 : 0;
      out.armRPitch = -0.92 + raise + Math.sin(cycle) * 0.06 * moveBlend;
      out.armRRoll = -0.22;
      out.armLPitch = -1.02 + raise + Math.sin(cycle) * 0.06 * moveBlend;
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

    applyHitRecoil(p, out);
    applyStagger(p, out);
    return out;
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

function buildHairGeoms(style: HairStyle, hairCol: number): THREE.BufferGeometry[] {
  const crown = (h = 0.1, w = 0.3) => makePartBox(w, h, 0.3, 0, 0.3 + (h - 0.1) / 2, -0.01, hairCol);
  const back = (h = 0.18) => makePartBox(0.3, h, 0.14, 0, 0.21 - (h - 0.18) / 2, -0.09, hairCol);
  switch (style) {
    case 'bald':
      return [];
    case 'short':
      return [crown(), back()];
    case 'bun':
      return [crown(), back(), makePartBox(0.14, 0.13, 0.13, 0, 0.3, -0.18, hairCol)];
    case 'afro':
      return [makePartBox(0.38, 0.26, 0.38, 0, 0.27, -0.02, hairCol)];
    case 'long':
      return [
        crown(),
        makePartBox(0.3, 0.34, 0.12, 0, 0.11, -0.1, hairCol),
        makePartBox(0.05, 0.24, 0.16, 0.15, 0.13, -0.02, hairCol),
        makePartBox(0.05, 0.24, 0.16, -0.15, 0.13, -0.02, hairCol),
      ];
  }
}

function buildHeadBase(skinCol: number, sunburned: boolean): THREE.BufferGeometry[] {
  const noseCol = sunburned ? 0xe67872 : skinCol;
  const cheekCol = sunburned ? 0xeb8680 : skinCol;
  const geoms: THREE.BufferGeometry[] = [
    // Neck + rounder low-seg sphere head
    makePartCyl(0.055, 0.065, 0.08, 0, 0.02, 0, skinCol, 6),
    makePartSphere(0.145, 0, 0.16, 0, skinCol, 7, 5, 0.96, 1.05, 0.98),
    // Nose
    makePartBox(0.032, 0.048, 0.04, 0, 0.15, 0.142, noseCol),
    // Ears
    makePartBox(0.026, 0.055, 0.04, 0.136, 0.16, 0, skinCol),
    makePartBox(0.026, 0.055, 0.04, -0.136, 0.16, 0, skinCol),
    // Eyes
    makePartBox(0.04, 0.032, 0.025, 0.052, 0.18, 0.128, 0x1e2228),
    makePartBox(0.04, 0.032, 0.025, -0.052, 0.18, 0.128, 0x1e2228),
  ];
  if (sunburned) {
    geoms.push(
      makePartBox(0.042, 0.028, 0.02, 0.068, 0.14, 0.125, cheekCol),
      makePartBox(0.042, 0.028, 0.02, -0.068, 0.14, 0.125, cheekCol),
    );
  }
  return geoms;
}

function appendWeaponParts(armRParts: THREE.BufferGeometry[], weapon: CivilianWeapon): void {
  const gunSteelCol = 0x242930;
  if (weapon === 'bat') {
    armRParts.push(
      makePartCyl(0.028, 0.026, 0.2, 0, -0.62, 0.02, 0x3a2a1c, 6),
      makePartCyl(0.042, 0.032, 0.62, 0, -1.0, 0.02, 0xb9874f, 6),
    );
  } else if (weapon === 'pistol') {
    armRParts.push(
      makePartBox(0.055, 0.14, 0.14, 0.02, -0.56, 0.03, gunSteelCol),
      makePartBox(0.055, 0.26, 0.08, 0.02, -0.66, 0.07, gunSteelCol),
    );
  } else if (weapon === 'shotgun') {
    armRParts.push(
      makePartBox(0.075, 0.3, 0.1, 0.02, -0.6, 0.0, 0x6b4a2e),
      makePartCyl(0.034, 0.034, 0.78, 0.02, -0.86, 0.06, gunSteelCol, 6),
      makePartBox(0.085, 0.16, 0.11, 0.02, -0.8, 0.07, 0x4a3524),
    );
  }
}

function buildFootParts(
  shoeCol: number,
  skinCol: number,
  style: 'sandal' | 'sneaker' | 'boot',
): THREE.BufferGeometry[] {
  if (style === 'sandal') {
    return [
      makePartBox(0.145, 0.032, 0.24, 0, -0.695, 0.04, shoeCol),
      makePartBox(0.125, 0.05, 0.16, 0, -0.655, 0.02, skinCol),
      makePartBox(0.135, 0.025, 0.06, 0, -0.635, 0.06, shoeCol),
    ];
  }
  if (style === 'sneaker') {
    return [
      makePartBox(0.15, 0.035, 0.245, 0, -0.695, 0.04, 0xf2f0ea),
      makePartBox(0.145, 0.085, 0.22, 0, -0.64, 0.035, shoeCol),
      makePartBox(0.135, 0.055, 0.07, 0, -0.655, 0.135, 0xf2f0ea),
    ];
  }
  // Work boot / combat boot
  return [
    makePartBox(0.16, 0.04, 0.255, 0, -0.695, 0.04, 0x181a1f),
    makePartBox(0.155, 0.1, 0.24, 0, -0.635, 0.035, shoeCol),
  ];
}

function hasProp(props: readonly HumanProp[], prop: HumanProp): boolean {
  return props.includes(prop);
}

/**
 * Human Character Rig driven by `HumanProfile` (or legacy index/role/post/weapon args).
 */
export function createGuardRig(
  profileOrIndex: HumanProfile | number = 0,
  role: HumanRole = 'soldier',
  post: HumanPost = 'checkpoint',
  weapon: CivilianWeapon = 'none',
): CharacterRig {
  const profile =
    typeof profileOrIndex === 'number'
      ? humanProfile(Math.abs(profileOrIndex), role, post, weapon)
      : profileOrIndex;

  const root = new THREE.Group();
  root.name = 'GuardRig';

  const body = new THREE.Group();
  body.scale.set(profile.scaleXZ, profile.scaleY, profile.scaleXZ);
  root.add(body);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.75,
    metalness: 0.0,
  });
  const materials: THREE.Material[] = [mat];

  const { palette, skinTone, sunburned, hairStyle, hairColor, props, archetype } = profile;
  const effectiveWeapon = profile.weapon;
  const bootCol = palette.shoes;
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

  // --- Head ---
  const headParts = buildHeadBase(skinTone, sunburned);
  const coveredByHat =
    archetype === 'defender' ||
    archetype === 'security' ||
    hasProp(props, 'hardHat') ||
    hasProp(props, 'cap') ||
    hasProp(props, 'sunHat');
  if (!coveredByHat) {
    headParts.push(...buildHairGeoms(hairStyle, hairColor));
  } else if (hairStyle === 'long') {
    // Long hair peeks out beneath hats/helmets
    headParts.push(makePartBox(0.25, 0.18, 0.1, 0, 0.07, -0.1, hairColor));
  }

  if (hasProp(props, 'sunglasses')) {
    headParts.push(
      makePartBox(0.22, 0.045, 0.03, 0, 0.185, 0.138, 0x171a20),
      makePartBox(0.08, 0.045, 0.032, 0.055, 0.185, 0.142, 0x1b2c3f),
      makePartBox(0.08, 0.045, 0.032, -0.055, 0.185, 0.142, 0x1b2c3f),
    );
  }

  if (archetype === 'defender') {
    const helmetCol = palette.hat;
    const vestCol = palette.shirtAccent;
    headParts.push(
      makePartSphere(0.175, 0, 0.21, -0.01, helmetCol, 7, 4, 1.02, 0.72, 1.06),
      makePartBox(0.32, 0.045, 0.33, 0, 0.22, -0.01, vestCol),
      makePartBox(0.25, 0.065, 0.05, 0, 0.175, 0.135, 0x18202c), // dark visor
    );
  } else if (archetype === 'security') {
    const navy = palette.hat;
    headParts.push(
      makePartCyl(0.15, 0.145, 0.09, 0, 0.27, -0.01, navy, 8, 1.02, 1.06),
      makePartCyl(0.165, 0.15, 0.04, 0, 0.32, -0.005, navy, 8, 1.04, 1.08),
      makePartBox(0.24, 0.025, 0.13, 0, 0.23, 0.15, 0x141a24), // visor brim
      makePartBox(0.06, 0.06, 0.03, 0, 0.28, 0.148, palette.shirtAccent), // gold cap badge
    );
  } else if (hasProp(props, 'sunHat')) {
    headParts.push(
      makePartCyl(0.11, 0.15, 0.09, 0, 0.28, -0.01, palette.hat, 8),
      makePartCyl(0.26, 0.27, 0.02, 0, 0.235, 0, palette.hat, 8),
      makePartCyl(0.155, 0.155, 0.025, 0, 0.25, -0.01, palette.shirtAccent, 8),
    );
  } else if (hasProp(props, 'hardHat')) {
    headParts.push(
      makePartSphere(0.168, 0, 0.22, -0.01, palette.hat, 7, 4, 1.02, 0.7, 1.05),
      makePartBox(0.05, 0.04, 0.3, 0, 0.3, -0.01, palette.hat),
      makePartBox(0.25, 0.02, 0.12, 0, 0.22, 0.13, palette.hat),
    );
  } else if (hasProp(props, 'cap')) {
    headParts.push(
      makePartSphere(0.158, 0, 0.25, -0.01, palette.hat, 7, 4, 1.0, 0.68, 1.04),
      makePartBox(0.2, 0.022, 0.12, 0, 0.21, 0.145, palette.hat),
    );
  }

  const head = makePartGroup('head', 0, JOINT_HEAD_Y, 0, headParts);

  // --- Torso ---
  const torsoParts: THREE.BufferGeometry[] = [
    makePartCyl(0.2, 0.175, 0.43, 0, 0.02, 0, palette.shirt, 6, 1.06, 0.64),
  ];

  if (archetype === 'defender') {
    const vestCol = palette.shirtAccent;
    torsoParts.push(
      makePartCyl(0.215, 0.195, 0.33, 0, 0.04, 0, vestCol, 6, 1.08, 0.72),
      makePartBox(0.13, 0.12, 0.29, -0.1, -0.02, 0.02, 0x353c45),
      makePartBox(0.13, 0.12, 0.29, 0.1, -0.02, 0.02, 0x353c45),
      makePartBox(0.14, 0.07, 0.28, 0, 0.12, 0.02, 0x2a3038), // chest pocket
    );
  } else if (archetype === 'security') {
    torsoParts.push(
      makePartBox(0.065, 0.26, 0.24, 0, 0.04, 0.015, palette.pants), // tie
      makePartBox(0.11, 0.045, 0.23, -0.14, 0.22, 0, palette.pants), // epaulets
      makePartBox(0.11, 0.045, 0.23, 0.14, 0.22, 0, palette.pants),
      makePartBox(0.065, 0.075, 0.25, -0.1, 0.11, 0.015, palette.shirtAccent), // chest badge
      makePartBox(0.05, 0.1, 0.06, 0.17, 0.18, 0.05, palette.prop), // shoulder radio
      makePartBox(0.015, 0.12, 0.015, 0.18, 0.26, 0.05, 0x111418), // radio antenna
    );
  } else if (archetype === 'tourist') {
    // Hawaiian/floral shirt blotches + collar
    const fCol = palette.shirtAccent;
    torsoParts.push(
      makePartBox(0.16, 0.08, 0.22, 0, 0.2, 0.02, 0xfaf6ee),
      makePartBox(0.08, 0.08, 0.02, 0.09, 0.1, 0.125, fCol, 0, 0, 0.4),
      makePartBox(0.07, 0.07, 0.02, -0.1, 0.02, 0.125, fCol, 0, 0, -0.3),
      makePartBox(0.08, 0.08, 0.02, 0.06, -0.09, 0.12, 0xf7e371, 0, 0, 0.5),
      makePartBox(0.08, 0.08, 0.02, -0.07, 0.09, -0.125, fCol, 0, 0, 0.2),
      makePartBox(0.07, 0.07, 0.02, 0.09, -0.05, -0.12, 0xf7e371, 0, 0, -0.4),
    );
    if (hasProp(props, 'camera')) {
      torsoParts.push(
        makePartBox(0.22, 0.03, 0.24, 0, 0.16, 0.01, 0x22252a),
        makePartBox(0.11, 0.08, 0.06, 0.02, -0.01, 0.145, 0x252830),
        makePartCyl(0.025, 0.025, 0.04, 0.02, -0.01, 0.18, 0x9aa2ad, 6, 1, 1, Math.PI / 2),
      );
    } else if (hasProp(props, 'backpack')) {
      torsoParts.push(
        makePartBox(0.3, 0.34, 0.16, 0, 0.03, -0.17, palette.prop),
        makePartBox(0.24, 0.12, 0.05, 0, -0.05, -0.25, 0x2b303a),
      );
    }
  } else if (archetype === 'worker') {
    // Hi-vis yellow-green tabard + reflective silver stripes
    torsoParts.push(
      makePartCyl(0.21, 0.19, 0.36, 0, 0.02, 0, palette.shirtAccent, 6, 1.07, 0.69),
      makePartBox(0.39, 0.055, 0.27, 0, 0.07, 0, 0xdfe6ea),
      makePartBox(0.38, 0.055, 0.26, 0, -0.08, 0, 0xdfe6ea),
    );
  } else {
    // Resident: tee/tank collar or horizontal stripe
    torsoParts.push(makePartBox(0.18, 0.08, 0.23, 0, 0.19, 0.01, 0xeae6dc));
    if (palette.shirtPattern === 'striped') {
      torsoParts.push(makePartBox(0.39, 0.09, 0.24, 0, 0.02, 0, palette.shirtAccent));
    }
  }

  const torso = makePartGroup('torso', 0, JOINT_TORSO_Y, 0, torsoParts);

  // --- Pelvis ---
  const pelvisParts: THREE.BufferGeometry[] = [
    makePartCyl(0.185, 0.18, 0.18, 0, 0, 0, palette.pants, 6, 1.05, 0.66),
  ];
  if (archetype === 'defender' || archetype === 'security') {
    pelvisParts.push(
      makePartBox(0.4, 0.065, 0.24, 0, 0.05, 0, bootCol),
      makePartBox(0.08, 0.07, 0.05, 0, 0.05, 0.125, 0x8b95a5),
    );
  } else if (hasProp(props, 'toolBelt')) {
    pelvisParts.push(
      makePartBox(0.41, 0.065, 0.25, 0, 0.04, 0, 0x5c422a),
      makePartBox(0.1, 0.1, 0.08, 0.2, -0.01, 0.04, 0x453120),
      makePartBox(0.1, 0.1, 0.08, -0.2, -0.01, 0.04, 0x453120),
    );
  } else if (palette.skirt) {
    pelvisParts.push(makePartCyl(0.185, 0.24, 0.26, 0, -0.1, 0, palette.pants, 6, 1.05, 0.78));
  }

  const pelvis = makePartGroup('pelvis', 0, JOINT_PELVIS_Y, 0, pelvisParts);

  // --- Arms (tapered cylinders + hands + props/weapons) ---
  const sleeveCol =
    archetype === 'tourist' || archetype === 'resident' || archetype === 'worker' || archetype === 'security'
      ? palette.shirt
      : palette.shirt;
  const shoulderSkinCol = sunburned && archetype === 'tourist' ? 0xe58d82 : skinTone;
  const handCol = archetype === 'defender' ? bootCol : skinTone;
  const longSleeve = archetype === 'defender';

  const armLParts: THREE.BufferGeometry[] = [
    makePartBox(0.135, 0.24, 0.135, 0, -0.12, 0, sleeveCol),
    makePartBox(0.11, 0.26, 0.11, 0, -0.37, 0, longSleeve ? sleeveCol : shoulderSkinCol),
    makePartBox(0.12, 0.09, 0.12, 0, -0.53, 0.005, handCol),
  ];
  if (hasProp(props, 'tote')) {
    armLParts.push(
      makePartBox(0.07, 0.24, 0.22, 0.04, -0.66, 0.01, palette.prop),
      makePartBox(0.04, 0.12, 0.04, 0.03, -0.52, 0.01, 0x3b322c),
    );
  } else if (hasProp(props, 'phone')) {
    armLParts.push(makePartBox(0.03, 0.09, 0.055, 0.02, -0.55, 0.05, 0x1d222b));
  }
  const armL = makePartGroup('armL', JOINT_SHOULDER_X, JOINT_SHOULDER_Y, 0, armLParts);

  const armRParts: THREE.BufferGeometry[] = [
    makePartBox(0.135, 0.24, 0.135, 0, -0.12, 0, sleeveCol),
    makePartBox(0.11, 0.26, 0.11, 0, -0.37, 0, longSleeve ? sleeveCol : shoulderSkinCol),
    makePartBox(0.12, 0.09, 0.12, 0, -0.53, 0.005, handCol),
  ];

  if (archetype === 'defender') {
    armRParts.push(
      makePartBox(0.075, 0.7, 0.11, 0.08, -0.62, 0.06, gunSteelCol),
      makePartCyl(0.025, 0.025, 0.34, 0.08, -0.98, 0.06, 0x454d59, 6),
      makePartBox(0.065, 0.12, 0.21, 0.08, -0.56, -0.05, gunSteelCol),
      makePartBox(0.085, 0.13, 0.085, 0.08, -0.72, 0.08, palette.shirtAccent),
    );
  } else if (archetype === 'security') {
    armRParts.push(
      makePartBox(0.055, 0.14, 0.14, 0.02, -0.56, 0.03, gunSteelCol),
      makePartBox(0.055, 0.26, 0.08, 0.02, -0.66, 0.07, gunSteelCol),
    );
  } else {
    appendWeaponParts(armRParts, effectiveWeapon);
  }

  const armR = makePartGroup('armR', -JOINT_SHOULDER_X, JOINT_SHOULDER_Y, 0, armRParts);

  // --- Legs (tapered cylinders + knee pads / shorts / sandals / sneakers / boots) ---
  const shinCol = palette.shorts || palette.skirt ? shoulderSkinCol : palette.pants;
  const footStyle = archetype === 'tourist' ? 'sandal' : archetype === 'resident' ? 'sneaker' : 'boot';

  const makeLegParts = (): THREE.BufferGeometry[] => {
    const parts: THREE.BufferGeometry[] = [
      makePartBox(0.155, 0.34, 0.165, 0, -0.17, 0, palette.pants),
      makePartBox(0.14, 0.28, 0.15, 0, -0.48, 0, shinCol),
      ...buildFootParts(bootCol, skinTone, footStyle),
    ];
    if (archetype === 'defender') {
      parts.push(makePartBox(0.11, 0.1, 0.05, 0, -0.35, 0.065, 0x1c212b)); // knee pad
    }
    return parts;
  };

  const legL = makePartGroup('legL', JOINT_HIP_X, JOINT_HIP_Y, 0, makeLegParts());
  const legR = makePartGroup('legR', -JOINT_HIP_X, JOINT_HIP_Y, 0, makeLegParts());

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
