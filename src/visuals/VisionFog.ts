import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { GameState, VisionTier } from '../core/types';
import { VISION_EDGE_BAND, lerpProfile, tierBlend, type VisionHazeProfile } from '../core/visionMath';
import { visionProfile } from '../systems/AwarenessSystem';

export type VisionFogQuality = 'low' | 'high';

export interface VisionFogUniforms {
  uVisionCenter: { value: THREE.Vector2 };
  uClearRadius: { value: number };
  uHazeRadius: { value: number };
  uHazeStrength: { value: number };
  uHazeColor: { value: THREE.Color };
  uDesaturate: { value: number };
  /** 1 = everything past hazeRadius (+ edge band) is fully haze-coloured (hidden); 0 = off (intro cinematic). */
  uHideBeyond: { value: number };
}

interface PatchedMaterialRecord {
  mat: THREE.Material;
  prevCompile: THREE.Material['onBeforeCompile'];
  prevKey: THREE.Material['customProgramCacheKey'];
}

const HIGH_DESATURATE = 0.75;

/**
 * [3D] World-space vision haze centered on the interpolated Alpha position.
 * Patches scene materials once via onBeforeCompile using one shared uniforms object,
 * working alongside existing camera-distance scene.fog.
 */
export class VisionFog {
  readonly uniforms: VisionFogUniforms;

  private readonly patched = new WeakSet<THREE.Material>();
  // Keyed by material and dropped when the material is disposed (streamed-out chunks), so nothing is retained.
  private readonly records = new Map<THREE.Material, PatchedMaterialRecord>();
  private disposed = false;

  private currentTier: VisionTier | null = null;
  private blendElapsed: number = BALANCE.vision.tierBlendTime;
  private readonly fromProfile: VisionHazeProfile;
  private readonly targetProfile: VisionHazeProfile;
  private readonly activeProfile: VisionHazeProfile;

  constructor(quality: VisionFogQuality = 'high') {
    const t1 = BALANCE.vision.tiers[0];
    this.fromProfile = { clearRadius: t1.clearRadius, hazeRadius: t1.hazeRadius, hazeStrength: t1.hazeStrength };
    this.targetProfile = { clearRadius: t1.clearRadius, hazeRadius: t1.hazeRadius, hazeStrength: t1.hazeStrength };
    this.activeProfile = { clearRadius: t1.clearRadius, hazeRadius: t1.hazeRadius, hazeStrength: t1.hazeStrength };

    this.uniforms = {
      uVisionCenter: { value: new THREE.Vector2(0, 0) },
      uClearRadius: { value: t1.clearRadius },
      uHazeRadius: { value: t1.hazeRadius },
      uHazeStrength: { value: t1.hazeStrength },
      // The haze is mixed in AFTER <colorspace_fragment> (it runs at <fog_fragment>), so the uniform must hold
      // output-space (sRGB) components, exactly like the sky/background it has to match. A plain
      // `new Color(hex)` is converted to linear and renders visibly darker than the sky (silhouettes).
      uHazeColor: { value: new THREE.Color().setHex(BALANCE.vision.hazeColor, THREE.LinearSRGBColorSpace) },
      uDesaturate: { value: quality === 'high' ? HIGH_DESATURATE : 0 },
      uHideBeyond: { value: 1 },
    };
  }

  /**
   * Traverses `root` and patches each eligible material once.
   * Skips subtrees with `userData.noVisionHaze` and materials with `fog === false`.
   * Safe to call again when new chunks or entities are added.
   */
  patchScene(root: THREE.Object3D): void {
    if (this.disposed) return;
    this.visit(root);
  }

  /**
   * Updates the haze center from the interpolated leader position and eases radii/strength
   * across tier changes (or drops to tier-1 radii while dead/respawning).
   */
  update(state: GameState, alpha: number, dt: number): void {
    if (this.disposed) return;

    const lx = state.leader.prevPos.x + (state.leader.pos.x - state.leader.prevPos.x) * alpha;
    const lz = state.leader.prevPos.z + (state.leader.pos.z - state.leader.prevPos.z) * alpha;
    this.uniforms.uVisionCenter.value.set(lx, lz);

    const deadOrRespawning = !state.leader.alive || state.phase === 'respawning';
    const desiredTier: VisionTier = deadOrRespawning ? 1 : state.vision.tier;

    if (this.currentTier === null) {
      const p = visionProfile(desiredTier);
      this.copyProfile(p, this.fromProfile);
      this.copyProfile(p, this.targetProfile);
      this.copyProfile(p, this.activeProfile);
      this.currentTier = desiredTier;
      this.blendElapsed = BALANCE.vision.tierBlendTime;
    } else if (desiredTier !== this.currentTier) {
      this.copyProfile(this.activeProfile, this.fromProfile);
      const p = visionProfile(desiredTier);
      this.copyProfile(p, this.targetProfile);
      this.currentTier = desiredTier;
      this.blendElapsed = 0;
    }

    const blendTime = BALANCE.vision.tierBlendTime;
    this.blendElapsed = blendTime > 0 ? Math.min(blendTime, this.blendElapsed + Math.max(0, dt)) : 0;
    const t = tierBlend(this.blendElapsed, blendTime);
    lerpProfile(this.fromProfile, this.targetProfile, t, this.activeProfile);

    this.uniforms.uClearRadius.value = this.activeProfile.clearRadius;
    this.uniforms.uHazeRadius.value = this.activeProfile.hazeRadius;
    this.uniforms.uHazeStrength.value = this.activeProfile.hazeStrength;
    this.uniforms.uHideBeyond.value = 1;
  }

  /** Haze off entirely (intro cinematic). Call after update() each frame it applies to. */
  suspend(): void {
    this.uniforms.uHazeStrength.value = 0;
    this.uniforms.uHideBeyond.value = 0;
  }

  /** Distance from the haze centre past which nothing is visible (0 while suspended). */
  get hiddenBeyond(): number {
    return this.uniforms.uHideBeyond.value > 0 ? this.uniforms.uHazeRadius.value * (1 + VISION_EDGE_BAND) : Infinity;
  }

  /** 'low' = haze only; 'high' = haze + distance desaturation. */
  setQuality(q: VisionFogQuality): void {
    this.uniforms.uDesaturate.value = q === 'high' ? HIGH_DESATURATE : 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const rec of this.records.values()) {
      rec.mat.removeEventListener('dispose', this.onMaterialDispose);
      rec.mat.onBeforeCompile = rec.prevCompile;
      rec.mat.customProgramCacheKey = rec.prevKey;
      rec.mat.needsUpdate = true;
    }
    this.records.clear();
  }

  private readonly onMaterialDispose = (event: { target: THREE.Material }): void => {
    const mat = event.target;
    mat.removeEventListener('dispose', this.onMaterialDispose);
    this.records.delete(mat);
  };

  private visit(obj: THREE.Object3D): void {
    if (obj.userData && obj.userData.noVisionHaze) return;
    if (obj instanceof THREE.Mesh) {
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (let i = 0; i < mat.length; i++) this.patchMaterial(mat[i]);
      } else if (mat) {
        this.patchMaterial(mat);
      }
    }
    const children = obj.children;
    for (let i = 0; i < children.length; i++) {
      this.visit(children[i]);
    }
  }

  private patchMaterial(mat: THREE.Material): void {
    if ((mat as { fog?: boolean }).fog === false || this.patched.has(mat)) return;
    this.patched.add(mat);

    const prevCompile = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    this.records.set(mat, { mat, prevCompile, prevKey });
    mat.addEventListener('dispose', this.onMaterialDispose);

    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader, renderer) => {
      if (prevCompile) prevCompile.call(mat, shader, renderer);
      if (
        !shader.vertexShader.includes('#include <project_vertex>') ||
        !shader.fragmentShader.includes('#include <fog_fragment>')
      ) {
        return;
      }

      shader.uniforms.uVisionCenter = uniforms.uVisionCenter;
      shader.uniforms.uClearRadius = uniforms.uClearRadius;
      shader.uniforms.uHazeRadius = uniforms.uHazeRadius;
      shader.uniforms.uHazeStrength = uniforms.uHazeStrength;
      shader.uniforms.uHazeColor = uniforms.uHazeColor;
      shader.uniforms.uDesaturate = uniforms.uDesaturate;
      shader.uniforms.uHideBeyond = uniforms.uHideBeyond;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWorldPos;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
vec4 vfWorldPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  vfWorldPos = instanceMatrix * vfWorldPos;
#endif
vfWorldPos = modelMatrix * vfWorldPos;
vWorldPos = vfWorldPos.xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec2 uVisionCenter;
uniform float uClearRadius;
uniform float uHazeRadius;
uniform float uHazeStrength;
uniform vec3 uHazeColor;
uniform float uDesaturate;
uniform float uHideBeyond;
varying vec3 vWorldPos;`,
        )
        .replace(
          '#include <fog_fragment>',
          `#include <fog_fragment>
{
  float vfDist = distance( vWorldPos.xz, uVisionCenter );
  float vfSpan = max( 0.0001, uHazeRadius - uClearRadius );
  float vfT = clamp( ( vfDist - uClearRadius ) / vfSpan, 0.0, 1.0 );
  float vfHaze = vfT * vfT * ( 3.0 - 2.0 * vfT ) * uHazeStrength;
  // Vision limit: fully opaque haze past hazeRadius over the edge band (visionMath.visionVisibility).
  float vfE = clamp( ( vfDist - uHazeRadius ) / max( 0.0001, uHazeRadius * ${VISION_EDGE_BAND.toFixed(4)} ), 0.0, 1.0 );
  vfHaze = mix( vfHaze, 1.0, vfE * vfE * ( 3.0 - 2.0 * vfE ) * uHideBeyond );
  vec3 vfCol = gl_FragColor.rgb;
  if ( uDesaturate > 0.001 ) {
    float vfLum = dot( vfCol, vec3( 0.299, 0.587, 0.114 ) );
    vfCol = mix( vfCol, vec3( vfLum ), clamp( vfHaze * uDesaturate, 0.0, 1.0 ) );
  }
  gl_FragColor.rgb = mix( vfCol, uHazeColor, clamp( vfHaze, 0.0, 1.0 ) );
}`,
        );
    };

    mat.customProgramCacheKey = () => {
      const base = prevKey ? prevKey.call(mat) : '';
      return base ? `${base}|vision-fog` : 'vision-fog';
    };
    mat.needsUpdate = true;
  }

  private copyProfile(src: VisionHazeProfile, dst: VisionHazeProfile): void {
    dst.clearRadius = src.clearRadius;
    dst.hazeRadius = src.hazeRadius;
    dst.hazeStrength = src.hazeStrength;
  }
}
