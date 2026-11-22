// [3D] Render-only world-edge boundary dressing (from layout.boundaries) and distant backdrop
// (from layout.backdrop). Instanced, never pickable, never in occluders, fog: true, no cast shadows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  AABB,
  BackdropDef,
  ColliderDef,
  DistrictLayout,
  Rng,
  WorldBoundarySegment,
} from '../core/types';
import { mulberry32 } from '../utils/rng';

const CONTAINER_PALETTE: readonly number[] = [
  0xe0782a, // orange
  0x2c3e66, // navy
  0x2e8b84, // teal
  0x9a4a2a, // rust
  0xe8c547, // quarantine yellow
];

const WRECK_PALETTE: readonly number[] = [
  0x7a483b,
  0x4c5866,
  0x6e6a5c,
  0x8c5a32,
  0x525c54,
  0xc89232,
];

const MANGROVE_PALETTE: readonly number[] = [
  0x3f6b3a,
  0x2e5230,
  0x497842,
  0x355e34,
];

const SKYLINE_PALETTE: readonly number[] = [
  0x4d5866,
  0x5b6778,
  0x424b57,
  0x687485,
  0x3a434f,
];

interface InstanceItem {
  x: number;
  y: number;
  z: number;
  rotY: number;
  rotX: number;
  rotZ: number;
  sx: number;
  sy: number;
  sz: number;
  color?: number;
}

interface AnimatedWater {
  mesh: THREE.Mesh;
  base: Float32Array;
  baseY: number;
}

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

function makeBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
  rotY = 0,
  rotX = 0,
  rotZ = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotX !== 0) g.rotateX(rotX);
  if (rotY !== 0) g.rotateY(rotY);
  if (rotZ !== 0) g.rotateZ(rotZ);
  g.translate(x, y, z);
  const painted = paintGeometry(g, color);
  g.dispose();
  return painted;
}

function makeCylinder(
  rTop: number,
  rBottom: number,
  h: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segs);
  g.translate(x, y, z);
  const painted = paintGeometry(g, color);
  g.dispose();
  return painted;
}

function makeCone(
  r: number,
  h: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, segs);
  g.translate(x, y, z);
  const painted = paintGeometry(g, color);
  g.dispose();
  return painted;
}

function mergeAndDispose(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geoms.length === 0) {
    return makeBox(0.01, 0.01, 0.01, 0, -20, 0, 0x000000);
  }
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return merged;
}

function insideRect(r: AABB, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

export class BoundaryScenery {
  readonly root = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly waters: AnimatedWater[] = [];
  private readonly bandMat: THREE.MeshLambertMaterial;
  private readonly backdropMat: THREE.MeshLambertMaterial;
  private readonly waterMat: THREE.MeshLambertMaterial;
  private disposed = false;

  /** Approximate draw calls created for band + backdrop. */
  readonly drawCalls: number;

  constructor(scene: THREE.Scene, layout: DistrictLayout) {
    this.root.name = 'BoundaryScenery';
    this.bandMat = this.keep(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true }),
    );
    this.backdropMat = this.keep(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true }),
    );
    this.waterMat = this.keep(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true }),
    );

    const colliderByTag = new Map<string, ColliderDef>();
    for (const c of layout.colliders) {
      if (c.kind === 'boundary' && c.tag) {
        colliderByTag.set(c.tag, c);
      }
    }

    let calls = 0;
    calls += this.buildBand(layout, colliderByTag);
    calls += this.buildBackdrop(layout);
    this.drawCalls = calls;

    scene.add(this.root);
  }

  update(time: number): void {
    if (this.disposed) return;
    for (const w of this.waters) {
      const pos = w.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const base = w.base;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i];
        const z = base[i + 2];
        arr[i + 1] =
          base[i + 1] +
          Math.sin(x * 0.04 + time * 0.85) * 0.24 +
          Math.sin(z * 0.06 - time * 1.1 + x * 0.015) * 0.18;
      }
      pos.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.waters.length = 0;
    this.root.clear();
    this.root.removeFromParent();
  }

  private keep<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  private addInstanced(
    name: string,
    geom: THREE.BufferGeometry,
    mat: THREE.Material,
    items: InstanceItem[],
    receiveShadow: boolean,
  ): number {
    if (items.length === 0) {
      geom.dispose();
      return 0;
    }
    this.keep(geom);
    const mesh = new THREE.InstancedMesh(geom, mat, items.length);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = receiveShadow;
    mesh.frustumCulled = true;

    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const euler = new THREE.Euler();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const col = new THREE.Color();
    let hasColors = false;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      pos.set(it.x, it.y, it.z);
      euler.set(it.rotX, it.rotY, it.rotZ, 'YXZ');
      quat.setFromEuler(euler);
      scale.set(it.sx, it.sy, it.sz);
      m4.compose(pos, quat, scale);
      mesh.setMatrixAt(i, m4);
      if (it.color !== undefined) {
        hasColors = true;
        mesh.setColorAt(i, col.setHex(it.color));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (hasColors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.keep(mesh);
    this.root.add(mesh);
    return 1;
  }

  private buildBand(layout: DistrictLayout, colliderByTag: Map<string, ColliderDef>): number {
    if (layout.boundaries.length === 0) return 0;

    const seawalls: InstanceItem[] = [];
    const bandWater: InstanceItem[] = [];
    const fences: InstanceItem[] = [];
    const wrecks: InstanceItem[] = [];
    const debris: InstanceItem[] = [];
    const containers: InstanceItem[] = [];
    const milWalls: InstanceItem[] = [];
    const watchtowers: InstanceItem[] = [];
    const mangroves: InstanceItem[] = [];
    const bridgeSlabs: InstanceItem[] = [];
    const barriers: InstanceItem[] = [];

    for (const seg of layout.boundaries) {
      const rng = mulberry32(seg.scenerySeed);
      const rects = this.resolveSegmentRects(seg, layout, colliderByTag);
      for (const rect of rects) {
        this.populateSegmentRect(seg, rect, layout.playArea, rng, {
          seawalls,
          bandWater,
          fences,
          wrecks,
          debris,
          containers,
          milWalls,
          watchtowers,
          mangroves,
          bridgeSlabs,
          barriers,
        });
      }
    }

    let calls = 0;
    calls += this.addInstanced('BandSeawalls', this.geomSeawall(), this.bandMat, seawalls, true);
    calls += this.addInstanced('BandWater', this.geomWaterSlab(), this.bandMat, bandWater, true);
    calls += this.addInstanced('BandFences', this.geomChainFence(), this.bandMat, fences, true);
    calls += this.addInstanced('BandWrecks', this.geomWreck(), this.bandMat, wrecks, true);
    calls += this.addInstanced('BandDebris', this.geomConcreteDebris(), this.bandMat, debris, true);
    calls += this.addInstanced('BandContainers', this.geomContainer(), this.bandMat, containers, true);
    calls += this.addInstanced('BandMilWalls', this.geomMilitaryWall(), this.bandMat, milWalls, true);
    calls += this.addInstanced('BandWatchtowers', this.geomWatchtower(), this.bandMat, watchtowers, true);
    calls += this.addInstanced('BandMangroves', this.geomMangrove(), this.bandMat, mangroves, true);
    calls += this.addInstanced('BandBridgeSlabs', this.geomBridgeSlab(), this.bandMat, bridgeSlabs, true);
    calls += this.addInstanced('BandJerseyBarriers', this.geomJerseyBarrier(), this.bandMat, barriers, true);
    return calls;
  }

  private resolveSegmentRects(
    seg: WorldBoundarySegment,
    layout: DistrictLayout,
    colliderByTag: Map<string, ColliderDef>,
  ): { rect: AABB; height: number }[] {
    const out: { rect: AABB; height: number }[] = [];
    for (const tag of seg.colliderTags) {
      const c = colliderByTag.get(tag);
      if (c) out.push({ rect: c, height: c.height });
    }
    if (out.length > 0) return out;

    // Fallback if a fixture has no colliderTags: extrude polyline into band.
    if (seg.points.length >= 2) {
      const a = seg.points[0];
      const b = seg.points[seg.points.length - 1];
      const p = layout.playArea;
      const wb = layout.bounds;
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minZ = Math.min(a.z, b.z);
      const maxZ = Math.max(a.z, b.z);
      const alongX = maxX - minX >= maxZ - minZ;
      if (alongX) {
        const isSouth = Math.abs(a.z - p.maxZ) < 1;
        out.push({
          rect: {
            minX,
            maxX,
            minZ: isSouth ? p.maxZ : wb.minZ,
            maxZ: isSouth ? wb.maxZ : p.minZ,
          },
          height: 3.5,
        });
      } else {
        const isEast = Math.abs(a.x - p.maxX) < 1;
        out.push({
          rect: {
            minX: isEast ? p.maxX : wb.minX,
            maxX: isEast ? wb.maxX : p.minX,
            minZ,
            maxZ,
          },
          height: 3.5,
        });
      }
    }
    return out;
  }

  private populateSegmentRect(
    seg: WorldBoundarySegment,
    entry: { rect: AABB; height: number },
    playArea: AABB,
    rng: Rng,
    out: {
      seawalls: InstanceItem[];
      bandWater: InstanceItem[];
      fences: InstanceItem[];
      wrecks: InstanceItem[];
      debris: InstanceItem[];
      containers: InstanceItem[];
      milWalls: InstanceItem[];
      watchtowers: InstanceItem[];
      mangroves: InstanceItem[];
      bridgeSlabs: InstanceItem[];
      barriers: InstanceItem[];
    },
  ): void {
    const r = entry.rect;
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const alongX = w >= d;
    const runMin = alongX ? r.minX : r.minZ;
    const runMax = alongX ? r.maxX : r.maxZ;
    const runLen = runMax - runMin;

    // Determine inner (playArea-facing) edge & outward normal sign.
    let innerPos: number;
    let outSign: number;
    let baseYaw: number;
    if (alongX) {
      const south = Math.abs(r.minZ - playArea.maxZ) <= Math.abs(r.maxZ - playArea.minZ);
      innerPos = south ? r.minZ : r.maxZ;
      outSign = south ? 1 : -1;
      baseYaw = south ? 0 : Math.PI;
    } else {
      const east = Math.abs(r.minX - playArea.maxX) <= Math.abs(r.maxX - playArea.minX);
      innerPos = east ? r.minX : r.maxX;
      outSign = east ? 1 : -1;
      baseYaw = east ? Math.PI * 0.5 : -Math.PI * 0.5;
    }

    const place = (
      list: InstanceItem[],
      tAlong: number,
      distOut: number,
      y: number,
      rotY: number,
      sx: number,
      sy: number,
      sz: number,
      color?: number,
      rotX = 0,
      rotZ = 0,
    ) => {
      const x = alongX ? tAlong : innerPos + outSign * distOut;
      const z = alongX ? innerPos + outSign * distOut : tAlong;
      list.push({ x, y, z, rotY, rotX, rotZ, sx, sy, sz, color });
    };

    switch (seg.kind) {
      case 'deep_water': {
        const step = 6;
        const count = Math.max(1, Math.ceil(runLen / step));
        const segLen = runLen / count;
        for (let i = 0; i < count; i++) {
          const t = runMin + (i + 0.5) * segLen;
          const hScale = (0.95 + rng.next() * 0.15) * Math.max(0.8, entry.height);
          place(out.seawalls, t, 1.0, 0, baseYaw, segLen / 6 + 0.02, hScale, 1);
          place(out.bandWater, t, 11.0, -0.35, baseYaw, segLen / 6 + 0.02, 1, 18 / 18);
        }
        break;
      }

      case 'urban_fence': {
        const step = 4;
        const count = Math.max(1, Math.ceil(runLen / step));
        const segLen = runLen / count;
        for (let i = 0; i < count; i++) {
          const t = runMin + (i + 0.5) * segLen;
          const hScale = (entry.height / 3.0) * (0.94 + rng.next() * 0.12);
          place(out.fences, t, 0.7, 0, baseYaw, segLen / 4 + 0.02, hScale, 1);
          if (rng.next() < 0.35) {
            place(
              out.barriers,
              t + (rng.next() - 0.5) * 1.5,
              3.5 + rng.next() * 4,
              0,
              baseYaw + (rng.next() - 0.5) * 0.5,
              1,
              1,
              1,
            );
          }
          if (rng.next() < 0.25) {
            place(
              out.debris,
              t,
              8 + rng.next() * 8,
              0,
              rng.next() * Math.PI * 2,
              0.8 + rng.next() * 0.4,
              0.5 + rng.next() * 0.3,
              0.8 + rng.next() * 0.4,
            );
          }
        }
        break;
      }

      case 'vehicle_blockade': {
        const step = 5.0;
        const count = Math.max(1, Math.ceil(runLen / step));
        const segLen = runLen / count;
        for (let i = 0; i < count; i++) {
          const t = runMin + (i + 0.5) * segLen;
          const col = WRECK_PALETTE[Math.floor(rng.next() * WRECK_PALETTE.length)];
          const yaw = baseYaw + (rng.next() - 0.5) * 0.45;
          const sy = Math.max(0.95, entry.height / 1.8) * (0.95 + rng.next() * 0.25);
          place(out.wrecks, t, 2.1 + rng.next() * 0.8, 0, yaw, 1.05, sy, 1.05, col);
          if (i % 2 === 0) {
            place(out.barriers, t + segLen * 0.35, 0.9, 0, baseYaw + (rng.next() - 0.5) * 0.2, 1.1, 1.1, 1);
          }
          if (rng.next() < 0.75) {
            const col2 = WRECK_PALETTE[Math.floor(rng.next() * WRECK_PALETTE.length)];
            place(
              out.wrecks,
              t + (rng.next() - 0.5) * 2.0,
              8.0 + rng.next() * 7.0,
              0,
              rng.next() * Math.PI * 2,
              1,
              0.9 + rng.next() * 0.3,
              1,
              col2,
            );
          }
        }
        break;
      }

      case 'concrete_debris': {
        const step = 4.4;
        const count = Math.max(1, Math.ceil(runLen / step));
        const segLen = runLen / count;
        for (let i = 0; i < count; i++) {
          const t = runMin + (i + 0.5) * segLen;
          const hScale = (entry.height / 3.5) * (0.9 + rng.next() * 0.22);
          place(
            out.debris,
            t,
            2.2 + rng.next() * 1.0,
            0,
            baseYaw + (rng.next() - 0.5) * 0.4,
            segLen / 4.2 + 0.15,
            hScale,
            1.15,
          );
          if (rng.next() < 0.7) {
            place(
              out.debris,
              t + (rng.next() - 0.5) * 2.0,
              8.5 + rng.next() * 7.5,
              0,
              rng.next() * Math.PI * 2,
              0.9 + rng.next() * 0.4,
              hScale * (0.7 + rng.next() * 0.4),
              1.0 + rng.next() * 0.4,
            );
          }
        }
        break;
      }

      case 'shipping_containers': {
        const step = 6.2;
        const count = Math.max(1, Math.ceil(runLen / step));
        const segLen = runLen / count;
        for (let i = 0; i < count; i++) {
          const t = runMin + (i + 0.5) * segLen;
          const c1 = CONTAINER_PALETTE[Math.floor(rng.next() * CONTAINER_PALETTE.length)];
          const c2 = CONTAINER_PALETTE[Math.floor(rng.next() * CONTAINER_PALETTE.length)];
          const yaw1 = baseYaw + (rng.next() - 0.5) * 0.12;
          const yaw2 = baseYaw + (rng.next() - 0.5) * 0.18;
          const sx = segLen / 6.0 + 0.04;
          // Bottom container (0..2.6 m)
          place(out.containers, t, 2.3, 0, yaw1, sx, 1, 1, c1);
          // Top container (2.6..5.2 m)
          place(out.containers, t + (rng.next() - 0.5) * 0.4, 2.4 + (rng.next() - 0.5) * 0.3, 2.6, yaw2, sx * 0.96, 1, 1, c2);
          // Second row deeper in band
          if (rng.next() < 0.8) {
            const c3 = CONTAINER_PALETTE[Math.floor(rng.next() * CONTAINER_PALETTE.length)];
            place(out.containers, t, 9.5 + rng.next() * 4.5, 0, baseYaw + (rng.next() - 0.5) * 0.3, 1, 1, 1, c3);
          }
        }
        break;
      }

      case 'military_perimeter': {
        const step = 5.0;
        const count = Math.max(1, Math.ceil(runLen / step));
        const segLen = runLen / count;
        for (let i = 0; i < count; i++) {
          const t = runMin + (i + 0.5) * segLen;
          const hScale = (entry.height / 4.0) * (0.96 + rng.next() * 0.1);
          place(out.milWalls, t, 1.3, 0, baseYaw, segLen / 5.0 + 0.02, hScale, 1);
          if (i % 6 === 2 || (count < 4 && i === 0)) {
            place(out.watchtowers, t, 5.2, 0, baseYaw, 1, 1, 1);
          }
          if (rng.next() < 0.45) {
            place(out.barriers, t, 10 + rng.next() * 5, 0, baseYaw + (rng.next() - 0.5) * 0.2, 1.2, 1.2, 1.2);
          }
        }
        break;
      }

      case 'mangrove_barrier': {
        const step = 4.5;
        const count = Math.max(1, Math.ceil(runLen / step));
        const segLen = runLen / count;
        for (let i = 0; i < count; i++) {
          const t = runMin + (i + 0.5) * segLen;
          place(out.bandWater, t, 10.0, -0.38, baseYaw, segLen / 6 + 0.1, 1, 1);
          const col1 = MANGROVE_PALETTE[Math.floor(rng.next() * MANGROVE_PALETTE.length)];
          const s1 = (entry.height / 5.0) * (0.9 + rng.next() * 0.3);
          place(out.mangroves, t + (rng.next() - 0.5) * 1.2, 2.5 + rng.next() * 2.0, 0, rng.next() * Math.PI * 2, s1, s1, s1, col1);
          const col2 = MANGROVE_PALETTE[Math.floor(rng.next() * MANGROVE_PALETTE.length)];
          const s2 = (entry.height / 5.0) * (0.85 + rng.next() * 0.35);
          place(out.mangroves, t + (rng.next() - 0.5) * 2.0, 8.5 + rng.next() * 6.5, 0, rng.next() * Math.PI * 2, s2, s2, s2, col2);
        }
        break;
      }

      case 'collapsed_bridge': {
        const step = 7.5;
        const count = Math.max(1, Math.ceil(runLen / step));
        const segLen = runLen / count;
        for (let i = 0; i < count; i++) {
          const t = runMin + (i + 0.5) * segLen;
          const tilt = (i % 2 === 0 ? 1 : -1) * (0.18 + rng.next() * 0.16);
          const hScale = Math.max(0.9, entry.height / 4.0);
          place(
            out.bridgeSlabs,
            t,
            5.0 + (rng.next() - 0.5) * 1.5,
            0.9,
            baseYaw + (rng.next() - 0.5) * 0.18,
            segLen / 7.2 + 0.08,
            hScale,
            1,
            undefined,
            tilt,
            (rng.next() - 0.5) * 0.08,
          );
          place(out.barriers, t, 1.0, 0, baseYaw, 1.2, 1.1, 1);
          if (rng.next() < 0.6) {
            const col = WRECK_PALETTE[Math.floor(rng.next() * WRECK_PALETTE.length)];
            place(out.wrecks, t + (rng.next() - 0.5) * 2, 12.5 + rng.next() * 3, 0, baseYaw + (rng.next() - 0.5) * 0.6, 1, 1, 1, col);
          }
        }
        break;
      }
    }
  }

  private buildBackdrop(layout: DistrictLayout): number {
    if (layout.backdrop.length === 0) return 0;

    const airfields = layout.backdrop.filter((b) => b.kind === 'airfield');
    const skylineItems: InstanceItem[] = [];
    const mangroveItems: InstanceItem[] = [];
    const highwayItems: InstanceItem[] = [];
    const hangarItems: InstanceItem[] = [];
    const groundGeoms: THREE.BufferGeometry[] = [];
    let calls = 0;

    for (const def of layout.backdrop) {
      const rng = mulberry32(def.seed);
      const r = def.rect;
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const cx = 0.5 * (r.minX + r.maxX);
      const cz = 0.5 * (r.minZ + r.maxZ);

      switch (def.kind) {
        case 'ocean': {
          calls += this.addBackdropWater('BackdropOcean', r, -0.45, 0x2f8fa3, 0x1d5f78, 'south');
          break;
        }
        case 'bay': {
          calls += this.addBackdropWater('BackdropBay', r, -0.46, 0x2f8fa3, 0x1d5f78, 'east');
          break;
        }
        case 'mangroves': {
          groundGeoms.push(makeBox(w, 0.2, d, cx, -0.22, cz, 0x2a402c));
          const step = 18;
          for (let x = r.minX + 9; x < r.maxX - 4; x += step) {
            for (let z = r.minZ + 9; z < r.maxZ - 4; z += step) {
              const px = x + (rng.next() - 0.5) * 10;
              const pz = z + (rng.next() - 0.5) * 10;
              if (airfields.some((af) => insideRect(af.rect, px, pz))) continue;
              const sc = 1.1 + rng.next() * 1.1;
              const col = MANGROVE_PALETTE[Math.floor(rng.next() * MANGROVE_PALETTE.length)];
              mangroveItems.push({
                x: px,
                y: -0.1,
                z: pz,
                rotY: rng.next() * Math.PI * 2,
                rotX: 0,
                rotZ: 0,
                sx: sc,
                sy: sc * (0.9 + rng.next() * 0.4),
                sz: sc,
                color: col,
              });
            }
          }
          break;
        }
        case 'highway': {
          groundGeoms.push(makeBox(w, 0.2, d, cx, -0.2, cz, 0x3b4046));
          const spanStep = 28;
          for (let x = r.minX + 14; x < r.maxX - 8; x += spanStep) {
            const broken = rng.next() < 0.25;
            highwayItems.push({
              x,
              y: broken ? 4.2 : 5.5,
              z: cz,
              rotY: 0,
              rotX: broken ? (rng.next() - 0.5) * 0.22 : 0,
              rotZ: broken ? (rng.next() - 0.5) * 0.14 : 0,
              sx: broken ? 0.82 : 1.0,
              sy: 1,
              sz: 1,
            });
          }
          break;
        }
        case 'skyline': {
          groundGeoms.push(makeBox(w, 0.2, d, cx, -0.24, cz, 0x353b44));
          const stepX = 34;
          const stepZ = 38;
          for (let x = r.minX + 16; x < r.maxX - 10; x += stepX) {
            for (let z = r.minZ + 18; z < r.maxZ - 12; z += stepZ) {
              const px = x + (rng.next() - 0.5) * 14;
              const pz = z + (rng.next() - 0.5) * 14;
              if (airfields.some((af) => insideRect(af.rect, px, pz))) continue;
              const bw = 14 + rng.next() * 14;
              const bd = 14 + rng.next() * 14;
              const bh = 24 + rng.next() * 58;
              const col = SKYLINE_PALETTE[Math.floor(rng.next() * SKYLINE_PALETTE.length)];
              skylineItems.push({
                x: px,
                y: 0,
                z: pz,
                rotY: (rng.next() - 0.5) * 0.12,
                rotX: 0,
                rotZ: 0,
                sx: bw,
                sy: bh,
                sz: bd,
                color: col,
              });
            }
          }
          break;
        }
        case 'airfield': {
          // Drawn slightly above surrounding backdrop ground so overlaps stay clean.
          groundGeoms.push(makeBox(w, 0.2, d, cx, -0.08, cz, 0x464c54));
          // Runway strip + centerline dashes
          const alongX = w >= d;
          const runW = alongX ? w * 0.86 : 26;
          const runD = alongX ? 26 : d * 0.86;
          groundGeoms.push(makeBox(runW, 0.04, runD, cx, 0.03, cz, 0x30353b));
          if (alongX) {
            for (let x = cx - runW * 0.44; x <= cx + runW * 0.44; x += 18) {
              groundGeoms.push(makeBox(9, 0.05, 1.2, x, 0.045, cz, 0xd8d2c2));
            }
          } else {
            for (let z = cz - runD * 0.44; z <= cz + runD * 0.44; z += 18) {
              groundGeoms.push(makeBox(1.2, 0.05, 9, cx, 0.045, z, 0xd8d2c2));
            }
          }
          // A few hangars along one side of the airfield
          const hangarCount = 3;
          for (let i = 0; i < hangarCount; i++) {
            const hx = r.minX + ((i + 0.5) / hangarCount) * w * 0.75 + 20;
            const hz = r.maxZ - 26;
            hangarItems.push({
              x: Math.min(r.maxX - 24, hx),
              y: 0.02,
              z: Math.max(r.minZ + 24, hz),
              rotY: 0,
              rotX: 0,
              rotZ: 0,
              sx: 1,
              sy: 0.9 + rng.next() * 0.3,
              sz: 1,
            });
          }
          break;
        }
      }
    }

    if (groundGeoms.length > 0) {
      const merged = this.keep(mergeAndDispose(groundGeoms));
      const mesh = new THREE.Mesh(merged, this.backdropMat);
      mesh.name = 'BackdropGround';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
      calls++;
    }

    calls += this.addInstanced('BackdropSkyline', this.geomSkylineBox(), this.backdropMat, skylineItems, false);
    calls += this.addInstanced('BackdropMangroves', this.geomMangrove(), this.backdropMat, mangroveItems, false);
    calls += this.addInstanced('BackdropHighway', this.geomHighwaySpan(), this.backdropMat, highwayItems, false);
    calls += this.addInstanced('BackdropHangars', this.geomHangar(), this.backdropMat, hangarItems, false);

    return calls;
  }

  private addBackdropWater(
    name: string,
    rect: AABB,
    y: number,
    shallowHex: number,
    deepHex: number,
    dir: 'south' | 'east',
  ): number {
    const w = rect.maxX - rect.minX;
    const d = rect.maxZ - rect.minZ;
    const geo = this.keep(new THREE.PlaneGeometry(w, d, 24, 16));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0.5 * (rect.minX + rect.maxX), y, 0.5 * (rect.minZ + rect.maxZ));

    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const base = new Float32Array(pos.array as Float32Array);
    const colors = new Float32Array(pos.count * 3);
    const shallow = new THREE.Color(shallowHex);
    const deep = new THREE.Color(deepHex);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const t =
        dir === 'south'
          ? Math.min(1, Math.max(0, (pos.getZ(i) - rect.minZ) / Math.max(1, d * 0.55)))
          : Math.min(1, Math.max(0, (pos.getX(i) - rect.minX) / Math.max(1, w * 0.55)));
      c.copy(shallow).lerp(deep, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mesh = new THREE.Mesh(geo, this.waterMat);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.waters.push({ mesh, base, baseY: y });
    return 1;
  }

  // ---- Shared low-poly prop geometries ---------------------------------------------------------

  private geomSeawall(): THREE.BufferGeometry {
    return mergeAndDispose([
      makeBox(6.0, 1.0, 1.8, 0, 0.5, 0, 0xb8b2a4),
      makeBox(6.04, 0.2, 2.0, 0, 1.0, 0, 0x9c9688),
      makeCylinder(0.16, 0.18, 0.5, 6, -2.0, 1.25, 0, 0x3a3f45),
      makeCylinder(0.16, 0.18, 0.5, 6, 2.0, 1.25, 0, 0x3a3f45),
    ]);
  }

  private geomWaterSlab(): THREE.BufferGeometry {
    return makeBox(6.0, 0.2, 18.0, 0, 0, 0, 0x247990);
  }

  private geomChainFence(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [
      makeBox(4.0, 0.28, 0.36, 0, 0.14, 0, 0x9e988c),
      makeBox(3.9, 2.55, 0.08, 0, 1.55, 0, 0x7a8590),
      makeBox(4.0, 0.1, 0.12, 0, 2.86, 0, 0x4c545e),
      makeCylinder(0.08, 0.09, 3.0, 5, -1.95, 1.5, 0, 0x3b424c),
      makeCylinder(0.08, 0.09, 3.0, 5, 1.95, 1.5, 0, 0x3b424c),
    ];
    return mergeAndDispose(parts);
  }

  private geomWreck(): THREE.BufferGeometry {
    return mergeAndDispose([
      makeBox(4.4, 0.72, 1.95, 0, 0.58, 0, 0xffffff),
      makeBox(2.2, 0.58, 1.72, -0.25, 1.22, 0, 0xffffff),
      makeBox(1.9, 0.42, 1.74, -0.25, 1.22, 0, 0x222a30),
      makeBox(0.62, 0.6, 0.3, 1.35, 0.3, 0.92, 0x1b1e22),
      makeBox(0.62, 0.6, 0.3, -1.35, 0.3, 0.92, 0x1b1e22),
      makeBox(0.62, 0.6, 0.3, 1.35, 0.3, -0.92, 0x1b1e22),
      makeBox(0.62, 0.6, 0.3, -1.35, 0.3, -0.92, 0x1b1e22),
    ]);
  }

  private geomConcreteDebris(): THREE.BufferGeometry {
    return mergeAndDispose([
      makeBox(3.8, 1.4, 2.2, 0, 0.7, 0, 0x8c8578, 0.05, 0.12),
      makeBox(3.2, 1.3, 1.9, 0.2, 1.8, 0.15, 0xa9a294, -0.14, -0.22, 0.18),
      makeBox(2.4, 1.1, 1.6, -0.3, 2.7, -0.1, 0xb8b2a4, 0.2, 0.18, -0.2),
      // Rebar spikes
      makeBox(0.08, 1.6, 0.08, -0.6, 3.1, 0.2, 0x3a3f45, 0, 0.35, 0.25),
      makeBox(0.08, 1.5, 0.08, 0.5, 3.0, -0.2, 0x3a3f45, 0, -0.3, -0.3),
      makeBox(0.08, 1.4, 0.08, 0.1, 3.2, 0.3, 0x3a3f45, 0, 0.2, -0.35),
    ]);
  }

  private geomContainer(): THREE.BufferGeometry {
    return mergeAndDispose([
      makeBox(5.9, 2.55, 2.45, 0, 1.28, 0, 0xffffff),
      makeBox(6.0, 0.16, 2.54, 0, 0.08, 0, 0xd8d8d8),
      makeBox(6.0, 0.16, 2.54, 0, 2.48, 0, 0xd8d8d8),
    ]);
  }

  private geomMilitaryWall(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [
      makeBox(5.0, 3.4, 1.2, 0, 1.7, 0, 0x5b6340),
      makeBox(5.04, 0.3, 1.32, 0, 3.4, 0, 0x8a887c),
      makeBox(5.02, 0.24, 1.26, 0, 2.7, 0, 0xe8c547),
    ];
    // Razor-wire zigzag silhouette on top
    for (let x = -2.0; x <= 2.0; x += 0.8) {
      parts.push(makeBox(0.9, 0.08, 0.08, x, 3.85, 0, 0x3a3f45, 0, 0, 0.7));
      parts.push(makeBox(0.9, 0.08, 0.08, x + 0.3, 3.85, 0, 0x3a3f45, 0, 0, -0.7));
    }
    return mergeAndDispose(parts);
  }

  private geomWatchtower(): THREE.BufferGeometry {
    return mergeAndDispose([
      makeCylinder(0.14, 0.18, 4.4, 5, -1.1, 2.2, -1.1, 0x454c40),
      makeCylinder(0.14, 0.18, 4.4, 5, 1.1, 2.2, -1.1, 0x454c40),
      makeCylinder(0.14, 0.18, 4.4, 5, -1.1, 2.2, 1.1, 0x454c40),
      makeCylinder(0.14, 0.18, 4.4, 5, 1.1, 2.2, 1.1, 0x454c40),
      makeBox(2.9, 0.3, 2.9, 0, 4.3, 0, 0x5b6340),
      makeBox(2.9, 1.1, 0.2, 0, 5.0, 1.35, 0x5b6340),
      makeBox(2.9, 1.1, 0.2, 0, 5.0, -1.35, 0x5b6340),
      makeBox(0.2, 1.1, 2.9, 1.35, 5.0, 0, 0x5b6340),
      makeBox(0.2, 1.1, 2.9, -1.35, 5.0, 0, 0x5b6340),
      makeBox(3.3, 0.24, 3.3, 0, 6.7, 0, 0x3b4236),
    ]);
  }

  private geomMangrove(): THREE.BufferGeometry {
    return mergeAndDispose([
      makeCylinder(0.28, 0.55, 2.2, 5, 0, 1.1, 0, 0x4f3d2c),
      makeCylinder(0.14, 0.28, 2.0, 5, -0.7, 0.8, 0.4, 0x4f3d2c),
      makeCylinder(0.14, 0.28, 2.0, 5, 0.7, 0.8, -0.4, 0x4f3d2c),
      makeCone(2.3, 2.8, 6, 0, 3.2, 0, 0xffffff),
      makeCone(1.8, 2.3, 6, 0.8, 2.7, 0.5, 0xeaeaea),
      makeCone(1.7, 2.2, 6, -0.7, 2.8, -0.5, 0xd8d8d8),
    ]);
  }

  private geomBridgeSlab(): THREE.BufferGeometry {
    return mergeAndDispose([
      makeBox(7.2, 0.75, 5.8, 0, 0.6, 0, 0x8e8b84),
      makeBox(7.22, 0.14, 5.0, 0, 1.0, 0, 0x4a5260),
      makeBox(7.22, 0.65, 0.35, 0, 1.25, 2.7, 0xb8b2a4),
      makeBox(7.22, 0.65, 0.35, 0, 1.25, -2.7, 0xb8b2a4),
      makeCylinder(0.55, 0.65, 2.8, 6, -1.8, -0.9, 0, 0x76726a),
      makeCylinder(0.55, 0.65, 2.8, 6, 1.8, -0.9, 0, 0x76726a),
    ]);
  }

  private geomJerseyBarrier(): THREE.BufferGeometry {
    return mergeAndDispose([
      makeBox(2.8, 0.42, 0.82, 0, 0.21, 0, 0x9e988c),
      makeBox(2.76, 0.68, 0.44, 0, 0.76, 0, 0xb5ae9e),
      makeBox(0.7, 0.18, 0.48, -0.75, 0.96, 0, 0xe0782a),
      makeBox(0.7, 0.18, 0.48, 0.75, 0.96, 0, 0xe0782a),
    ]);
  }

  private geomSkylineBox(): THREE.BufferGeometry {
    // Unit 1x1x1 box with base at y=0, colored white for per-instance tinting.
    return makeBox(1, 1, 1, 0, 0.5, 0, 0xffffff);
  }

  private geomHighwaySpan(): THREE.BufferGeometry {
    return mergeAndDispose([
      makeBox(28, 1.1, 14, 0, 0, 0, 0x8c8982),
      makeBox(28.04, 0.18, 12.2, 0, 0.6, 0, 0x4a5260),
      makeBox(28.04, 0.85, 0.4, 0, 0.95, 6.7, 0xb8b2a4),
      makeBox(28.04, 0.85, 0.4, 0, 0.95, -6.7, 0xb8b2a4),
      makeCylinder(0.9, 1.1, 6.0, 6, -9, -3.0, 0, 0x76726a),
      makeCylinder(0.9, 1.1, 6.0, 6, 9, -3.0, 0, 0x76726a),
    ]);
  }

  private geomHangar(): THREE.BufferGeometry {
    return mergeAndDispose([
      makeBox(26, 9.0, 22, 0, 4.5, 0, 0x6c737c),
      makeBox(26.6, 2.4, 18, 0, 9.8, 0, 0x545b63),
      makeBox(16, 6.5, 0.4, 0, 3.25, 11.05, 0x2f353d),
      makeBox(26.2, 0.6, 22.2, 0, 8.6, 0, 0xe0782a),
    ]);
  }
}
