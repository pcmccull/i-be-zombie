import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { approachOccluderOpacity } from '../core/cameraMath';
import type {
  AABB,
  BuildingDef,
  DistrictId,
  DistrictLayout,
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

// Miami art-deco stucco palette (indexed by colorIndex & 7)
const BUILDING_WALL_PALETTE: readonly number[] = [
  0xf4a7b9, // 0: flamingo pink
  0xf6e7c8, // 1: sand cream
  0x8fd6d0, // 2: ocean mint
  0xf9d58b, // 3: sunshine yellow
  0xf7b58d, // 4: peach coral
  0xa9c7f0, // 5: sky blue
  0xc7b3e6, // 6: lavender
  0xe9eef0, // 7: deco white
];

// Tropical house stucco palette
const HOUSE_WALL_PALETTE: readonly number[] = [
  0xfbeedd, // 0: coconut cream
  0x9fe0c9, // 1: key-lime mint
  0x86c9e8, // 2: lagoon blue
  0xf6a8a0, // 3: coral
  0xfbe08f, // 4: mango yellow
  0xf7c4a5, // 5: peach stucco
  0xd7c6ef, // 6: orchid
  0xf2b4cf, // 7: hibiscus pink
];

const HOUSE_ROOF_PALETTE: readonly number[] = [
  0xc0623f, // terracotta tile
  0xe8e4da, // white flat roof
  0xa8553a, // burnt clay tile
  0x5f9aa3, // teal metal
];

// Suburban yard fence palette
const SUBURB_FENCE_PALETTE: readonly number[] = [
  0xe8e2d5, // classic white picket
  0x9c7248, // warm cedar wood
  0x7c8f74, // painted sage yard fence
  0x8c5842, // weathered redwood
];

const AWNING_PALETTE: readonly number[] = [
  0xc84b31, // brick red
  0x2d6a4f, // forest green
  0xd97724, // warm orange
  0x2b5876, // deep blue
];

const CAR_PALETTE: readonly number[] = [
  0xb84a42, // 0: faded crimson
  0xd9a338, // 1: cab yellow
  0x4c6e8d, // 2: slate blue
  0x9ea7b0, // 3: silver gray
  0x476953, // 4: forest green
  0xc46d3b, // 5: burnt orange
];

const TREE_INSTANCE_TINTS: readonly number[] = [
  0xffffff,
  0xf2ffeb,
  0xe4f5dc,
];

// 3x5 bitmap font for low-poly 3D block signage ("GALLERIA")
const SIGN_GLYPHS: Record<string, readonly number[]> = {
  G: [
    0b111,
    0b100,
    0b101,
    0b101,
    0b111,
  ],
  A: [
    0b111,
    0b101,
    0b111,
    0b101,
    0b101,
  ],
  L: [
    0b100,
    0b100,
    0b100,
    0b100,
    0b111,
  ],
  E: [
    0b111,
    0b100,
    0b110,
    0b100,
    0b111,
  ],
  R: [
    0b111,
    0b101,
    0b110,
    0b101,
    0b101,
  ],
  I: [
    0b111,
    0b010,
    0b010,
    0b010,
    0b111,
  ],
};

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

function intersectAABB(a: AABB, b: AABB): AABB | null {
  const minX = Math.max(a.minX, b.minX);
  const minZ = Math.max(a.minZ, b.minZ);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxZ = Math.min(a.maxZ, b.maxZ);
  if (maxX <= minX || maxZ <= minZ) return null;
  return { minX, minZ, maxX, maxZ };
}

interface BuildingFadeEntry {
  index: number;
  def: BuildingDef;
  insideCheckpoint: boolean;
  occluder: THREE.Mesh;
  visualMesh: THREE.Mesh | null;
  material: THREE.MeshLambertMaterial | null;
  currentOpacity: number;
}

interface TrafficBulbEntry {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  phase: number;
}

interface LoadedChunk {
  id: number;
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  instancedMeshes: THREE.InstancedMesh[];
  buildingIndices: number[];
  trafficBulbs: TrafficBulbEntry[];
  drawCalls: number;
}

export class CityDistrict {
  readonly group: THREE.Group;
  readonly occluders: THREE.Object3D[];

  private readonly layout: DistrictLayout;
  private readonly streamer: ChunkStreamer;
  private readonly numChunks: number;

  private readonly groundByChunk: GroundPatch[][];
  private readonly markingsByChunk: RoadMarking[][];
  private readonly buildingsByChunk: number[][];
  private readonly propsByChunk: PropDef[][];
  private readonly roadRects: AABB[] = [];

  private readonly buildingEntries: BuildingFadeEntry[] = [];
  private readonly occluderToEntry = new Map<THREE.Object3D, BuildingFadeEntry>();
  private readonly sharedOccluderGeom: THREE.BufferGeometry;
  private readonly sharedOccluderMat: THREE.MeshBasicMaterial;

  private readonly loadedChunks = new Map<number, LoadedChunk>();
  private disposed = false;

  constructor(scene: THREE.Object3D, layout: DistrictLayout);
  constructor(layout: DistrictLayout);
  constructor(sceneOrLayout: THREE.Object3D | DistrictLayout, maybeLayout?: DistrictLayout) {
    const hasScene = maybeLayout !== undefined;
    const layout = hasScene ? maybeLayout! : (sceneOrLayout as DistrictLayout);
    this.layout = layout;
    this.streamer = new ChunkStreamer(layout);

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

    this.indexLayoutByChunk();
    this.initBuildingOccluders();

    // Load initial chunks around playerStart so scene is populated immediately after construction.
    this.updateStreaming(layout.playerStart);
  }

  get loadedChunkIds(): ReadonlySet<number> {
    return this.streamer.loaded;
  }

  updateStreaming(focus: Vec2): { loaded: number; drawCalls: number } {
    if (this.disposed) {
      return { loaded: 0, drawCalls: 0 };
    }
    const { load, unload } = this.streamer.update(focus);
    for (let i = 0; i < unload.length; i++) {
      this.unloadChunk(unload[i]);
    }
    for (let i = 0; i < load.length; i++) {
      this.loadChunk(load[i]);
    }

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
      drawCalls += chunk.drawCalls;
    }
    return { loaded: this.streamer.loaded.size, drawCalls };
  }

  setOccluderFade(hits: Set<THREE.Object3D>, dt = 1 / 60): void {
    for (const chunk of this.loadedChunks.values()) {
      const indices = chunk.buildingIndices;
      for (let i = 0; i < indices.length; i++) {
        const entry = this.buildingEntries[indices[i]];
        if (!entry || !entry.material) continue;
        const isHit =
          hits.has(entry.occluder) ||
          (entry.visualMesh !== null && hits.has(entry.visualMesh));
        entry.currentOpacity = approachOccluderOpacity(entry.currentOpacity, isHit, dt);
        const transparent = entry.currentOpacity < 1;
        if (entry.material.transparent !== transparent) {
          entry.material.transparent = transparent;
          entry.material.needsUpdate = true;
        }
        entry.material.depthWrite = !transparent;
        entry.material.opacity = entry.currentOpacity;
      }
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
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of Array.from(this.loadedChunks.keys())) {
      this.unloadChunk(id);
    }
    this.sharedOccluderGeom.dispose();
    this.sharedOccluderMat.dispose();
    this.buildingEntries.length = 0;
    this.occluderToEntry.clear();
    this.occluders.length = 0;
    this.group.clear();
    this.group.removeFromParent();
    activeLoadedChunksByLayout.delete(this.layout);
  }

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
        visualMesh: null,
        material: null,
        currentOpacity: 1.0,
      };
      this.buildingEntries.push(entry);
      this.occluderToEntry.set(occluder, entry);
    }
  }

  private loadChunk(chunkId: number): void {
    if (this.loadedChunks.has(chunkId)) return;

    const group = new THREE.Group();
    group.name = `CityChunk_${chunkId}`;
    this.group.add(group);

    const chunk: LoadedChunk = {
      id: chunkId,
      group,
      geometries: [],
      materials: [],
      instancedMeshes: [],
      buildingIndices: [],
      trafficBulbs: [],
      drawCalls: 0,
    };

    this.buildChunkGroundAndMarkings(chunkId, chunk);
    this.buildChunkBuildings(chunkId, chunk);
    this.buildChunkProps(chunkId, chunk);

    this.loadedChunks.set(chunkId, chunk);
  }

  private unloadChunk(chunkId: number): void {
    const chunk = this.loadedChunks.get(chunkId);
    if (!chunk) return;

    for (let i = 0; i < chunk.buildingIndices.length; i++) {
      const entry = this.buildingEntries[chunk.buildingIndices[i]];
      if (!entry) continue;
      if (entry.visualMesh) {
        this.occluderToEntry.delete(entry.visualMesh);
      }
      entry.visualMesh = null;
      entry.material = null;
      entry.currentOpacity = 1.0;
    }

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
    chunk.buildingIndices.length = 0;
    chunk.trafficBulbs.length = 0;
    chunk.group.clear();
    this.group.remove(chunk.group);
    this.loadedChunks.delete(chunkId);
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
    }
  }

  private buildChunkGroundAndMarkings(chunkId: number, chunk: LoadedChunk): void {
    const cRect = chunkRect(this.layout, chunkId);
    const wBounds = this.layout.bounds;
    const groundGeoms: THREE.BufferGeometry[] = [];

    // 1. Outer world surround skirt on west/east/north boundary chunks so looking past the map edge shows dark ground
    const skirtPad = 90;
    if (cRect.minX <= wBounds.minX + 0.01) {
      const d = cRect.maxZ - cRect.minZ + (cRect.minZ <= wBounds.minZ + 0.01 ? skirtPad : 0);
      const cz = 0.5 * (cRect.minZ - (cRect.minZ <= wBounds.minZ + 0.01 ? skirtPad : 0) + cRect.maxZ);
      groundGeoms.push(makeColoredBox(skirtPad, 0.2, d, cRect.minX - skirtPad * 0.5, -0.14, cz, 0x353b44));
    }
    if (cRect.maxX >= wBounds.maxX - 0.01) {
      const d = cRect.maxZ - cRect.minZ + (cRect.minZ <= wBounds.minZ + 0.01 ? skirtPad : 0);
      const cz = 0.5 * (cRect.minZ - (cRect.minZ <= wBounds.minZ + 0.01 ? skirtPad : 0) + cRect.maxZ);
      groundGeoms.push(makeColoredBox(skirtPad, 0.2, d, cRect.maxX + skirtPad * 0.5, -0.14, cz, 0x353b44));
    }
    if (cRect.minZ <= wBounds.minZ + 0.01) {
      groundGeoms.push(
        makeColoredBox(
          cRect.maxX - cRect.minX,
          0.2,
          skirtPad,
          0.5 * (cRect.minX + cRect.maxX),
          -0.14,
          cRect.minZ - skirtPad * 0.5,
          0x353b44,
        ),
      );
    }
    // South edge: no skirt — the beach and ocean (TropicalScenery) continue the world there.

    // 2. District-tinted base slab for this chunk (split at x=0 / z=0 seam if the chunk straddles two districts)
    const xSplits = [cRect.minX];
    if (cRect.minX < 0 && cRect.maxX > 0) xSplits.push(0);
    xSplits.push(cRect.maxX);

    const zSplits = [cRect.minZ];
    if (cRect.minZ < 0 && cRect.maxZ > 0) zSplits.push(0);
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
        groundGeoms.push(makeColoredBox(sx1 - sx0, 0.08, sz1 - sz0, scx, -0.045, scz, baseColor));
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

      if (p.kind === 'road') {
        groundGeoms.push(makeColoredBox(w, 0.04, d, cx, -0.015, cz, 0x4a5260));
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
          groundGeoms.push(makeColoredBox(pw, 0.14, pd, pcx, 0.07, pcz, curbColor));
          const inset = Math.min(0.18, pw * 0.2, pd * 0.2);
          groundGeoms.push(
            makeColoredBox(pw - inset * 2, 0.02, pd - inset * 2, pcx, 0.145, pcz, topColor),
          );
        }
      } else if (p.kind === 'park') {
        groundGeoms.push(makeColoredBox(w, 0.04, d, cx, 0.0, cz, 0x4e7540));
        groundGeoms.push(makeColoredBox(w * 0.85, 0.015, d * 0.85, cx, 0.022, cz, 0x588248));
      } else if (p.kind === 'plaza') {
        const tileRim = distId === 'police' ? 0x868c92 : 0x8f8677;
        const tileTop = distId === 'police' ? 0xb4bac0 : 0xb8ae9c;
        const tileInlay = distId === 'police' ? 0x969ea6 : 0x9e9381;
        groundGeoms.push(makeColoredBox(w + 0.4, 0.05, d + 0.4, cx, 0.015, cz, tileRim));
        groundGeoms.push(makeColoredBox(w, 0.05, d, cx, 0.025, cz, tileTop));
        groundGeoms.push(makeColoredBox(w * 0.45, 0.02, d * 0.45, cx, 0.052, cz, tileInlay));
      } else if (p.kind === 'lot') {
        const lotCol = distId === 'industrial' ? 0x52565c : 0x676c73;
        groundGeoms.push(makeColoredBox(w, 0.03, d, cx, -0.005, cz, lotCol));
      } else if (p.kind === 'compound') {
        const compCol =
          distId === 'industrial' ? 0x62615b : distId === 'police' ? 0x6f747c : 0x76756e;
        groundGeoms.push(makeColoredBox(w, 0.04, d, cx, 0.0, cz, compCol));
      }
    }

    const mergedGround = mergeAndDispose(groundGeoms);
    const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    chunk.geometries.push(mergedGround);
    chunk.materials.push(groundMat);

    const groundMesh = new THREE.Mesh(mergedGround, groundMat);
    groundMesh.receiveShadow = true;
    groundMesh.name = `ChunkGround_${chunkId}`;
    chunk.group.add(groundMesh);
    chunk.drawCalls++;

    // 4. Road markings in this chunk
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
        markingGeoms.push(makeColoredBox(w, 0.012, d, cx, 0.015, cz, 0xe8e2ce));
      } else if (m.kind === 'stopLine') {
        markingGeoms.push(makeColoredBox(w, 0.014, d, cx, 0.016, cz, 0xf2eee2));
      } else if (m.kind === 'crosswalk') {
        if (w >= d) {
          const stripeW = 0.9;
          const step = 1.8;
          for (let x = r.minX + 0.6; x <= r.maxX - stripeW; x += step) {
            markingGeoms.push(
              makeColoredBox(stripeW, 0.014, d * 0.9, x + stripeW * 0.5, 0.016, cz, 0xeae6da),
            );
          }
        } else {
          const stripeD = 0.9;
          const step = 1.8;
          for (let z = r.minZ + 0.6; z <= r.maxZ - stripeD; z += step) {
            markingGeoms.push(
              makeColoredBox(w * 0.9, 0.014, stripeD, cx, 0.016, z + stripeD * 0.5, 0xeae6da),
            );
          }
        }
      } else if (m.kind === 'parkingBay') {
        const lineT = 0.14;
        markingGeoms.push(makeColoredBox(lineT, 0.012, d, r.minX + lineT * 0.5, 0.015, cz, 0xd8d3c3));
        markingGeoms.push(makeColoredBox(lineT, 0.012, d, r.maxX - lineT * 0.5, 0.015, cz, 0xd8d3c3));
        markingGeoms.push(makeColoredBox(w, 0.012, lineT, cx, 0.015, cz, 0xd8d3c3));
      } else if (m.kind === 'crack') {
        markingGeoms.push(
          makeColoredBox(w * 0.85, 0.01, 0.18, cx, 0.014, cz, 0x2b3038, m.rotation),
        );
        markingGeoms.push(
          makeColoredBox(w * 0.5, 0.01, 0.14, cx + 0.3, 0.014, cz - 0.2, 0x2b3038, m.rotation + 0.55),
        );
      } else if (m.kind === 'drain') {
        markingGeoms.push(makeColoredBox(w, 0.016, d, cx, 0.016, cz, 0x23282e));
        markingGeoms.push(makeColoredBox(w * 0.8, 0.02, 0.12, cx, 0.018, cz - 0.2, 0x3e4650));
        markingGeoms.push(makeColoredBox(w * 0.8, 0.02, 0.12, cx, 0.018, cz + 0.2, 0x3e4650));
      }
    }

    if (markingGeoms.length > 0) {
      const mergedMarkings = mergeAndDispose(markingGeoms);
      const markingMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      chunk.geometries.push(mergedMarkings);
      chunk.materials.push(markingMat);

      const markingMesh = new THREE.Mesh(mergedMarkings, markingMat);
      markingMesh.receiveShadow = true;
      markingMesh.name = `ChunkMarkings_${chunkId}`;
      chunk.group.add(markingMesh);
      chunk.drawCalls++;
    }
  }

  private buildChunkBuildings(chunkId: number, chunk: LoadedChunk): void {
    const indices = this.buildingsByChunk[chunkId];
    for (let i = 0; i < indices.length; i++) {
      const bIdx = indices[i];
      const entry = this.buildingEntries[bIdx];
      if (!entry) continue;

      const b = entry.def;
      const bldgMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      chunk.materials.push(bldgMat);
      entry.material = bldgMat;
      entry.currentOpacity = 1.0;
      chunk.buildingIndices.push(bIdx);

      if (!entry.insideCheckpoint) {
        const bldgGeom = this.createBuildingGeometry(b);
        chunk.geometries.push(bldgGeom);
        bldgGeom.computeBoundingBox();
        const bounds = bldgGeom.boundingBox!;
        bounds.getCenter(entry.occluder.position);
        entry.occluder.scale.set(
          bounds.max.x - bounds.min.x,
          bounds.max.y - bounds.min.y,
          bounds.max.z - bounds.min.z,
        );

        const visualMesh = new THREE.Mesh(bldgGeom, bldgMat);
        visualMesh.castShadow = true;
        visualMesh.receiveShadow = true;
        visualMesh.name = `Building_${bIdx}_${b.style}`;
        chunk.group.add(visualMesh);
        chunk.drawCalls++;

        entry.visualMesh = visualMesh;
        this.occluderToEntry.set(visualMesh, entry);
      }
    }
  }

  private createBuildingGeometry(b: BuildingDef): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const fp = b.footprint;
    const w = fp.maxX - fp.minX;
    const d = fp.maxZ - fp.minZ;
    const cx = 0.5 * (fp.minX + fp.maxX);
    const cz = 0.5 * (fp.minZ + fp.maxZ);
    const h = b.height;

    const trimColor = 0xa9a294;
    const plinthColor = 0x5c5852;
    const roofTarColor = 0x3a3f46;
    const darkGlassColor = 0x263542;
    const litGlassColor = 0xcbb074;

    if (b.style === 'house') {
      // Suburban residential house: pitched roof, front porch, shutters, chimney
      const houseWallCol = HOUSE_WALL_PALETTE[b.colorIndex & 7];
      const roofCol = HOUSE_ROOF_PALETTE[b.colorIndex & 3];
      const whiteTrim = 0xece6d8;
      const shutterCol = b.colorIndex % 2 === 0 ? 0x354f3e : 0x344658;
      const wallH = Math.max(3.2, h * 0.72);
      const roofPeakH = Math.max(1.6, h - wallH + 0.8);

      // Foundation plinth + main house body
      parts.push(makeColoredBox(w + 0.16, 0.48, d + 0.16, cx, 0.24, cz, 0x6b645c));
      parts.push(makeColoredBox(w, wallH, d, cx, wallH * 0.5, cz, houseWallCol));
      // Corner trim boards + eave fascia band
      parts.push(makeColoredBox(w + 0.18, 0.22, d + 0.18, cx, wallH - 0.1, cz, whiteTrim));

      // Pitched gable roof (stepped gable core + two sloped roof planes overhanging eaves)
      const overhang = 0.55;
      const isWideX = w >= d;
      if (isWideX) {
        const halfSpan = d * 0.5 + overhang;
        const slopeLen = Math.hypot(halfSpan, roofPeakH);
        const tilt = Math.atan2(roofPeakH, halfSpan);
        parts.push(
          makeColoredBox(
            w + overhang * 2,
            0.26,
            slopeLen,
            cx,
            wallH + roofPeakH * 0.48,
            cz - halfSpan * 0.48,
            roofCol,
            0,
            -tilt,
            0,
          ),
        );
        parts.push(
          makeColoredBox(
            w + overhang * 2,
            0.26,
            slopeLen,
            cx,
            wallH + roofPeakH * 0.48,
            cz + halfSpan * 0.48,
            roofCol,
            0,
            tilt,
            0,
          ),
        );
        // Gable triangular fill tiers
        for (let t = 1; t <= 4; t++) {
          const frac = 1 - t / 4.6;
          const ty = wallH + (t - 0.5) * (roofPeakH / 4.2);
          parts.push(makeColoredBox(w - 0.08, roofPeakH / 4.0, d * frac, cx, ty, cz, houseWallCol));
        }
        // Ridge beam
        parts.push(makeColoredBox(w + overhang * 2, 0.22, 0.36, cx, wallH + roofPeakH - 0.02, cz, roofCol));
      } else {
        const halfSpan = w * 0.5 + overhang;
        const slopeLen = Math.hypot(halfSpan, roofPeakH);
        const tilt = Math.atan2(roofPeakH, halfSpan);
        parts.push(
          makeColoredBox(
            slopeLen,
            0.26,
            d + overhang * 2,
            cx - halfSpan * 0.48,
            wallH + roofPeakH * 0.48,
            cz,
            roofCol,
            0,
            0,
            tilt,
          ),
        );
        parts.push(
          makeColoredBox(
            slopeLen,
            0.26,
            d + overhang * 2,
            cx + halfSpan * 0.48,
            wallH + roofPeakH * 0.48,
            cz,
            roofCol,
            0,
            0,
            -tilt,
          ),
        );
        for (let t = 1; t <= 4; t++) {
          const frac = 1 - t / 4.6;
          const ty = wallH + (t - 0.5) * (roofPeakH / 4.2);
          parts.push(makeColoredBox(w * frac, roofPeakH / 4.0, d - 0.08, cx, ty, cz, houseWallCol));
        }
        parts.push(makeColoredBox(0.36, 0.22, d + overhang * 2, cx, wallH + roofPeakH - 0.02, cz, roofCol));
      }

      // Brick chimney on one side
      const chimX = fp.maxX - 2.2;
      const chimZ = cz - d * 0.18;
      const chimH = wallH + roofPeakH + 0.65;
      parts.push(makeColoredBox(0.95, chimH, 0.95, chimX, chimH * 0.5, chimZ, 0x8f4e3d));
      parts.push(makeColoredBox(1.12, 0.18, 1.12, chimX, chimH + 0.05, chimZ, 0x45403c));

      // Covered front porch on the north (-Z) street side (stays tight within 0.45 m of footprint)
      const porchW = Math.min(7.5, w * 0.48);
      const porchD = 0.42;
      const porchZ = fp.minZ - porchD * 0.5;
      parts.push(makeColoredBox(porchW, 0.42, porchD + 0.2, cx, 0.21, porchZ, 0x8a6846));
      parts.push(makeColoredBox(porchW + 0.3, 0.2, porchD + 0.35, cx, 2.75, porchZ, roofCol));
      parts.push(makeColoredBox(porchW + 0.34, 0.14, porchD + 0.38, cx, 2.62, porchZ, whiteTrim));
      // Porch columns
      for (const sign of [-1, 1]) {
        parts.push(
          makeColoredBox(0.2, 2.4, 0.2, cx + sign * (porchW * 0.45), 1.4, fp.minZ - 0.32, whiteTrim),
        );
      }
      // Front door + frame
      parts.push(makeColoredBox(1.35, 2.25, 0.16, cx, 1.35, fp.minZ - 0.04, whiteTrim));
      parts.push(makeColoredBox(1.08, 2.1, 0.2, cx, 1.32, fp.minZ - 0.06, 0x6e3b28));

      // Shuttered windows on N/S/E/W facades
      for (let x = fp.minX + 2.6; x <= fp.maxX - 2.6; x += 3.8) {
        if (Math.abs(x - cx) > 1.6) {
          const paneCol = ((Math.floor(x) + b.colorIndex) & 3) === 0 ? litGlassColor : darkGlassColor;
          parts.push(makeColoredBox(1.3, 1.35, 0.14, x, 1.85, fp.minZ - 0.04, whiteTrim));
          parts.push(makeColoredBox(1.08, 1.15, 0.18, x, 1.85, fp.minZ - 0.05, paneCol));
          parts.push(makeColoredBox(0.32, 1.32, 0.16, x - 0.78, 1.85, fp.minZ - 0.05, shutterCol));
          parts.push(makeColoredBox(0.32, 1.32, 0.16, x + 0.78, 1.85, fp.minZ - 0.05, shutterCol));
        }
        parts.push(makeColoredBox(1.3, 1.35, 0.14, x, 1.85, fp.maxZ + 0.04, whiteTrim));
        parts.push(makeColoredBox(1.08, 1.15, 0.18, x, 1.85, fp.maxZ + 0.05, darkGlassColor));
      }
      for (let z = fp.minZ + 3.0; z <= fp.maxZ - 3.0; z += 4.2) {
        parts.push(makeColoredBox(0.14, 1.35, 1.3, fp.minX - 0.04, 1.85, z, whiteTrim));
        parts.push(makeColoredBox(0.18, 1.15, 1.08, fp.minX - 0.05, 1.85, z, darkGlassColor));
        parts.push(makeColoredBox(0.14, 1.35, 1.3, fp.maxX + 0.04, 1.85, z, whiteTrim));
        parts.push(makeColoredBox(0.18, 1.15, 1.08, fp.maxX + 0.05, 1.85, z, darkGlassColor));
      }

      return mergeAndDispose(parts);
    }

    if (b.style === 'civic') {
      // Civic / Police building: monumental stone facade, colonnade columns, flat cornice roof, flagpole
      const stoneWall = b.colorIndex % 2 === 0 ? 0xc2bcb0 : 0xb3aca0;
      const columnStone = 0xdad4c6;
      const navyAccent = 0x2c3e66;
      const orangeAccent = 0xe0782a;

      // Stepped monumental base + main stone block
      parts.push(makeColoredBox(w + 0.36, 0.85, d + 0.36, cx, 0.425, cz, 0x7a766e));
      parts.push(makeColoredBox(w, h, d, cx, h * 0.5, cz, stoneWall));

      // Navy civic frieze band near top & heavy stone cornice flat roof
      parts.push(makeColoredBox(w + 0.24, 0.75, d + 0.24, cx, h - 1.15, cz, navyAccent));
      parts.push(makeColoredBox(w + 0.42, 0.55, d + 0.42, cx, h - 0.25, cz, columnStone));
      parts.push(makeColoredBox(w - 0.8, 0.16, d - 0.8, cx, h + 0.05, cz, roofTarColor));

      // Stepped roof parapet + central civic command cupola
      const paraH = 0.65;
      const paraT = 0.4;
      parts.push(
        makeColoredBox(w + 0.2, paraH, paraT, cx, h + paraH * 0.5, fp.minZ + paraT * 0.5, columnStone),
        makeColoredBox(w + 0.2, paraH, paraT, cx, h + paraH * 0.5, fp.maxZ - paraT * 0.5, columnStone),
        makeColoredBox(paraT, paraH, d + 0.2, fp.minX + paraT * 0.5, h + paraH * 0.5, cz, columnStone),
        makeColoredBox(paraT, paraH, d + 0.2, fp.maxX - paraT * 0.5, h + paraH * 0.5, cz, columnStone),
      );
      parts.push(makeColoredBox(w * 0.42, 1.9, d * 0.38, cx, h + 0.95, cz, 0x56616e));
      parts.push(makeColoredBox(w * 0.46, 0.28, d * 0.42, cx, h + 1.95, cz, columnStone));

      // Classical columns along S (+Z) and N (-Z) facades
      const colH = Math.max(4.5, h - 2.2);
      const colStep = Math.max(3.2, (w - 4.0) / 5);
      for (let x = fp.minX + 2.2; x <= fp.maxX - 2.2; x += colStep) {
        for (const zFace of [fp.minZ - 0.18, fp.maxZ + 0.18]) {
          parts.push(makeColoredCylinder(0.36, 0.42, colH, 8, x, 0.85 + colH * 0.5, zFace, columnStone));
          parts.push(makeColoredBox(0.95, 0.35, 0.95, x, 0.95, zFace, columnStone));
          parts.push(makeColoredBox(1.0, 0.38, 1.0, x, 0.85 + colH, zFace, columnStone));
        }
      }

      // Tall vertical window bays between columns
      for (let x = fp.minX + 2.2 + colStep * 0.5; x <= fp.maxX - 2.4; x += colStep) {
        const winH = Math.max(3.2, h - 4.2);
        parts.push(makeColoredBox(1.45, winH, 0.16, x, 1.2 + winH * 0.5, fp.minZ - 0.04, darkGlassColor));
        parts.push(makeColoredBox(1.45, winH, 0.16, x, 1.2 + winH * 0.5, fp.maxZ + 0.04, darkGlassColor));
      }

      // Tall flagpole on the front roof with human-faction flag
      const poleX = cx;
      const poleZ = fp.maxZ - 1.4;
      const poleH = 5.4;
      const poleBaseY = h + 0.2;
      parts.push(makeColoredBox(0.85, 0.45, 0.85, poleX, poleBaseY + 0.22, poleZ, columnStone));
      parts.push(
        makeColoredCylinder(0.07, 0.12, poleH, 6, poleX, poleBaseY + poleH * 0.5, poleZ, 0xd8dfe6),
      );
      // Gold finial
      parts.push(makeColoredBox(0.28, 0.28, 0.28, poleX, poleBaseY + poleH + 0.14, poleZ, 0xf2b632));
      // Waving two-tone flag (navy + orange stripe)
      const flagY = poleBaseY + poleH - 0.75;
      parts.push(makeColoredBox(2.1, 1.15, 0.12, poleX + 1.1, flagY, poleZ, navyAccent));
      parts.push(makeColoredBox(2.14, 0.36, 0.14, poleX + 1.1, flagY, poleZ, orangeAccent));

      return mergeAndDispose(parts);
    }

    if (b.style === 'mall') {
      // Big-box shopping mall: two-tone panels, wrap-around glass band, skylight atrium, signage block "GALLERIA"
      const mallCream = 0xd2c6b2;
      const mallSlate = 0x3e4c59;
      const mallTerracotta = 0xc85a32;
      const atriumGlass = 0x3b6c85;
      const mullionCol = 0xd8dde2;

      // 1. Plinth + main big-box volume
      parts.push(makeColoredBox(w + 0.3, 0.7, d + 0.3, cx, 0.35, cz, plinthColor));
      parts.push(makeColoredBox(w, h, d, cx, h * 0.5, cz, mallCream));

      // Upper architectural fascia band + terracotta stripe
      parts.push(makeColoredBox(w + 0.28, 1.8, d + 0.28, cx, h - 1.1, cz, mallSlate));
      parts.push(makeColoredBox(w + 0.36, 0.42, d + 0.36, cx, h - 2.1, cz, mallTerracotta));

      // 2. Continuous wrap-around glass curtain-wall band (ground & mezzanine level y = 0.8..5.4 m)
      const bandH = Math.min(4.6, h * 0.52);
      const bandY = 0.7 + bandH * 0.5;
      parts.push(makeColoredBox(w + 0.18, bandH, d - 3.2, cx, bandY, cz, atriumGlass));
      parts.push(makeColoredBox(w - 3.2, bandH, d + 0.18, cx, bandY, cz, atriumGlass));

      // Vertical aluminum mullions along glass band
      for (let x = fp.minX + 3.0; x <= fp.maxX - 3.0; x += 4.5) {
        parts.push(makeColoredBox(0.24, bandH + 0.2, d + 0.26, x, bandY, cz, mullionCol));
      }
      for (let z = fp.minZ + 3.0; z <= fp.maxZ - 3.0; z += 4.5) {
        parts.push(makeColoredBox(w + 0.26, bandH + 0.2, 0.24, cx, bandY, z, mullionCol));
      }

      // 3. Rooftop tar + central glazed skylight atrium dome
      parts.push(makeColoredBox(w - 1.2, 0.16, d - 1.2, cx, h + 0.06, cz, roofTarColor));
      const skyW = w * 0.58;
      const skyD = d * 0.46;
      parts.push(makeColoredBox(skyW + 0.6, 0.9, skyD + 0.6, cx, h + 0.45, cz, mallSlate));
      parts.push(makeColoredBox(skyW, 1.35, skyD, cx, h + 0.9, cz, 0x5288a3));
      for (let x = cx - skyW * 0.42; x <= cx + skyW * 0.42; x += 4.5) {
        parts.push(makeColoredBox(0.22, 1.45, skyD + 0.2, x, h + 0.9, cz, mullionCol));
      }

      // 4. Entrance canopy porticoes on North (-Z, parking lot) and West (-X, boulevard) sides
      const canW = Math.min(22, w * 0.36);
      parts.push(makeColoredBox(canW, 0.55, 1.6, cx, 5.6, fp.minZ - 0.6, mallTerracotta));
      parts.push(makeColoredBox(1.6, 0.55, Math.min(16, d * 0.42), fp.minX - 0.6, 5.6, cz, mallTerracotta));

      // 5. Prominent rooftop/facade signage block with original name "GALLERIA"
      const signBlockW = Math.min(28, w * 0.45);
      const signBlockH = 3.2;
      const signY = h + signBlockH * 0.5 + 0.2;
      const signZ = fp.minZ + 1.8;
      // Backing monolith on North (parking lot) & West (boulevard) roof edges
      parts.push(makeColoredBox(signBlockW, signBlockH, 1.1, cx, signY, signZ, 0x1e2833));
      parts.push(makeColoredBox(signBlockW + 0.4, 0.32, 1.25, cx, signY + signBlockH * 0.5, signZ, mallTerracotta));
      parts.push(makeColoredBox(signBlockW + 0.4, 0.32, 1.25, cx, signY - signBlockH * 0.5, signZ, mallTerracotta));

      // Spell "GALLERIA" in 3D block letters on both N and S faces of the rooftop sign
      const word = 'GALLERIA';
      const pixW = 0.52;
      const pixH = 0.42;
      const charStep = pixW * 4;
      const totalWordW = word.length * charStep - pixW;
      const startX = cx - totalWordW * 0.5;
      const topRowY = signY + 2 * pixH;

      for (let cIdx = 0; cIdx < word.length; cIdx++) {
        const glyph = SIGN_GLYPHS[word[cIdx]];
        if (!glyph) continue;
        const charX = startX + cIdx * charStep;
        for (let row = 0; row < 5; row++) {
          const bits = glyph[row];
          for (let col = 0; col < 3; col++) {
            if ((bits >> (2 - col)) & 1) {
              const lx = charX + col * pixW;
              const ly = topRowY - row * pixH;
              parts.push(makeColoredBox(pixW * 0.95, pixH * 0.95, 1.32, lx, ly, signZ, 0xf7e39c));
            }
          }
        }
      }

      return mergeAndDispose(parts);
    }

    // Standard urban styles: apartment, storefront, warehouse, office, garage
    const wallColor = BUILDING_WALL_PALETTE[b.colorIndex & 7];

    // 1. Base concrete plinth + main wall volume
    const plinthH = 0.6;
    parts.push(makeColoredBox(w + 0.14, plinthH, d + 0.14, cx, plinthH * 0.5, cz, plinthColor));
    parts.push(makeColoredBox(w, h, d, cx, h * 0.5, cz, wallColor));

    // 2. Roof tar surface + roof parapets along all 4 sides
    parts.push(makeColoredBox(w - 0.6, 0.12, d - 0.6, cx, h + 0.04, cz, roofTarColor));
    const parapetH = 0.48;
    const parapetT = 0.35;
    parts.push(
      makeColoredBox(w + 0.1, parapetH, parapetT, cx, h + parapetH * 0.5, fp.minZ + parapetT * 0.5, trimColor),
      makeColoredBox(w + 0.1, parapetH, parapetT, cx, h + parapetH * 0.5, fp.maxZ - parapetT * 0.5, trimColor),
      makeColoredBox(parapetT, parapetH, d + 0.1, fp.minX + parapetT * 0.5, h + parapetH * 0.5, cz, trimColor),
      makeColoredBox(parapetT, parapetH, d + 0.1, fp.maxX - parapetT * 0.5, h + parapetH * 0.5, cz, trimColor),
    );

    if (b.style === 'apartment') {
      const floorStep = 3.1;
      for (let y = 3.2; y < h - 0.8; y += floorStep) {
        parts.push(makeColoredBox(w + 0.22, 0.18, d + 0.22, cx, y, cz, trimColor));
      }
      const winW = 1.2;
      const winH = 1.45;
      for (let y = 2.0; y < h - 1.2; y += floorStep) {
        for (let x = fp.minX + 2.0; x <= fp.maxX - 2.0; x += 3.0) {
          const hash = Math.abs(Math.floor(x * 7 + y * 13 + b.colorIndex));
          const paneCol = hash % 6 === 0 ? litGlassColor : darkGlassColor;
          parts.push(makeColoredBox(winW, winH, 0.14, x, y, fp.minZ - 0.04, paneCol));
          parts.push(makeColoredBox(winW, winH, 0.14, x, y, fp.maxZ + 0.04, paneCol));
          parts.push(makeColoredBox(winW + 0.2, 0.14, 0.24, x, y - winH * 0.5 - 0.05, fp.minZ - 0.08, trimColor));
          parts.push(makeColoredBox(winW + 0.2, 0.14, 0.24, x, y - winH * 0.5 - 0.05, fp.maxZ + 0.08, trimColor));
        }
        for (let z = fp.minZ + 2.0; z <= fp.maxZ - 2.0; z += 3.0) {
          const hash = Math.abs(Math.floor(z * 11 + y * 17 + b.colorIndex));
          const paneCol = hash % 7 === 0 ? litGlassColor : darkGlassColor;
          parts.push(makeColoredBox(0.14, winH, winW, fp.minX - 0.04, y, z, paneCol));
          parts.push(makeColoredBox(0.14, winH, winW, fp.maxX + 0.04, y, z, paneCol));
        }
      }
      const stairX = fp.maxX + 0.12;
      for (let y = 2.6; y < h - 1.5; y += floorStep) {
        parts.push(makeColoredBox(0.45, 0.12, 2.4, stairX, y, cz, 0x343a40));
        parts.push(makeColoredBox(0.08, 0.8, 2.4, stairX + 0.2, y + 0.4, cz, 0x343a40));
      }
      if (w >= 11 && d >= 10) {
        const tx = fp.maxX - 3.2;
        const tz = fp.maxZ - 3.2;
        parts.push(
          makeColoredBox(0.18, 1.4, 0.18, tx - 0.7, h + 0.7, tz - 0.7, 0x454a52),
          makeColoredBox(0.18, 1.4, 0.18, tx + 0.7, h + 0.7, tz - 0.7, 0x454a52),
          makeColoredBox(0.18, 1.4, 0.18, tx - 0.7, h + 0.7, tz + 0.7, 0x454a52),
          makeColoredBox(0.18, 1.4, 0.18, tx + 0.7, h + 0.7, tz + 0.7, 0x454a52),
          makeColoredCylinder(1.15, 1.15, 2.1, 8, tx, h + 2.3, tz, 0x7b5842),
          makeColoredCylinder(0.05, 1.25, 0.55, 8, tx, h + 3.6, tz, 0x5c4030),
        );
        parts.push(makeColoredBox(2.6, 2.1, 2.2, cx - 2.0, h + 1.05, cz, plinthColor));
      }
    } else if (b.style === 'storefront') {
      const awningColor = AWNING_PALETTE[b.colorIndex % AWNING_PALETTE.length];
      const shopW = Math.max(2.0, w - 2.4);
      parts.push(makeColoredBox(shopW, 2.5, 0.16, cx, 1.6, fp.minZ - 0.04, 0x2c4252));
      parts.push(makeColoredBox(shopW, 2.5, 0.16, cx, 1.6, fp.maxZ + 0.04, 0x2c4252));
      parts.push(makeColoredBox(shopW + 0.4, 0.35, 1.1, cx, 3.05, fp.minZ - 0.45, awningColor));
      parts.push(makeColoredBox(shopW + 0.4, 0.35, 1.1, cx, 3.05, fp.maxZ + 0.45, awningColor));
      parts.push(makeColoredBox(shopW * 0.85, 0.75, 0.22, cx, 3.85, fp.minZ - 0.08, 0x2d3238));
      parts.push(makeColoredBox(shopW * 0.85, 0.75, 0.22, cx, 3.85, fp.maxZ + 0.08, 0x2d3238));
      parts.push(makeColoredBox(shopW * 0.7, 0.42, 0.26, cx, 3.85, fp.minZ - 0.09, 0xe8d9b5));
      parts.push(makeColoredBox(shopW * 0.7, 0.42, 0.26, cx, 3.85, fp.maxZ + 0.09, 0xe8d9b5));
      for (let y = 5.4; y < h - 1.0; y += 2.8) {
        for (let x = fp.minX + 2.2; x <= fp.maxX - 2.2; x += 3.2) {
          parts.push(makeColoredBox(1.3, 1.4, 0.14, x, y, fp.minZ - 0.04, darkGlassColor));
          parts.push(makeColoredBox(1.3, 1.4, 0.14, x, y, fp.maxZ + 0.04, darkGlassColor));
        }
      }
      parts.push(
        makeColoredBox(Math.min(6.0, w * 0.5), 1.6, 0.25, cx, h + 1.2, fp.maxZ - 0.8, awningColor),
      );
    } else if (b.style === 'warehouse') {
      const ribColor = 0x565d65;
      // Corrugated vertical ribs
      for (let x = fp.minX + 2.0; x <= fp.maxX - 2.0; x += 3.0) {
        parts.push(makeColoredBox(0.24, h - 0.8, d + 0.18, x, h * 0.5, cz, ribColor));
      }
      for (let z = fp.minZ + 2.0; z <= fp.maxZ - 2.0; z += 3.2) {
        parts.push(makeColoredBox(w + 0.18, h - 0.8, 0.24, cx, h * 0.5, z, ribColor));
      }

      // Multi-bay industrial loading docks on N (-Z) and S (+Z) faces
      const dockBayCount = Math.max(1, Math.min(3, Math.floor((w - 4) / 7)));
      const dockSpan = Math.min(w - 2.5, dockBayCount * 5.6);
      // Raised concrete loading dock apron + rubber dock bumpers + cantilevered dock canopy
      for (const zSign of [-1, 1]) {
        const faceZ = zSign < 0 ? fp.minZ : fp.maxZ;
        parts.push(
          makeColoredBox(dockSpan + 0.8, 1.05, 0.42, cx, 0.525, faceZ + zSign * 0.18, 0x6e6c66),
        );
        parts.push(
          makeColoredBox(dockSpan + 1.2, 0.28, 1.15, cx, 4.45, faceZ + zSign * 0.48, 0x3b424c),
        );
        parts.push(
          makeColoredBox(dockSpan + 1.24, 0.16, 1.18, cx, 4.32, faceZ + zSign * 0.48, 0xe0782a),
        );
      }

      const baySpacing = dockSpan / dockBayCount;
      for (let k = 0; k < dockBayCount; k++) {
        const bx = cx - dockSpan * 0.5 + (k + 0.5) * baySpacing;
        const doorW = Math.min(3.8, baySpacing * 0.72);
        const doorH = 3.1;
        // Roll-up steel loading bay doors + yellow safety bollards + rubber bumpers
        for (const zSign of [-1, 1]) {
          const faceZ = zSign < 0 ? fp.minZ : fp.maxZ;
          parts.push(
            makeColoredBox(doorW, doorH, 0.24, bx, 1.0 + doorH * 0.5, faceZ + zSign * 0.05, 0x414952),
          );
          parts.push(
            makeColoredBox(doorW + 0.2, 0.28, 0.28, bx, 1.0 + doorH + 0.1, faceZ + zSign * 0.06, 0xe5a932),
          );
          parts.push(
            makeColoredBox(0.28, 0.55, 0.36, bx - doorW * 0.45, 0.65, faceZ + zSign * 0.24, 0x1e2226),
          );
          parts.push(
            makeColoredBox(0.28, 0.55, 0.36, bx + doorW * 0.45, 0.65, faceZ + zSign * 0.24, 0x1e2226),
          );
        }
      }

      // Clerestory high windows
      if (h >= 7.5) {
        parts.push(makeColoredBox(w - 3.0, 0.9, 0.16, cx, h - 1.6, fp.minZ - 0.04, darkGlassColor));
        parts.push(makeColoredBox(w - 3.0, 0.9, 0.16, cx, h - 1.6, fp.maxZ + 0.04, darkGlassColor));
      }
      // Rooftop industrial vent ridge + exhaust stacks
      parts.push(makeColoredBox(w * 0.55, 0.95, 2.4, cx, h + 0.5, cz, ribColor));
      parts.push(makeColoredCylinder(0.45, 0.45, 1.6, 8, cx - w * 0.18, h + 1.2, cz, 0x454c54));
      parts.push(makeColoredCylinder(0.45, 0.45, 1.6, 8, cx + w * 0.18, h + 1.2, cz, 0x454c54));
    } else if (b.style === 'office') {
      for (let y = 2.6; y < h - 1.0; y += 2.7) {
        parts.push(makeColoredBox(w + 0.14, 1.45, d - 1.6, cx, y, cz, 0x2f4858));
        parts.push(makeColoredBox(w - 1.6, 1.45, d + 0.14, cx, y, cz, 0x2f4858));
      }
      for (let x = fp.minX + 2.5; x <= fp.maxX - 2.5; x += 3.5) {
        parts.push(makeColoredBox(0.32, h, d + 0.2, x, h * 0.5, cz, trimColor));
      }
      parts.push(makeColoredBox(w * 0.45, 1.8, d * 0.45, cx, h + 0.9, cz, 0x676f78));
    } else if (b.style === 'garage') {
      parts.push(makeColoredBox(w + 0.18, 0.45, d + 0.18, cx, 3.8, cz, 0xc85a32));
      const bayCount = Math.max(1, Math.min(3, Math.floor((w - 2) / 5)));
      const baySpacing = w / (bayCount + 1);
      for (let k = 1; k <= bayCount; k++) {
        const bx = fp.minX + k * baySpacing;
        parts.push(makeColoredBox(3.4, 3.0, 0.2, bx, 1.5, fp.minZ - 0.05, 0x48505a));
        parts.push(makeColoredBox(3.4, 3.0, 0.2, bx, 1.5, fp.maxZ + 0.05, 0x48505a));
      }
    }

    return mergeAndDispose(parts);
  }

  private buildChunkProps(chunkId: number, chunk: LoadedChunk): void {
    const props = this.propsByChunk[chunkId];
    if (props.length === 0) return;

    const trees: PropDef[] = [];
    const streetlights: PropDef[] = [];
    const cars: PropDef[] = [];
    const shadowPropGeoms: THREE.BufferGeometry[] = [];
    const detailPropGeoms: THREE.BufferGeometry[] = [];

    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (p.kind === 'tree') {
        trees.push(p);
      } else if (p.kind === 'streetlight') {
        streetlights.push(p);
      } else if (p.kind === 'car') {
        cars.push(p);
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

    // 1. Instanced Trees per chunk
    if (trees.length > 0) {
      const treeParts: THREE.BufferGeometry[] = [
        makeColoredCylinder(0.22, 0.34, 2.2, 6, 0, 1.1, 0, 0x5e4532),
        makeColoredCylinder(0.1, 1.85, 2.4, 7, 0, 2.9, 0, 0x4a753b),
        makeColoredCylinder(0.08, 1.45, 2.1, 7, 0, 4.2, 0, 0x5a8444),
        makeColoredCylinder(0.04, 0.95, 1.5, 7, 0, 5.2, 0, 0x628f4b),
      ];
      const treeGeom = mergeAndDispose(treeParts);
      const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      const treeInst = new THREE.InstancedMesh(treeGeom, treeMat, trees.length);
      treeInst.castShadow = true;
      treeInst.receiveShadow = true;
      treeInst.name = `ChunkTrees_${chunkId}`;

      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        dummyPos.set(t.pos.x, 0, t.pos.z);
        dummyQuat.setFromAxisAngle(yAxis, t.rotation);
        dummyMat4.compose(dummyPos, dummyQuat, dummyScale);
        treeInst.setMatrixAt(i, dummyMat4);
        const v = t.variant ?? 0;
        dummyColor.setHex(TREE_INSTANCE_TINTS[v % TREE_INSTANCE_TINTS.length]);
        treeInst.setColorAt(i, dummyColor);
      }
      treeInst.instanceMatrix.needsUpdate = true;
      if (treeInst.instanceColor) treeInst.instanceColor.needsUpdate = true;

      chunk.geometries.push(treeGeom);
      chunk.materials.push(treeMat);
      chunk.instancedMeshes.push(treeInst);
      chunk.group.add(treeInst);
      chunk.drawCalls++;
    }

    // 2. Instanced Streetlights per chunk
    if (streetlights.length > 0) {
      const lightParts: THREE.BufferGeometry[] = [
        makeColoredCylinder(0.08, 0.14, 5.4, 6, 0, 2.84, 0, 0x4c545e),
        makeColoredBox(0.12, 0.12, 1.6, 0, 5.49, 0.72, 0x4c545e),
        makeColoredBox(0.36, 0.16, 0.56, 0, 5.46, 1.42, 0x373d45),
        makeColoredBox(0.28, 0.08, 0.42, 0, 5.36, 1.42, 0xffe49e),
      ];
      const lightGeom = mergeAndDispose(lightParts);
      const lightMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      const lightInst = new THREE.InstancedMesh(lightGeom, lightMat, streetlights.length);
      lightInst.castShadow = true;
      lightInst.receiveShadow = true;
      lightInst.name = `ChunkStreetlights_${chunkId}`;

      for (let i = 0; i < streetlights.length; i++) {
        const s = streetlights[i];
        dummyPos.set(s.pos.x, 0, s.pos.z);
        dummyQuat.setFromAxisAngle(yAxis, s.rotation);
        dummyMat4.compose(dummyPos, dummyQuat, dummyScale);
        lightInst.setMatrixAt(i, dummyMat4);
      }
      lightInst.instanceMatrix.needsUpdate = true;

      chunk.geometries.push(lightGeom);
      chunk.materials.push(lightMat);
      chunk.instancedMeshes.push(lightInst);
      chunk.group.add(lightInst);
      chunk.drawCalls++;
    }

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

    // 4. Merged non-instanced props per chunk
    if (shadowPropGeoms.length > 0) {
      const geom = mergeAndDispose(shadowPropGeoms);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      chunk.geometries.push(geom);
      chunk.materials.push(mat);

      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `ChunkPropsShadow_${chunkId}`;
      chunk.group.add(mesh);
      chunk.drawCalls++;
    }

    if (detailPropGeoms.length > 0) {
      const geom = mergeAndDispose(detailPropGeoms);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      chunk.geometries.push(geom);
      chunk.materials.push(mat);

      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = `ChunkPropsDetail_${chunkId}`;
      chunk.group.add(mesh);
      chunk.drawCalls++;
    }
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

      case 'dumpster': {
        const dumpCol = v % 2 === 0 ? 0x3b5e47 : 0x34506b;
        local.push(makeColoredBox(1.96, 1.22, 1.16, 0, 0.61, 0, dumpCol));
        local.push(makeColoredBox(2.04, 0.14, 1.24, 0, 1.15, 0, 0x2b3036));
        local.push(makeColoredBox(0.92, 0.16, 1.18, -0.48, 1.3, 0, 0x22262b));
        local.push(makeColoredBox(0.92, 0.16, 1.18, 0.48, 1.3, 0, 0x22262b));
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

      case 'bush': {
        castsShadow = false;
        local.push(makeColoredCylinder(0.45, 0.75, 0.95, 6, 0, 0.45, 0, 0x4c763e));
        local.push(makeColoredCylinder(0.35, 0.58, 0.75, 6, 0.45, 0.35, 0.25, 0x588448));
        local.push(makeColoredCylinder(0.35, 0.55, 0.7, 6, -0.42, 0.34, -0.2, 0x436936));
        break;
      }

      case 'bench': {
        castsShadow = false;
        local.push(makeColoredBox(1.7, 0.1, 0.52, 0, 0.46, 0, 0x8f623d));
        local.push(makeColoredBox(1.7, 0.46, 0.1, 0, 0.72, -0.22, 0x8f623d));
        local.push(makeColoredBox(0.12, 0.5, 0.54, -0.72, 0.25, 0, 0x333840));
        local.push(makeColoredBox(0.12, 0.5, 0.54, 0.72, 0.25, 0, 0x333840));
        break;
      }

      case 'trafficLight': {
        baseY = 0.14;
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

      case 'hydrant': {
        castsShadow = false;
        baseY = 0.14;
        local.push(makeColoredCylinder(0.18, 0.22, 0.78, 6, 0, 0.39, 0, 0xc93b2b));
        local.push(makeColoredBox(0.52, 0.16, 0.16, 0, 0.52, 0, 0xd8d4c8));
        local.push(makeColoredCylinder(0.12, 0.19, 0.18, 6, 0, 0.84, 0, 0xc93b2b));
        break;
      }

      case 'trashCan': {
        castsShadow = false;
        baseY = 0.14;
        local.push(makeColoredCylinder(0.28, 0.25, 0.88, 7, 0, 0.44, 0, 0x3b4d43));
        local.push(makeColoredCylinder(0.22, 0.3, 0.16, 7, 0, 0.94, 0, 0x2c3831));
        break;
      }

      case 'sign': {
        castsShadow = false;
        baseY = 0.14;
        local.push(makeColoredCylinder(0.05, 0.05, 2.5, 5, 0, 1.25, 0, 0x747b82));
        local.push(makeColoredBox(0.68, 0.68, 0.08, 0, 2.35, 0, 0xc93b2b));
        local.push(makeColoredBox(0.52, 0.18, 0.1, 0, 2.35, 0, 0xf2eee4));
        break;
      }

      case 'utilityPole': {
        baseY = 0.14;
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

      case 'fence': {
        const distId = getDistrictAt(this.layout, p.pos);
        if (distId === 'suburbs') {
          // Suburban picket/yard fence with varied residential fence colors
          const fenceHash = Math.abs(Math.floor(x * 3 + z * 5));
          const fenceCol = SUBURB_FENCE_PALETTE[fenceHash & 3];
          local.push(makeColoredBox(3.2, 0.1, 0.08, 0, 0.35, 0, fenceCol));
          local.push(makeColoredBox(3.2, 0.1, 0.08, 0, 0.95, 0, fenceCol));
          for (let px = -1.5; px <= 1.51; px += 0.3) {
            local.push(makeColoredBox(0.14, 1.25, 0.12, px, 0.625, 0, fenceCol));
          }
        } else {
          // Industrial / urban steel fence panel
          local.push(makeColoredBox(3.0, 1.8, 0.12, 0, 0.9, 0, 0x6c737a));
          local.push(makeColoredBox(0.16, 1.9, 0.18, -1.45, 0.95, 0, 0x3b424c));
          local.push(makeColoredBox(0.16, 1.9, 0.18, 1.45, 0.95, 0, 0x3b424c));
        }
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
