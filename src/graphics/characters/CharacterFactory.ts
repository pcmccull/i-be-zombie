/**
 * [3D] Character geometry factory (VP2-T009). Part a: cached skinned body geometry per (shape, LOD).
 * Part b (VP2-T009b): `createAlphaCharacter` = real Bone hierarchy + Skeleton + SkinnedMesh + SkeletonHelper + AnimationMixer.
 *
 * Geometry attributes (all per vertex, character bind space, rig units):
 *   position, normal, uv (metres / BODY_UV_METERS, ready for the atlas), skinIndex (Uint16 x4), skinWeight (x4),
 *   aRegion  float: packed `major + 64 * minor`, each class = `region + 8 * part` (see classOf),
 *   aSel     float: 0 / 1 per vertex; the fragment picks `minor` where the interpolated aSel > 0.5, else `major`.
 * Triangles whose vertices span several classes (shirt|pants hem, sleeve|skin, ...) are copied with their own
 * (major, minor, aSel) so the class boundary is a straight line through the triangle instead of a provoking-vertex
 * sawtooth; uniform triangles keep their shared vertices (aRegion = class, aSel = 0).
 */
import * as THREE from 'three';
import {
  BONE_PARENT, HB, HUMANOID_BONES, HUMANOID_BONE_COUNT, REGION, type BodyShapeId, type ClipName,
} from './characterTypes';
import { BODY_SHAPES, bindInverses, poseToBoneMatrices, type BodyShape } from './humanoidRig';
import { buildBodyMesh, type BodyMeshData } from './bodyMeshMath';
import { CLIPS, applyClipAuthored, type PoseClip } from './characterClips';
import { createPose, type ZombiePose } from '../../visuals/zombieRig';
import { createAlphaBodyMaterial, type AlphaBodyUniforms } from '../../visuals/zombieModel';
import type { ZombieLook } from '../../visuals/zombieProfiles';

/** Atlas UV scale: mesh UVs are metres of surface; zombie atlas tiles repeat every 0.55 m. */
export const BODY_UV_METERS = 0.55;

/** Sub-part codes (class = region + 8 * part): which per-instance rule recolours a vertex. */
export const PART = { none: 0, shinL: 1, shinR: 2, armShirt: 3, armSkin: 4 } as const;

/** Packed shading class of a vertex (region + 8 * part), from its region and dominant bone. */
export function classOf(region: number, dominantBone: number): number {
  let part = 0;
  if (region === REGION.pants) {
    if (dominantBone === HB.lowerLegL) part = PART.shinL;
    else if (dominantBone === HB.lowerLegR) part = PART.shinR;
  } else if (region === REGION.shirt) {
    if (dominantBone === HB.upperArmL || dominantBone === HB.upperArmR) part = PART.armShirt;
  } else if (region === REGION.skin) {
    if (dominantBone === HB.upperArmL || dominantBone === HB.upperArmR
      || dominantBone === HB.forearmL || dominantBone === HB.forearmR) part = PART.armSkin;
  }
  return region + 8 * part;
}

export interface RegionedBody {
  positions: Float32Array; normals: Float32Array; uvs: Float32Array;
  skinIndex: Uint16Array; skinWeight: Float32Array;
  region: Float32Array; sel: Float32Array; index: Uint32Array; vertexCount: number; triangles: number;
}

/** Sides per ring that buildBodyMesh uses (needed to close the UV seam). */
export function bodySides(shape: BodyShapeId, lod: 0 | 1): number {
  return shape === 'alpha' ? (lod === 0 ? 24 : 10) : (lod === 0 ? 12 : 6);
}

/**
 * [pure] Expands raw body-mesh data: per-vertex shading classes, mixed-class triangle copies with a straight class
 * boundary, and UV seam repair (the loft's u wraps from ~circumference back to 0 across one quad column; seam triangles
 * get copies with the small-u vertices shifted by one circumference so the texture doesn't squeeze through them).
 */
export function buildRegionedBody(mesh: BodyMeshData, sides: number): RegionedBody {
  const vCount = mesh.positions.length / 3;
  const cls = new Int32Array(vCount);
  for (let v = 0; v < vCount; v++) cls[v] = classOf(mesh.region[v], mesh.skinIndex[v * 4]);

  const pos: number[] = Array.from(mesh.positions), nor: number[] = Array.from(mesh.normals), uv: number[] = Array.from(mesh.uvs);
  const bi: number[] = Array.from(mesh.skinIndex), bw: number[] = Array.from(mesh.skinWeight);
  const reg: number[] = Array.from(cls), sel: number[] = new Array(vCount).fill(0);
  const index: number[] = [];

  const copyVertex = (v: number, uShift: number, packed: number, s: number): number => {
    const id = pos.length / 3;
    pos.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]);
    nor.push(mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]);
    uv.push(mesh.uvs[v * 2] + uShift, mesh.uvs[v * 2 + 1]);
    bi.push(mesh.skinIndex[v * 4], mesh.skinIndex[v * 4 + 1], mesh.skinIndex[v * 4 + 2], mesh.skinIndex[v * 4 + 3]);
    bw.push(mesh.skinWeight[v * 4], mesh.skinWeight[v * 4 + 1], mesh.skinWeight[v * 4 + 2], mesh.skinWeight[v * 4 + 3]);
    reg.push(packed); sel.push(s);
    return id;
  };

  const tri = [0, 0, 0], shift = [0, 0, 0], selv = [0, 0, 0];
  for (let t = 0; t < mesh.index.length; t += 3) {
    tri[0] = mesh.index[t]; tri[1] = mesh.index[t + 1]; tri[2] = mesh.index[t + 2];
    const c0 = cls[tri[0]], c1 = cls[tri[1]], c2 = cls[tri[2]];
    const mixed = c0 !== c1 || c1 !== c2;

    // UV seam: a vertex whose u trails the triangle's largest u by far more than its 3D distance to that vertex.
    shift[0] = shift[1] = shift[2] = 0;
    let m = 0;
    for (let k = 1; k < 3; k++) if (mesh.uvs[tri[k] * 2] > mesh.uvs[tri[m] * 2]) m = k;
    const um = mesh.uvs[tri[m] * 2];
    let seam = false;
    for (let k = 0; k < 3; k++) {
      if (k === m) continue;
      const a = tri[m] * 3, b = tri[k] * 3;
      const dist = Math.hypot(mesh.positions[a] - mesh.positions[b], mesh.positions[a + 1] - mesh.positions[b + 1],
        mesh.positions[a + 2] - mesh.positions[b + 2]);
      if (um - mesh.uvs[tri[k] * 2] > 2 * dist + 0.01) { shift[k] = um * sides / (sides - 1); seam = true; }
    }

    if (!mixed && !seam) { index.push(tri[0], tri[1], tri[2]); continue; }

    let major = c0, minor = c0;
    selv[0] = selv[1] = selv[2] = 0;
    if (mixed) {
      let a = 0, b = 1, c = 2; // a,b share the majority class when two match
      if (c0 === c1) { a = 0; b = 1; c = 2; } else if (c0 === c2) { a = 0; b = 2; c = 1; } else if (c1 === c2) { a = 1; b = 2; c = 0; }
      major = cls[tri[a]];
      minor = cls[tri[c]];
      selv[a] = selv[b] = 0; selv[c] = 1;
      if (c0 !== c1 && c0 !== c2 && c1 !== c2) { minor = c1; selv[0] = 0; selv[1] = 1; selv[2] = 1; major = c0; }
    }
    const packed = major + 64 * minor;
    index.push(copyVertex(tri[0], shift[0], packed, selv[0]), copyVertex(tri[1], shift[1], packed, selv[1]),
      copyVertex(tri[2], shift[2], packed, selv[2]));
  }

  return {
    positions: new Float32Array(pos), normals: new Float32Array(nor), uvs: new Float32Array(uv),
    skinIndex: new Uint16Array(bi), skinWeight: new Float32Array(bw),
    region: new Float32Array(reg), sel: new Float32Array(sel), index: new Uint32Array(index),
    vertexCount: pos.length / 3, triangles: index.length / 3,
  };
}

const bodyCache = new Map<string, THREE.BufferGeometry>();

/** Cached skinned body geometry for a shape + LOD (see header for attributes). Do not mutate; clone to add instance attributes. */
export function bodyGeometry(shape: BodyShapeId, lod: 0 | 1): THREE.BufferGeometry {
  const key = `${shape}:${lod}`;
  const hit = bodyCache.get(key);
  if (hit) return hit;
  const body = buildRegionedBody(buildBodyMesh(BODY_SHAPES[shape], lod), bodySides(shape, lod));
  const g = new THREE.BufferGeometry();
  const uvs = new Float32Array(body.uvs.length);
  for (let i = 0; i < uvs.length; i++) uvs[i] = body.uvs[i] / BODY_UV_METERS;
  g.setAttribute('position', new THREE.BufferAttribute(body.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(body.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(body.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(body.skinWeight, 4));
  g.setAttribute('aRegion', new THREE.BufferAttribute(body.region, 1));
  g.setAttribute('aSel', new THREE.BufferAttribute(body.sel, 1));
  g.setIndex(new THREE.BufferAttribute(body.index, 1));
  g.name = `Body_${shape}_${lod}`;
  bodyCache.set(key, g);
  return g;
}

/** Frees every cached body geometry (renderer teardown / hot restart). */
export function disposeCharacterCaches(): void {
  for (const g of bodyCache.values()) g.dispose();
  bodyCache.clear();
}

// ---------------------------------------------------------------------------
// Alpha: real skinned character (VP2-T009b, ARCHITECTURE VP2-0 "Alpha rig")
// ---------------------------------------------------------------------------

export type AlphaCosmeticSlot = 'hat' | 'glasses' | 'back' | 'hand';

export interface AlphaCharacter {
  /** Group holding the root bone + the SkinnedMesh. Position/orient it (or a parent) in the world; scale lives in the root bone. */
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  /** Hidden by default. Add it to a parent at the world origin (it follows `root` itself), e.g. the entity root group. */
  helper: THREE.SkeletonHelper;
  mixer: THREE.AnimationMixer;
  material: THREE.MeshStandardMaterial;
  uniforms: AlphaBodyUniforms;
  /** Empty cosmetic anchors parented to head (hat, glasses), chest (back) and handR (hand). */
  slots: Record<AlphaCosmeticSlot, THREE.Object3D>;
  /** Procedural pose -> real bones, then each bone is layered toward the active clip by the action weight. Call after `update`. */
  setPose(pose: ZombiePose, root: THREE.Matrix4): void;
  /** Crossfades an authored clip in (loop clips repeat `repeats` times, default forever; one-shots play once). */
  play(clip: ClipName, repeats?: number): void;
  /** Fades the active clip out. */
  stop(): void;
  /** True while a clip has weight. */
  isClipActive(): boolean;
  /** Advances the clip mixer (hidden clip skeleton). */
  update(dt: number): void;
  setSkeletonHelperVisible(on: boolean): void;
  dispose(): void;
}

const CLIP_SAMPLE_HZ = 30;
const CLIP_FADE = 0.14;
const IDENTITY = new THREE.Matrix4();

const _mp = new THREE.Matrix4();
const _mc = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();

/** World matrices (poseToBoneMatrices layout) -> per-bone local translation / rotation / scale. */
function worldToLocals(mats: Float32Array, pos: Float32Array, quat: Float32Array, scl: Float32Array): void {
  for (let i = 0; i < HUMANOID_BONE_COUNT; i++) {
    _mc.fromArray(mats, i * 16);
    const parent = BONE_PARENT[i];
    if (parent >= 0) _mc.premultiply(_mp.fromArray(mats, parent * 16).invert());
    _mc.decompose(_v, _qa, _s);
    pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z;
    quat[i * 4] = _qa.x; quat[i * 4 + 1] = _qa.y; quat[i * 4 + 2] = _qa.z; quat[i * 4 + 3] = _qa.w;
    scl[i * 3] = _s.x; scl[i * 3 + 1] = _s.y; scl[i * 3 + 2] = _s.z;
  }
}

interface BuiltClip { clip: THREE.AnimationClip; def: PoseClip; tracked: boolean[] }

/**
 * Builds the THREE.AnimationClip of an authored pose clip: the clip is sampled at 30 Hz onto the neutral pose, run through
 * the same pose -> bone FK as the live rig, and each bone that ever moves gets a QuaternionKeyframeTrack (the hips also
 * a position track for the celebrate hop). Bone names double as track node names on the hidden clip skeleton.
 */
function buildAnimationClip(def: PoseClip, shape: BodyShape, restQuat: Float32Array, restPos: Float32Array): BuiltClip {
  const n = Math.max(2, Math.ceil(def.duration * CLIP_SAMPLE_HZ) + 1);
  const times = new Float32Array(n);
  const quats = HUMANOID_BONES.map(() => new Float32Array(n * 4));
  const hips = new Float32Array(n * 3);
  const mats = new Float32Array(HUMANOID_BONE_COUNT * 16);
  const pos = new Float32Array(HUMANOID_BONE_COUNT * 3), quat = new Float32Array(HUMANOID_BONE_COUNT * 4);
  const scl = new Float32Array(HUMANOID_BONE_COUNT * 3);
  const pose = createPose(), neutral = createPose();
  const ident = IDENTITY.elements;
  for (let k = 0; k < n; k++) {
    const t = Math.min(def.duration, (k / (n - 1)) * def.duration);
    times[k] = t;
    Object.assign(pose, neutral);
    // A loop clip's final sample is the wrap point: sample its start so the last key equals the first.
    applyClipAuthored(pose, def, def.loop && k === n - 1 ? 0 : t, 1, 0);
    poseToBoneMatrices(pose, shape, ident, mats);
    worldToLocals(mats, pos, quat, scl);
    const o = k * 4;
    for (let i = 0; i < HUMANOID_BONE_COUNT; i++) {
      let x = quat[i * 4], y = quat[i * 4 + 1], z = quat[i * 4 + 2], w = quat[i * 4 + 3];
      if (k > 0) {
        const pq = quats[i];
        // keep the shortest-arc hemisphere continuous with the previous key
        if (pq[o - 4] * x + pq[o - 3] * y + pq[o - 2] * z + pq[o - 1] * w < 0) { x = -x; y = -y; z = -z; w = -w; }
      }
      quats[i][o] = x; quats[i][o + 1] = y; quats[i][o + 2] = z; quats[i][o + 3] = w;
    }
    hips[k * 3] = pos[HB.hips * 3]; hips[k * 3 + 1] = pos[HB.hips * 3 + 1]; hips[k * 3 + 2] = pos[HB.hips * 3 + 2];
  }
  const tracks: THREE.KeyframeTrack[] = [];
  const tracked = HUMANOID_BONES.map(() => false);
  for (let i = 0; i < HUMANOID_BONE_COUNT; i++) {
    let moves = false;
    for (let k = 0; k < n && !moves; k++) {
      let d = 0, dn = 0;
      for (let c = 0; c < 4; c++) {
        d += Math.abs(quats[i][k * 4 + c] - restQuat[i * 4 + c]);
        dn += Math.abs(quats[i][k * 4 + c] + restQuat[i * 4 + c]);
      }
      if (Math.min(d, dn) > 1e-5) moves = true;
    }
    if (!moves) continue;
    tracked[i] = true;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${HUMANOID_BONES[i]}.quaternion`, Array.from(times), Array.from(quats[i])));
  }
  let hipMoves = false;
  for (let k = 0; k < n; k++) {
    if (Math.abs(hips[k * 3] - restPos[HB.hips * 3]) + Math.abs(hips[k * 3 + 1] - restPos[HB.hips * 3 + 1])
      + Math.abs(hips[k * 3 + 2] - restPos[HB.hips * 3 + 2]) > 1e-5) { hipMoves = true; break; }
  }
  if (hipMoves) tracks.push(new THREE.VectorKeyframeTrack('hips.position', Array.from(times), Array.from(hips)));
  const clip = new THREE.AnimationClip(`alpha_${def.name}`, def.duration, tracks);
  return { clip, def, tracked };
}

/** Cosmetic slot anchors, in rig units, tuned to the alpha body (head top ~0.5, eyes y 0.31 / z 0.18). */
const SLOT_OFFSETS: Record<AlphaCosmeticSlot, { bone: number; x: number; y: number; z: number }> = {
  hat: { bone: HB.head, x: 0, y: 0.4, z: -0.005 },
  glasses: { bone: HB.head, x: 0, y: 0.31, z: 0.185 },
  back: { bone: HB.chest, x: 0, y: 0.3, z: -0.2 },
  hand: { bone: HB.handR, x: 0, y: -0.2, z: 0.05 },
};

/**
 * Creates the Alpha: 21 real THREE.Bones (rest offsets from the alpha body shape), a Skeleton bound with
 * `bindInverses`, a SkinnedMesh over `bodyGeometry('alpha', 0)` with the horde-body atlas material (uniform look,
 * mismatched glowing eyes, LEADER_GLOW baseline), a hidden SkeletonHelper, and an AnimationMixer that drives a hidden
 * clone of the bones with AnimationClips built from `characterClips.CLIPS`. The existing IK controller keeps owning
 * locomotion: `setPose` writes the procedural pose, then layers clips (additive clips add their bone delta, absolute
 * clips slerp toward the clip) by the action weight.
 */
export function createAlphaCharacter(look: ZombieLook): AlphaCharacter {
  const shape = BODY_SHAPES.alpha;
  const root = new THREE.Group();
  root.name = 'AlphaCharacter';
  root.userData.noVisionHaze = true;

  // Rest locals from the neutral pose (root carries scale * width).
  const mats = new Float32Array(HUMANOID_BONE_COUNT * 16);
  const restPos = new Float32Array(HUMANOID_BONE_COUNT * 3), restQuat = new Float32Array(HUMANOID_BONE_COUNT * 4);
  const restScl = new Float32Array(HUMANOID_BONE_COUNT * 3);
  poseToBoneMatrices(createPose(), shape, IDENTITY.elements, mats);
  worldToLocals(mats, restPos, restQuat, restScl);

  const makeBones = (): THREE.Bone[] => {
    const bs: THREE.Bone[] = [];
    for (let i = 0; i < HUMANOID_BONE_COUNT; i++) {
      const b = new THREE.Bone();
      b.name = HUMANOID_BONES[i];
      b.position.fromArray(restPos, i * 3);
      b.quaternion.fromArray(restQuat, i * 4);
      b.scale.fromArray(restScl, i * 3);
      bs.push(b);
      if (BONE_PARENT[i] >= 0) bs[BONE_PARENT[i]].add(b);
    }
    return bs;
  };

  const bones = makeBones();
  root.add(bones[0]);
  const inverses: THREE.Matrix4[] = [];
  const inv = bindInverses(shape);
  for (let i = 0; i < HUMANOID_BONE_COUNT; i++) inverses.push(new THREE.Matrix4().fromArray(inv, i * 16));
  const skeleton = new THREE.Skeleton(bones, inverses);

  const { material, uniforms } = createAlphaBodyMaterial(look);
  const mesh = new THREE.SkinnedMesh(bodyGeometry('alpha', 0), material);
  mesh.name = 'AlphaBody';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  root.add(mesh);
  mesh.bind(skeleton, new THREE.Matrix4());
  root.updateMatrixWorld(true);

  const helper = new THREE.SkeletonHelper(root);
  helper.visible = false;
  helper.name = 'AlphaSkeletonHelper';
  root.userData.skeletonHelper = helper;

  const slots = {} as Record<AlphaCosmeticSlot, THREE.Object3D>;
  for (const name of ['hat', 'glasses', 'back', 'hand'] as const) {
    const o = SLOT_OFFSETS[name];
    const anchor = new THREE.Object3D();
    anchor.name = `AlphaSlot_${name}`;
    anchor.position.set(o.x, o.y, o.z);
    bones[o.bone].add(anchor);
    slots[name] = anchor;
  }

  // Hidden clip skeleton (never in a scene): the mixer animates it, setPose reads it.
  const clipRoot = new THREE.Group();
  clipRoot.name = 'AlphaClipSkeleton';
  const clipBones = makeBones();
  clipRoot.add(clipBones[0]);
  const mixer = new THREE.AnimationMixer(clipRoot);
  const built = new Map<ClipName, BuiltClip>();
  const actions = new Map<ClipName, THREE.AnimationAction>();
  let current: ClipName | null = null;

  const ensure = (name: ClipName): { b: BuiltClip; a: THREE.AnimationAction } => {
    let b = built.get(name);
    if (!b) { b = buildAnimationClip(CLIPS[name], shape, restQuat, restPos); built.set(name, b); }
    let a = actions.get(name);
    if (!a) { a = mixer.clipAction(b.clip); actions.set(name, a); }
    return { b, a };
  };

  const invRest: THREE.Quaternion[] = [];
  for (let i = 0; i < HUMANOID_BONE_COUNT; i++) invRest.push(new THREE.Quaternion().fromArray(restQuat, i * 4).invert());

  const mats2 = new Float32Array(HUMANOID_BONE_COUNT * 16);
  const pPos = new Float32Array(HUMANOID_BONE_COUNT * 3), pQuat = new Float32Array(HUMANOID_BONE_COUNT * 4);
  const pScl = new Float32Array(HUMANOID_BONE_COUNT * 3);

  const clipWeight = (): number => {
    let w = 0;
    for (const a of actions.values()) if (a.isRunning()) w += a.getEffectiveWeight();
    return Math.min(1, w);
  };

  return {
    root, mesh, skeleton, helper, mixer, material, uniforms, slots,
    setPose(pose: ZombiePose, rootMatrix: THREE.Matrix4): void {
      poseToBoneMatrices(pose, shape, rootMatrix.elements, mats2);
      worldToLocals(mats2, pPos, pQuat, pScl);
      const w = current ? clipWeight() : 0;
      const cur = current ? built.get(current) : undefined;
      if (cur && w > 1e-3) {
        const additive = cur.def.additive;
        if (additive || w > 0.02) {
          for (let i = 0; i < HUMANOID_BONE_COUNT; i++) {
            if (!cur.tracked[i]) continue;
            _qa.fromArray(pQuat, i * 4);
            const cq = clipBones[i].quaternion;
            if (additive) {
              _qb.copy(invRest[i]).multiply(cq); // local delta from rest, already weight-scaled by the mixer
              _qa.multiply(_qb);
            } else {
              _qb.fromArray(restQuat, i * 4).slerp(cq, 1 / w); // un-blend the mixer's rest mix -> pure clip rotation
              _qc.copy(_qa).slerp(_qb, w);
              _qa.copy(_qc);
            }
            pQuat[i * 4] = _qa.x; pQuat[i * 4 + 1] = _qa.y; pQuat[i * 4 + 2] = _qa.z; pQuat[i * 4 + 3] = _qa.w;
          }
          const hp = clipBones[HB.hips].position, h = HB.hips * 3;
          for (let c = 0; c < 3; c++) {
            const d = (c === 0 ? hp.x : c === 1 ? hp.y : hp.z) - restPos[h + c];
            pPos[h + c] = additive ? pPos[h + c] + d : pPos[h + c] * (1 - w) + restPos[h + c] * w + d;
          }
        }
      }
      for (let i = 0; i < HUMANOID_BONE_COUNT; i++) {
        const b = bones[i];
        b.position.fromArray(pPos, i * 3);
        b.quaternion.fromArray(pQuat, i * 4);
        b.scale.fromArray(pScl, i * 3);
      }
    },
    play(name: ClipName, repeats?: number): void {
      const { b, a } = ensure(name);
      const prev = current ? actions.get(current) : undefined;
      a.reset();
      const n = repeats ?? (b.def.loop ? Infinity : 1);
      a.setLoop(n === 1 ? THREE.LoopOnce : THREE.LoopRepeat, n);
      a.clampWhenFinished = false;
      a.fadeIn(CLIP_FADE).play();
      if (prev && prev !== a) prev.fadeOut(CLIP_FADE);
      current = name;
    },
    stop(): void {
      const a = current ? actions.get(current) : undefined;
      if (a) a.fadeOut(CLIP_FADE);
    },
    isClipActive(): boolean { return current !== null && clipWeight() > 1e-3; },
    update(dt: number): void { if (current) mixer.update(dt); },
    setSkeletonHelperVisible(on: boolean): void { helper.visible = on; },
    dispose(): void {
      mixer.stopAllAction();
      mixer.uncacheRoot(clipRoot);
      helper.removeFromParent();
      helper.dispose();
      skeleton.dispose();
      material.dispose();
      root.removeFromParent();
    },
  };
}
