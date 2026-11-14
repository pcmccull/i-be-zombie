import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { approachOccluderOpacity } from '../core/cameraMath';
import type {
  AABB,
  BuildingDef,
  DistrictLayout,
  GroundPatch,
  PropDef,
  RoadMarking,
} from '../core/types';

// Palette of 8 faded urban wall colors (indexed by colorIndex & 7)
const BUILDING_WALL_PALETTE: readonly number[] = [
  0xb98b73, // 0: faded terracotta brick
  0xc9b99a, // 1: warm sandy concrete
  0x8fa3ad, // 2: muted slate blue-gray
  0xb5a895, // 3: weathered limestone
  0xa67b68, // 4: aged red-brown masonry
  0x7e8c85, // 5: industrial sage concrete
  0xc2ab83, // 6: faded ochre stucco
  0x8d8892, // 7: cool urban gray
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

const TREE_PALETTE: readonly number[] = [
  0x4a753b,
  0x5a8444,
  0x3e6634,
];

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
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(w, h, d);
  if (rotY !== 0) {
    box.rotateY(rotY);
  }
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
  // Left slice
  if (subject.minX < clipper.minX) {
    result.push({
      minX: subject.minX,
      minZ: subject.minZ,
      maxX: clipper.minX,
      maxZ: subject.maxZ,
    });
  }
  // Right slice
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
    // Top (north) slice
    if (subject.minZ < clipper.minZ) {
      result.push({
        minX: overlapMinX,
        minZ: subject.minZ,
        maxX: overlapMaxX,
        maxZ: clipper.minZ,
      });
    }
    // Bottom (south) slice
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

interface BuildingFadeEntry {
  occluder: THREE.Mesh;
  visualMesh: THREE.Mesh | null;
  material: THREE.MeshLambertMaterial;
  currentOpacity: number;
}

export class CityDistrict {
  readonly group: THREE.Group;
  readonly occluders: THREE.Object3D[];

  private readonly buildingEntries: BuildingFadeEntry[] = [];
  private readonly occluderToEntry = new Map<THREE.Object3D, BuildingFadeEntry>();
  private readonly trafficBulbs: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];

  constructor(layout: DistrictLayout) {
    this.group = new THREE.Group();
    this.group.name = 'CityDistrict';
    this.occluders = [];

    this.buildGroundAndMarkings(layout.bounds, layout.ground, layout.markings);
    this.buildBuildings(layout);
    this.buildProps(layout);
  }

  setOccluderFade(hits: Set<THREE.Object3D>, dt = 1 / 60): void {
    for (let i = 0; i < this.buildingEntries.length; i++) {
      const entry = this.buildingEntries[i];
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

  update(_dt: number, time: number): void {
    for (let i = 0; i < this.trafficBulbs.length; i++) {
      const b = this.trafficBulbs[i];
      const cycle = Math.sin(time * 2.2 + b.phase);
      b.mat.color.setHex(cycle > 0 ? 0xffb347 : 0x553310);
    }
  }

  dispose(): void {
    for (const g of this.disposableGeometries) {
      g.dispose();
    }
    for (const m of this.disposableMaterials) {
      m.dispose();
    }
    this.disposableGeometries.length = 0;
    this.disposableMaterials.length = 0;
    this.buildingEntries.length = 0;
    this.occluderToEntry.clear();
    this.trafficBulbs.length = 0;
    this.group.clear();
  }

  private trackGeometry<T extends THREE.BufferGeometry>(g: T): T {
    this.disposableGeometries.push(g);
    return g;
  }

  private trackMaterial<T extends THREE.Material>(m: T): T {
    this.disposableMaterials.push(m);
    return m;
  }

  private buildGroundAndMarkings(
    bounds: AABB,
    patches: readonly GroundPatch[],
    markings: readonly RoadMarking[],
  ): void {
    const groundGeoms: THREE.BufferGeometry[] = [];

    // 1. Large surrounding ground plane beyond district bounds
    groundGeoms.push(makeColoredBox(560, 0.2, 460, 0, -0.14, 0, 0x353b44));

    // 2. District base slab under all city blocks (sandy concrete / earth base)
    const distW = bounds.maxX - bounds.minX;
    const distD = bounds.maxZ - bounds.minZ;
    const distCx = 0.5 * (bounds.minX + bounds.maxX);
    const distCz = 0.5 * (bounds.minZ + bounds.maxZ);
    groundGeoms.push(makeColoredBox(distW, 0.08, distD, distCx, -0.045, distCz, 0x857f74));

    // Collect road rects so sidewalks stop cleanly at road edges
    const roadRects: AABB[] = [];
    for (const p of patches) {
      if (p.kind === 'road') {
        roadRects.push(p.rect);
      }
    }

    for (const p of patches) {
      const r = p.rect;
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const cx = 0.5 * (r.minX + r.maxX);
      const cz = 0.5 * (r.minZ + r.maxZ);

      if (p.kind === 'road') {
        // Asphalt #4a5260 at y=0
        groundGeoms.push(makeColoredBox(w, 0.04, d, cx, -0.015, cz, 0x4a5260));
      } else if (p.kind === 'sidewalk') {
        // Clip sidewalk against roads so raised 0.15m sidewalks don't cut across intersections
        const pieces = clipRectAgainstList(r, roadRects);
        for (const piece of pieces) {
          const pw = piece.maxX - piece.minX;
          const pd = piece.maxZ - piece.minZ;
          if (pw < 0.2 || pd < 0.2) continue;
          const pcx = 0.5 * (piece.minX + piece.maxX);
          const pcz = 0.5 * (piece.minZ + piece.maxZ);
          // Darker curb outer rim + #a9a294 sidewalk top raised 0.15 m
          groundGeoms.push(makeColoredBox(pw, 0.14, pd, pcx, 0.07, pcz, 0x8c8578));
          const inset = Math.min(0.18, pw * 0.2, pd * 0.2);
          groundGeoms.push(
            makeColoredBox(pw - inset * 2, 0.02, pd - inset * 2, pcx, 0.145, pcz, 0xa9a294),
          );
        }
      } else if (p.kind === 'park') {
        groundGeoms.push(makeColoredBox(w, 0.04, d, cx, 0.0, cz, 0x527644));
        // Subtle darker grass patches inside the park
        groundGeoms.push(makeColoredBox(w * 0.85, 0.015, d * 0.85, cx, 0.022, cz, 0x5b824b));
      } else if (p.kind === 'plaza') {
        // Plaza stone tiles
        groundGeoms.push(makeColoredBox(w + 0.6, 0.05, d + 0.6, cx, 0.015, cz, 0x8f8677));
        groundGeoms.push(makeColoredBox(w, 0.05, d, cx, 0.025, cz, 0xb8ae9c));
        // Decorative center plaza inlay
        groundGeoms.push(makeColoredBox(w * 0.45, 0.02, d * 0.45, cx, 0.052, cz, 0x9e9381));
      } else if (p.kind === 'lot') {
        groundGeoms.push(makeColoredBox(w, 0.03, d, cx, -0.005, cz, 0x676c73));
      } else if (p.kind === 'compound') {
        groundGeoms.push(makeColoredBox(w, 0.04, d, cx, 0.0, cz, 0x76756e));
      }
    }

    const mergedGround = this.trackGeometry(mergeAndDispose(groundGeoms));
    const groundMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    const groundMesh = new THREE.Mesh(mergedGround, groundMat);
    groundMesh.receiveShadow = true;
    groundMesh.name = 'CityGround';
    this.group.add(groundMesh);

    // 3. Road markings slightly above ground (y ~ 0.015..0.025) to avoid z-fighting
    const markingGeoms: THREE.BufferGeometry[] = [];
    for (const m of markings) {
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
        // Draw zebra stripes across the longer axis
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
      const mergedMarkings = this.trackGeometry(mergeAndDispose(markingGeoms));
      const markingMat = this.trackMaterial(
        new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      );
      const markingMesh = new THREE.Mesh(mergedMarkings, markingMat);
      markingMesh.receiveShadow = true;
      markingMesh.name = 'RoadMarkings';
      this.group.add(markingMesh);
    }
  }

  private buildBuildings(layout: DistrictLayout): void {
    const occluderMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    const cpBounds = layout.checkpoint.bounds;

    for (let i = 0; i < layout.buildings.length; i++) {
      const b = layout.buildings[i];
      const fp = b.footprint;
      const w = fp.maxX - fp.minX;
      const d = fp.maxZ - fp.minZ;
      const cx = 0.5 * (fp.minX + fp.maxX);
      const cz = 0.5 * (fp.minZ + fp.maxZ);
      const h = b.height;

      // Render-free volume, expanded below to include every rendered architectural detail.
      const occGeom = this.trackGeometry(new THREE.BoxGeometry(w, h, d));
      const occluder = new THREE.Mesh(occGeom, occluderMat);
      occluder.position.set(cx, h * 0.5, cz);
      occluder.name = `Occluder_${i}`;
      occluder.visible = false; // Raycaster still tests invisible proxies.
      occluder.userData.occlusionVolume = true;
      this.group.add(occluder);
      this.occluders.push(occluder);

      // Checkpoint interior structures (cp-tent-w, cp-tent-e) are built in CheckpointVisual
      const insideCheckpoint =
        cx > cpBounds.minX &&
        cx < cpBounds.maxX &&
        cz > cpBounds.minZ &&
        cz < cpBounds.maxZ &&
        h <= 3.2;

      if (insideCheckpoint) {
        // These buildings render in CheckpointStatic, including a slightly wider
        // roof and a ridge extending 0.3m above the authored collider.
        occluder.userData.checkpointBuilding = true;
        occluder.position.y = (h + 0.3) * 0.5;
        occluder.scale.set((w + 0.3) / w, (h + 0.3) / h, (d + 0.3) / d);
      }

      const bldgMat = this.trackMaterial(
        new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      );

      let visualMesh: THREE.Mesh | null = null;
      if (!insideCheckpoint) {
        const bldgGeom = this.trackGeometry(this.createBuildingGeometry(b));
        bldgGeom.computeBoundingBox();
        const bounds = bldgGeom.boundingBox!;
        // Geometry is authored in world coordinates. Keep the proxy local and axis aligned.
        bounds.getCenter(occluder.position);
        occluder.scale.set(
          (bounds.max.x - bounds.min.x) / w,
          (bounds.max.y - bounds.min.y) / h,
          (bounds.max.z - bounds.min.z) / d,
        );
        visualMesh = new THREE.Mesh(bldgGeom, bldgMat);
        visualMesh.castShadow = true;
        visualMesh.receiveShadow = true;
        visualMesh.name = `Building_${i}_${b.style}`;
        this.group.add(visualMesh);
      }

      const entry: BuildingFadeEntry = {
        occluder,
        visualMesh,
        material: bldgMat,
        currentOpacity: 1.0,
      };
      this.buildingEntries.push(entry);
      this.occluderToEntry.set(occluder, entry);
      if (visualMesh) {
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

    const wallColor = BUILDING_WALL_PALETTE[b.colorIndex & 7];
    const trimColor = 0xa9a294;
    const plinthColor = 0x5c5852;
    const roofTarColor = 0x3a3f46;
    const darkGlassColor = 0x263542;
    const litGlassColor = 0xcbb074;

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

    // 3. Style-specific architectural features
    if (b.style === 'apartment') {
      const floorStep = 3.1;
      // Floor ledges
      for (let y = 3.2; y < h - 0.8; y += floorStep) {
        parts.push(makeColoredBox(w + 0.22, 0.18, d + 0.22, cx, y, cz, trimColor));
      }
      // Window rows on N/S and E/W facades
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
      // Decorative exterior fire-escape staircase on one facade (recessed within footprint margin)
      const stairX = fp.maxX + 0.12;
      for (let y = 2.6; y < h - 1.5; y += floorStep) {
        parts.push(makeColoredBox(0.45, 0.12, 2.4, stairX, y, cz, 0x343a40));
        parts.push(makeColoredBox(0.08, 0.8, 2.4, stairX + 0.2, y + 0.4, cz, 0x343a40));
      }
      // Rooftop water tank + stairwell bulkhead
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
      // Ground floor big shopfront glass & awning on N and S sides
      const shopW = Math.max(2.0, w - 2.4);
      parts.push(makeColoredBox(shopW, 2.5, 0.16, cx, 1.6, fp.minZ - 0.04, 0x2c4252));
      parts.push(makeColoredBox(shopW, 2.5, 0.16, cx, 1.6, fp.maxZ + 0.04, 0x2c4252));
      // Sloped awnings
      parts.push(makeColoredBox(shopW + 0.4, 0.35, 1.1, cx, 3.05, fp.minZ - 0.45, awningColor));
      parts.push(makeColoredBox(shopW + 0.4, 0.35, 1.1, cx, 3.05, fp.maxZ + 0.45, awningColor));
      // Signboard above awning
      parts.push(makeColoredBox(shopW * 0.85, 0.75, 0.22, cx, 3.85, fp.minZ - 0.08, 0x2d3238));
      parts.push(makeColoredBox(shopW * 0.85, 0.75, 0.22, cx, 3.85, fp.maxZ + 0.08, 0x2d3238));
      parts.push(makeColoredBox(shopW * 0.7, 0.42, 0.26, cx, 3.85, fp.minZ - 0.09, 0xe8d9b5));
      parts.push(makeColoredBox(shopW * 0.7, 0.42, 0.26, cx, 3.85, fp.maxZ + 0.09, 0xe8d9b5));
      // Upper floor windows
      for (let y = 5.4; y < h - 1.0; y += 2.8) {
        for (let x = fp.minX + 2.2; x <= fp.maxX - 2.2; x += 3.2) {
          parts.push(makeColoredBox(1.3, 1.4, 0.14, x, y, fp.minZ - 0.04, darkGlassColor));
          parts.push(makeColoredBox(1.3, 1.4, 0.14, x, y, fp.maxZ + 0.04, darkGlassColor));
        }
      }
      // Rooftop sign board
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
      // Large cargo garage doors
      const doorW = Math.min(4.6, w * 0.35);
      const doorH = Math.min(3.8, h * 0.45);
      parts.push(makeColoredBox(doorW, doorH, 0.22, cx, doorH * 0.5, fp.minZ - 0.05, 0x454d57));
      parts.push(makeColoredBox(doorW, doorH, 0.22, cx, doorH * 0.5, fp.maxZ + 0.05, 0x454d57));
      // Clerestory high windows
      if (h >= 7.5) {
        parts.push(makeColoredBox(w - 3.0, 0.9, 0.16, cx, h - 1.6, fp.minZ - 0.04, darkGlassColor));
        parts.push(makeColoredBox(w - 3.0, 0.9, 0.16, cx, h - 1.6, fp.maxZ + 0.04, darkGlassColor));
      }
      // Rooftop industrial vent ridge
      parts.push(makeColoredBox(w * 0.55, 0.9, 2.2, cx, h + 0.5, cz, ribColor));
    } else if (b.style === 'office') {
      // Curtain-wall horizontal window bands + vertical pilasters
      for (let y = 2.6; y < h - 1.0; y += 2.7) {
        parts.push(makeColoredBox(w + 0.14, 1.45, d - 1.6, cx, y, cz, 0x2f4858));
        parts.push(makeColoredBox(w - 1.6, 1.45, d + 0.14, cx, y, cz, 0x2f4858));
      }
      for (let x = fp.minX + 2.5; x <= fp.maxX - 2.5; x += 3.5) {
        parts.push(makeColoredBox(0.32, h, d + 0.2, x, h * 0.5, cz, trimColor));
      }
      // Rooftop mechanical enclosure
      parts.push(makeColoredBox(w * 0.45, 1.8, d * 0.45, cx, h + 0.9, cz, 0x676f78));
    } else if (b.style === 'garage') {
      // Multiple service bay doors + orange-red service stripe
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

  private buildProps(layout: DistrictLayout): void {
    const shadowPropGeoms: THREE.BufferGeometry[] = [];
    const detailPropGeoms: THREE.BufferGeometry[] = [];

    for (let i = 0; i < layout.props.length; i++) {
      const p = layout.props[i];
      this.appendPropGeometry(p, layout.buildings, shadowPropGeoms, detailPropGeoms);
    }

    if (shadowPropGeoms.length > 0) {
      const geom = this.trackGeometry(mergeAndDispose(shadowPropGeoms));
      const mat = this.trackMaterial(
        new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      );
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'CityPropsShadow';
      this.group.add(mesh);
    }

    if (detailPropGeoms.length > 0) {
      const geom = this.trackGeometry(mergeAndDispose(detailPropGeoms));
      const mat = this.trackMaterial(
        new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      );
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = 'CityPropsDetail';
      this.group.add(mesh);
    }
  }

  private appendPropGeometry(
    p: PropDef,
    buildings: readonly BuildingDef[],
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
      case 'car': {
        // 2.0 m wide (X) x 1.7 m tall (Y) x 4.4 m long (Z)
        const bodyCol = CAR_PALETTE[v % CAR_PALETTE.length];
        // Lower chassis + bumpers
        local.push(makeColoredBox(1.92, 0.68, 4.3, 0, 0.56, 0, bodyCol));
        local.push(makeColoredBox(1.98, 0.24, 0.25, 0, 0.36, 2.12, 0x333840));
        local.push(makeColoredBox(1.98, 0.24, 0.25, 0, 0.36, -2.12, 0x333840));
        // Cabin + glass
        local.push(makeColoredBox(1.66, 0.62, 2.15, 0, 1.18, -0.15, bodyCol));
        local.push(makeColoredBox(1.7, 0.46, 1.85, 0, 1.18, -0.15, 0x263440));
        // Headlights & taillights
        local.push(makeColoredBox(0.36, 0.18, 0.08, -0.65, 0.62, 2.14, 0xf5e9b8));
        local.push(makeColoredBox(0.36, 0.18, 0.08, 0.65, 0.62, 2.14, 0xf5e9b8));
        local.push(makeColoredBox(0.38, 0.18, 0.08, -0.65, 0.62, -2.14, 0xd1382c));
        local.push(makeColoredBox(0.38, 0.18, 0.08, 0.65, 0.62, -2.14, 0xd1382c));
        // 4 Wheels
        const wheelPositions: [number, number][] = [
          [-0.92, 1.32],
          [0.92, 1.32],
          [-0.92, -1.32],
          [0.92, -1.32],
        ];
        for (const [wx, wz] of wheelPositions) {
          local.push(makeColoredBox(0.28, 0.62, 0.62, wx, 0.31, wz, 0x1e2226));
        }
        break;
      }

      case 'truck': {
        // 2.6 m wide x 3.0 m tall x 7.0 m long
        const cabColors = [0x3b607d, 0xc78d32, 0x6b7075];
        const boxColors = [0xd8d5cc, 0xbab4a6, 0x8a857c];
        const cabCol = cabColors[v % cabColors.length];
        const cargoCol = boxColors[v % boxColors.length];
        // Chassis frame
        local.push(makeColoredBox(2.3, 0.42, 6.8, 0, 0.5, 0, 0x2b3036));
        // Cab at +Z front
        local.push(makeColoredBox(2.45, 1.85, 2.0, 0, 1.45, 2.35, cabCol));
        local.push(makeColoredBox(2.48, 0.68, 1.2, 0, 1.75, 2.55, 0x263542));
        // Cargo box at rear
        local.push(makeColoredBox(2.58, 2.35, 4.6, 0, 1.82, -1.05, cargoCol));
        local.push(makeColoredBox(2.62, 0.25, 4.64, 0, 1.82, -1.05, cabCol));
        // 6 Wheels
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
        // 2.0 x 1.4 x 1.2 m
        const dumpCol = v % 2 === 0 ? 0x3b5e47 : 0x34506b;
        local.push(makeColoredBox(1.96, 1.22, 1.16, 0, 0.61, 0, dumpCol));
        local.push(makeColoredBox(2.04, 0.14, 1.24, 0, 1.15, 0, 0x2b3036));
        local.push(makeColoredBox(0.92, 0.16, 1.18, -0.48, 1.3, 0, 0x22262b));
        local.push(makeColoredBox(0.92, 0.16, 1.18, 0.48, 1.3, 0, 0x22262b));
        break;
      }

      case 'barrier': {
        // Concrete Jersey barrier 3.0 x 1.1 x 0.9 m
        local.push(makeColoredBox(2.96, 0.42, 0.88, 0, 0.21, 0, 0x9e988c));
        local.push(makeColoredBox(2.94, 0.68, 0.46, 0, 0.76, 0, 0xb5ae9e));
        local.push(makeColoredBox(0.7, 0.18, 0.5, -0.8, 0.96, 0, 0xe0782a));
        local.push(makeColoredBox(0.7, 0.18, 0.5, 0.8, 0.96, 0, 0xe0782a));
        break;
      }

      case 'sandbags': {
        // 4.0 x 1.1 x 1.0 m stacked sandbag wall
        const bagCol1 = 0xa89674;
        const bagCol2 = 0x968463;
        local.push(makeColoredBox(3.95, 0.4, 0.95, 0, 0.2, 0, bagCol1));
        local.push(makeColoredBox(3.75, 0.38, 0.82, 0, 0.58, 0, bagCol2));
        local.push(makeColoredBox(3.45, 0.34, 0.68, 0, 0.93, 0, bagCol1));
        break;
      }

      case 'tree': {
        const canopyCol = TREE_PALETTE[v % TREE_PALETTE.length];
        local.push(makeColoredCylinder(0.22, 0.34, 2.2, 6, 0, 1.1, 0, 0x5e4532));
        local.push(makeColoredCylinder(0.1, 1.85, 2.4, 7, 0, 2.9, 0, canopyCol));
        local.push(makeColoredCylinder(0.08, 1.45, 2.1, 7, 0, 4.2, 0, canopyCol));
        local.push(makeColoredCylinder(0.04, 0.95, 1.5, 7, 0, 5.2, 0, 0x628f4b));
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

      case 'streetlight': {
        baseY = 0.14;
        local.push(makeColoredCylinder(0.08, 0.14, 5.4, 6, 0, 2.7, 0, 0x4c545e));
        local.push(makeColoredBox(0.12, 0.12, 1.6, 0, 5.35, 0.72, 0x4c545e));
        local.push(makeColoredBox(0.36, 0.16, 0.56, 0, 5.32, 1.42, 0x373d45));
        local.push(makeColoredBox(0.28, 0.08, 0.42, 0, 5.22, 1.42, 0xffe49e));
        break;
      }

      case 'trafficLight': {
        baseY = 0.14;
        local.push(makeColoredCylinder(0.1, 0.14, 5.2, 6, 0, 2.6, 0, 0x3d434c));
        local.push(makeColoredBox(3.4, 0.14, 0.14, 1.65, 4.9, 0, 0x3d434c));
        local.push(makeColoredBox(0.36, 1.05, 0.36, 2.9, 4.65, 0, 0xd49b2a));
        local.push(makeColoredBox(0.22, 0.22, 0.4, 2.9, 4.95, 0, 0xe8453c));
        local.push(makeColoredBox(0.22, 0.22, 0.4, 2.9, 4.35, 0, 0x4cd964));

        // Animated blinking amber bulb mesh for CityDistrict.update()
        const bulbGeom = this.trackGeometry(new THREE.BoxGeometry(0.24, 0.24, 0.42));
        const bulbMat = this.trackMaterial(new THREE.MeshBasicMaterial({ color: 0xffb347 }));
        const bulbMesh = new THREE.Mesh(bulbGeom, bulbMat);
        const offset = new THREE.Vector3(2.9, baseY + 4.65, 0).applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          rot,
        );
        bulbMesh.position.set(x + offset.x, offset.y, z + offset.z);
        bulbMesh.rotation.y = rot;
        this.group.add(bulbMesh);
        this.trafficBulbs.push({ mesh: bulbMesh, mat: bulbMat, phase: (x + z) * 0.17 });
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
        local.push(makeColoredBox(3.0, 1.8, 0.12, 0, 0.9, 0, 0x6c737a));
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
        // Place rooftop AC unit on the roof of the building containing (x, z)
        baseY = 8.0;
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
