import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALANCE } from '../config/balance';
import type { AnimAction, GuardState, HumanPost, HumanRole, LeaderAttackPhase } from '../core/types';

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

  // Zombies (horde + Alpha) are animated by visuals/zombieAnimation.ts; nothing else reaches here.
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
