import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { approachOccluderOpacity } from '../core/cameraMath';
import { DISTRICT_STYLES } from '../content/districtStyles';
import { buildBuildingGeometry } from '../graphics/buildings/BuildingFactory';
import { configForBuilding, planBuilding } from '../graphics/buildings/buildingPlan';
import type { BuildingPlan } from '../graphics/buildings/buildingTypes';
import {
  FLAT_KINDS,
  PROP_TO_FURNITURE,
  isPlantKind,
  type DressingKind,
  type FurnitureKind,
  type PlantKind,
} from '../graphics/environment/environmentKinds';
import { furnitureGeometry } from '../graphics/environment/StreetFurnitureFactory';
import { plantGeometry } from '../graphics/environment/VegetationFactory';
import { applyFoliageWind, applySurfaceDetail } from '../graphics/materials/SurfaceDetail';
import { SURFACE } from '../graphics/materials/surfaceDetailMath';
import { QUALITY_PRESETS, type QualityProfile } from '../graphics/performance/GraphicsQuality';
import {
  BuildJob,
  BuildQueue,
  ChunkGeometryCache,
  type BuildingLodGeometry,
  type BuiltBuilding,
} from '../graphics/world/ChunkGeometryCache';
import { populateChunk } from '../graphics/world/environmentPopulation';
import { WorldLOD, capByTier, distanceToRect } from '../graphics/world/WorldLOD';
import type {
  AABB,
  BuildingDef,
  DistrictId,
  DistrictLayout,
  Facing4,
  GroundPatch,
  PropDef,
  RoadMarking,
  Vec2,
} from '../core/types';
import { isLandmarkProp } from './Landmarks';
import {
  ChunkStreamer,
  chunkCols,
  chunkIdAt,
  chunkRect,
  chunkRows,
  getDistrictAt,
} from './worldQueries';
import { GROUND_TOP, SIDEWALK_TOP } from './groundLevels';

// Shared lookup so Landmarks / CheckpointVisual / NestMarkers can also auto-sync
// chunk visibility whenever CityDistrict.updateStreaming() runs.
const activeLoadedChunksByLayout = new WeakMap<DistrictLayout, ReadonlySet<number>>();
const chunkListenersByLayout = new WeakMap<
  DistrictLayout,
  Set<(loaded: ReadonlySet<number>) => void>
>();

export function getLoadedChunksForLayout(layout: DistrictLayout): ReadonlySet<number> | undefined {
  return activeLoadedChunksByLayout.get(layout);
}

export function onLayoutChunksChanged(
  layout: DistrictLayout,
  listener: (loaded: ReadonlySet<number>) => void,
): () => void {
  let set = chunkListenersByLayout.get(layout);
  if (!set) {
    set = new Set();
    chunkListenersByLayout.set(layout, set);
  }
  set.add(listener);
  const current = activeLoadedChunksByLayout.get(layout);
  if (current) {
    listener(current);
  }
  return () => {
    set?.delete(listener);
  };
}

const CAR_PALETTE: readonly number[] = [
  0xb84a42, // 0: faded crimson
  0xd9a338, // 1: cab yellow
  0x4c6e8d, // 2: slate blue
  0x9ea7b0, // 3: silver gray
  0x476953, // 4: forest green
  0xc46d3b, // 5: burnt orange
];

/** World yaw of a building's local +Z (frontage side): rotation.y that maps +Z onto the world frontage direction. */
const FRONTAGE_ANGLE: Readonly<Record<Facing4, number>> = {
  south: 0,
  east: Math.PI / 2,
  north: Math.PI,
  west: (3 * Math.PI) / 2,
};

/** Dressing groups with at least this many instances are drawn as an InstancedMesh; smaller groups are baked/merged. */
const INSTANCE_MIN = 12;
/** Anything shorter than this never casts a shadow (VP2-3). */
const SHADOW_MIN_HEIGHT = 1.5;
/** Default per-frame budget (ms) for building plan -> geometry work. */
const DEFAULT_BUILD_BUDGET_MS = 6;
/** Loading at least this many chunks in one call (intro start, teleport) builds buildings synchronously. */
const SYNC_BUILD_CHUNKS = 4;
/** Prop kinds whose blocking footprint a building plan must build around (VP2-T003 lotBlockers). */
const LOT_BLOCKER_KINDS: ReadonlySet<string> = new Set(['gasPump', 'patioTable']);
/** Building-fade lookup texture row width (multiple of 4 for tight R8 rows). */
const FADE_TEX_W = 256;

/**
 * VP-T004: surface class written into `aSurface` by paintGeometry (world-space detail shader). Builder scratch:
 * set right before a group of paint calls and reset to SURFACE.none after (never read across frames).
 */
let paintSurface: number = SURFACE.none;

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
  nonIndexed.setAttribute('aSurface', new THREE.BufferAttribute(new Float32Array(count).fill(paintSurface), 1));
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

function makeColoredBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hexColor: number,
  rotY = 0,
  rotX = 0,
  rotZ = 0,
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(w, h, d);
  if (rotX !== 0) box.rotateX(rotX);
  if (rotY !== 0) box.rotateY(rotY);
  if (rotZ !== 0) box.rotateZ(rotZ);
  box.translate(x, y, z);
  const painted = paintGeometry(box, hexColor);
  box.dispose();
  return painted;
}

function makeColoredCylinder(
  rTop: number,
  rBottom: number,
  h: number,
  radialSegments: number,
  x: number,
  y: number,
  z: number,
  hexColor: number,
): THREE.BufferGeometry {
  const cyl = new THREE.CylinderGeometry(rTop, rBottom, h, radialSegments);
  cyl.translate(x, y, z);
  const painted = paintGeometry(cyl, hexColor);
  cyl.dispose();
  return painted;
}

function mergeAndDispose(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geoms.length === 0) {
    return makeColoredBox(0.01, 0.01, 0.01, 0, -10, 0, 0x000000);
  }
  for (const g of geoms) {
    // mergeGeometries needs identical attribute sets: untagged geometry gets surface 0 (no detail)
    if (!g.getAttribute('aSurface')) {
      g.setAttribute('aSurface', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
    }
  }
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) {
    g.dispose();
  }
  return merged;
}

function subtractAABB(subject: AABB, clipper: AABB): AABB[] {
  if (
    subject.maxX <= clipper.minX ||
    subject.minX >= clipper.maxX ||
    subject.maxZ <= clipper.minZ ||
    subject.minZ >= clipper.maxZ
  ) {
    return [subject];
  }

  const result: AABB[] = [];
  if (subject.minX < clipper.minX) {
    result.push({
      minX: subject.minX,
      minZ: subject.minZ,
      maxX: clipper.minX,
      maxZ: subject.maxZ,
    });
  }
  if (subject.maxX > clipper.maxX) {
    result.push({
      minX: clipper.maxX,
      minZ: subject.minZ,
      maxX: subject.maxX,
      maxZ: subject.maxZ,
    });
  }
  const overlapMinX = Math.max(subject.minX, clipper.minX);
  const overlapMaxX = Math.min(subject.maxX, clipper.maxX);
  if (overlapMaxX > overlapMinX) {
    if (subject.minZ < clipper.minZ) {
      result.push({
        minX: overlapMinX,
        minZ: subject.minZ,
        maxX: overlapMaxX,
        maxZ: clipper.minZ,
      });
    }
    if (subject.maxZ > clipper.maxZ) {
      result.push({
        minX: overlapMinX,
        minZ: clipper.maxZ,
        maxX: overlapMaxX,
        maxZ: subject.maxZ,
      });
    }
  }
  return result;
}

function clipRectAgainstList(initial: AABB, clippers: readonly AABB[]): AABB[] {
  let pieces: AABB[] = [initial];
  for (const c of clippers) {
    const next: AABB[] = [];
    for (const p of pieces) {
      next.push(...subtractAABB(p, c));
    }
    pieces = next;
    if (pieces.length === 0) break;
  }
  return pieces;
}

/** Flat patch kinds that can overlap: a higher one is drawn, a lower one is clipped away under it (no coplanar z-fight). */
const PATCH_PRIORITY: Partial<Record<string, number>> = { plaza: 5, compound: 4, sand: 3, park: 2, court: 1.5, lot: 1 };

/** Box whose top face is at `top` (flat ground slab). */
function makeSlab(w: number, h: number, d: number, cx: number, top: number, cz: number, color: number): THREE.BufferGeometry {
  return makeColoredBox(w, h, d, cx, top - h * 0.5, cz, color);
}

function intersectAABB(a: AABB, b: AABB): AABB | null {
  const minX = Math.max(a.minX, b.minX);
  const minZ = Math.max(a.minZ, b.minZ);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxZ = Math.min(a.maxZ, b.maxZ);
  if (maxX <= minX || maxZ <= minZ) return null;
  return { minX, minZ, maxX, maxZ };
}

type BuildingBucketName = 'opaque' | 'glass' | 'emissive';
const BUCKETS: readonly BuildingBucketName[] = ['opaque', 'glass', 'emissive'];

interface BuildingFadeEntry {
  index: number;
  def: BuildingDef;
  insideCheckpoint: boolean;
  occluder: THREE.Mesh;
  /** True while a merged chunk mesh currently draws this building (fade bytes only matter then). */
  shown: boolean;
  currentOpacity: number;
}

interface TrafficBulbEntry {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  phase: number;
}

/** One render-only item (layout prop mapped onto an environment asset, or a populateChunk instance). */
interface DressingItem {
  kind: DressingKind;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  sx?: number;
  sz?: number;
  variant: number;
}

interface LoadedChunk {
  id: number;
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  instancedMeshes: THREE.InstancedMesh[];
  buildingIndices: readonly number[];
  trafficBulbs: TrafficBulbEntry[];
  /** Draw calls of ground, markings and bespoke props (buildings + dressing are counted separately). */
  drawCalls: number;
  lod: 0 | 1;
  shownLod: 0 | 1 | null;
  buildingMeshes: Record<BuildingBucketName, THREE.Mesh | null>;
  buildingCalls: number;
  dressingMeshes: THREE.Mesh[];
  dressingGeoms: THREE.BufferGeometry[];
  dressingTris: number;
  dressingItems: number;
}

export interface CityDistrictStats {
  chunks: number;
  lod0Chunks: number;
  lod1Chunks: number;
  drawCalls: number;
  buildingTriangles: number;
  buildingDrawCalls: number;
  dressingTriangles: number;
  dressingDrawCalls: number;
  dressingItems: number;
  pendingBuildJobs: number;
  /** Total ms spent in building plan -> geometry jobs (cold). */
  buildMs: number;
  buildingsBuilt: number;
  /** Recent synchronous chunk load times (ms) split by cold (nothing cached) / warm (ground cached). */
  chunkLoadColdMs: number[];
  chunkLoadWarmMs: number[];
  cache: { records: number; pinned: number; triangles: number; hits: number; misses: number; evictions: number };
}

interface FadeUniforms {
  uBfTex: { value: THREE.DataTexture };
  uBfSize: { value: THREE.Vector2 };
}

const FADE_VERT_DECL = /* glsl */ `
attribute float aBuilding;
uniform sampler2D uBfTex;
uniform vec2 uBfSize;
varying float vBfFade;
`;
const FADE_VERT_BODY = /* glsl */ `
{
  vec2 bfUv = vec2((mod(aBuilding, uBfSize.x) + 0.5) / uBfSize.x, (floor(aBuilding / uBfSize.x) + 0.5) / uBfSize.y);
  vBfFade = texture2D(uBfTex, bfUv).r;
}
`;
const FADE_FRAG_DECL = /* glsl */ `
varying float vBfFade;
`;
// Screen-door dither: the camera-occluding building dissolves without needing a transparent (sorted) material,
// so one shared opaque material serves every building of every chunk.
const FADE_FRAG_BODY = /* glsl */ `
if (vBfFade < 0.995) {
  float bfN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (vBfFade < bfN * 0.94 + 0.03) discard;
}
`;

/** Per-building occluder fade (opacity read from a lookup texture by the `aBuilding` vertex attribute). Chain-safe. */
function applyBuildingFade(mat: THREE.Material, u: FadeUniforms, glow: boolean): void {
  const prevCompile = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile.call(mat, shader, renderer);
    shader.uniforms.uBfTex = u.uBfTex;
    shader.uniforms.uBfSize = u.uBfSize;
    shader.vertexShader = FADE_VERT_DECL + shader.vertexShader.replace(
      '#include <project_vertex>', `#include <project_vertex>\n${FADE_VERT_BODY}`);
    let frag = FADE_FRAG_DECL + shader.fragmentShader.replace(
      '#include <color_fragment>', `${FADE_FRAG_BODY}\n#include <color_fragment>`);
    if (glow) {
      // Neon / lit windows: add the vertex colour as emitted light (Lambert has no per-vertex emissive).
      frag = frag.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.95;');
    }
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => `${prevKey.call(mat)}|bf1${glow ? 'g' : ''}`;
  mat.needsUpdate = true;
}

function fallbackBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(0, h * 0.5, 0);
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(0xb8b0a0);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aSurface', new THREE.BufferAttribute(new Float32Array(n).fill(SURFACE.building), 1));
  return g;
}

export class CityDistrict {
  readonly group: THREE.Group;
  readonly occluders: THREE.Object3D[];

  private readonly layout: DistrictLayout;
  private readonly streamer: ChunkStreamer;
  private readonly numChunks: number;
  private readonly xSeamCoords: number[] = [];
  private readonly zSeamCoords: number[] = [];

  private readonly groundByChunk: GroundPatch[][];
  private readonly markingsByChunk: RoadMarking[][];
  private readonly buildingsByChunk: number[][];
  private readonly propsByChunk: PropDef[][];
  private readonly roadRects: AABB[] = [];
  private readonly sidewalkByChunk = new Map<number, AABB[]>();

  private readonly buildingEntries: BuildingFadeEntry[] = [];
  private readonly occluderToEntry = new Map<THREE.Object3D, BuildingFadeEntry>();
  private readonly sharedOccluderGeom: THREE.BufferGeometry;
  private readonly sharedOccluderMat: THREE.MeshBasicMaterial;

  private readonly loadedChunks = new Map<number, LoadedChunk>();
  private disposed = false;

  // ---- VP2-T010: cache, build queue, LOD, shared materials ----
  private readonly cache = new ChunkGeometryCache(24);
  private readonly buildQueue = new BuildQueue();
  private readonly lodSelect: WorldLOD;
  private quality: Readonly<QualityProfile> = QUALITY_PRESETS.high;
  private readonly focus: Vec2 = { x: 0, z: 0 };
  private buildBudgetMs = DEFAULT_BUILD_BUDGET_MS;
  private pumpedThisFrame = false;
  private readonly planCache = new Map<number, BuildingPlan | null>();
  private lotProps: PropDef[] | null = null;
  private readonly swapScratch: number[] = [];
  private readonly rectScratch: AABB = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  private readonly tmpMat = new THREE.Matrix4();
  private buildMs = 0;
  private buildingsBuilt = 0;
  private readonly loadColdMs: number[] = [];
  private readonly loadWarmMs: number[] = [];

  private readonly fadeData: Uint8Array;
  private readonly fadeTex: THREE.DataTexture;
  private readonly fadeUniforms: FadeUniforms;
  private fadeDirty = false;

  private groundMat!: THREE.MeshLambertMaterial;
  private markingMat!: THREE.MeshLambertMaterial;
  private propMat!: THREE.MeshLambertMaterial;
  private foliageMat!: THREE.MeshLambertMaterial;
  private buildingMats!: Record<BuildingBucketName, THREE.Material>;

  constructor(scene: THREE.Object3D, layout: DistrictLayout);
  constructor(layout: DistrictLayout);
  constructor(sceneOrLayout: THREE.Object3D | DistrictLayout, maybeLayout?: DistrictLayout) {
    const hasScene = maybeLayout !== undefined;
    const layout = hasScene ? maybeLayout! : (sceneOrLayout as DistrictLayout);
    this.layout = layout;
    this.streamer = new ChunkStreamer(layout);
    const xSeams = new Set<number>();
    const zSeams = new Set<number>();
    for (const d of layout.districts) {
      if (d.rect.minX > layout.bounds.minX && d.rect.minX < layout.bounds.maxX) xSeams.add(d.rect.minX);
      if (d.rect.maxX > layout.bounds.minX && d.rect.maxX < layout.bounds.maxX) xSeams.add(d.rect.maxX);
      if (d.rect.minZ > layout.bounds.minZ && d.rect.minZ < layout.bounds.maxZ) zSeams.add(d.rect.minZ);
      if (d.rect.maxZ > layout.bounds.minZ && d.rect.maxZ < layout.bounds.maxZ) zSeams.add(d.rect.maxZ);
    }
    this.xSeamCoords.push(...[...xSeams].sort((a, b) => a - b));
    this.zSeamCoords.push(...[...zSeams].sort((a, b) => a - b));

    this.group = new THREE.Group();
    this.group.name = 'CityDistrict';
    if (hasScene) {
      (sceneOrLayout as THREE.Object3D).add(this.group);
    }

    this.occluders = [];
    const cols = chunkCols(layout);
    const rows = chunkRows(layout);
    this.numChunks = cols * rows;

    this.groundByChunk = Array.from({ length: this.numChunks }, () => []);
    this.markingsByChunk = Array.from({ length: this.numChunks }, () => []);
    this.buildingsByChunk = Array.from({ length: this.numChunks }, () => []);
    this.propsByChunk = Array.from({ length: this.numChunks }, () => []);

    this.sharedOccluderGeom = new THREE.BoxGeometry(1, 1, 1);
    this.sharedOccluderMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
      side: THREE.DoubleSide,
    });

    this.lodSelect = new WorldLOD(this.quality.buildingLod1Distance);
    this.focus.x = layout.playerStart.x;
    this.focus.z = layout.playerStart.z;

    // Per-building fade lookup (one byte per building index), shared by the three building materials.
    const fadeRows = Math.max(1, Math.ceil(Math.max(1, layout.buildings.length) / FADE_TEX_W));
    this.fadeData = new Uint8Array(FADE_TEX_W * fadeRows).fill(255);
    this.fadeTex = new THREE.DataTexture(this.fadeData, FADE_TEX_W, fadeRows, THREE.RedFormat, THREE.UnsignedByteType);
    this.fadeTex.minFilter = this.fadeTex.magFilter = THREE.NearestFilter;
    this.fadeTex.generateMipmaps = false;
    this.fadeTex.colorSpace = THREE.NoColorSpace;
    this.fadeTex.needsUpdate = true;
    this.fadeUniforms = {
      uBfTex: { value: this.fadeTex },
      uBfSize: { value: new THREE.Vector2(FADE_TEX_W, fadeRows) },
    };
    this.createMaterials();

    this.indexLayoutByChunk();
    this.initBuildingOccluders();

    // Load initial chunks around playerStart so scene is populated immediately after construction.
    this.updateStreaming(layout.playerStart);
    this.flushBuilds();
  }

  get loadedChunkIds(): ReadonlySet<number> {
    return this.streamer.loaded;
  }

  /**
   * Quality profile for building LOD distance + render-only dressing (tier, cap, foliage wind). Optional: without a
   * call the 'high' preset applies. Cheap when unchanged; rebuilds dressing meshes of loaded chunks when it matters.
   */
  setQuality(profile: Readonly<QualityProfile>): void {
    if (this.disposed) return;
    const prev = this.quality;
    this.quality = profile;
    this.lodSelect.setLod1Distance(profile.buildingLod1Distance);
    const windChanged = prev.foliageWind !== profile.foliageWind;
    const dressingChanged = windChanged || prev.dressingTier !== profile.dressingTier ||
      prev.maxDressingPerChunk !== profile.maxDressingPerChunk;
    if (!dressingChanged) return;
    const oldFoliage = this.foliageMat;
    if (windChanged) this.foliageMat = this.makeFoliageMaterial();
    for (const chunk of this.loadedChunks.values()) this.buildChunkDressing(chunk);
    if (windChanged) oldFoliage.dispose();
  }

  /** Per-frame building build budget in ms (default 6). Infinity = synchronous. */
  setBuildBudget(ms: number): void {
    this.buildBudgetMs = ms;
  }

  /** Builds every pending building job right now (use before a teleport / cinematic cut). */
  flushBuilds(): void {
    this.pumpBuilds(Infinity);
  }

  getStats(): CityDistrictStats {
    let drawCalls = 0;
    let buildingTriangles = 0;
    let buildingDrawCalls = 0;
    let dressingTriangles = 0;
    let dressingDrawCalls = 0;
    let dressingItems = 0;
    let lod0 = 0;
    let lod1 = 0;
    for (const chunk of this.loadedChunks.values()) {
      drawCalls += chunk.drawCalls + chunk.buildingCalls + chunk.dressingMeshes.length;
      buildingDrawCalls += chunk.buildingCalls;
      dressingDrawCalls += chunk.dressingMeshes.length;
      dressingTriangles += chunk.dressingTris;
      dressingItems += chunk.dressingItems;
      if (chunk.lod === 0) lod0++; else lod1++;
      if (chunk.shownLod !== null) buildingTriangles += this.cache.peek(chunk.id)?.lods[chunk.shownLod]?.triangles ?? 0;
    }
    return {
      chunks: this.loadedChunks.size, lod0Chunks: lod0, lod1Chunks: lod1, drawCalls, buildingTriangles, buildingDrawCalls,
      dressingTriangles, dressingDrawCalls, dressingItems, pendingBuildJobs: this.buildQueue.length,
      buildMs: this.buildMs, buildingsBuilt: this.buildingsBuilt,
      chunkLoadColdMs: this.loadColdMs.slice(), chunkLoadWarmMs: this.loadWarmMs.slice(), cache: this.cache.stats(),
    };
  }

  updateStreaming(focus: Vec2): { loaded: number; drawCalls: number } {
    if (this.disposed) {
      return { loaded: 0, drawCalls: 0 };
    }
    this.focus.x = focus.x;
    this.focus.z = focus.z;
    const { load, unload } = this.streamer.update(focus);
    for (let i = 0; i < unload.length; i++) {
      this.unloadChunk(unload[i]);
    }
    if (unload.length > 0) this.buildQueue.prune(chunkId => this.loadedChunks.has(chunkId));
    for (let i = 0; i < load.length; i++) {
      this.loadChunk(load[i]);
    }

    // Per-chunk LOD swaps (hysteresis + max swaps per call inside WorldLOD).
    const swapped = this.lodSelect.update(id => this.chunkDistance(id), this.swapScratch);
    for (let i = 0; i < swapped.length; i++) {
      const chunk = this.loadedChunks.get(swapped[i]);
      const lod = this.lodSelect.get(swapped[i]);
      if (!chunk || lod === undefined) continue;
      chunk.lod = lod;
      this.attachBuildings(chunk);
      this.buildChunkDressing(chunk);
    }

    if (load.length >= SYNC_BUILD_CHUNKS) this.flushBuilds();
    else this.pumpBuilds(this.buildBudgetMs);

    if (load.length > 0 || unload.length > 0 || !activeLoadedChunksByLayout.has(this.layout)) {
      activeLoadedChunksByLayout.set(this.layout, this.streamer.loaded);
      const listeners = chunkListenersByLayout.get(this.layout);
      if (listeners) {
        for (const fn of listeners) {
          fn(this.streamer.loaded);
        }
      }
    }

    let drawCalls = 0;
    for (const chunk of this.loadedChunks.values()) {
      drawCalls += chunk.drawCalls + chunk.buildingCalls + chunk.dressingMeshes.length;
    }
    return { loaded: this.streamer.loaded.size, drawCalls };
  }

  /**
   * Camera occluder fade. Each building has an opacity driven toward 0 while its proxy is hit; the value is written
   * into a tiny lookup texture and applied in the shared building materials by a screen-door dither keyed on the
   * per-vertex `aBuilding` index (no per-building material/mesh, no transparency sorting).
   */
  setOccluderFade(hits: Set<THREE.Object3D>, dt = 1 / 60): void {
    for (const chunk of this.loadedChunks.values()) {
      const indices = chunk.buildingIndices;
      for (let i = 0; i < indices.length; i++) {
        const entry = this.buildingEntries[indices[i]];
        if (!entry || !entry.shown) continue;
        entry.currentOpacity = approachOccluderOpacity(entry.currentOpacity, hits.has(entry.occluder), dt);
        const byte = Math.max(0, Math.min(255, Math.round(entry.currentOpacity * 255)));
        if (this.fadeData[entry.index] !== byte) {
          this.fadeData[entry.index] = byte;
          this.fadeDirty = true;
        }
      }
    }
    if (this.fadeDirty) {
      this.fadeTex.needsUpdate = true;
      this.fadeDirty = false;
    }
  }

  update(_dt: number, time: number): void {
    for (const chunk of this.loadedChunks.values()) {
      const bulbs = chunk.trafficBulbs;
      for (let i = 0; i < bulbs.length; i++) {
        const b = bulbs[i];
        const cycle = Math.sin(time * 2.2 + b.phase);
        b.mat.color.setHex(cycle > 0 ? 0xffb347 : 0x553310);
      }
    }
    // Streaming normally pumps the build queue; do it here too when a frame skipped updateStreaming.
    if (!this.pumpedThisFrame) this.pumpBuilds(this.buildBudgetMs);
    this.pumpedThisFrame = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of Array.from(this.loadedChunks.keys())) {
      this.unloadChunk(id);
    }
    this.buildQueue.dispose();
    this.cache.dispose();
    this.sharedOccluderGeom.dispose();
    this.sharedOccluderMat.dispose();
    this.groundMat.dispose();
    this.markingMat.dispose();
    this.propMat.dispose();
    this.foliageMat.dispose();
    for (const b of BUCKETS) this.buildingMats[b].dispose();
    this.fadeTex.dispose();
    this.planCache.clear();
    this.buildingEntries.length = 0;
    this.occluderToEntry.clear();
    this.occluders.length = 0;
    this.group.clear();
    this.group.removeFromParent();
    activeLoadedChunksByLayout.delete(this.layout);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Materials (shared by every chunk; patched once)
  // -------------------------------------------------------------------------------------------------------------------

  private createMaterials(): void {
    const lambert = (): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.groundMat = lambert();
    applySurfaceDetail(this.groundMat);
    this.markingMat = lambert();
    this.propMat = lambert();
    applySurfaceDetail(this.propMat);
    this.foliageMat = this.makeFoliageMaterial();

    const opaque = lambert();
    applySurfaceDetail(opaque);
    applyBuildingFade(opaque, this.fadeUniforms, false);
    // Glass: smooth, slightly reflective-looking standard material (no transparency: one sorted-free pass).
    const glass = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.22, metalness: 0.12 });
    applySurfaceDetail(glass);
    applyBuildingFade(glass, this.fadeUniforms, false);
    // Emissive (neon, lit windows): vertex colour added as emitted light; saturated, so the bloom pass picks it up.
    const emissive = lambert();
    applySurfaceDetail(emissive);
    applyBuildingFade(emissive, this.fadeUniforms, true);
    this.buildingMats = { opaque, glass, emissive };
  }

  private makeFoliageMaterial(): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    applySurfaceDetail(m);
    if (this.quality.foliageWind) applyFoliageWind(m, { perHeight2: 0.006 });
    return m;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Layout indexing / occluders
  // -------------------------------------------------------------------------------------------------------------------

  private indexLayoutByChunk(): void {
    const layout = this.layout;

    for (let i = 0; i < layout.ground.length; i++) {
      const p = layout.ground[i];
      if (p.kind === 'road') {
        this.roadRects.push(p.rect);
      }
    }

    // Slice ground patches into each chunk's bounds so long boulevards/streets render in every loaded chunk
    // while smaller patches stay within their chunk(s).
    const cBox: AABB = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
    for (let cId = 0; cId < this.numChunks; cId++) {
      chunkRect(layout, cId, cBox);
      for (let i = 0; i < layout.ground.length; i++) {
        const patch = layout.ground[i];
        const clipped = intersectAABB(patch.rect, cBox);
        if (clipped) {
          this.groundByChunk[cId].push({ kind: patch.kind, rect: clipped });
        }
      }
    }

    // Road markings -> chunk of center
    for (let i = 0; i < layout.markings.length; i++) {
      const m = layout.markings[i];
      const cx = 0.5 * (m.rect.minX + m.rect.maxX);
      const cz = 0.5 * (m.rect.minZ + m.rect.maxZ);
      const cId = chunkIdAt(layout, { x: cx, z: cz });
      this.markingsByChunk[cId].push(m);
    }

    // Buildings -> chunk of center (big items like the mall go to the chunk containing their center)
    for (let i = 0; i < layout.buildings.length; i++) {
      const b = layout.buildings[i];
      const cx = 0.5 * (b.footprint.minX + b.footprint.maxX);
      const cz = 0.5 * (b.footprint.minZ + b.footprint.maxZ);
      const cId = chunkIdAt(layout, { x: cx, z: cz });
      this.buildingsByChunk[cId].push(i);
    }

    // Props -> chunk of pos (skipping police cars owned by Landmarks)
    for (let i = 0; i < layout.props.length; i++) {
      const p = layout.props[i];
      if (isLandmarkProp(layout, p)) continue;
      const cId = chunkIdAt(layout, p.pos);
      this.propsByChunk[cId].push(p);
    }
  }

  private initBuildingOccluders(): void {
    const cpBounds = this.layout.checkpoint.bounds;
    for (let i = 0; i < this.layout.buildings.length; i++) {
      const b = this.layout.buildings[i];
      const fp = b.footprint;
      const w = fp.maxX - fp.minX;
      const d = fp.maxZ - fp.minZ;
      const cx = 0.5 * (fp.minX + fp.maxX);
      const cz = 0.5 * (fp.minZ + fp.maxZ);
      const h = b.height;

      const occluder = new THREE.Mesh(this.sharedOccluderGeom, this.sharedOccluderMat);
      occluder.position.set(cx, h * 0.5, cz);
      occluder.scale.set(w, h, d);
      occluder.name = `Occluder_${i}`;
      occluder.visible = false;
      occluder.userData.occlusionVolume = true;

      const insideCheckpoint =
        cx > cpBounds.minX &&
        cx < cpBounds.maxX &&
        cz > cpBounds.minZ &&
        cz < cpBounds.maxZ &&
        h <= 3.2;

      if (insideCheckpoint) {
        occluder.userData.checkpointBuilding = true;
        occluder.position.y = (h + 0.3) * 0.5;
        occluder.scale.set(w + 0.3, h + 0.3, d + 0.3);
      }

      this.group.add(occluder);
      this.occluders.push(occluder);

      const entry: BuildingFadeEntry = {
        index: i,
        def: b,
        insideCheckpoint,
        occluder,
        shown: false,
        currentOpacity: 1.0,
      };
      this.buildingEntries.push(entry);
      this.occluderToEntry.set(occluder, entry);
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Chunk load / unload
  // -------------------------------------------------------------------------------------------------------------------

  private chunkDistance(chunkId: number): number {
    chunkRect(this.layout, chunkId, this.rectScratch);
    return distanceToRect(this.focus.x, this.focus.z, this.rectScratch);
  }

  private loadChunk(chunkId: number): void {
    if (this.loadedChunks.has(chunkId)) return;
    const t0 = performance.now();
    const warm = this.cache.peek(chunkId)?.ground != null;

    const group = new THREE.Group();
    group.name = `CityChunk_${chunkId}`;
    this.group.add(group);
    this.cache.pin(chunkId);

    const chunk: LoadedChunk = {
      id: chunkId,
      group,
      geometries: [],
      materials: [],
      instancedMeshes: [],
      buildingIndices: [],
      trafficBulbs: [],
      drawCalls: 0,
      lod: this.lodSelect.admit(chunkId, this.chunkDistance(chunkId)),
      shownLod: null,
      buildingMeshes: { opaque: null, glass: null, emissive: null },
      buildingCalls: 0,
      dressingMeshes: [],
      dressingGeoms: [],
      dressingTris: 0,
      dressingItems: 0,
    };
    this.loadedChunks.set(chunkId, chunk);

    this.buildChunkGroundAndMarkings(chunkId, chunk);
    this.attachBuildings(chunk);
    this.buildChunkDressing(chunk);
    this.buildChunkProps(chunkId, chunk);

    const ms = performance.now() - t0;
    const list = warm ? this.loadWarmMs : this.loadColdMs;
    list.push(ms);
    if (list.length > 64) list.shift();
  }

  private unloadChunk(chunkId: number): void {
    const chunk = this.loadedChunks.get(chunkId);
    if (!chunk) return;

    const all = this.buildingsByChunk[chunkId];
    for (let i = 0; i < all.length; i++) {
      const entry = this.buildingEntries[all[i]];
      if (!entry) continue;
      entry.shown = false;
      entry.currentOpacity = 1.0;
      if (this.fadeData[entry.index] !== 255) {
        this.fadeData[entry.index] = 255;
        this.fadeDirty = true;
      }
    }
    if (this.fadeDirty) {
      this.fadeTex.needsUpdate = true;
      this.fadeDirty = false;
    }

    this.disposeDressing(chunk);
    for (let i = 0; i < chunk.instancedMeshes.length; i++) {
      chunk.instancedMeshes[i].dispose();
    }
    for (let i = 0; i < chunk.geometries.length; i++) {
      chunk.geometries[i].dispose();
    }
    for (let i = 0; i < chunk.materials.length; i++) {
      chunk.materials[i].dispose();
    }

    chunk.instancedMeshes.length = 0;
    chunk.geometries.length = 0;
    chunk.materials.length = 0;
    chunk.buildingIndices = [];
    chunk.trafficBulbs.length = 0;
    chunk.group.clear();
    this.group.remove(chunk.group);
    this.loadedChunks.delete(chunkId);
    this.lodSelect.forget(chunkId);
    this.cache.unpin(chunkId);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Buildings: plan -> geometry jobs, merged per chunk per LOD
  // -------------------------------------------------------------------------------------------------------------------

  private pumpBuilds(budgetMs: number): void {
    this.pumpedThisFrame = true;
    if (this.buildQueue.length === 0) return;
    const t0 = performance.now();
    this.buildingsBuilt += this.buildQueue.run(
      budgetMs,
      job => this.chunkDistance(job.chunkId),
      (job, result) => {
        const rec = this.cache.ensure(job.chunkId);
        rec.lods[job.lod] = result.geometry;
        for (const [idx, b] of result.bounds) rec.bounds.set(idx, b);
        const chunk = this.loadedChunks.get(job.chunkId);
        if (chunk) this.attachBuildings(chunk);
      },
    );
    this.buildMs += performance.now() - t0;
  }

  private requestBuild(chunkId: number, lod: 0 | 1): void {
    const rec = this.cache.ensure(chunkId);
    if (rec.lods[lod] || this.buildQueue.has(chunkId, lod)) return;
    const indices = this.buildingsByChunk[chunkId].filter(i => !this.buildingEntries[i].insideCheckpoint);
    if (indices.length === 0) {
      rec.lods[lod] = { opaque: null, glass: null, emissive: null, triangles: 0, indices: [] };
      return;
    }
    this.buildQueue.add(new BuildJob(chunkId, lod, indices, i => this.buildOne(i, lod)));
  }

  /** Shows the chunk's desired-LOD buildings (building them if needed), or the other LOD / nothing until ready. */
  private attachBuildings(chunk: LoadedChunk): void {
    const rec = this.cache.ensure(chunk.id);
    const want = chunk.lod;
    if (!rec.lods[want]) this.requestBuild(chunk.id, want);
    let lod: 0 | 1 = want;
    let geo = rec.lods[want];
    if (!geo) {
      lod = want === 0 ? 1 : 0;
      geo = rec.lods[lod];
    }
    this.showBuildings(chunk, geo, lod, rec.bounds);
  }

  private showBuildings(
    chunk: LoadedChunk,
    geo: BuildingLodGeometry | null,
    lod: 0 | 1,
    bounds: ReadonlyMap<number, readonly number[]>,
  ): void {
    if (geo && chunk.shownLod === lod && chunk.buildingMeshes.opaque?.geometry === geo.opaque) return;
    for (let i = 0; i < chunk.buildingIndices.length; i++) {
      const e = this.buildingEntries[chunk.buildingIndices[i]];
      if (e) e.shown = false;
    }
    chunk.buildingIndices = geo ? geo.indices : [];
    chunk.shownLod = geo ? lod : null;

    let calls = 0;
    for (const bucket of BUCKETS) {
      const geom = geo ? geo[bucket] : null;
      let mesh = chunk.buildingMeshes[bucket];
      if (!geom) {
        if (mesh) {
          chunk.group.remove(mesh);
          chunk.buildingMeshes[bucket] = null;
        }
        continue;
      }
      if (!mesh) {
        mesh = new THREE.Mesh(geom, this.buildingMats[bucket]);
        mesh.castShadow = bucket === 'opaque';
        mesh.receiveShadow = bucket !== 'emissive';
        mesh.name = `Buildings_${bucket}_${chunk.id}`;
        chunk.group.add(mesh);
        chunk.buildingMeshes[bucket] = mesh;
      } else {
        mesh.geometry = geom;
      }
      calls++;
    }
    chunk.buildingCalls = calls;

    for (let i = 0; i < chunk.buildingIndices.length; i++) {
      const entry = this.buildingEntries[chunk.buildingIndices[i]];
      if (!entry) continue;
      entry.shown = true;
      entry.currentOpacity = 1.0;
      const bb = bounds.get(entry.index);
      if (bb && !entry.insideCheckpoint) {
        entry.occluder.position.set((bb[0] + bb[3]) * 0.5, (bb[1] + bb[4]) * 0.5, (bb[2] + bb[5]) * 0.5);
        entry.occluder.scale.set(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]);
      }
    }
  }

  private lotBlockersFor(b: BuildingDef): AABB[] {
    const lot = b.lot;
    if (!lot) return [];
    if (!this.lotProps) this.lotProps = this.layout.props.filter(p => p.blocking && LOT_BLOCKER_KINDS.has(p.kind));
    const fp = b.footprint;
    const cx = 0.5 * (fp.minX + fp.maxX);
    const cz = 0.5 * (fp.minZ + fp.maxZ);
    const a = FRONTAGE_ANGLE[b.frontage ?? 'south'];
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const out: AABB[] = [];
    for (const p of this.lotProps) {
      if (p.pos.x < lot.minX || p.pos.x > lot.maxX || p.pos.z < lot.minZ || p.pos.z > lot.maxZ) continue;
      const half = Math.max(0.3, (p.kind === 'gasPump' ? 0.9 : 0.8) * 0.5);
      const cr = Math.cos(p.rotation);
      const sr = Math.sin(p.rotation);
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const [lx, lz] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
        const wx = p.pos.x + lx * cr + lz * sr - cx;
        const wz = p.pos.z - lx * sr + lz * cr - cz;
        const x = wx * ca - wz * sa;
        const z = wx * sa + wz * ca;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      out.push({ minX, minZ, maxX, maxZ });
    }
    return out;
  }

  private planFor(index: number): BuildingPlan | null {
    if (this.planCache.has(index)) return this.planCache.get(index) ?? null;
    const b = this.layout.buildings[index];
    const fp = b.footprint;
    const district: DistrictId = getDistrictAt(this.layout, { x: 0.5 * (fp.minX + fp.maxX), z: 0.5 * (fp.minZ + fp.maxZ) });
    const style = DISTRICT_STYLES[district] ?? DISTRICT_STYLES.suburbs;
    const attempt = (def: BuildingDef): BuildingPlan | null => {
      try {
        const cfg = configForBuilding(def, index, style);
        cfg.lotBlockers = this.lotBlockersFor(def);
        return planBuilding(cfg);
      } catch {
        return null;
      }
    };
    let plan = attempt(b);
    if (!plan && b.sharedWalls) {
      // A shared wall on the frontage is invalid for the planner: drop it rather than lose the building.
      const front = b.frontage ?? 'south';
      plan = attempt({ ...b, sharedWalls: b.sharedWalls.filter(s => s !== front) });
    }
    this.planCache.set(index, plan);
    return plan;
  }

  /** Builds one building to world-space geometry (frontage rotation + footprint centre) tagged with `aBuilding`. */
  private buildOne(index: number, lod: 0 | 1): BuiltBuilding {
    const b = this.layout.buildings[index];
    const fp = b.footprint;
    const plan = this.planFor(index);
    const parts = plan
      ? buildBuildingGeometry(plan, lod)
      : { opaque: fallbackBox(fp.maxX - fp.minX, b.height, fp.maxZ - fp.minZ), glass: null, emissive: null };
    const cx = 0.5 * (fp.minX + fp.maxX);
    const cz = 0.5 * (fp.minZ + fp.maxZ);
    this.tmpMat.makeRotationY(plan ? FRONTAGE_ANGLE[b.frontage ?? 'south'] : 0);
    this.tmpMat.setPosition(cx, 0, cz);
    const box = new THREE.Box3();
    const out: BuiltBuilding = { index, opaque: null, glass: null, emissive: null, bounds: null };
    for (const bucket of BUCKETS) {
      const g = parts[bucket];
      if (!g) continue;
      const n = g.getAttribute('position').count;
      if (n === 0) {
        g.dispose();
        continue;
      }
      g.applyMatrix4(this.tmpMat);
      g.setAttribute('aBuilding', new THREE.BufferAttribute(new Float32Array(n).fill(index), 1));
      g.computeBoundingBox();
      box.union(g.boundingBox!);
      out[bucket] = g;
    }
    if (!box.isEmpty()) out.bounds = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
    return out;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Render-only dressing + layout props drawn through the environment factories
  // -------------------------------------------------------------------------------------------------------------------

  private sidewalkPieces(chunkId: number): AABB[] {
    let list = this.sidewalkByChunk.get(chunkId);
    if (list) return list;
    list = [];
    for (const p of this.groundByChunk[chunkId]) {
      if (p.kind !== 'sidewalk') continue;
      for (const piece of clipRectAgainstList(p.rect, this.roadRects)) {
        if (piece.maxX - piece.minX >= 0.2 && piece.maxZ - piece.minZ >= 0.2) list.push(piece);
      }
    }
    this.sidewalkByChunk.set(chunkId, list);
    return list;
  }

  private baseYAt(chunkId: number, x: number, z: number): number {
    const pieces = this.sidewalkPieces(chunkId);
    for (let i = 0; i < pieces.length; i++) {
      const r = pieces[i];
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return SIDEWALK_TOP;
    }
    return 0;
  }

  private disposeDressing(chunk: LoadedChunk): void {
    for (let i = 0; i < chunk.dressingMeshes.length; i++) {
      const m = chunk.dressingMeshes[i];
      chunk.group.remove(m);
      if (m instanceof THREE.InstancedMesh) m.dispose();
    }
    for (let i = 0; i < chunk.dressingGeoms.length; i++) chunk.dressingGeoms[i].dispose();
    chunk.dressingMeshes.length = 0;
    chunk.dressingGeoms.length = 0;
    chunk.dressingTris = 0;
    chunk.dressingItems = 0;
  }

  private partsFor(kind: DressingKind, variant: number, lod: 0 | 1): { prop: THREE.BufferGeometry | null; foliage: THREE.BufferGeometry | null } {
    if (isPlantKind(kind)) {
      const p = plantGeometry(kind as PlantKind, variant, lod);
      return { prop: p.wood, foliage: p.foliage };
    }
    return { prop: furnitureGeometry(kind as FurnitureKind, variant, lod), foliage: null };
  }

  private buildChunkDressing(chunk: LoadedChunk): void {
    this.disposeDressing(chunk);
    const rec = this.cache.ensure(chunk.id);
    if (!rec.dressing) rec.dressing = populateChunk(this.layout, chunk.id);
    const q = this.quality;
    const dressing = capByTier(rec.dressing, q.dressingTier, q.maxDressingPerChunk);

    // Layout props that have an environment asset (same items the old bespoke builders drew), then the dressing.
    const items: DressingItem[] = [];
    for (const p of this.propsByChunk[chunk.id]) {
      const kind = PROP_TO_FURNITURE[p.kind];
      if (!kind) continue;
      items.push({ kind, x: p.pos.x, y: this.baseYAt(chunk.id, p.pos.x, p.pos.z), z: p.pos.z, rotY: p.rotation, scale: 1, variant: p.variant ?? 0 });
    }
    for (const d of dressing) {
      items.push({ kind: d.kind, x: d.x, y: d.y, z: d.z, rotY: d.rotY, scale: d.scale, sx: d.sx, sz: d.sz, variant: d.variant });
    }
    chunk.dressingItems = items.length;
    if (items.length === 0) return;

    const groups = new Map<string, DressingItem[]>();
    for (const it of items) {
      const v = ((Math.trunc(it.variant) % 3) + 3) % 3;
      const key = `${it.kind}|${v}`;
      let g = groups.get(key);
      if (!g) { g = []; groups.set(key, g); }
      g.push(it);
    }

    const lod = chunk.lod;
    const bake: Record<'prop' | 'foliage', { cast: THREE.BufferGeometry[]; flat: THREE.BufferGeometry[] }> = {
      prop: { cast: [], flat: [] },
      foliage: { cast: [], flat: [] },
    };
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);

    for (const [key, list] of groups) {
      const sep = key.indexOf('|');
      const kind = key.slice(0, sep) as DressingKind;
      const variant = Number(key.slice(sep + 1));
      const parts = this.partsFor(kind, variant, lod);
      const flatKind = FLAT_KINDS.has(kind);
      for (const slot of ['prop', 'foliage'] as const) {
        const geom = parts[slot];
        if (!geom) continue;
        if (!geom.boundingBox) geom.computeBoundingBox();
        const bb = geom.boundingBox!;
        const bw = Math.max(0.01, bb.max.x - bb.min.x);
        const bd = Math.max(0.01, bb.max.z - bb.min.z);
        const matrixOf = (it: DressingItem): THREE.Matrix4 => {
          pos.set(it.x, it.y, it.z);
          quat.setFromAxisAngle(yAxis, it.rotY);
          scl.set(it.sx !== undefined ? it.sx / bw : it.scale, flatKind ? 1 : it.scale, it.sz !== undefined ? it.sz / bd : it.scale);
          return m4.compose(pos, quat, scl);
        };
        let maxScale = 0;
        for (const it of list) maxScale = Math.max(maxScale, it.scale);
        const casts = !flatKind && bb.max.y * maxScale >= SHADOW_MIN_HEIGHT;
        const mat = slot === 'prop' ? this.propMat : this.foliageMat;
        const geomTris = geom.index ? geom.index.count / 3 : geom.getAttribute('position').count / 3;
        if (list.length >= INSTANCE_MIN) {
          const inst = new THREE.InstancedMesh(geom, mat, list.length);
          for (let i = 0; i < list.length; i++) inst.setMatrixAt(i, matrixOf(list[i]));
          inst.instanceMatrix.needsUpdate = true;
          inst.castShadow = casts;
          inst.receiveShadow = true;
          inst.name = `Dressing_${kind}_${variant}_${chunk.id}`;
          chunk.group.add(inst);
          chunk.dressingMeshes.push(inst);
          chunk.dressingTris += geomTris * list.length;
        } else {
          for (const it of list) {
            const c = geom.clone();
            c.applyMatrix4(matrixOf(it));
            (!flatKind && bb.max.y * it.scale >= SHADOW_MIN_HEIGHT ? bake[slot].cast : bake[slot].flat).push(c);
          }
        }
      }
    }

    for (const slot of ['prop', 'foliage'] as const) {
      for (const cast of [true, false]) {
        const list = cast ? bake[slot].cast : bake[slot].flat;
        if (list.length === 0) continue;
        let merged: THREE.BufferGeometry | null = null;
        try { merged = mergeGeometries(list, false); } catch { merged = null; }
        for (const g of list) g.dispose();
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, slot === 'prop' ? this.propMat : this.foliageMat);
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        mesh.name = `DressingMerged_${slot}_${cast ? 'cast' : 'flat'}_${chunk.id}`;
        chunk.group.add(mesh);
        chunk.dressingMeshes.push(mesh);
        chunk.dressingGeoms.push(merged);
        chunk.dressingTris += (merged.index ? merged.index.count : merged.getAttribute('position').count) / 3;
      }
    }
  }

  private districtBaseGroundColor(districtId: DistrictId): number {
    switch (districtId) {
      case 'suburbs':
        return 0x5c7a4c; // greener suburban lawn/earth undertone
      case 'police':
        return 0x82868a; // civic stone/slate undertone
      case 'shopping':
        return 0x918a7e; // warm commercial concrete undertone
      case 'industrial':
        return 0x5b5d60; // darker weathered industrial concrete
      case 'palm_park':
        return 0x4f7842; // lush park turf
      case 'sunny_boardwalk':
        return 0xdcc896; // sandy boardwalk undertone
      case 'neon_nights':
        return 0x585a68; // dark urban asphalt/slate
      case 'arts_district':
        return 0x8d8278; // warm terrazzo/brick undertone
      case 'oceanfront_hotels':
        return 0xc8be9e; // coastal limestone/sand
      case 'luxury_marina':
        return 0x7a8588; // coastal concrete/dock stone
      case 'golf_estates':
        return 0x548244; // manicured fairway green
      case 'medical_center':
        return 0x8f9699; // clean medical concrete
      case 'university':
        return 0x6c7d58; // campus quad grass/stone
      case 'financial_core':
        return 0x6e737b; // granite downtown plaza
      case 'airport':
        return 0x64686e; // tarmac/apron gray
      case 'military_base':
        return 0x5d6152; // olive-gray packed earth/concrete
      default:
        return 0x7a7d72;
    }
  }

  private buildChunkGroundAndMarkings(chunkId: number, chunk: LoadedChunk): void {
    const rec = this.cache.ensure(chunkId);
    if (!rec.ground) rec.ground = this.buildGroundGeometry(chunkId);
    const groundMesh = new THREE.Mesh(rec.ground, this.groundMat);
    groundMesh.receiveShadow = true;
    groundMesh.name = `ChunkGround_${chunkId}`;
    chunk.group.add(groundMesh);
    chunk.drawCalls++;

    if (!rec.markings && this.markingsByChunk[chunkId].length > 0) rec.markings = this.buildMarkingsGeometry(chunkId);
    if (rec.markings) {
      const markingMesh = new THREE.Mesh(rec.markings, this.markingMat);
      markingMesh.receiveShadow = true;
      markingMesh.name = `ChunkMarkings_${chunkId}`;
      chunk.group.add(markingMesh);
      chunk.drawCalls++;
    }
  }

  private buildGroundGeometry(chunkId: number): THREE.BufferGeometry {
    const cRect = chunkRect(this.layout, chunkId);
    const groundGeoms: THREE.BufferGeometry[] = [];

    // 1. District-tinted base slab for this chunk (split at any district seam inside the chunk)
    const xSplits = [cRect.minX];
    for (const sx of this.xSeamCoords) {
      if (sx > cRect.minX && sx < cRect.maxX) xSplits.push(sx);
    }
    xSplits.push(cRect.maxX);

    const zSplits = [cRect.minZ];
    for (const sz of this.zSeamCoords) {
      if (sz > cRect.minZ && sz < cRect.maxZ) zSplits.push(sz);
    }
    zSplits.push(cRect.maxZ);

    for (let xi = 0; xi < xSplits.length - 1; xi++) {
      for (let zi = 0; zi < zSplits.length - 1; zi++) {
        const sx0 = xSplits[xi];
        const sx1 = xSplits[xi + 1];
        const sz0 = zSplits[zi];
        const sz1 = zSplits[zi + 1];
        const scx = 0.5 * (sx0 + sx1);
        const scz = 0.5 * (sz0 + sz1);
        const distId = getDistrictAt(this.layout, { x: scx, z: scz });
        const baseColor = this.districtBaseGroundColor(distId);
        paintSurface = SURFACE.grass;
        groundGeoms.push(makeSlab(sx1 - sx0, 0.08, sz1 - sz0, scx, GROUND_TOP.base, scz, baseColor));
        paintSurface = SURFACE.none;
      }
    }

    // 3. Clipped ground patches in this chunk
    const patches = this.groundByChunk[chunkId];
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      const r = p.rect;
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const cx = 0.5 * (r.minX + r.maxX);
      const cz = 0.5 * (r.minZ + r.maxZ);
      const distId = getDistrictAt(this.layout, { x: cx, z: cz });

      // Overlapping flat patches: clip this one against higher-priority kinds and earlier patches of its own kind.
      const prio = PATCH_PRIORITY[p.kind];
      const blockers: AABB[] = [];
      if (prio !== undefined) {
        for (let j = 0; j < patches.length; j++) {
          if (j === i) continue;
          const o = patches[j];
          const op = PATCH_PRIORITY[o.kind];
          if (op === undefined) continue;
          if (op > prio || (op === prio && j < i)) blockers.push(o.rect);
        }
      }
      const slabs = (rect: AABB, h: number, top: number, color: number): void => {
        for (const piece of blockers.length > 0 ? clipRectAgainstList(rect, blockers) : [rect]) {
          const pw = piece.maxX - piece.minX;
          const pd = piece.maxZ - piece.minZ;
          if (pw < 0.05 || pd < 0.05) continue;
          groundGeoms.push(makeSlab(pw, h, pd, 0.5 * (piece.minX + piece.maxX), top, 0.5 * (piece.minZ + piece.maxZ), color));
        }
      };
      const scaled = (k: number): AABB => ({
        minX: cx - w * k * 0.5, maxX: cx + w * k * 0.5, minZ: cz - d * k * 0.5, maxZ: cz + d * k * 0.5,
      });

      if (p.kind === 'road') {
        paintSurface = SURFACE.asphalt;
        groundGeoms.push(makeSlab(w, 0.04, d, cx, GROUND_TOP.road, cz, 0x4a5260));
      } else if (p.kind === 'sidewalk') {
        const pieces = clipRectAgainstList(r, this.roadRects);
        const topColor =
          distId === 'industrial' ? 0x948e82 : distId === 'suburbs' ? 0xb2aba0 : 0xa9a294;
        const curbColor = distId === 'industrial' ? 0x767066 : 0x8c8578;
        for (const piece of pieces) {
          const pw = piece.maxX - piece.minX;
          const pd = piece.maxZ - piece.minZ;
          if (pw < 0.2 || pd < 0.2) continue;
          const pcx = 0.5 * (piece.minX + piece.maxX);
          const pcz = 0.5 * (piece.minZ + piece.maxZ);
          paintSurface = SURFACE.concrete;
          groundGeoms.push(makeColoredBox(pw, 0.14, pd, pcx, 0.07, pcz, curbColor));
          paintSurface = SURFACE.sidewalk;
          const inset = Math.min(0.18, pw * 0.2, pd * 0.2);
          groundGeoms.push(
            makeColoredBox(pw - inset * 2, 0.02, pd - inset * 2, pcx, SIDEWALK_TOP - 0.01, pcz, topColor),
          );
        }
      } else if (p.kind === 'park') {
        paintSurface = SURFACE.grass;
        slabs(r, 0.04, GROUND_TOP.park, 0x4e7540);
        slabs(scaled(0.85), 0.015, GROUND_TOP.parkInner, 0x588248);
      } else if (p.kind === 'plaza') {
        const tileRim = distId === 'police' ? 0x868c92 : 0x8f8677;
        const tileTop = distId === 'police' ? 0xb4bac0 : 0xb8ae9c;
        const tileInlay = distId === 'police' ? 0x969ea6 : 0x9e9381;
        paintSurface = SURFACE.sidewalk;
        slabs({ minX: r.minX - 0.2, maxX: r.maxX + 0.2, minZ: r.minZ - 0.2, maxZ: r.maxZ + 0.2 }, 0.05, GROUND_TOP.plazaRim, tileRim);
        slabs(r, 0.05, GROUND_TOP.plazaTop, tileTop);
        slabs(scaled(0.45), 0.02, GROUND_TOP.plazaInlay, tileInlay);
      } else if (p.kind === 'lot') {
        const lotCol = distId === 'industrial' ? 0x52565c : 0x676c73;
        paintSurface = SURFACE.asphalt;
        slabs(r, 0.03, GROUND_TOP.lot, lotCol);
      } else if (p.kind === 'sand') {
        // Start beach: dry sand over the park edge + a damp band along the sea wall.
        paintSurface = SURFACE.sand;
        slabs(r, 0.06, GROUND_TOP.sand, 0xf2dca6);
        if (p.rect.maxZ >= this.layout.playArea.maxZ - 0.01) {
          const bandD = Math.min(2.5, d);
          slabs({ minX: r.minX, maxX: r.maxX, minZ: r.maxZ - bandD, maxZ: r.maxZ }, 0.02, GROUND_TOP.sandDamp, 0xdcc48f);
        }
      } else if (p.kind === 'court') {
        // Basketball / tennis court: painted surface + white lines (lines only when nothing clips the surface).
        paintSurface = SURFACE.concrete;
        slabs(r, 0.03, GROUND_TOP.court, 0x336a7a);
        if (blockers.length === 0 && w >= 6 && d >= 6) {
          const lineCol = 0xe9e5d8;
          const t = 0.1;
          const inset = 0.7;
          const x0 = r.minX + inset;
          const x1 = r.maxX - inset;
          const z0 = r.minZ + inset;
          const z1 = r.maxZ - inset;
          groundGeoms.push(makeSlab(x1 - x0, 0.01, z1 - z0, cx, GROUND_TOP.court + 0.008, cz, 0x3f7f90));
          const bar = (ax: number, az: number, bx: number, bz: number): void => {
            groundGeoms.push(makeSlab(Math.max(t, Math.abs(bx - ax)), 0.01, Math.max(t, Math.abs(bz - az)),
              (ax + bx) * 0.5, GROUND_TOP.courtLine, (az + bz) * 0.5, lineCol));
          };
          bar(x0, z0, x1, z0);
          bar(x0, z1, x1, z1);
          bar(x0, z0, x0, z1);
          bar(x1, z0, x1, z1);
          const kw = 2.45;
          if (w >= d) {
            const k = Math.min(5.8, (x1 - x0) / 3);
            bar(cx, z0, cx, z1);
            bar(x0, cz - kw, x0 + k, cz - kw);
            bar(x0, cz + kw, x0 + k, cz + kw);
            bar(x0 + k, cz - kw, x0 + k, cz + kw);
            bar(x1, cz - kw, x1 - k, cz - kw);
            bar(x1, cz + kw, x1 - k, cz + kw);
            bar(x1 - k, cz - kw, x1 - k, cz + kw);
          } else {
            const k = Math.min(5.8, (z1 - z0) / 3);
            bar(x0, cz, x1, cz);
            bar(cx - kw, z0, cx - kw, z0 + k);
            bar(cx + kw, z0, cx + kw, z0 + k);
            bar(cx - kw, z0 + k, cx + kw, z0 + k);
            bar(cx - kw, z1, cx - kw, z1 - k);
            bar(cx + kw, z1, cx + kw, z1 - k);
            bar(cx - kw, z1 - k, cx + kw, z1 - k);
          }
        }
      } else if (p.kind === 'compound') {
        const compCol =
          distId === 'industrial' ? 0x62615b : distId === 'police' ? 0x6f747c : 0x76756e;
        paintSurface = SURFACE.concrete;
        slabs(r, 0.04, GROUND_TOP.compound, compCol);
      }
    }

    paintSurface = SURFACE.none;
    return mergeAndDispose(groundGeoms);
  }

  private buildMarkingsGeometry(chunkId: number): THREE.BufferGeometry | null {
    const markings = this.markingsByChunk[chunkId];
    const markingGeoms: THREE.BufferGeometry[] = [];
    for (let i = 0; i < markings.length; i++) {
      const m = markings[i];
      const r = m.rect;
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const cx = 0.5 * (r.minX + r.maxX);
      const cz = 0.5 * (r.minZ + r.maxZ);

      if (m.kind === 'laneDash') {
        markingGeoms.push(makeSlab(w, 0.012, d, cx, GROUND_TOP.laneDash, cz, 0xe8e2ce));
      } else if (m.kind === 'stopLine') {
        markingGeoms.push(makeSlab(w, 0.014, d, cx, GROUND_TOP.stopLine, cz, 0xf2eee2));
      } else if (m.kind === 'crosswalk') {
        if (w >= d) {
          const stripeW = 0.9;
          const step = 1.8;
          for (let x = r.minX + 0.6; x <= r.maxX - stripeW; x += step) {
            markingGeoms.push(
              makeSlab(stripeW, 0.014, d * 0.9, x + stripeW * 0.5, GROUND_TOP.crosswalk, cz, 0xeae6da),
            );
          }
        } else {
          const stripeD = 0.9;
          const step = 1.8;
          for (let z = r.minZ + 0.6; z <= r.maxZ - stripeD; z += step) {
            markingGeoms.push(
              makeSlab(w * 0.9, 0.014, stripeD, cx, GROUND_TOP.crosswalk, z + stripeD * 0.5, 0xeae6da),
            );
          }
        }
      } else if (m.kind === 'parkingBay') {
        const lineT = 0.14;
        markingGeoms.push(makeSlab(lineT, 0.012, d, r.minX + lineT * 0.5, GROUND_TOP.parkingBay, cz, 0xd8d3c3));
        markingGeoms.push(makeSlab(lineT, 0.012, d, r.maxX - lineT * 0.5, GROUND_TOP.parkingBay, cz, 0xd8d3c3));
        markingGeoms.push(makeSlab(w, 0.012, lineT, cx, GROUND_TOP.parkingBay, cz, 0xd8d3c3));
      } else if (m.kind === 'crack') {
        markingGeoms.push(
          makeColoredBox(w * 0.85, 0.01, 0.18, cx, GROUND_TOP.crack - 0.005, cz, 0x2b3038, m.rotation),
        );
        markingGeoms.push(
          makeColoredBox(w * 0.5, 0.01, 0.14, cx + 0.3, GROUND_TOP.crack - 0.005, cz - 0.2, 0x2b3038, m.rotation + 0.55),
        );
      } else if (m.kind === 'drain') {
        markingGeoms.push(makeSlab(w, 0.016, d, cx, GROUND_TOP.drain, cz, 0x23282e));
        markingGeoms.push(makeSlab(w * 0.8, 0.02, 0.12, cx, GROUND_TOP.drainBar, cz - 0.2, 0x3e4650));
        markingGeoms.push(makeSlab(w * 0.8, 0.02, 0.12, cx, GROUND_TOP.drainBar, cz + 0.2, 0x3e4650));
      }
    }
    return markingGeoms.length > 0 ? mergeAndDispose(markingGeoms) : null;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Bespoke props (kinds without an environment asset): instanced where repeated, merged otherwise
  // -------------------------------------------------------------------------------------------------------------------

  private buildChunkProps(chunkId: number, chunk: LoadedChunk): void {
    const props = this.propsByChunk[chunkId];
    if (props.length === 0) return;

    const cars: PropDef[] = [];
    const containers: PropDef[] = [];
    const jerseyBarriers: PropDef[] = [];
    const chainFences: PropDef[] = [];
    const watchtowers: PropDef[] = [];
    const tents: PropDef[] = [];
    const wrecks: PropDef[] = [];
    const shadowPropGeoms: THREE.BufferGeometry[] = [];
    const detailPropGeoms: THREE.BufferGeometry[] = [];

    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (PROP_TO_FURNITURE[p.kind]) {
        continue; // drawn by buildChunkDressing through the environment factories
      } else if (p.kind === 'car') {
        cars.push(p);
      } else if (p.kind === 'container') {
        containers.push(p);
      } else if (p.kind === 'jerseyBarrier') {
        jerseyBarriers.push(p);
      } else if (p.kind === 'chainFence') {
        chainFences.push(p);
      } else if (p.kind === 'watchtower') {
        watchtowers.push(p);
      } else if (p.kind === 'tent') {
        tents.push(p);
      } else if (p.kind === 'wreck') {
        wrecks.push(p);
      } else {
        this.appendPropGeometry(p, chunk, shadowPropGeoms, detailPropGeoms);
      }
    }

    const dummyMat4 = new THREE.Matrix4();
    const dummyPos = new THREE.Vector3();
    const dummyQuat = new THREE.Quaternion();
    const dummyScale = new THREE.Vector3(1, 1, 1);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const dummyColor = new THREE.Color();

    // 3. Instanced Cars per chunk (body instanced with per-car CAR_PALETTE color; trim instanced with fixed details)
    if (cars.length > 0) {
      const carBodyParts: THREE.BufferGeometry[] = [
        makeColoredBox(1.92, 0.68, 4.3, 0, 0.56, 0, 0xffffff),
        makeColoredBox(1.66, 0.62, 2.15, 0, 1.18, -0.15, 0xffffff),
      ];
      const carTrimParts: THREE.BufferGeometry[] = [
        makeColoredBox(1.98, 0.24, 0.25, 0, 0.36, 2.12, 0x333840),
        makeColoredBox(1.98, 0.24, 0.25, 0, 0.36, -2.12, 0x333840),
        makeColoredBox(1.7, 0.46, 1.85, 0, 1.18, -0.15, 0x263440),
        makeColoredBox(0.36, 0.18, 0.08, -0.65, 0.62, 2.14, 0xf5e9b8),
        makeColoredBox(0.36, 0.18, 0.08, 0.65, 0.62, 2.14, 0xf5e9b8),
        makeColoredBox(0.38, 0.18, 0.08, -0.65, 0.62, -2.14, 0xd1382c),
        makeColoredBox(0.38, 0.18, 0.08, 0.65, 0.62, -2.14, 0xd1382c),
        makeColoredBox(0.28, 0.62, 0.62, -0.92, 0.31, 1.32, 0x1e2226),
        makeColoredBox(0.28, 0.62, 0.62, 0.92, 0.31, 1.32, 0x1e2226),
        makeColoredBox(0.28, 0.62, 0.62, -0.92, 0.31, -1.32, 0x1e2226),
        makeColoredBox(0.28, 0.62, 0.62, 0.92, 0.31, -1.32, 0x1e2226),
      ];

      const carBodyGeom = mergeAndDispose(carBodyParts);
      const carTrimGeom = mergeAndDispose(carTrimParts);
      const carBodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      const carTrimMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

      const carBodyInst = new THREE.InstancedMesh(carBodyGeom, carBodyMat, cars.length);
      carBodyInst.castShadow = true;
      carBodyInst.receiveShadow = true;
      carBodyInst.name = `ChunkCarsBody_${chunkId}`;

      const carTrimInst = new THREE.InstancedMesh(carTrimGeom, carTrimMat, cars.length);
      carTrimInst.castShadow = false;
      carTrimInst.receiveShadow = true;
      carTrimInst.name = `ChunkCarsTrim_${chunkId}`;

      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        dummyPos.set(c.pos.x, 0, c.pos.z);
        dummyQuat.setFromAxisAngle(yAxis, c.rotation);
        dummyMat4.compose(dummyPos, dummyQuat, dummyScale);
        carBodyInst.setMatrixAt(i, dummyMat4);
        carTrimInst.setMatrixAt(i, dummyMat4);

        const v = c.variant ?? 0;
        dummyColor.setHex(CAR_PALETTE[v % CAR_PALETTE.length]);
        carBodyInst.setColorAt(i, dummyColor);
      }
      carBodyInst.instanceMatrix.needsUpdate = true;
      if (carBodyInst.instanceColor) carBodyInst.instanceColor.needsUpdate = true;
      carTrimInst.instanceMatrix.needsUpdate = true;

      chunk.geometries.push(carBodyGeom, carTrimGeom);
      chunk.materials.push(carBodyMat, carTrimMat);
      chunk.instancedMeshes.push(carBodyInst, carTrimInst);
      chunk.group.add(carBodyInst, carTrimInst);
      chunk.drawCalls += 2;
    }

    // 3b. Instanced EW district dressing props per chunk
    if (containers.length > 0) {
      this.addChunkInstancedProps(
        chunk,
        `ChunkContainers_${chunkId}`,
        containers,
        mergeAndDispose([
          makeColoredBox(5.9, 2.55, 2.45, 0, 1.28, 0, 0xffffff),
          makeColoredBox(6.0, 0.16, 2.54, 0, 0.08, 0, 0xd8d8d8),
          makeColoredBox(6.0, 0.16, 2.54, 0, 2.48, 0, 0xd8d8d8),
        ]),
        [0xe0782a, 0x2c3e66, 0x2e8b84, 0x9a4a2a, 0xe8c547],
      );
    }
    if (jerseyBarriers.length > 0) {
      this.addChunkInstancedProps(
        chunk,
        `ChunkJerseyBarriers_${chunkId}`,
        jerseyBarriers,
        mergeAndDispose([
          makeColoredBox(2.8, 0.42, 0.82, 0, 0.21, 0, 0x9e988c),
          makeColoredBox(2.76, 0.68, 0.44, 0, 0.76, 0, 0xb5ae9e),
          makeColoredBox(0.7, 0.18, 0.48, -0.75, 0.96, 0, 0xe0782a),
          makeColoredBox(0.7, 0.18, 0.48, 0.75, 0.96, 0, 0xe0782a),
        ]),
      );
    }
    if (chainFences.length > 0) {
      this.addChunkInstancedProps(
        chunk,
        `ChunkChainFences_${chunkId}`,
        chainFences,
        mergeAndDispose([
          makeColoredBox(3.2, 2.2, 0.08, 0, 1.25, 0, 0x7a8590),
          makeColoredBox(3.3, 0.1, 0.12, 0, 2.4, 0, 0x4c545e),
          makeColoredCylinder(0.07, 0.08, 2.5, 5, -1.55, 1.25, 0, 0x3b424c),
          makeColoredCylinder(0.07, 0.08, 2.5, 5, 1.55, 1.25, 0, 0x3b424c),
        ]),
      );
    }
    if (watchtowers.length > 0) {
      this.addChunkInstancedProps(
        chunk,
        `ChunkWatchtowers_${chunkId}`,
        watchtowers,
        mergeAndDispose([
          makeColoredCylinder(0.12, 0.16, 4.2, 5, -1.0, 2.1, -1.0, 0x454c40),
          makeColoredCylinder(0.12, 0.16, 4.2, 5, 1.0, 2.1, -1.0, 0x454c40),
          makeColoredCylinder(0.12, 0.16, 4.2, 5, -1.0, 2.1, 1.0, 0x454c40),
          makeColoredCylinder(0.12, 0.16, 4.2, 5, 1.0, 2.1, 1.0, 0x454c40),
          makeColoredBox(2.6, 0.28, 2.6, 0, 4.1, 0, 0x5b6340),
          makeColoredBox(2.6, 1.0, 0.18, 0, 4.75, 1.2, 0x5b6340),
          makeColoredBox(2.6, 1.0, 0.18, 0, 4.75, -1.2, 0x5b6340),
          makeColoredBox(0.18, 1.0, 2.6, 1.2, 4.75, 0, 0x5b6340),
          makeColoredBox(0.18, 1.0, 2.6, -1.2, 4.75, 0, 0x5b6340),
          makeColoredBox(3.0, 0.22, 3.0, 0, 6.2, 0, 0x3b4236),
        ]),
      );
    }
    if (tents.length > 0) {
      this.addChunkInstancedProps(
        chunk,
        `ChunkTents_${chunkId}`,
        tents,
        mergeAndDispose([
          makeColoredBox(4.0, 1.8, 3.8, 0, 0.9, 0, 0xffffff),
          makeColoredBox(4.2, 0.7, 2.6, 0, 2.0, -0.7, 0xd8dcd8, 0, 0.42, 0),
          makeColoredBox(4.2, 0.7, 2.6, 0, 2.0, 0.7, 0xd8dcd8, 0, -0.42, 0),
          makeColoredBox(1.4, 1.5, 0.14, 0, 0.75, 1.9, 0x263038),
          makeColoredBox(4.06, 0.28, 3.86, 0, 1.55, 0, 0x2e8b84),
        ]),
        [0xeae6da, 0xe8c547, 0xdce4e6],
      );
    }
    if (wrecks.length > 0) {
      this.addChunkInstancedProps(
        chunk,
        `ChunkWrecks_${chunkId}`,
        wrecks,
        mergeAndDispose([
          makeColoredBox(1.9, 0.68, 4.2, 0, 0.54, 0, 0xffffff),
          makeColoredBox(1.65, 0.56, 2.1, 0, 1.14, -0.2, 0xffffff),
          makeColoredBox(1.68, 0.42, 1.85, 0, 1.14, -0.2, 0x222a30),
          makeColoredBox(0.28, 0.58, 0.58, -0.9, 0.29, 1.3, 0x1b1e22),
          makeColoredBox(0.28, 0.58, 0.58, 0.9, 0.29, 1.3, 0x1b1e22),
          makeColoredBox(0.28, 0.58, 0.58, -0.9, 0.29, -1.3, 0x1b1e22),
          makeColoredBox(0.28, 0.58, 0.58, 0.9, 0.29, -1.3, 0x1b1e22),
        ]),
        [0x7a483b, 0x4c5866, 0x6e6a5c, 0x8c5a32, 0x525c54],
      );
    }

    // Merged non-instanced props per chunk
    if (shadowPropGeoms.length > 0) {
      const geom = mergeAndDispose(shadowPropGeoms);
      chunk.geometries.push(geom);

      const mesh = new THREE.Mesh(geom, this.propMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `ChunkPropsShadow_${chunkId}`;
      chunk.group.add(mesh);
      chunk.drawCalls++;
    }

    if (detailPropGeoms.length > 0) {
      const geom = mergeAndDispose(detailPropGeoms);
      chunk.geometries.push(geom);

      const mesh = new THREE.Mesh(geom, this.propMat);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = `ChunkPropsDetail_${chunkId}`;
      chunk.group.add(mesh);
      chunk.drawCalls++;
    }
  }

  private addChunkInstancedProps(
    chunk: LoadedChunk,
    name: string,
    items: PropDef[],
    geom: THREE.BufferGeometry,
    palette?: readonly number[],
  ): void {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const inst = new THREE.InstancedMesh(geom, mat, items.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = name;

    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();

    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      pos.set(p.pos.x, 0, p.pos.z);
      quat.setFromAxisAngle(yAxis, p.rotation);
      m4.compose(pos, quat, scale);
      inst.setMatrixAt(i, m4);
      if (palette && palette.length > 0) {
        const v = p.variant ?? 0;
        col.setHex(palette[Math.abs(v) % palette.length]);
        inst.setColorAt(i, col);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    if (palette && inst.instanceColor) inst.instanceColor.needsUpdate = true;

    chunk.geometries.push(geom);
    chunk.materials.push(mat);
    chunk.instancedMeshes.push(inst);
    chunk.group.add(inst);
    chunk.drawCalls++;
  }

  private appendPropGeometry(
    p: PropDef,
    chunk: LoadedChunk,
    shadowOut: THREE.BufferGeometry[],
    detailOut: THREE.BufferGeometry[],
  ): void {
    const x = p.pos.x;
    const z = p.pos.z;
    const rot = p.rotation;
    const v = p.variant ?? 0;
    const local: THREE.BufferGeometry[] = [];
    let castsShadow = true;
    let baseY = 0;

    switch (p.kind) {
      case 'truck': {
        const cabColors = [0x3b607d, 0xc78d32, 0x6b7075];
        const boxColors = [0xd8d5cc, 0xbab4a6, 0x8a857c];
        const cabCol = cabColors[v % cabColors.length];
        const cargoCol = boxColors[v % boxColors.length];
        local.push(makeColoredBox(2.3, 0.42, 6.8, 0, 0.5, 0, 0x2b3036));
        local.push(makeColoredBox(2.45, 1.85, 2.0, 0, 1.45, 2.35, cabCol));
        local.push(makeColoredBox(2.48, 0.68, 1.2, 0, 1.75, 2.55, 0x263542));
        local.push(makeColoredBox(2.58, 2.35, 4.6, 0, 1.82, -1.05, cargoCol));
        local.push(makeColoredBox(2.62, 0.25, 4.64, 0, 1.82, -1.05, cabCol));
        const truckWheels: [number, number][] = [
          [-1.18, 2.3],
          [1.18, 2.3],
          [-1.18, -0.8],
          [1.18, -0.8],
          [-1.18, -2.2],
          [1.18, -2.2],
        ];
        for (const [wx, wz] of truckWheels) {
          local.push(makeColoredBox(0.36, 0.78, 0.78, wx, 0.39, wz, 0x1d2024));
        }
        break;
      }


      case 'barrier': {
        local.push(makeColoredBox(2.96, 0.42, 0.88, 0, 0.21, 0, 0x9e988c));
        local.push(makeColoredBox(2.94, 0.68, 0.46, 0, 0.76, 0, 0xb5ae9e));
        local.push(makeColoredBox(0.7, 0.18, 0.5, -0.8, 0.96, 0, 0xe0782a));
        local.push(makeColoredBox(0.7, 0.18, 0.5, 0.8, 0.96, 0, 0xe0782a));
        break;
      }

      case 'sandbags': {
        const bagCol1 = 0xa89674;
        const bagCol2 = 0x968463;
        local.push(makeColoredBox(3.95, 0.4, 0.95, 0, 0.2, 0, bagCol1));
        local.push(makeColoredBox(3.75, 0.38, 0.82, 0, 0.58, 0, bagCol2));
        local.push(makeColoredBox(3.45, 0.34, 0.68, 0, 0.93, 0, bagCol1));
        break;
      }



      case 'trafficLight': {
        baseY = SIDEWALK_TOP;
        local.push(makeColoredCylinder(0.1, 0.14, 5.2, 6, 0, 2.6, 0, 0x3d434c));
        local.push(makeColoredBox(3.4, 0.14, 0.14, 1.65, 4.9, 0, 0x3d434c));
        local.push(makeColoredBox(0.36, 1.05, 0.36, 2.9, 4.65, 0, 0xd49b2a));
        local.push(makeColoredBox(0.22, 0.22, 0.4, 2.9, 4.95, 0, 0xe8453c));
        local.push(makeColoredBox(0.22, 0.22, 0.4, 2.9, 4.35, 0, 0x4cd964));

        const bulbGeom = new THREE.BoxGeometry(0.24, 0.24, 0.42);
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
        chunk.geometries.push(bulbGeom);
        chunk.materials.push(bulbMat);

        const bulbMesh = new THREE.Mesh(bulbGeom, bulbMat);
        const offset = new THREE.Vector3(2.9, baseY + 4.65, 0).applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          rot,
        );
        bulbMesh.position.set(x + offset.x, offset.y, z + offset.z);
        bulbMesh.rotation.y = rot;
        chunk.group.add(bulbMesh);
        chunk.drawCalls++;
        chunk.trafficBulbs.push({ mesh: bulbMesh, mat: bulbMat, phase: (x + z) * 0.17 });
        break;
      }




      case 'utilityPole': {
        baseY = SIDEWALK_TOP;
        local.push(makeColoredCylinder(0.13, 0.18, 7.6, 6, 0, 3.8, 0, 0x6b5038));
        local.push(makeColoredBox(2.2, 0.16, 0.16, 0, 6.8, 0, 0x59412d));
        local.push(makeColoredBox(1.8, 0.14, 0.14, 0, 6.1, 0, 0x59412d));
        break;
      }

      case 'debris': {
        castsShadow = false;
        local.push(makeColoredBox(0.75, 0.22, 0.55, -0.3, 0.11, 0.15, 0x8a8478, 0.4));
        local.push(makeColoredBox(0.55, 0.18, 0.45, 0.35, 0.09, -0.2, 0x6e6a61, -0.3));
        local.push(makeColoredBox(1.1, 0.08, 0.22, 0.1, 0.14, 0.3, 0x8c633e, 0.8));
        local.push(makeColoredCylinder(0.04, 0.22, 0.55, 6, -0.45, 0.27, -0.3, 0xe0782a));
        break;
      }


      case 'floodlight': {
        local.push(makeColoredCylinder(0.08, 0.45, 0.9, 5, 0, 0.45, 0, 0x3b424a));
        local.push(makeColoredCylinder(0.06, 0.07, 3.4, 5, 0, 2.1, 0, 0x555e68));
        local.push(makeColoredBox(0.95, 0.42, 0.36, 0, 3.85, 0, 0x2c3e66));
        local.push(makeColoredBox(0.82, 0.3, 0.4, 0, 3.85, 0.04, 0xffb347));
        break;
      }

      case 'warningSign': {
        castsShadow = false;
        local.push(makeColoredCylinder(0.06, 0.35, 1.9, 5, 0, 0.95, 0, 0x3d434c));
        local.push(makeColoredBox(1.15, 0.85, 0.1, 0, 1.65, 0, 0xe0782a));
        local.push(makeColoredBox(0.95, 0.22, 0.12, 0, 1.65, 0, 0x2c3e66));
        break;
      }

      case 'acUnit': {
        castsShadow = false;
        baseY = 8.0;
        const buildings = this.layout.buildings;
        for (let bIdx = 0; bIdx < buildings.length; bIdx++) {
          const b = buildings[bIdx];
          if (
            x >= b.footprint.minX &&
            x <= b.footprint.maxX &&
            z >= b.footprint.minZ &&
            z <= b.footprint.maxZ
          ) {
            baseY = b.height + 0.1;
            break;
          }
        }
        local.push(makeColoredBox(1.8, 1.15, 1.4, 0, 0.58, 0, 0x8c949c));
        local.push(makeColoredCylinder(0.52, 0.52, 0.18, 8, -0.35, 1.18, 0, 0x2f353b));
        local.push(makeColoredBox(0.45, 0.75, 0.95, 0.55, 0.95, 0, 0x6f7780));
        break;
      }
    }

    const targetOut = castsShadow ? shadowOut : detailOut;
    for (const g of local) {
      if (rot !== 0) {
        g.rotateY(rot);
      }
      g.translate(x, baseY, z);
      targetOut.push(g);
    }
  }
}
