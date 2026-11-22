/**
 * [3D] Instanced GPU skinning for the horde (VP2-T009, ARCHITECTURE VP2-0).
 *
 * A plain InstancedMesh cannot skin each instance independently, so the horde renders each (body shape x LOD) as a
 * `THREE.Mesh` over an `InstancedBufferGeometry` (NOT an InstancedMesh: no `instanceMatrix` attribute, so the
 * vertex-attribute budget stays <= 16 and VisionFog's non-instanced `modelMatrix * transformed` world position is right).
 *
 * Conventions (shared with HordeRenderer, documented once here):
 *  - `BoneTexture` row = one character; texel `bone * 4 + c` holds column `c` of that bone's SKIN matrix
 *    (`poseToBoneMatrices(pose, shape, IDENTITY) * bindInverses(shape)`), i.e. a CHARACTER-SPACE matrix mapping the
 *    unscaled bind-pose mesh to the posed, scaled body. Root scale/width/rootY/pitch/roll are already inside it.
 *  - Per-instance `aBoneRow` (float) selects the row (stable for the frame; HordeRenderer writes compacted rows and copies
 *    each zombie's cached matrices into its row, so bone-update LOD can skip recomputing while the row stays valid).
 *  - Per-instance `aRoot` (vec4: x, y, z, yaw) places the character in the world AFTER skinning, so a zombie whose
 *    bones are only refreshed every 2nd/4th frame still moves smoothly with the sim. No instanceMatrix is used.
 *  - Shadows: skinned bodies do NOT cast shadow-map shadows (`castShadow = false`; the horde uses cheap blob shadows),
 *    so no skinned depth/distance material is needed. They still receive shadows.
 *  - Chain order for materials: atlas patch -> `applyInstancedSkinning` -> VisionFog / SurfaceDetail (they chain after
 *    via `prevCompile`, and only need `#include <project_vertex>` which this patch leaves in place).
 */
import * as THREE from 'three';
import { HUMANOID_BONE_COUNT } from './characterTypes';

/** Texels per bone (one per matrix column). */
export const BONE_TEXELS = 4;
/** Texture width in texels (21 bones x 4 columns). */
export const BONE_TEX_WIDTH = HUMANOID_BONE_COUNT * BONE_TEXELS;
/** Floats per row (21 bones x 16). */
export const BONE_ROW_FLOATS = HUMANOID_BONE_COUNT * 16;

export class BoneTexture {
  readonly texture: THREE.DataTexture;
  readonly data: Float32Array;
  readonly maxInstances: number;
  /** Rows uploaded by the last markRows (for stats). */
  rowsUsed = 0;

  constructor(maxInstances: number) {
    this.maxInstances = Math.max(1, Math.floor(maxInstances));
    this.data = new Float32Array(BONE_ROW_FLOATS * this.maxInstances);
    // Identity everywhere so an unwritten row skins to the bind pose rather than collapsing to the origin.
    for (let r = 0; r < this.maxInstances; r++) {
      for (let b = 0; b < HUMANOID_BONE_COUNT; b++) {
        const o = r * BONE_ROW_FLOATS + b * 16;
        this.data[o] = this.data[o + 5] = this.data[o + 10] = this.data[o + 15] = 1;
      }
    }
    const tex = new THREE.DataTexture(this.data, BONE_TEX_WIDTH, this.maxInstances, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.needsUpdate = true;
    this.texture = tex;
  }

  /**
   * Flags the texture for upload after `count` rows were written. three r172 has no texture update ranges, so the
   * whole texture (maxInstances x 1.3 KB, ~300 KB for 220) is re-uploaded; only the used rows carry fresh data.
   */
  markRows(count: number): void {
    this.rowsUsed = Math.max(0, Math.min(this.maxInstances, count | 0));
    if (this.rowsUsed > 0) this.texture.needsUpdate = true;
  }

  dispose(): void { this.texture.dispose(); }
}

function replaceOnce(src: string, find: string, replace: string): string {
  if (!src.includes(find)) throw new Error(`InstancedSkinning: shader chunk changed (missing "${find}")`);
  return src.replace(find, replace);
}

const SKIN_PARS = `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute float aBoneRow;
attribute vec4 aRoot;
uniform highp sampler2D uBoneTex;
mat4 zBoneMat( int row, int bone ) {
  int x = bone * ${BONE_TEXELS};
  return mat4( texelFetch( uBoneTex, ivec2( x, row ), 0 ), texelFetch( uBoneTex, ivec2( x + 1, row ), 0 ),
    texelFetch( uBoneTex, ivec2( x + 2, row ), 0 ), texelFetch( uBoneTex, ivec2( x + 3, row ), 0 ) );
}
mat4 zSkinMatrix() {
  int row = int( aBoneRow + 0.5 );
  mat4 m = skinWeight.x * zBoneMat( row, int( skinIndex.x + 0.5 ) );
  if ( skinWeight.y > 0.0 ) m += skinWeight.y * zBoneMat( row, int( skinIndex.y + 0.5 ) );
  if ( skinWeight.z > 0.0 ) m += skinWeight.z * zBoneMat( row, int( skinIndex.z + 0.5 ) );
  if ( skinWeight.w > 0.0 ) m += skinWeight.w * zBoneMat( row, int( skinIndex.w + 0.5 ) );
  return m;
}
vec3 zRootDir( vec3 d ) {
  float c = cos( aRoot.w ), s = sin( aRoot.w );
  return vec3( c * d.x + s * d.z, d.y, -s * d.x + c * d.z );
}`;

/**
 * Chains instanced linear-blend skinning (<= 4 influences) onto `mat` (position AND normal) and binds `bones`.
 * Call after any other onBeforeCompile patch you own, before VisionFog patches the scene.
 */
export function applyInstancedSkinning(mat: THREE.Material, bones: BoneTexture): void {
  const prevCompile = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile.call(mat, shader, renderer);
    shader.uniforms.uBoneTex = { value: bones.texture };
    let v = shader.vertexShader;
    v = replaceOnce(v, '#include <common>', `#include <common>${SKIN_PARS}`);
    v = replaceOnce(v, '#include <beginnormal_vertex>', `#include <beginnormal_vertex>
mat4 zSkin = zSkinMatrix();
objectNormal = normalize( zRootDir( mat3( zSkin ) * objectNormal ) );`);
    v = replaceOnce(v, '#include <begin_vertex>', `#include <begin_vertex>
transformed = zRootDir( ( zSkin * vec4( transformed, 1.0 ) ).xyz ) + aRoot.xyz;`);
    shader.vertexShader = v;
  };
  mat.customProgramCacheKey = () => {
    const base = prevKey ? prevKey.call(mat) : '';
    return base ? `${base}|iskin` : 'iskin';
  };
  mat.needsUpdate = true;
}
