// [3D] World-space surface detail for the vertex-coloured city materials (docs/8_visual_polish.md §3, §4).
// One shared linear DataTexture atlas (grain / cracks / slab joints / blotches) + one shared uniforms object,
// injected once per material via onBeforeCompile (chains any previous patch; VisionFog patches on top later).
// Geometry opts in with a float `aSurface` attribute (see surfaceDetailMath.ts SURFACE); without it WebGL feeds 0 => untouched.
import * as THREE from 'three';
import { DETAIL_FADE_FAR, DETAIL_FADE_NEAR, SURFACE_TILE_M, buildDetailAtlas } from './surfaceDetailMath';

interface SurfaceDetailUniforms {
  uSdTex: { value: THREE.DataTexture | null };
  uSdOn: { value: number };
  uSdCam: { value: THREE.Vector3 };
  uSdTime: { value: number };
  uSdWind: { value: number };
}

let shared: SurfaceDetailUniforms | null = null;
const patched = new WeakSet<THREE.Material>();

function uniforms(): SurfaceDetailUniforms {
  if (shared) return shared;
  const atlas = buildDetailAtlas(512, 1337);
  const tex = new THREE.DataTexture(atlas.data, atlas.size, atlas.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace; // data texture: linear
  tex.needsUpdate = true;
  shared = {
    uSdTex: { value: tex },
    uSdOn: { value: 1 },
    uSdCam: { value: new THREE.Vector3() },
    uSdTime: { value: 0 },
    uSdWind: { value: 1 },
  };
  return shared;
}

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

const VERT_DECL = /* glsl */ `
attribute float aSurface;
varying vec3 vSdPos;
varying vec3 vSdN;
varying float vSdSurf;
`;
const VERT_BODY = /* glsl */ `
vSdPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSdN = normalize(mat3(modelMatrix) * objectNormal);
vSdSurf = aSurface;
`;

const FRAG_DECL = /* glsl */ `
uniform sampler2D uSdTex;
uniform float uSdOn;
uniform vec3 uSdCam;
varying vec3 vSdPos;
varying vec3 vSdN;
varying float vSdSurf;
`;

// Each surface returns a luminance multiplier k (~0.7..1.15) and an optional tint; contrast kept low (VP-2).
const FRAG_BODY = /* glsl */ `
if (uSdOn > 0.5 && vSdSurf > 0.5) {
  float sdFade = 1.0 - smoothstep(${f(DETAIL_FADE_NEAR)}, ${f(DETAIL_FADE_FAR)}, distance(vSdPos, uSdCam));
  if (sdFade > 0.001) {
    int sdS = int(vSdSurf + 0.5);
    float k = 1.0;
    vec3 tint = vec3(1.0);
    if (sdS == 1) { // asphalt: grain, wide wear blotches, repaired patches, cracks
      vec4 t = texture2D(uSdTex, vSdPos.xz / ${f(SURFACE_TILE_M[1])});
      vec4 w = texture2D(uSdTex, vSdPos.xz / 29.0 + 0.37);
      float patchM = smoothstep(0.66, 0.7, w.a);
      k = 1.0 + (t.r - 0.5) * 0.16 + (w.a - 0.5) * 0.22 - t.g * 0.32 * (1.0 - patchM);
      k *= mix(1.0, 0.86, patchM);
      // faint tyre polish where wear is high
      k *= 1.0 + smoothstep(0.55, 0.75, texture2D(uSdTex, vec2(vSdPos.x / 9.0, vSdPos.z / 41.0)).a) * 0.05;
    } else if (sdS == 2) { // sidewalk / plaza: slab joints, stains, edge wear
      vec4 t = texture2D(uSdTex, vSdPos.xz / ${f(SURFACE_TILE_M[2])});
      vec4 w = texture2D(uSdTex, vSdPos.xz / 17.0 + 0.11);
      k = 1.0 + (t.r - 0.5) * 0.10 - t.b * 0.2 + (w.a - 0.5) * 0.14 - smoothstep(0.7, 0.85, w.a) * 0.08;
    } else if (sdS == 3) { // grass: mottled, sun-dried patches
      vec4 t = texture2D(uSdTex, vSdPos.xz / ${f(SURFACE_TILE_M[3])});
      vec4 w = texture2D(uSdTex, vSdPos.xz / 23.0 + 0.53);
      vec4 m = texture2D(uSdTex, vSdPos.xz / 8.5 + 0.19);
      k = 1.0 + (t.r - 0.5) * 0.2 + (w.a - 0.5) * 0.3 + (m.a - 0.5) * 0.2;
      float dry = smoothstep(0.56, 0.78, w.a);
      tint = mix(vec3(1.0), vec3(1.18, 1.08, 0.78), dry);
    } else if (sdS == 4) { // buildings: stucco walls (sun-faded up top, grime at the base), concrete roofs
      bool roof = abs(vSdN.y) > 0.5;
      vec2 uvW = roof ? vSdPos.xz : (abs(vSdN.x) > abs(vSdN.z) ? vSdPos.zy : vSdPos.xy);
      vec4 t = texture2D(uSdTex, uvW / ${f(SURFACE_TILE_M[4])});
      vec4 w = texture2D(uSdTex, uvW / 13.0 + 0.71);
      k = 1.0 + (t.r - 0.5) * 0.09 + (w.a - 0.5) * 0.10;
      if (!roof) {
        k *= mix(0.8, 1.0, smoothstep(0.05, 1.1, vSdPos.y));
        k *= 1.0 + smoothstep(3.0, 14.0, vSdPos.y) * 0.06;
        // rain streaks under ledges
        k *= 1.0 - smoothstep(0.62, 0.9, texture2D(uSdTex, vec2(uvW.x / 3.0, uvW.y / 40.0)).a) * 0.07;
      } else {
        k -= t.g * 0.12;
      }
    } else if (sdS == 5) { // concrete lots / compounds / curbs
      vec4 t = texture2D(uSdTex, vSdPos.xz / ${f(SURFACE_TILE_M[5])});
      vec4 w = texture2D(uSdTex, vSdPos.xz / 19.0 + 0.29);
      k = 1.0 + (t.r - 0.5) * 0.12 + (w.a - 0.5) * 0.16 - t.g * 0.18 - t.b * 0.06;
    } else if (sdS == 6) { // sand: grain + wind ripples
      vec4 t = texture2D(uSdTex, vSdPos.xz / ${f(SURFACE_TILE_M[6])});
      float rip = sin(vSdPos.x * 2.1 + vSdPos.z * 0.6 + t.a * 6.0) * 0.5 + 0.5;
      k = 1.0 + (t.r - 0.5) * 0.12 + (t.a - 0.5) * 0.1 - rip * 0.04;
    }
    diffuseColor.rgb *= mix(vec3(1.0), tint * k, sdFade);
  }
}
`;

/**
 * Patch a city material once (idempotent). Safe on any material whose shader has `<color_fragment>` and
 * `<project_vertex>` (Lambert/Standard/Phong). Must run before VisionFog patches it (VisionFog chains this).
 */
export function applySurfaceDetail(mat: THREE.Material): void {
  if (patched.has(mat)) return;
  patched.add(mat);
  const u = uniforms();
  const prevCompile = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile.call(mat, shader, renderer);
    shader.uniforms.uSdTex = u.uSdTex;
    shader.uniforms.uSdOn = u.uSdOn;
    shader.uniforms.uSdCam = u.uSdCam;
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_BODY}`);
  };
  mat.customProgramCacheKey = () => `${prevKey.call(mat)}|sd1`;
  mat.needsUpdate = true;
}

export function setSurfaceDetailEnabled(on: boolean): void {
  uniforms().uSdOn.value = on ? 1 : 0;
}

export function setSurfaceDetailCamera(x: number, y: number, z: number): void {
  uniforms().uSdCam.value.set(x, y, z);
}

// ---------------------------------------------------------------------------
// Foliage wind: gentle height-weighted sway for instanced palms/trees (vertex only, shared time uniform).
// ---------------------------------------------------------------------------

const windPatched = new WeakSet<THREE.Material>();

const WIND_DECL = /* glsl */ `
uniform float uSdTime;
uniform float uSdWind;
`;
export interface WindOptions {
  /** Constant sway amplitude (m) — crowns that sit on top of a trunk. */
  base?: number;
  /** Extra amplitude per local height² (m / unit²) — trunks / whole trees anchored at the ground. */
  perHeight2?: number;
}

// Phase from the instance position (low frequency, so a crown and its trunk top stay in step while neighbours differ).
function windBody(base: number, perH2: number): string {
  return /* glsl */ `
{
  vec3 sdBase = vec3(0.0);
  #ifdef USE_INSTANCING
    sdBase = instanceMatrix[3].xyz;
  #endif
  float sdH = max(transformed.y, 0.0);
  float sdPh = sdBase.x * 0.11 + sdBase.z * 0.07;
  float sdAmp = uSdWind * (${f(base)} + ${f(perH2)} * sdH * sdH);
  transformed.x += sin(uSdTime * 1.3 + sdPh) * sdAmp + sin(uSdTime * 3.1 + sdPh * 2.0) * sdAmp * 0.2;
  transformed.z += cos(uSdTime * 1.1 + sdPh) * sdAmp * 0.6;
}
`;
}

/** Wind sway (idempotent per material). Vertex-only; amplitude = base + perHeight2 · localY². */
export function applyFoliageWind(mat: THREE.Material, opts: WindOptions = {}): void {
  if (windPatched.has(mat)) return;
  windPatched.add(mat);
  const base = opts.base ?? 0;
  const perH2 = opts.perHeight2 ?? 0.0045;
  const body = windBody(base, perH2);
  const u = uniforms();
  const prevCompile = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile.call(mat, shader, renderer);
    shader.uniforms.uSdTime = u.uSdTime;
    shader.uniforms.uSdWind = u.uSdWind;
    shader.vertexShader = WIND_DECL + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
${body}`);
  };
  mat.customProgramCacheKey = () => `${prevKey.call(mat)}|wind1:${base}:${perH2}`;
  mat.needsUpdate = true;
}

export function setFoliageWind(time: number, strength: number): void {
  const u = uniforms();
  u.uSdTime.value = time;
  u.uSdWind.value = strength;
}

/** Adds a constant `aSurface` attribute to a geometry (non-indexed or indexed, any vertex count). */
export function tagSurface(geom: THREE.BufferGeometry, surface: number): THREE.BufferGeometry {
  const n = geom.getAttribute('position').count;
  geom.setAttribute('aSurface', new THREE.BufferAttribute(new Float32Array(n).fill(surface), 1));
  return geom;
}

export function disposeSurfaceDetail(): void {
  shared?.uSdTex.value?.dispose();
  shared = null;
}
