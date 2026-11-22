/**
 * [3D] VP2-T011: instanced GPU-skinned humans (civilians, defenders, police) on the shared 21-bone skeleton.
 *
 * One `THREE.Mesh` over an `InstancedBufferGeometry` per (build x LOD) = 8 body draws (+ 1 blob-shadow draw) for every
 * human on screen. Gear (hair, hats, vests, weapons, props) is part of each geometry; a per-instance mask collapses the
 * pieces a human does not wear in the vertex shader, so hats / vests / weapons cost no extra draw calls. Skinning uses the
 * same `BoneTexture` + `applyInstancedSkinning` conventions as the horde (InstancedSkinning.ts). Humans do not cast
 * shadow-map shadows (no skinned depth material); near ones get an instanced blob shadow instead.
 *
 * Per-instance attributes: aBoneRow, aRoot (x, y, z, yaw), aColA/B/C (packed 0xRRGGBB hex floats per colour slot),
 * aGear (gear mask lo, hi, weapon code), aFx (HUMAN_FX code: hit / hover / target flash, or 4 = flat silhouette).
 * Chain order for materials: this patch -> applyInstancedSkinning -> VisionFog / SurfaceDetail (they chain after).
 */
import * as THREE from 'three';
import { HUMANOID_BONE_COUNT } from './characterTypes';
import { BODY_SHAPES, bindInverses, poseToBoneMatrices, type BodyShape } from './humanoidRig';
import { BONE_ROW_FLOATS, BoneTexture, applyInstancedSkinning } from './InstancedSkinning';
import {
  HUMAN_BUILDS, HUMAN_FIXED_COLORS, HUMAN_SILHOUETTE_COLOR, buildHumanBody, type HumanLod, type HumanLook,
} from './humanBodyMath';
import { BUILD_DIMS } from '../../visuals/humanProfiles';
import type { ZombiePose } from '../../visuals/zombieRig';
import { asGroundDecal, DECAL_Y } from '../../world/groundLevels';

const IDENTITY16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function lin(hex: number): string {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
}

/** Flat-shaded standard material whose colours / gear visibility come from per-instance attributes. */
export function createHumanMaterial(bones: BoneTexture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.75, metalness: 0 });
  mat.name = 'HumanBodyMaterial';
  const fixed = HUMAN_FIXED_COLORS.map(lin).join(',\n  ');
  const flash = [new THREE.Color(0x999999), new THREE.Color(0x55280c), new THREE.Color(0x3a1208)]
    .map((c) => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aMeta;
attribute vec4 aColA;
attribute vec4 aColB;
attribute vec4 aColC;
attribute vec3 aGear;
attribute float aFx;
varying vec3 vZCol;
varying float vZFx;
bool zHide;
const vec3 Z_FIXED[${HUMAN_FIXED_COLORS.length}] = vec3[${HUMAN_FIXED_COLORS.length}](
  ${fixed}
);
vec3 zHex( float h ) {
  float r = floor( h / 65536.0 );
  float g = floor( ( h - r * 65536.0 ) / 256.0 );
  float b = h - r * 65536.0 - g * 256.0;
  vec3 c = vec3( r, g, b ) / 255.0;
  return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
}
vec3 zRegion( int r ) {
  if ( r >= 12 ) return Z_FIXED[ r - 12 ];
  float h = 0.0;
  if ( r == 0 ) h = aColA.x; else if ( r == 1 ) h = aColA.y; else if ( r == 2 ) h = aColA.z; else if ( r == 3 ) h = aColA.w;
  else if ( r == 4 ) h = aColB.x; else if ( r == 5 ) h = aColB.y; else if ( r == 6 ) h = aColB.z; else if ( r == 7 ) h = aColB.w;
  else if ( r == 8 ) h = aColC.x; else if ( r == 9 ) h = aColC.y; else if ( r == 10 ) h = aColC.z; else h = aColC.w;
  return zHex( h );
}
bool zVisible( float piece, float weapon ) {
  if ( weapon > 0.5 ) return abs( aGear.z - weapon ) < 0.5;
  if ( piece < 0.5 ) return true;
  if ( piece < 24.5 ) return mod( floor( aGear.x / exp2( piece - 1.0 ) ), 2.0 ) > 0.5;
  return mod( floor( aGear.y / exp2( piece - 25.0 ) ), 2.0 ) > 0.5;
}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
zHide = !zVisible( aMeta.y, aMeta.z );
vec3 zc = zRegion( int( aMeta.x + 0.5 ) );
if ( aFx > 3.5 ) zc = ${lin(HUMAN_SILHOUETTE_COLOR)};
vZCol = zc;
vZFx = aFx;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
if ( zHide ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vZCol;
varying float vZFx;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = vZCol;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if ( vZFx > 0.5 && vZFx < 3.5 ) totalEmissiveRadiance += vZFx < 1.5 ? ${flash[0]} : vZFx < 2.5 ? ${flash[1]} : ${flash[2]};`);
  };
  applyInstancedSkinning(mat, bones);
  return mat;
}

function touch(a: THREE.InstancedBufferAttribute, n: number): void {
  a.clearUpdateRanges();
  a.addUpdateRange(0, n * a.itemSize);
  a.needsUpdate = true;
}

function mul4(a: Float32Array, ao: number, b: Float32Array, bo: number, out: Float32Array, oo: number): void {
  for (let c = 0; c < 4; c++) {
    const b0 = b[bo + c * 4], b1 = b[bo + c * 4 + 1], b2 = b[bo + c * 4 + 2], b3 = b[bo + c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      out[oo + c * 4 + r] = a[ao + r] * b0 + a[ao + 4 + r] * b1 + a[ao + 8 + r] * b2 + a[ao + 12 + r] * b3;
    }
  }
}

interface BodyDraw {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  row: THREE.InstancedBufferAttribute;
  root: THREE.InstancedBufferAttribute;
  colA: THREE.InstancedBufferAttribute;
  colB: THREE.InstancedBufferAttribute;
  colC: THREE.InstancedBufferAttribute;
  gear: THREE.InstancedBufferAttribute;
  fx: THREE.InstancedBufferAttribute;
  count: number;
}

export class HumanRenderer {
  readonly group = new THREE.Group();
  /** Draw calls issued last frame (visible body draws + the blob-shadow draw). */
  drawCalls = 0;
  /** Humans drawn last frame, and how many were dropped for lack of bone rows. */
  drawn = 0;
  overflow = 0;
  readonly bodyLodCounts: [number, number] = [0, 0];

  private readonly capacity: number;
  private readonly boneTex: BoneTexture;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly bodies: BodyDraw[] = [];
  private readonly shapes: BodyShape[] = [];
  private readonly bindInv: Float32Array;
  private readonly world = new Float32Array(BONE_ROW_FLOATS);
  private readonly shadowMesh: THREE.InstancedMesh;
  private readonly shadowGeo: THREE.BufferGeometry;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly m4 = new THREE.Matrix4();
  private rows = 0;
  private shadows = 0;

  constructor(capacity = 384) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.group.name = 'HumanRenderer';
    this.boneTex = new BoneTexture(this.capacity);
    this.material = createHumanMaterial(this.boneTex);
    this.bindInv = bindInverses(BODY_SHAPES.average);
    for (const build of HUMAN_BUILDS) {
      this.shapes.push({ ...BODY_SHAPES.average, scale: BUILD_DIMS[build].scaleY, width: 1 });
      for (const lod of [0, 1] as const) this.bodies.push(this.createBody(build, lod));
    }
    this.shadowGeo = new THREE.CircleGeometry(0.4, 10);
    this.shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x12161c, transparent: true, opacity: 0.4, depthWrite: false });
    asGroundDecal(this.shadowMat);
    this.shadowMesh = new THREE.InstancedMesh(this.shadowGeo, this.shadowMat, this.capacity);
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.count = 0;
    this.shadowMesh.name = 'HumanBlobShadows';
    this.group.add(this.shadowMesh);
  }

  private createBody(build: (typeof HUMAN_BUILDS)[number], lod: HumanLod): BodyDraw {
    const data = buildHumanBody(build, lod);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(new THREE.BufferAttribute(data.index, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(data.skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(data.skinWeight, 4));
    geo.setAttribute('aMeta', new THREE.BufferAttribute(data.meta, 3));
    const inst = (size: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    const row = inst(1), root = inst(4), colA = inst(4), colB = inst(4), colC = inst(4), gear = inst(3), fx = inst(1);
    geo.setAttribute('aBoneRow', row);
    geo.setAttribute('aRoot', root);
    geo.setAttribute('aColA', colA);
    geo.setAttribute('aColB', colB);
    geo.setAttribute('aColC', colC);
    geo.setAttribute('aGear', gear);
    geo.setAttribute('aFx', fx);
    geo.instanceCount = 0;
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.name = `HumanBody_${build}_${lod}`;
    this.group.add(mesh);
    return { mesh, geo, row, root, colA, colB, colC, gear, fx, count: 0 };
  }

  /** Call once per frame before add(). */
  beginFrame(): void {
    for (const b of this.bodies) b.count = 0;
    this.rows = 0;
    this.shadows = 0;
    this.overflow = 0;
    this.bodyLodCounts[0] = this.bodyLodCounts[1] = 0;
  }

  /**
   * Queues one human. `pose` is the already-mapped ZombiePose; (x, y, z, facing) is the interpolated sim root; `fx` is a
   * HUMAN_FX code. Returns false when out of bone rows (the human is simply not drawn that frame).
   */
  add(look: HumanLook, pose: ZombiePose, x: number, y: number, z: number, facing: number, lod: HumanLod, fx: number,
    shadow: boolean): boolean {
    if (this.rows >= this.capacity) { this.overflow++; return false; }
    const b = this.bodies[look.buildIndex * 2 + lod];
    poseToBoneMatrices(pose, this.shapes[look.buildIndex], IDENTITY16, this.world, 0);
    const row = this.rows++;
    const off = row * BONE_ROW_FLOATS;
    for (let i = 0; i < HUMANOID_BONE_COUNT; i++) mul4(this.world, i * 16, this.bindInv, i * 16, this.boneTex.data, off + i * 16);
    const i = b.count++;
    const c = look.colors;
    b.row.setX(i, row);
    b.root.setXYZW(i, x, y, z, facing);
    b.colA.setXYZW(i, c[0], c[1], c[2], c[3]);
    b.colB.setXYZW(i, c[4], c[5], c[6], c[7]);
    b.colC.setXYZW(i, c[8], c[9], c[10], c[11]);
    b.gear.setXYZ(i, look.gearLo, look.gearHi, look.weapon);
    b.fx.setX(i, fx);
    this.bodyLodCounts[lod]++;
    if (shadow) {
      const s = BUILD_DIMS[look.build].scaleXZ;
      this.m4.makeScale(s, 1, s);
      this.m4.setPosition(x, DECAL_Y, z);
      this.shadowMesh.setMatrixAt(this.shadows++, this.m4);
    }
    return true;
  }

  /** Uploads the frame. Call once after the last add(). */
  endFrame(): void {
    let draws = 0;
    for (const b of this.bodies) {
      const n = b.count;
      b.geo.instanceCount = n;
      b.mesh.visible = n > 0;
      if (n === 0) continue;
      draws++;
      touch(b.row, n); touch(b.root, n); touch(b.colA, n); touch(b.colB, n); touch(b.colC, n); touch(b.gear, n); touch(b.fx, n);
    }
    this.boneTex.markRows(this.rows);
    this.shadowMesh.count = this.shadows;
    this.shadowMesh.visible = this.shadows > 0;
    this.shadowMesh.instanceMatrix.needsUpdate = this.shadows > 0;
    this.drawn = this.rows;
    this.drawCalls = draws + (this.shadows > 0 ? 1 : 0);
  }

  dispose(): void {
    for (const b of this.bodies) b.geo.dispose();
    this.material.dispose();
    this.boneTex.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.shadowMesh.dispose();
    this.group.clear();
    this.bodies.length = 0;
  }
}
