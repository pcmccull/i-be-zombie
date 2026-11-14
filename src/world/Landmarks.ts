import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { approachOccluderOpacity } from '../core/cameraMath';
import type {
  AABB,
  ColliderDef,
  DistrictLayout,
  GameState,
  LandmarkKind,
  PropDef,
  StructureDef,
  StructureKind,
  StructureState,
  TargetRef,
} from '../core/types';

const COLOR_BUS_YELLOW = 0xe59824;
const COLOR_BUS_ORANGE = 0xd48318;
const COLOR_BUS_TRIM = 0x22262b;
const COLOR_DARK_STEEL = 0x3b424c;
const COLOR_RUST_STEEL = 0x594a42;
const COLOR_WOOD_PLANK = 0x8a6642;
const COLOR_WOOD_DARK = 0x6b4c30;
const COLOR_HAZARD_ORANGE = 0xe0782a;
const COLOR_HAZARD_YELLOW = 0xf2b632;
const COLOR_DANGER_RED = 0xc93528;
const COLOR_STORE_WALL = 0xc9b99a;
const COLOR_STORE_TRIM = 0x45525e;
const COLOR_STORE_AWNING = 0x2d7a53;
const COLOR_STORE_SIGN = 0xe89c38;
const COLOR_STORE_GLASS = 0x68a8cf;
const COLOR_POLICE_NAVY = 0x233454;
const COLOR_POLICE_BLUE = 0x5c92cc;
const COLOR_POLICE_WHITE = 0xe8ecef;

const BARRICADE_PROP_RADIUS = 15;

function rectCenterX(r: AABB): number {
  return 0.5 * (r.minX + r.maxX);
}

function rectCenterZ(r: AABB): number {
  return 0.5 * (r.minZ + r.maxZ);
}

function unionAABBs(rects: readonly AABB[]): AABB | null {
  if (rects.length === 0) return null;
  let minX = rects[0].minX;
  let minZ = rects[0].minZ;
  let maxX = rects[0].maxX;
  let maxZ = rects[0].maxZ;
  for (let i = 1; i < rects.length; i++) {
    const r = rects[i];
    if (r.minX < minX) minX = r.minX;
    if (r.minZ < minZ) minZ = r.minZ;
    if (r.maxX > maxX) maxX = r.maxX;
    if (r.maxZ > maxZ) maxZ = r.maxZ;
  }
  return { minX, minZ, maxX, maxZ };
}

function findLandmarkDef(layout: DistrictLayout, landmark: LandmarkKind): StructureDef | undefined {
  for (let i = 0; i < layout.structures.length; i++) {
    const s = layout.structures[i];
    if (s.landmark === landmark) return s;
  }
  return undefined;
}

function barricadeAnchorCenter(layout: DistrictLayout): { x: number; z: number } | null {
  const def = findLandmarkDef(layout, 'barricade');
  if (!def) return null;
  const bounds = unionAABBs([def.rect, def.enclosure]);
  const r = bounds ?? def.enclosure;
  return { x: rectCenterX(r), z: rectCenterZ(r) };
}

/**
 * Returns true for car props near the police barricade landmark so CityDistrict skips them
 * and Landmarks draws them as police cruisers (guaranteeing each car is drawn once).
 */
export function isLandmarkProp(layout: DistrictLayout, prop: PropDef): boolean {
  if (prop.kind !== 'car') return false;
  const center = barricadeAnchorCenter(layout);
  if (!center) return false;
  return Math.hypot(prop.pos.x - center.x, prop.pos.z - center.z) <= BARRICADE_PROP_RADIUS;
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

function makeCylinder(
  rTop: number,
  rBottom: number,
  h: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  hexColor: number,
  rotX = 0,
  rotY = 0,
  rotZ = 0,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segs);
  if (rotX !== 0) g.rotateX(rotX);
  if (rotY !== 0) g.rotateY(rotY);
  if (rotZ !== 0) g.rotateZ(rotZ);
  g.translate(x, y, z);
  const painted = paintGeometry(g, hexColor);
  g.dispose();
  return painted;
}

function mergeAndDispose(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geoms.length === 0) {
    return makeBox(0.01, 0.01, 0.01, 0, -100, 0, 0x000000);
  }
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) {
    g.dispose();
  }
  return merged;
}

interface BreakableVisual {
  id: number;
  kind: StructureKind;
  landmark: LandmarkKind;
  def: StructureDef;
  cx: number;
  cz: number;
  w: number;
  h: number;
  d: number;
  pickY: number;
  intactGroup: THREE.Group;
  doorPivot: THREE.Group;
  intactMesh: THREE.Mesh;
  intactMat: THREE.MeshLambertMaterial;
  glassPanes: THREE.Mesh[];
  crackMesh: THREE.Mesh | null;
  rubbleGroup: THREE.Group;
  highlightMesh: THREE.Mesh;
  pickMesh: THREE.Mesh;
  occluderMesh: THREE.Mesh | null;
  localDestroyedAt: number | null;
}

export class Landmarks {
  readonly group: THREE.Group;
  readonly pickMeshes: THREE.Object3D[] = [];
  readonly shellOccluders: THREE.Mesh[] = [];

  private readonly breakables = new Map<number, BreakableVisual>();
  private readonly idByLandmark = new Map<LandmarkKind, number>();
  private readonly landmarkById = new Map<number, LandmarkKind>();
  private readonly heldCountByLandmark = new Map<LandmarkKind, number>();
  private readonly highlightedIds = new Set<number>();

  private readonly busBodyGroup: THREE.Group;
  private readonly busOrigin = new THREE.Vector3();

  private readonly storeFadeMat: THREE.MeshLambertMaterial;
  private storeFadeMesh: THREE.Mesh | null = null;
  private readonly storeOccluders = new Set<THREE.Object3D>();
  private storeOpacity = 1.0;

  private readonly glassIntactMat: THREE.MeshLambertMaterial;
  private readonly glassCrackedMat: THREE.MeshLambertMaterial;

  private readonly policeRedMat: THREE.MeshBasicMaterial;
  private readonly policeBlueMat: THREE.MeshBasicMaterial;

  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];

  constructor(layout: DistrictLayout) {
    this.group = new THREE.Group();
    this.group.name = 'Landmarks';

    for (let i = 0; i < layout.structures.length; i++) {
      const s = layout.structures[i];
      this.idByLandmark.set(s.landmark, s.id);
      this.landmarkById.set(s.id, s.landmark);
    }

    this.storeFadeMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    this.glassIntactMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({
        color: COLOR_STORE_GLASS,
        flatShading: true,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    );
    this.glassCrackedMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({
        color: 0x9ad4f5,
        emissive: 0x163247,
        flatShading: true,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    );
    this.policeRedMat = this.trackMaterial(new THREE.MeshBasicMaterial({ color: 0xff2e24 }));
    this.policeBlueMat = this.trackMaterial(new THREE.MeshBasicMaterial({ color: 0x247bff }));

    this.busBodyGroup = new THREE.Group();
    this.busBodyGroup.name = 'LandmarkBusBody';
    this.group.add(this.busBodyGroup);

    this.buildStaticLandmarks(layout);
    this.buildBreakables(layout);
  }

  /** Return the pick proxy mesh for a structure id, if any. */
  getPickMesh(id: number): THREE.Mesh | undefined {
    return this.breakables.get(id)?.pickMesh;
  }

  /** Return the pick proxy mesh for a landmark ('bus' | 'alley' | 'store' | 'barricade'), if any. */
  pickMeshFor(landmark: LandmarkKind): THREE.Mesh | undefined {
    const id = this.idByLandmark.get(landmark);
    return id !== undefined ? this.breakables.get(id)?.pickMesh : undefined;
  }

  /**
   * Sync active breakable occluders into `occluders` (adding intact ones, removing destroyed ones).
   */
  syncOccluders(occluders: THREE.Object3D[], state: GameState): void {
    const structMap = new Map<number, StructureState>();
    if (state.structures) {
      for (let i = 0; i < state.structures.length; i++) {
        const s = state.structures[i];
        structMap.set(s.id, s);
      }
    }
    for (const [id, b] of this.breakables) {
      if (!b.occluderMesh) continue;
      const s = structMap.get(id);
      const destroyed = s ? s.destroyed : false;
      const idx = occluders.indexOf(b.occluderMesh);
      if (destroyed) {
        if (idx !== -1) occluders.splice(idx, 1);
      } else if (idx === -1) {
        occluders.push(b.occluderMesh);
      }
    }
  }

  /** Fade convenience store upper walls when they obstruct the camera ray. */
  setOccluderFade(hits: Set<THREE.Object3D>, dt = 1 / 60): void {
    if (!this.storeFadeMesh) return;
    let isHit = hits.has(this.storeFadeMesh);
    if (!isHit) {
      for (const occ of this.storeOccluders) {
        if (hits.has(occ)) {
          isHit = true;
          break;
        }
      }
    }
    this.storeOpacity = approachOccluderOpacity(this.storeOpacity, isHit, dt);
    const transparent = this.storeOpacity < 1;
    if (this.storeFadeMat.transparent !== transparent) {
      this.storeFadeMat.transparent = transparent;
      this.storeFadeMat.needsUpdate = true;
    }
    this.storeFadeMat.depthWrite = !transparent;
    this.storeFadeMat.opacity = this.storeOpacity;
  }

  /**
   * Highlight hovered / targeted structure(s).
   * Accepts a single structure id (or null) plus optional additional targeted structure ids.
   */
  setHighlight(id: number | null, extraIds?: readonly number[]): void {
    this.highlightedIds.clear();
    if (id !== null) {
      this.highlightedIds.add(id);
    }
    if (extraIds) {
      for (let i = 0; i < extraIds.length; i++) {
        this.highlightedIds.add(extraIds[i]);
      }
    }
    for (const [sId, b] of this.breakables) {
      b.highlightMesh.visible = this.highlightedIds.has(sId) && !b.rubbleGroup.visible;
    }
  }

  reset(): void {
    this.highlightedIds.clear();
    this.busBodyGroup.rotation.set(0, 0, 0);
    this.busBodyGroup.position.copy(this.busOrigin);
    for (const b of this.breakables.values()) {
      this.resetBreakableOffsets(b);
      b.intactMat.emissive.setHex(0x000000);
      b.highlightMesh.visible = false;
    }
  }

  private resetBreakableOffsets(b: BreakableVisual): void {
    b.localDestroyedAt = null;
    b.intactGroup.visible = true;
    b.intactGroup.position.set(b.cx, 0, b.cz);
    b.intactGroup.rotation.set(0, 0, 0);
    b.doorPivot.position.set(0, 0, 0);
    b.doorPivot.rotation.set(0, 0, 0);
    b.rubbleGroup.visible = false;
    for (let i = 0; i < b.glassPanes.length; i++) {
      const pane = b.glassPanes[i];
      pane.visible = true;
      pane.material = this.glassIntactMat;
    }
    if (b.crackMesh) {
      b.crackMesh.visible = false;
      b.crackMesh.scale.set(1, 1, 1);
    }
    b.pickMesh.visible = true;
    b.pickMesh.position.set(b.cx, b.pickY, b.cz);
    b.pickMesh.userData.target = { kind: 'structure', id: b.id };
  }

  update(state: GameState, _dt: number, time: number): void {
    // 1. Toggle flashing police red/blue lightbar materials (emissive-style color toggle, no PointLights)
    const flashPhase = Math.sin(time * 9.5);
    if (flashPhase >= 0) {
      this.policeRedMat.color.setHex(0xff3324);
      this.policeBlueMat.color.setHex(0x142642);
    } else {
      this.policeRedMat.color.setHex(0x3d1210);
      this.policeBlueMat.color.setHex(0x2e8cff);
    }

    // 2. Count held zombies per landmark via structure landmark mapping
    this.heldCountByLandmark.clear();
    for (let i = 0; i < state.zombies.length; i++) {
      const z = state.zombies[i];
      if (z.state !== 'dead' && z.heldBy !== 0) {
        const lm = this.landmarkById.get(z.heldBy);
        if (lm) {
          this.heldCountByLandmark.set(lm, (this.heldCountByLandmark.get(lm) ?? 0) + 1);
        }
      }
    }

    const structById = new Map<number, StructureState>();
    const structByLandmark = new Map<LandmarkKind, StructureState>();
    if (state.structures) {
      for (let i = 0; i < state.structures.length; i++) {
        const s = state.structures[i];
        structById.set(s.id, s);
        structByLandmark.set(s.landmark, s);
      }
    }

    const busHeldCount = this.heldCountByLandmark.get('bus') ?? 0;
    const busDoorState = structByLandmark.get('bus');
    const busIntact = busDoorState ? !busDoorState.destroyed : true;
    if (busHeldCount > 0 && busIntact) {
      // Thumping/rocking idle while held zombies remain inside the bus
      const thump = Math.max(0, Math.sin(time * 6.8)) * Math.sin(time * 19.0);
      const sway = Math.sin(time * 4.4) * 0.024 + thump * 0.018;
      this.busBodyGroup.rotation.x = sway;
      this.busBodyGroup.rotation.z = Math.cos(time * 3.3) * 0.012;
      this.busBodyGroup.position.set(
        this.busOrigin.x,
        this.busOrigin.y + Math.abs(thump) * 0.04,
        this.busOrigin.z,
      );
    } else {
      this.busBodyGroup.rotation.set(0, 0, 0);
      this.busBodyGroup.position.copy(this.busOrigin);
    }

    // 3. Update each breakable structure
    for (const [id, b] of this.breakables) {
      const s = structById.get(id);
      const hp = s ? s.hp : 100;
      const maxHp = s ? s.maxHp : 100;
      const destroyed = s ? s.destroyed : false;
      const hitFlash = s ? s.hitFlash : 0;
      const isHighlighted = this.highlightedIds.has(id);

      if (!destroyed) {
        const hpFrac = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
        const dmg = 1.0 - hpFrac;

        if (hpFrac >= 0.999) {
          this.resetBreakableOffsets(b);
        } else {
          b.localDestroyedAt = null;
          b.intactGroup.visible = true;
          b.rubbleGroup.visible = false;
          b.doorPivot.position.set(0, 0, 0);
          b.doorPivot.rotation.set(0, 0, 0);
          b.pickMesh.visible = true;
          b.pickMesh.position.set(b.cx, b.pickY, b.cz);
          if (!b.pickMesh.userData.target) {
            b.pickMesh.userData.target = { kind: 'structure', id };
          }
          for (let i = 0; i < b.glassPanes.length; i++) {
            const pane = b.glassPanes[i];
            pane.visible = true;
            pane.material = dmg > 0.05 ? this.glassCrackedMat : this.glassIntactMat;
          }
          if (b.crackMesh) {
            b.crackMesh.visible = dmg > 0.05;
            const crackScale = 0.5 + dmg * 0.65;
            b.crackMesh.scale.set(crackScale, crackScale, 1);
          }
        }

        // Shake on hit + idle rattle on alley gate while held zombies push from inside
        let shake = hitFlash > 0 ? Math.sin(time * 58 + id * 1.7) * 0.08 : 0;
        const landmarkHeldCount = this.heldCountByLandmark.get(b.landmark) ?? 0;
        if (b.landmark === 'alley' && landmarkHeldCount > 0 && shake === 0) {
          const rattle = (0.35 + 0.65 * Math.max(0, Math.sin(time * 5.2))) * Math.sin(time * 22.0);
          shake = rattle * 0.03;
          b.doorPivot.rotation.z = rattle * 0.015;
        }

        const dirX = Math.sin(b.def.facing);
        const dirZ = Math.cos(b.def.facing);

        // Dent/tilt outward along structure facing as HP drops
        b.intactGroup.position.set(
          b.cx + dirX * (dmg * 0.14 + shake),
          0,
          b.cz + dirZ * (dmg * 0.14 + shake),
        );
        b.intactGroup.rotation.x = dirZ * dmg * 0.22;
        b.intactGroup.rotation.z = -dirX * dmg * 0.22;
        b.intactGroup.rotation.y = shake * 0.35;

        // Material hitFlash / highlight emissive
        if (hitFlash > 0) {
          b.intactMat.emissive.setHex(0x884418);
        } else if (isHighlighted) {
          const pulse = 0.5 + 0.5 * Math.sin(time * 7.0);
          b.intactMat.emissive.setRGB(0.32 * pulse, 0.16 * pulse, 0.04 * pulse);
        } else {
          b.intactMat.emissive.setHex(0x000000);
        }

        b.highlightMesh.visible = isHighlighted;
      } else {
        // Destroyed: clear pick proxy and hide intact glass/cracks immediately
        b.pickMesh.visible = false;
        b.pickMesh.userData.target = null;
        b.pickMesh.position.set(b.cx, -1000, b.cz);
        b.highlightMesh.visible = false;
        b.intactMat.emissive.setHex(0x000000);
        for (let i = 0; i < b.glassPanes.length; i++) {
          b.glassPanes[i].visible = false;
        }
        if (b.crackMesh) {
          b.crackMesh.visible = false;
        }

        const destroyedAt =
          s && s.destroyedAt !== null
            ? s.destroyedAt
            : (b.localDestroyedAt ?? (b.localDestroyedAt = time));
        const elapsed = Math.max(0, time - destroyedAt);
        const tweenDur = 0.48; // <= 0.6 s outward fall/shatter tween

        if (elapsed < tweenDur) {
          const t = elapsed / tweenDur;
          const ease = t * t;
          const dirX = Math.sin(b.def.facing);
          const dirZ = Math.cos(b.def.facing);
          b.intactGroup.visible = true;
          b.rubbleGroup.visible = true;
          b.intactGroup.position.set(
            b.cx + dirX * ease * 1.15,
            -ease * 0.35,
            b.cz + dirZ * ease * 1.15,
          );
          b.intactGroup.rotation.set(0, 0, 0);
          b.doorPivot.rotation.set(
            dirZ * ease * (Math.PI * 0.46),
            0,
            -dirX * ease * (Math.PI * 0.46),
          );
        } else {
          b.intactGroup.visible = false;
          b.rubbleGroup.visible = true;
        }
      }
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
    this.breakables.clear();
    this.idByLandmark.clear();
    this.landmarkById.clear();
    this.heldCountByLandmark.clear();
    this.pickMeshes.length = 0;
    this.shellOccluders.length = 0;
    this.storeOccluders.clear();
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

  private buildStaticLandmarks(layout: DistrictLayout): void {
    const staticOpaqueGeoms: THREE.BufferGeometry[] = [];
    const storeFadeGeoms: THREE.BufferGeometry[] = [];
    const glassGeoms: THREE.BufferGeometry[] = [];
    const chainLinkGeoms: THREE.BufferGeometry[] = [];
    const redLightGeoms: THREE.BufferGeometry[] = [];
    const blueLightGeoms: THREE.BufferGeometry[] = [];

    // 1. Abandoned Bus (derived from bus StructureDef + bus-shell-* colliders)
    this.buildBusBody(layout);

    // 2. Locked Alley (derived from alleyGate StructureDef + alley-wall-n collider)
    this.appendLockedAlleyStatic(layout, staticOpaqueGeoms);

    // 3. Convenience Store (derived from storeDoor StructureDef + store-wall-* colliders)
    this.appendStoreStatic(layout, staticOpaqueGeoms, storeFadeGeoms, glassGeoms);

    // 4. Police Barricade + Chain-Link Pen (derived from penGate StructureDef, pen-fence-* colliders, nearby props)
    this.appendPoliceBarricadeStatic(
      layout,
      staticOpaqueGeoms,
      glassGeoms,
      chainLinkGeoms,
      redLightGeoms,
      blueLightGeoms,
    );

    // 5. Build invisible camera-occlusion proxies for landmark shell colliders
    const occMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const occBoxGeo = this.trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const storeDoorDef = findLandmarkDef(layout, 'store');

    for (let i = 0; i < layout.colliders.length; i++) {
      const c = layout.colliders[i];
      if (!c.tag || !c.blocksSight) continue;
      const isStoreWall = c.tag.startsWith('store-wall-');
      const isAlleyWall = c.tag === 'alley-wall-n' || c.tag.startsWith('alley-wall-');
      if (!isStoreWall && !isAlleyWall) continue;

      // Determine whether this store wall segment is on the storefront (door) face
      let isStoreGlassFront = c.tag === 'store-wall-nw' || c.tag === 'store-wall-ne';
      if (isStoreWall && storeDoorDef) {
        const doorR = storeDoorDef.rect;
        const sameNorthSouthFace =
          Math.abs(rectCenterZ(c) - rectCenterZ(doorR)) < 0.6 &&
          Math.abs(c.maxZ - c.minZ - (doorR.maxZ - doorR.minZ)) < 0.6;
        const sameEastWestFace =
          Math.abs(rectCenterX(c) - rectCenterX(doorR)) < 0.6 &&
          Math.abs(c.maxX - c.minX - (doorR.maxX - doorR.minX)) < 0.6;
        if (sameNorthSouthFace || sameEastWestFace) {
          isStoreGlassFront = true;
        }
      }

      const occ = new THREE.Mesh(occBoxGeo, occMat);
      occ.position.set(rectCenterX(c), c.height * 0.5, rectCenterZ(c));
      occ.scale.set(c.maxX - c.minX, c.height, c.maxZ - c.minZ);
      occ.visible = false;
      occ.name = `LandmarkOccluder_${c.tag}`;
      // Store glass front must NEVER block pointer picking of sheltered civilians inside
      if (isStoreGlassFront) {
        occ.userData.ignorePickOcclusion = true;
      }
      if (isStoreWall) {
        this.storeOccluders.add(occ);
      }
      this.group.add(occ);
      this.shellOccluders.push(occ);
    }

    // Merge static opaque geometry into 1 draw call
    const mergedOpaque = this.trackGeometry(mergeAndDispose(staticOpaqueGeoms));
    const opaqueMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    const opaqueMesh = new THREE.Mesh(mergedOpaque, opaqueMat);
    opaqueMesh.castShadow = true;
    opaqueMesh.receiveShadow = true;
    opaqueMesh.name = 'LandmarksStaticOpaque';
    this.group.add(opaqueMesh);

    // Merge store walls that fade on camera occlusion into 1 draw call
    const mergedStoreFade = this.trackGeometry(mergeAndDispose(storeFadeGeoms));
    const storeMesh = new THREE.Mesh(mergedStoreFade, this.storeFadeMat);
    storeMesh.castShadow = true;
    storeMesh.receiveShadow = true;
    storeMesh.name = 'LandmarkStoreWalls';
    this.storeFadeMesh = storeMesh;
    this.group.add(storeMesh);

    // Merge transparent glass panes into 1 draw call
    const mergedGlass = this.trackGeometry(mergeAndDispose(glassGeoms));
    const glassMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      }),
    );
    const glassMesh = new THREE.Mesh(mergedGlass, glassMat);
    glassMesh.name = 'LandmarksGlass';
    this.group.add(glassMesh);

    // Merge chain-link fence panels into 1 draw call
    const mergedChainLink = this.trackGeometry(mergeAndDispose(chainLinkGeoms));
    const chainLinkMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const chainLinkMesh = new THREE.Mesh(mergedChainLink, chainLinkMat);
    chainLinkMesh.name = 'LandmarksChainLink';
    this.group.add(chainLinkMesh);

    // Merge flashing red & blue police lightbars into 2 draw calls
    const mergedRed = this.trackGeometry(mergeAndDispose(redLightGeoms));
    const redMesh = new THREE.Mesh(mergedRed, this.policeRedMat);
    redMesh.name = 'PoliceLightsRed';
    this.group.add(redMesh);

    const mergedBlue = this.trackGeometry(mergeAndDispose(blueLightGeoms));
    const blueMesh = new THREE.Mesh(mergedBlue, this.policeBlueMat);
    blueMesh.name = 'PoliceLightsBlue';
    this.group.add(blueMesh);
  }

  private buildBusBody(layout: DistrictLayout): void {
    const busDef = findLandmarkDef(layout, 'bus');
    const shellColliders = layout.colliders.filter((c) => c.tag?.startsWith('bus-shell-'));
    const unionRects: AABB[] = [...shellColliders];
    if (busDef) {
      unionRects.push(busDef.enclosure, busDef.rect);
    }
    const busBounds = unionAABBs(unionRects);
    if (!busBounds) return;

    const busCx = rectCenterX(busBounds);
    const busCz = rectCenterZ(busBounds);
    const busW = busBounds.maxX - busBounds.minX;
    const busD = busBounds.maxZ - busBounds.minZ;
    const halfW = busW * 0.5;
    const halfD = busD * 0.5;
    const wallH = shellColliders[0]?.height ?? 3.2;

    this.busOrigin.set(busCx, 0, busCz);
    this.busBodyGroup.position.copy(this.busOrigin);

    const bodyGeoms: THREE.BufferGeometry[] = [];
    const windowGeoms: THREE.BufferGeometry[] = [];

    // Interior floor deck from enclosure (or inset from outer bounds)
    const enc = busDef?.enclosure ?? {
      minX: busBounds.minX + 0.4,
      minZ: busBounds.minZ + 0.4,
      maxX: busBounds.maxX - 0.4,
      maxZ: busBounds.maxZ - 0.4,
    };
    const encW = enc.maxX - enc.minX;
    const encD = enc.maxZ - enc.minZ;
    const encLocalX = rectCenterX(enc) - busCx;
    const encLocalZ = rectCenterZ(enc) - busCz;
    bodyGeoms.push(makeBox(encW + 0.4, 0.18, encD + 0.4, encLocalX, 0.28, encLocalZ, 0x2c3138));

    // Front (+X) & rear (-X) heavy steel bumpers at ends of the bus shell
    bodyGeoms.push(makeBox(0.32, 0.38, busD + 0.08, halfW - 0.05, 0.48, 0, COLOR_BUS_TRIM));
    bodyGeoms.push(makeBox(0.32, 0.38, busD + 0.08, -halfW + 0.05, 0.48, 0, COLOR_BUS_TRIM));

    // Build wall segments directly from each bus-shell-* collider rect
    for (let i = 0; i < shellColliders.length; i++) {
      const c = shellColliders[i];
      const cw = c.maxX - c.minX;
      const cd = c.maxZ - c.minZ;
      const lx = rectCenterX(c) - busCx;
      const lz = rectCenterZ(c) - busCz;
      const isHorizontal = cw >= cd;

      if (isHorizontal) {
        // Long/doorway wall segment running along X (north wall or south doorway segments)
        const thickness = Math.min(0.36, cd);
        bodyGeoms.push(makeBox(cw, 1.35, thickness, lx, 0.95, lz, COLOR_BUS_YELLOW));
        bodyGeoms.push(makeBox(cw + 0.04, 0.16, thickness + 0.04, lx, 0.75, lz, COLOR_BUS_TRIM));
        bodyGeoms.push(makeBox(cw + 0.04, 0.14, thickness + 0.04, lx, 1.52, lz, COLOR_BUS_TRIM));
        bodyGeoms.push(makeBox(cw, 0.36, thickness, lx, wallH - 0.45, lz, COLOR_BUS_ORANGE));

        const pillarCount = Math.max(2, Math.round(cw / 2.2) + 1);
        for (let p = 0; p < pillarCount; p++) {
          const frac = pillarCount === 1 ? 0.5 : p / (pillarCount - 1);
          const px = lx - cw * 0.46 + frac * (cw * 0.92);
          bodyGeoms.push(makeBox(0.28, 1.1, thickness * 0.95, px, 2.1, lz, COLOR_BUS_YELLOW));
        }
        if (cw > 0.6) {
          windowGeoms.push(makeBox(cw - 0.5, 0.88, 0.12, lx, 2.1, lz, 0x1e2b36));
        }
      } else {
        // End wall running along Z (west rear wall or east front cab wall)
        const thickness = Math.min(0.38, cw);
        if (lx < 0) {
          // West rear wall
          bodyGeoms.push(makeBox(thickness, 2.55, cd - 0.04, lx, 1.55, lz, COLOR_BUS_YELLOW));
          bodyGeoms.push(makeBox(thickness + 0.04, 0.16, cd + 0.02, lx, 1.1, lz, COLOR_BUS_TRIM));
          const outerX = -halfW - 0.01;
          bodyGeoms.push(makeBox(0.12, 0.28, 0.42, outerX, 0.95, lz - cd * 0.34, COLOR_DANGER_RED));
          bodyGeoms.push(makeBox(0.12, 0.28, 0.42, outerX, 0.95, lz + cd * 0.34, COLOR_DANGER_RED));
          windowGeoms.push(makeBox(0.14, 0.78, cd * 0.45, lx, 2.15, lz, 0x1e2b36));
        } else {
          // East front cab wall
          bodyGeoms.push(makeBox(thickness, 1.45, cd - 0.04, lx, 1.0, lz, COLOR_BUS_ORANGE));
          bodyGeoms.push(makeBox(thickness - 0.02, 0.42, cd - 0.04, lx, wallH - 0.48, lz, COLOR_BUS_YELLOW));
          bodyGeoms.push(makeBox(0.28, 1.1, 0.34, lx, 2.1, lz - cd * 0.45, COLOR_BUS_YELLOW));
          bodyGeoms.push(makeBox(0.28, 1.1, 0.34, lx, 2.1, lz + cd * 0.45, COLOR_BUS_YELLOW));
          bodyGeoms.push(makeBox(0.22, 1.1, 0.18, lx, 2.1, lz, COLOR_BUS_TRIM));
          const outerX = halfW + 0.01;
          bodyGeoms.push(makeBox(0.12, 0.55, cd * 0.45, outerX, 0.88, lz, COLOR_BUS_TRIM));
          bodyGeoms.push(makeBox(0.12, 0.28, 0.38, outerX, 0.88, lz - cd * 0.34, 0xfff0b8));
          bodyGeoms.push(makeBox(0.12, 0.28, 0.38, outerX, 0.88, lz + cd * 0.34, 0xfff0b8));
          bodyGeoms.push(makeBox(0.14, 0.28, cd * 0.52, outerX, wallH - 0.46, lz, 0x181c20));
          bodyGeoms.push(makeBox(0.16, 0.14, cd * 0.42, outerX + 0.01, wallH - 0.46, lz, COLOR_HAZARD_YELLOW));
          windowGeoms.push(makeBox(0.14, 0.88, cd * 0.82, lx, 2.1, lz, 0x1e2b36));
        }
      }
    }

    // Doorway header beam above the busDoor rect
    if (busDef) {
      const doorW = busDef.rect.maxX - busDef.rect.minX;
      const doorD = busDef.rect.maxZ - busDef.rect.minZ;
      const doorLocalX = rectCenterX(busDef.rect) - busCx;
      const doorLocalZ = rectCenterZ(busDef.rect) - busCz;
      bodyGeoms.push(
        makeBox(doorW + 0.1, 0.34, doorD + 0.02, doorLocalX, wallH - 0.44, doorLocalZ, COLOR_BUS_ORANGE),
      );
    }

    // Open-top cutaway roof perimeter rim & cross ribs so held zombies inside read clearly from camera
    const roofY = wallH - 0.22;
    bodyGeoms.push(makeBox(busW - 0.2, 0.16, 0.48, 0, roofY, -(halfD - 0.32), 0xd8d2c5));
    bodyGeoms.push(makeBox(busW - 0.2, 0.16, 0.48, 0, roofY, halfD - 0.32, 0xd8d2c5));
    bodyGeoms.push(makeBox(1.1, 0.16, busD - 1.0, -(halfW - 0.7), roofY, 0, 0xd8d2c5));
    bodyGeoms.push(makeBox(1.1, 0.16, busD - 1.0, halfW - 0.7, roofY, 0, 0xd8d2c5));
    for (const frac of [-0.22, 0.02, 0.24]) {
      bodyGeoms.push(makeBox(0.22, 0.14, busD - 1.1, busW * frac, roofY, 0, COLOR_BUS_YELLOW));
    }

    // 6 heavy bus wheels positioned proportionally to bus shell footprint
    const wheelZ = halfD - 0.04;
    const wheelXOffsets = [-busW * 0.34, -busW * 0.2, busW * 0.32];
    for (let i = 0; i < wheelXOffsets.length; i++) {
      const wx = wheelXOffsets[i];
      for (const wz of [-wheelZ, wheelZ]) {
        bodyGeoms.push(
          makeCylinder(0.52, 0.52, 0.38, 10, wx, 0.52, wz, 0x1a1d21, Math.PI / 2, 0, 0),
        );
        bodyGeoms.push(
          makeCylinder(0.24, 0.24, 0.42, 8, wx, 0.52, wz, 0x8c949e, Math.PI / 2, 0, 0),
        );
      }
    }

    const mergedBody = this.trackGeometry(mergeAndDispose(bodyGeoms));
    const bodyMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    const bodyMesh = new THREE.Mesh(mergedBody, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.busBodyGroup.add(bodyMesh);

    const mergedWin = this.trackGeometry(mergeAndDispose(windowGeoms));
    const winMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    );
    const winMesh = new THREE.Mesh(mergedWin, winMat);
    this.busBodyGroup.add(winMesh);
  }

  private appendLockedAlleyStatic(layout: DistrictLayout, out: THREE.BufferGeometry[]): void {
    const alleyDef = findLandmarkDef(layout, 'alley');
    const northWall = layout.colliders.find(
      (c) => c.tag === 'alley-wall-n' || c.tag?.startsWith('alley-wall-'),
    );

    if (northWall) {
      const nwW = northWall.maxX - northWall.minX;
      const nwD = northWall.maxZ - northWall.minZ;
      const nwH = northWall.height;
      const nwCx = rectCenterX(northWall);
      const nwCz = rectCenterZ(northWall);
      out.push(makeBox(nwW, nwH, nwD, nwCx, nwH * 0.5, nwCz, 0x7c5c4a));
      out.push(makeBox(nwW + 0.1, 0.22, nwD + 0.1, nwCx, nwH + 0.05, nwCz, 0xa9a294));
    }

    if (alleyDef) {
      const gr = alleyDef.rect;
      const gw = gr.maxX - gr.minX;
      const gd = gr.maxZ - gr.minZ;
      const gcx = rectCenterX(gr);
      const gcz = rectCenterZ(gr);
      const gateCollider = layout.colliders.find((c) => c.tag === alleyDef.tag);
      const gateH = gateCollider?.height ?? 2.8;
      const postH = gateH + 0.3;

      const isEW = gw >= gd;
      if (isEW) {
        const postW = Math.min(0.32, gw * 0.12);
        const postD = Math.max(0.48, gd * 0.8);
        out.push(makeBox(postW, postH, postD, gr.minX + postW * 0.5, postH * 0.5, gcz, COLOR_DARK_STEEL));
        out.push(makeBox(postW, postH, postD, gr.maxX - postW * 0.5, postH * 0.5, gcz, COLOR_DARK_STEEL));
        out.push(makeBox(gw, 0.22, gd * 0.6, gcx, postH + 0.02, gcz, COLOR_DARK_STEEL));
        out.push(makeBox(gw * 0.9, 0.14, gd * 0.66, gcx, postH + 0.02, gcz, COLOR_HAZARD_ORANGE));
      } else {
        const postW = Math.max(0.48, gw * 0.8);
        const postD = Math.min(0.32, gd * 0.12);
        out.push(makeBox(postW, postH, postD, gcx, postH * 0.5, gr.minZ + postD * 0.5, COLOR_DARK_STEEL));
        out.push(makeBox(postW, postH, postD, gcx, postH * 0.5, gr.maxZ - postD * 0.5, COLOR_DARK_STEEL));
        out.push(makeBox(gw * 0.6, 0.22, gd, gcx, postH + 0.02, gcz, COLOR_DARK_STEEL));
        out.push(makeBox(gw * 0.66, 0.14, gd * 0.9, gcx, postH + 0.02, gcz, COLOR_HAZARD_ORANGE));
      }

      // Alley ground apron slab spanning enclosure + gate
      const apronBounds = unionAABBs(
        northWall ? [alleyDef.enclosure, alleyDef.rect, northWall] : [alleyDef.enclosure, alleyDef.rect],
      );
      if (apronBounds) {
        const aw = apronBounds.maxX - apronBounds.minX - 0.1;
        const ad = apronBounds.maxZ - apronBounds.minZ;
        out.push(makeBox(aw, 0.03, ad, rectCenterX(apronBounds), 0.01, rectCenterZ(apronBounds), 0x3e444c));
      }
    }
  }

  private appendStoreStatic(
    layout: DistrictLayout,
    opaqueOut: THREE.BufferGeometry[],
    fadeOut: THREE.BufferGeometry[],
    glassOut: THREE.BufferGeometry[],
  ): void {
    const storeDef = findLandmarkDef(layout, 'store');
    const storeWalls = layout.colliders.filter((c) => c.tag?.startsWith('store-wall-'));
    if (!storeDef && storeWalls.length === 0) return;

    const allStoreRects: AABB[] = [...storeWalls];
    if (storeDef) {
      allStoreRects.push(storeDef.enclosure, storeDef.rect);
    }
    const storeBounds = unionAABBs(allStoreRects);
    if (!storeBounds) return;

    const storeCx = rectCenterX(storeBounds);
    const storeCz = rectCenterZ(storeBounds);
    const storeW = storeBounds.maxX - storeBounds.minX;
    const storeD = storeBounds.maxZ - storeBounds.minZ;
    const wallH = storeWalls[0]?.height ?? 5.0;

    // 1. Bright checkered interior floor tile inside the store enclosure
    const enc = storeDef?.enclosure ?? {
      minX: storeBounds.minX + 0.5,
      minZ: storeBounds.minZ + 0.5,
      maxX: storeBounds.maxX - 0.5,
      maxZ: storeBounds.maxZ - 0.5,
    };
    const encW = enc.maxX - enc.minX;
    const encD = enc.maxZ - enc.minZ;
    const encCx = rectCenterX(enc);
    const encCz = rectCenterZ(enc);
    opaqueOut.push(makeBox(encW + 0.4, 0.04, encD + 0.4, encCx, 0.02, encCz, 0xd8d0c0));
    for (let x = enc.minX + 0.5; x <= enc.maxX - 0.5; x += 2.0) {
      for (let z = enc.minZ + 0.7; z <= enc.maxZ - 0.7; z += 2.0) {
        opaqueOut.push(makeBox(0.92, 0.045, 0.92, x, 0.024, z, 0xbab09e));
      }
    }

    // 2. Interior convenience store shelves & stocked product boxes along the interior walls
    const dirX = storeDef ? Math.sin(storeDef.facing) : 0;
    const dirZ = storeDef ? Math.cos(storeDef.facing) : -1;
    const shelfPositions: [number, number, number, number][] = [
      [enc.minX + 0.35, encCz - encD * 0.2, 0.55, Math.min(2.6, encD * 0.3)],
      [enc.minX + 0.35, encCz + encD * 0.2, 0.55, Math.min(2.6, encD * 0.3)],
      [enc.maxX - 0.35, encCz - encD * 0.2, 0.55, Math.min(2.6, encD * 0.3)],
      [enc.maxX - 0.35, encCz + encD * 0.2, 0.55, Math.min(2.6, encD * 0.3)],
    ];
    // Back-wall shelves on the side opposite the entrance door
    const backZ = dirZ <= 0 ? enc.maxZ - 0.45 : enc.minZ + 0.45;
    shelfPositions.push(
      [encCx - encW * 0.2, backZ, Math.min(2.4, encW * 0.3), 0.55],
      [encCx + encW * 0.2, backZ, Math.min(2.4, encW * 0.3), 0.55],
    );

    const prodColors = [0xd94e34, 0x3b82bd, 0xe5a932, 0x4ca66b];
    for (let i = 0; i < shelfPositions.length; i++) {
      const [sx, sz, sw, sd] = shelfPositions[i];
      opaqueOut.push(makeBox(sw, 1.55, sd, sx, 0.78, sz, 0x4d5660));
      opaqueOut.push(makeBox(sw + 0.06, 0.08, sd + 0.06, sx, 0.52, sz, 0xd8dde2));
      opaqueOut.push(makeBox(sw + 0.06, 0.08, sd + 0.06, sx, 1.04, sz, 0xd8dde2));
      opaqueOut.push(makeBox(sw + 0.06, 0.08, sd + 0.06, sx, 1.52, sz, 0xd8dde2));
      opaqueOut.push(
        makeBox(sw * 0.75, 0.28, sd * 0.75, sx, 0.72, sz, prodColors[i % prodColors.length]),
      );
      opaqueOut.push(
        makeBox(
          sw * 0.7,
          0.26,
          sd * 0.7,
          sx,
          1.24,
          sz,
          prodColors[(i + 1) % prodColors.length],
        ),
      );
    }

    // 3. Build store walls and glass storefront from the store-wall-* colliders
    const doorRect = storeDef?.rect;
    for (let i = 0; i < storeWalls.length; i++) {
      const c = storeWalls[i];
      const cw = c.maxX - c.minX;
      const cd = c.maxZ - c.minZ;
      const cx = rectCenterX(c);
      const cz = rectCenterZ(c);
      const ch = c.height;

      // Check if this wall collider shares the entrance face with storeDoor
      let isFrontWindowWall = c.tag === 'store-wall-nw' || c.tag === 'store-wall-ne';
      if (doorRect) {
        const sameZFace =
          Math.abs(cz - rectCenterZ(doorRect)) < 0.6 &&
          Math.abs(cd - (doorRect.maxZ - doorRect.minZ)) < 0.6;
        const sameXFace =
          Math.abs(cx - rectCenterX(doorRect)) < 0.6 &&
          Math.abs(cw - (doorRect.maxX - doorRect.minX)) < 0.6;
        if (sameZFace || sameXFace) {
          isFrontWindowWall = true;
        }
      }

      if (isFrontWindowWall) {
        // Low knee wall + mullions + bluish transparent storefront glass
        opaqueOut.push(makeBox(cw, 0.65, cd, cx, 0.325, cz, COLOR_STORE_TRIM));
        const isEW = cw >= cd;
        if (isEW) {
          opaqueOut.push(makeBox(0.24, 2.8, cd + 0.02, c.minX + 0.15, 1.4, cz, COLOR_STORE_TRIM));
          opaqueOut.push(makeBox(0.24, 2.8, cd + 0.02, c.maxX - 0.15, 1.4, cz, COLOR_STORE_TRIM));
          glassOut.push(makeBox(Math.max(0.4, cw - 0.45), 2.15, 0.16, cx, 1.72, cz, COLOR_STORE_GLASS));
        } else {
          opaqueOut.push(makeBox(cw + 0.02, 2.8, 0.24, cx, 1.4, c.minZ + 0.15, COLOR_STORE_TRIM));
          opaqueOut.push(makeBox(cw + 0.02, 2.8, 0.24, cx, 1.4, c.maxZ - 0.15, COLOR_STORE_TRIM));
          glassOut.push(makeBox(0.16, 2.15, Math.max(0.4, cd - 0.45), cx, 1.72, cz, COLOR_STORE_GLASS));
        }
        // Upper lintel wall above window
        const upperH = Math.max(0.5, ch - 2.85);
        fadeOut.push(makeBox(cw, upperH, cd, cx, 2.85 + upperH * 0.5, cz, COLOR_STORE_WALL));
      } else {
        // Solid perimeter wall: lower 1.6m base stays solid; upper wall fades on camera occlusion
        const baseH = Math.min(1.6, ch * 0.35);
        const upperH = Math.max(0.4, ch - baseH);
        opaqueOut.push(makeBox(cw, baseH, cd, cx, baseH * 0.5, cz, COLOR_STORE_WALL));
        fadeOut.push(makeBox(cw, upperH, cd, cx, baseH + upperH * 0.5, cz, COLOR_STORE_WALL));
      }

      // Parapet cornice trim at top of each wall segment
      fadeOut.push(makeBox(cw + 0.16, 0.24, cd + 0.16, cx, ch + 0.05, cz, COLOR_STORE_TRIM));
    }

    // 4. Lintel above door + awning and sign board on the face given by storeDef.facing
    if (storeDef && doorRect) {
      const doorW = doorRect.maxX - doorRect.minX;
      const doorD = doorRect.maxZ - doorRect.minZ;
      const doorCx = rectCenterX(doorRect);
      const doorCz = rectCenterZ(doorRect);
      const doorCollider = layout.colliders.find((c) => c.tag === storeDef.tag);
      const doorH = doorCollider?.height ?? 2.6;
      const lintelH = Math.max(0.4, wallH - doorH);
      fadeOut.push(
        makeBox(doorW, lintelH, doorD, doorCx, doorH + lintelH * 0.5, doorCz, COLOR_STORE_WALL),
      );
      fadeOut.push(
        makeBox(doorW + 0.16, 0.24, doorD + 0.16, doorCx, wallH + 0.05, doorCz, COLOR_STORE_TRIM),
      );

      // Place awning and rooftop signboard along the face indicated by storeDef.facing
      const isNorthSouthFace = Math.abs(dirZ) >= Math.abs(dirX);
      if (isNorthSouthFace) {
        const facadeZ = doorCz + dirZ * (doorD * 0.5);
        const awningZ = facadeZ + dirZ * 0.45;
        const signZ = facadeZ - dirZ * 0.15;
        opaqueOut.push(makeBox(storeW + 0.2, 0.36, 1.35, storeCx, 3.02, awningZ, COLOR_STORE_AWNING));
        opaqueOut.push(makeBox(storeW + 0.26, 0.14, 1.4, storeCx, 2.86, awningZ, COLOR_STORE_SIGN));
        opaqueOut.push(makeBox(storeW * 0.82, 1.05, 0.36, storeCx, wallH - 0.85, signZ, COLOR_STORE_TRIM));
        opaqueOut.push(makeBox(storeW * 0.75, 0.68, 0.42, storeCx, wallH - 0.85, signZ, COLOR_STORE_SIGN));
        opaqueOut.push(makeBox(storeW * 0.58, 0.22, 0.46, storeCx, wallH - 0.85, signZ, 0xf7f2e4));
      } else {
        const facadeX = doorCx + dirX * (doorW * 0.5);
        const awningX = facadeX + dirX * 0.45;
        const signX = facadeX - dirX * 0.15;
        opaqueOut.push(makeBox(1.35, 0.36, storeD + 0.2, awningX, 3.02, storeCz, COLOR_STORE_AWNING));
        opaqueOut.push(makeBox(1.4, 0.14, storeD + 0.26, awningX, 2.86, storeCz, COLOR_STORE_SIGN));
        opaqueOut.push(makeBox(0.36, 1.05, storeD * 0.82, signX, wallH - 0.85, storeCz, COLOR_STORE_TRIM));
        opaqueOut.push(makeBox(0.42, 0.68, storeD * 0.75, signX, wallH - 0.85, storeCz, COLOR_STORE_SIGN));
        opaqueOut.push(makeBox(0.46, 0.22, storeD * 0.58, signX, wallH - 0.85, storeCz, 0xf7f2e4));
      }
    }
  }

  private appendPoliceBarricadeStatic(
    layout: DistrictLayout,
    opaqueOut: THREE.BufferGeometry[],
    glassOut: THREE.BufferGeometry[],
    chainLinkOut: THREE.BufferGeometry[],
    redLightOut: THREE.BufferGeometry[],
    blueLightOut: THREE.BufferGeometry[],
  ): void {
    // 1. Police Cruiser(s): layout car props within ~15m of the barricade structure
    const appendPoliceCar = (cx: number, cz: number, rotY: number): void => {
      const parts: THREE.BufferGeometry[] = [];
      // Navy lower body + white doors/roof (classic police black/navy & white)
      parts.push(makeBox(1.94, 0.68, 4.32, 0, 0.56, 0, COLOR_POLICE_NAVY));
      parts.push(makeBox(1.98, 0.64, 1.95, 0, 0.58, 0, COLOR_POLICE_WHITE));
      parts.push(makeBox(2.0, 0.24, 0.26, 0, 0.36, 2.14, 0x1a1e24));
      parts.push(makeBox(2.0, 0.24, 0.26, 0, 0.36, -2.14, 0x1a1e24));
      // Push bumper bar on front (+Z)
      parts.push(makeBox(1.2, 0.48, 0.14, 0, 0.52, 2.24, 0x1a1e24));
      // Cabin roof (white)
      parts.push(makeBox(1.66, 0.62, 2.15, 0, 1.18, -0.15, COLOR_POLICE_WHITE));
      // Blue police stripe along flanks
      parts.push(makeBox(2.01, 0.12, 4.1, 0, 0.68, 0, COLOR_POLICE_BLUE));
      // Headlights & taillights
      parts.push(makeBox(0.36, 0.18, 0.08, -0.65, 0.62, 2.16, 0xf5e9b8));
      parts.push(makeBox(0.36, 0.18, 0.08, 0.65, 0.62, 2.16, 0xf5e9b8));
      parts.push(makeBox(0.38, 0.18, 0.08, -0.65, 0.62, -2.16, 0xd1382c));
      parts.push(makeBox(0.38, 0.18, 0.08, 0.65, 0.62, -2.16, 0xd1382c));
      // 4 Wheels
      for (const [wx, wz] of [
        [-0.92, 1.32],
        [0.92, 1.32],
        [-0.92, -1.32],
        [0.92, -1.32],
      ] as [number, number][]) {
        parts.push(makeBox(0.28, 0.62, 0.62, wx, 0.31, wz, 0x181b1f));
      }
      // Roof lightbar center mount
      parts.push(makeBox(0.32, 0.12, 0.28, 0, 1.54, -0.1, 0x22262b));

      for (const g of parts) {
        if (rotY !== 0) g.rotateY(rotY);
        g.translate(cx, 0, cz);
        opaqueOut.push(g);
      }

      // Cabin glass
      const win = makeBox(1.7, 0.46, 1.85, 0, 1.18, -0.15, 0x26384a);
      if (rotY !== 0) win.rotateY(rotY);
      win.translate(cx, 0, cz);
      glassOut.push(win);

      // Flashing red & blue lightbar halves
      const redBar = makeBox(0.52, 0.16, 0.26, -0.38, 1.58, -0.1, 0xffffff);
      if (rotY !== 0) redBar.rotateY(rotY);
      redBar.translate(cx, 0, cz);
      redLightOut.push(redBar);

      const blueBar = makeBox(0.52, 0.16, 0.26, 0.38, 1.58, -0.1, 0xffffff);
      if (rotY !== 0) blueBar.rotateY(rotY);
      blueBar.translate(cx, 0, cz);
      blueLightOut.push(blueBar);
    };

    for (let i = 0; i < layout.props.length; i++) {
      const p = layout.props[i];
      if (isLandmarkProp(layout, p)) {
        appendPoliceCar(p.pos.x, p.pos.z, p.rotation);
      }
    }

    // 2. Dress barrier props in layout.props within ~15m of the barricade structure centre
    const barricadeCenter = barricadeAnchorCenter(layout);
    if (barricadeCenter) {
      let barrierIdx = 0;
      for (let i = 0; i < layout.props.length; i++) {
        const p = layout.props[i];
        if (p.kind !== 'barrier') continue;
        const dist = Math.hypot(p.pos.x - barricadeCenter.x, p.pos.z - barricadeCenter.z);
        if (dist > BARRICADE_PROP_RADIUS) continue;

        const bx = p.pos.x;
        const bz = p.pos.z;
        const rotY = p.rotation;
        const capParts: THREE.BufferGeometry[] = [
          makeBox(2.88, 0.28, 0.56, 0, 1.22, 0, COLOR_POLICE_NAVY),
          makeBox(0.72, 0.18, 0.6, -0.85, 1.22, 0, COLOR_HAZARD_ORANGE),
          makeBox(0.72, 0.18, 0.6, 0.85, 1.22, 0, COLOR_POLICE_BLUE),
          makeBox(0.22, 0.16, 0.22, 0, 1.42, 0, 0x22262b),
        ];
        for (const g of capParts) {
          if (rotY !== 0) g.rotateY(rotY);
          g.translate(bx, 0, bz);
          opaqueOut.push(g);
        }
        const beacon = makeBox(0.18, 0.18, 0.18, 0, 1.56, 0, 0xffffff);
        if (rotY !== 0) beacon.rotateY(rotY);
        beacon.translate(bx, 0, bz);
        if (barrierIdx % 2 === 0) {
          redLightOut.push(beacon);
        } else {
          blueLightOut.push(beacon);
        }
        barrierIdx++;
      }
    }

    // 3. Chain-link containment pen fence derived from pen-fence-* colliders and penGate rect
    const penFences = layout.colliders.filter((c) => c.tag?.startsWith('pen-fence-'));
    const penDef = findLandmarkDef(layout, 'barricade');
    if (penFences.length === 0 && !penDef) return;

    const fenceH = penFences[0]?.height ?? 2.2;
    const postKeySet = new Set<string>();
    const addPost = (px: number, pz: number): void => {
      const key = `${px.toFixed(2)},${pz.toFixed(2)}`;
      if (postKeySet.has(key)) return;
      postKeySet.add(key);
      opaqueOut.push(
        makeCylinder(
          0.07,
          0.08,
          fenceH + 0.15,
          6,
          px,
          (fenceH + 0.15) * 0.5,
          pz,
          COLOR_DARK_STEEL,
        ),
      );
    };

    const appendFenceCollider = (c: ColliderDef): void => {
      const cw = c.maxX - c.minX;
      const cd = c.maxZ - c.minZ;
      const cx = rectCenterX(c);
      const cz = rectCenterZ(c);
      const isEW = cw >= cd;
      const len = isEW ? cw : cd;
      const w = isEW ? len : 0.06;
      const d = isEW ? 0.06 : len;

      // Top, middle, and bottom horizontal steel pipe rails
      opaqueOut.push(makeBox(w, 0.07, d, cx, 0.12, cz, COLOR_DARK_STEEL));
      opaqueOut.push(makeBox(w, 0.06, d, cx, fenceH * 0.52, cz, COLOR_DARK_STEEL));
      opaqueOut.push(makeBox(w, 0.08, d, cx, fenceH, cz, COLOR_DARK_STEEL));

      // Semi-transparent chain-link mesh sheet
      const meshW = isEW ? Math.max(0.05, len - 0.08) : 0.04;
      const meshD = isEW ? 0.04 : Math.max(0.05, len - 0.08);
      chainLinkOut.push(makeBox(meshW, fenceH - 0.18, meshD, cx, fenceH * 0.5, cz, 0x9aa6b2));

      // Posts along the span endpoints and intermediate intervals
      const steps = Math.max(1, Math.round(len / 2.6));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        if (isEW) {
          const px = c.minX + 0.2 + t * Math.max(0, cw - 0.4);
          addPost(px, cz);
        } else {
          const pz = c.minZ + 0.2 + t * Math.max(0, cd - 0.4);
          addPost(cx, pz);
        }
      }
    };

    for (let i = 0; i < penFences.length; i++) {
      appendFenceCollider(penFences[i]);
    }

    // Gateposts and flashing police beacons flanking penGate
    if (penDef) {
      const gr = penDef.rect;
      const gw = gr.maxX - gr.minX;
      const gd = gr.maxZ - gr.minZ;
      const gcx = rectCenterX(gr);
      const gcz = rectCenterZ(gr);
      const isEW = gw >= gd;
      const post1: [number, number] = isEW ? [gr.minX, gcz] : [gcx, gr.minZ];
      const post2: [number, number] = isEW ? [gr.maxX, gcz] : [gcx, gr.maxZ];
      addPost(post1[0], post1[1]);
      addPost(post2[0], post2[1]);

      opaqueOut.push(makeBox(0.22, 0.12, 0.22, post1[0], fenceH + 0.2, post1[1], 0x22262b));
      opaqueOut.push(makeBox(0.22, 0.12, 0.22, post2[0], fenceH + 0.2, post2[1], 0x22262b));
      redLightOut.push(makeBox(0.18, 0.18, 0.18, post1[0], fenceH + 0.34, post1[1], 0xffffff));
      blueLightOut.push(makeBox(0.18, 0.18, 0.18, post2[0], fenceH + 0.34, post2[1], 0xffffff));
    }
  }

  private buildBreakables(layout: DistrictLayout): void {
    const heightsByKind: Record<StructureKind, number> = {
      busDoor: 2.6,
      alleyGate: 2.8,
      storeDoor: 2.6,
      penGate: 2.2,
      stationDoor: 3.2,
      securityShutter: 3,
    };

    const pickMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      }),
    );

    const hlMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: COLOR_HAZARD_ORANGE,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      }),
    );

    const occMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    for (let i = 0; i < layout.structures.length; i++) {
      const def = layout.structures[i];
      const r: AABB = def.rect;
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const matchingCollider = layout.colliders.find((c) => c.tag === def.tag);
      const h = matchingCollider?.height ?? heightsByKind[def.kind] ?? 2.6;
      const cx = rectCenterX(r);
      const cz = rectCenterZ(r);

      const intactGroup = new THREE.Group();
      intactGroup.name = `StructureIntact_${def.tag}`;
      intactGroup.position.set(cx, 0, cz);
      this.group.add(intactGroup);

      const doorPivot = new THREE.Group();
      doorPivot.name = `StructureDoorPivot_${def.tag}`;
      intactGroup.add(doorPivot);

      const intactMat = this.trackMaterial(
        new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      );

      const { intactGeom, glassPanes, crackMesh, rubbleGeom } = this.createBreakableGeometries(
        def.kind,
        w,
        h,
        d,
        def.facing,
      );

      const intactMesh = new THREE.Mesh(intactGeom, intactMat);
      intactMesh.castShadow = true;
      intactMesh.receiveShadow = true;
      doorPivot.add(intactMesh);

      for (let gIdx = 0; gIdx < glassPanes.length; gIdx++) {
        doorPivot.add(glassPanes[gIdx]);
      }

      if (crackMesh) {
        doorPivot.add(crackMesh);
      }

      const rubbleGroup = new THREE.Group();
      rubbleGroup.name = `StructureRubble_${def.tag}`;
      rubbleGroup.position.set(cx, 0, cz);
      rubbleGroup.visible = false;
      const rubbleMat = this.trackMaterial(
        new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      );
      const rubbleMesh = new THREE.Mesh(rubbleGeom, rubbleMat);
      rubbleMesh.receiveShadow = true;
      rubbleGroup.add(rubbleMesh);
      this.group.add(rubbleGroup);

      const hlGeom = this.trackGeometry(new THREE.BoxGeometry(w + 0.28, h + 0.22, d + 0.28));
      const highlightMesh = new THREE.Mesh(hlGeom, hlMat);
      highlightMesh.position.set(0, h * 0.5, 0);
      highlightMesh.visible = false;
      intactGroup.add(highlightMesh);

      // Slightly enlarged invisible pick proxy (kept compact on storeDoor so sheltered civilians stay easily clickable)
      const padXZ = def.kind === 'storeDoor' ? 0.45 : 1.1;
      const padY = 0.8;
      const pickGeom = this.trackGeometry(new THREE.BoxGeometry(w + padXZ, h + padY, d + padXZ));
      const pickY = (h + padY) * 0.5;
      const pickMesh = new THREE.Mesh(pickGeom, pickMat);
      pickMesh.position.set(cx, pickY, cz);
      pickMesh.name = `StructurePickProxy_${def.id}`;
      pickMesh.userData.target = { kind: 'structure', id: def.id };
      this.group.add(pickMesh);
      this.pickMeshes.push(pickMesh);

      // Camera/sight occluder for intact breakable (linked to pickMesh; storeDoor excluded from pick occlusion)
      const occGeom = this.trackGeometry(new THREE.BoxGeometry(w, h, d));
      const occluderMesh = new THREE.Mesh(occGeom, occMat);
      occluderMesh.position.set(cx, h * 0.5, cz);
      occluderMesh.visible = false;
      occluderMesh.name = `StructureOccluder_${def.id}`;
      occluderMesh.userData.pickTarget = pickMesh;
      if (def.kind === 'storeDoor') {
        occluderMesh.userData.ignorePickOcclusion = true;
        this.storeOccluders.add(occluderMesh);
      }
      this.group.add(occluderMesh);

      this.breakables.set(def.id, {
        id: def.id,
        kind: def.kind,
        landmark: def.landmark,
        def,
        cx,
        cz,
        w,
        h,
        d,
        pickY,
        intactGroup,
        doorPivot,
        intactMesh,
        intactMat,
        glassPanes,
        crackMesh,
        rubbleGroup,
        highlightMesh,
        pickMesh,
        occluderMesh,
        localDestroyedAt: null,
      });
    }
  }

  private createBreakableGeometries(
    kind: StructureKind,
    w: number,
    h: number,
    d: number,
    facing: number,
  ): {
    intactGeom: THREE.BufferGeometry;
    glassPanes: THREE.Mesh[];
    crackMesh: THREE.Mesh | null;
    rubbleGeom: THREE.BufferGeometry;
  } {
    const parts: THREE.BufferGeometry[] = [];
    const rubble: THREE.BufferGeometry[] = [];
    const glassPanes: THREE.Mesh[] = [];
    let crackMesh: THREE.Mesh | null = null;
    const dirX = Math.sin(facing);
    const dirZ = Math.cos(facing);

    if (kind === 'busDoor') {
      // Double folding yellow/orange bus doors with window panes & hazard bar
      const leafW = w * 0.46;
      for (const sign of [-1, 1]) {
        const lx = sign * (w * 0.25);
        parts.push(makeBox(leafW, h - 0.1, d * 0.72, lx, h * 0.5, 0, COLOR_BUS_YELLOW));
        parts.push(makeBox(leafW * 0.9, 0.2, d * 0.9, lx, h * 0.36, 0, COLOR_BUS_TRIM));
        const paneGeom = this.trackGeometry(new THREE.BoxGeometry(leafW * 0.76, h * 0.42, d * 0.84));
        const paneMesh = new THREE.Mesh(paneGeom, this.glassIntactMat);
        paneMesh.position.set(lx, h * 0.66, 0);
        glassPanes.push(paneMesh);
      }
      // Emergency diagonal hazard bar across bus doors
      parts.push(makeBox(w * 0.92, 0.2, d * 0.96, 0, 1.15, 0, COLOR_HAZARD_ORANGE, 0, 0, 0.12));
      parts.push(makeBox(w * 0.88, 0.16, d * 0.96, 0, 0.75, 0, COLOR_WOOD_PLANK, 0, 0, -0.08));

      // Rubble on ground along outward facing
      rubble.push(
        makeBox(leafW, 0.1, h * 0.75, -w * 0.24 + dirX * 0.95, 0.06, dirZ * 0.95, COLOR_BUS_YELLOW, 0.04, 0.18, 0),
      );
      rubble.push(
        makeBox(leafW, 0.1, h * 0.75, w * 0.26 + dirX * 1.05, 0.07, dirZ * 1.05, COLOR_BUS_ORANGE, -0.05, -0.22, 0),
      );
      rubble.push(
        makeBox(w * 0.7, 0.12, 0.24, 0.1 + dirX * 0.55, 0.08, dirZ * 0.55, COLOR_HAZARD_ORANGE, 0, 0.35, 0),
      );
    } else if (kind === 'alleyGate') {
      // Chain-link + plank gate with hazard paint, padlock, and hand-painted "DON'T OPEN" red-X sign
      parts.push(makeBox(0.16, h, d * 0.7, -w * 0.46, h * 0.5, 0, COLOR_DARK_STEEL));
      parts.push(makeBox(0.16, h, d * 0.7, w * 0.46, h * 0.5, 0, COLOR_DARK_STEEL));
      parts.push(makeBox(w, 0.14, d * 0.7, 0, h - 0.08, 0, COLOR_DARK_STEEL));
      parts.push(makeBox(w, 0.14, d * 0.7, 0, 0.14, 0, COLOR_DARK_STEEL));
      parts.push(makeBox(0.14, h, d * 0.75, 0, h * 0.5, 0, COLOR_DARK_STEEL));
      parts.push(makeBox(w - 0.24, h - 0.28, d * 0.3, 0, h * 0.5, 0, 0x6b747e));

      // Horizontal & angled wood barricade planks + hazard stripes
      parts.push(makeBox(w * 0.94, 0.28, d * 0.85, 0, 0.58, 0, COLOR_WOOD_PLANK, 0, 0, 0.04));
      parts.push(makeBox(w * 0.92, 0.26, d * 0.85, 0, 1.12, 0, COLOR_HAZARD_YELLOW, 0, 0, -0.03));
      parts.push(makeBox(w * 0.94, 0.28, d * 0.85, 0, 2.22, 0, COLOR_WOOD_DARK, 0, 0, 0.05));

      // Hand-painted "DON'T OPEN" sign board on the outer face (planks + bold red X)
      const faceZ = (dirZ !== 0 ? Math.sign(dirZ) : 1) * d * 0.45;
      parts.push(makeBox(1.55, 0.88, 0.14, 0, 1.65, faceZ, 0xd8cbb2));
      parts.push(makeBox(1.62, 0.1, 0.16, 0, 2.06, faceZ, COLOR_WOOD_DARK));
      parts.push(makeBox(1.62, 0.1, 0.16, 0, 1.24, faceZ, COLOR_WOOD_DARK));
      parts.push(makeBox(1.38, 0.16, 0.18, 0, 1.65, faceZ * 1.06, COLOR_DANGER_RED, 0, 0, 0.46));
      parts.push(makeBox(1.38, 0.16, 0.18, 0, 1.65, faceZ * 1.06, COLOR_DANGER_RED, 0, 0, -0.46));

      // Heavy chain & oversized padlock
      parts.push(makeBox(0.75, 0.14, 0.22, 0, 1.08, faceZ, COLOR_RUST_STEEL));
      parts.push(makeBox(0.28, 0.32, 0.24, 0, 0.92, faceZ * 1.14, COLOR_HAZARD_YELLOW));
      parts.push(makeBox(0.18, 0.2, 0.18, 0, 1.12, faceZ * 1.14, 0x9aa2ab));

      // Collapsed gate & broken planks on ground
      for (let k = 0; k < 7; k++) {
        const rx = -w * 0.38 + (k / 6) * w * 0.76;
        const rz = (0.35 + (k % 3) * 0.38) * (dirZ !== 0 ? Math.sign(dirZ) : 1);
        const col = k % 3 === 0 ? COLOR_HAZARD_YELLOW : k % 2 === 0 ? COLOR_WOOD_PLANK : COLOR_DARK_STEEL;
        rubble.push(makeBox(0.95, 0.12, 0.28, rx, 0.07, rz, col, 0.04, k * 0.5, 0));
      }
    } else if (kind === 'storeDoor') {
      // Storefront double aluminum glass doors + light wooden barricade bar
      parts.push(makeBox(0.16, h, d * 0.8, -w * 0.47, h * 0.5, 0, COLOR_STORE_TRIM));
      parts.push(makeBox(0.16, h, d * 0.8, w * 0.47, h * 0.5, 0, COLOR_STORE_TRIM));
      parts.push(makeBox(0.14, h, d * 0.8, 0, h * 0.5, 0, COLOR_STORE_TRIM));
      parts.push(makeBox(w, 0.18, d * 0.8, 0, h - 0.09, 0, COLOR_STORE_TRIM));
      parts.push(makeBox(w, 0.32, d * 0.8, 0, 0.16, 0, COLOR_STORE_TRIM));
      // Push bar & wooden plank across glass door
      parts.push(makeBox(w * 0.88, 0.1, d * 0.9, 0, 1.05, 0, 0xc8d0d8));
      parts.push(makeBox(w * 0.92, 0.22, d * 0.92, 0, 1.35, 0, COLOR_WOOD_PLANK, 0, 0, -0.06));
      // Left & right transparent door glass panes
      const paneW = Math.max(0.2, (w - 0.5) * 0.48);
      const paneH = Math.max(0.4, h - 0.5);
      for (const sign of [-1, 1]) {
        const paneGeom = this.trackGeometry(new THREE.BoxGeometry(paneW, paneH, 0.1));
        const paneMesh = new THREE.Mesh(paneGeom, this.glassIntactMat);
        paneMesh.position.set(sign * (w * 0.23), h * 0.52, 0);
        glassPanes.push(paneMesh);
      }

      // Glass crack lines mesh (hidden at full HP, revealed as HP drops)
      const crackGeoms: THREE.BufferGeometry[] = [
        makeBox(1.4, 0.05, d * 0.96, -0.2, 1.5, 0, 0xe8f6ff, 0, 0, 0.62),
        makeBox(1.2, 0.05, d * 0.96, 0.25, 1.45, 0, 0xe8f6ff, 0, 0, -0.54),
        makeBox(0.95, 0.04, d * 0.96, 0.05, 1.75, 0, 0xe8f6ff, 0, 0, 0.18),
        makeBox(1.1, 0.04, d * 0.96, -0.35, 1.15, 0, 0xe8f6ff, 0, 0, -0.32),
      ];
      const mergedCracks = this.trackGeometry(mergeAndDispose(crackGeoms));
      const crackMat = this.trackMaterial(new THREE.MeshBasicMaterial({ color: 0xeaf8ff }));
      crackMesh = new THREE.Mesh(mergedCracks, crackMat);
      crackMesh.visible = false;

      // Shattered glass shards & bent frame on the threshold
      for (let k = 0; k < 9; k++) {
        const rx = -w * 0.4 + (k / 8) * w * 0.8;
        const rz = -0.5 + (k % 3) * 0.45;
        const col = k % 3 === 0 ? COLOR_STORE_TRIM : 0x8fd0f2;
        rubble.push(makeBox(0.42, 0.06, 0.32, rx, 0.04, rz, col, 0.05, k * 0.7, 0));
      }
    } else {
      // penGate: riot-door pen gate
      parts.push(makeBox(w * 0.8, h, 0.16, 0, h * 0.5, -d * 0.46, COLOR_POLICE_NAVY));
      parts.push(makeBox(w * 0.8, h, 0.16, 0, h * 0.5, d * 0.46, COLOR_POLICE_NAVY));
      parts.push(makeBox(w * 0.8, 0.16, d, 0, h - 0.08, 0, COLOR_POLICE_NAVY));
      parts.push(makeBox(w * 0.8, 0.16, d, 0, 0.14, 0, COLOR_POLICE_NAVY));
      // Diagonal steel cross-brace & riot shield bars
      parts.push(makeBox(w * 0.85, 0.16, d * 0.92, 0, h * 0.5, 0, COLOR_POLICE_BLUE));
      parts.push(makeBox(w * 0.9, 0.22, d * 0.88, 0, h * 0.68, 0, COLOR_HAZARD_ORANGE));
      parts.push(makeBox(w * 0.9, 0.22, d * 0.88, 0, h * 0.32, 0, COLOR_HAZARD_ORANGE));
      parts.push(makeBox(w * 0.4, h - 0.32, d - 0.32, 0, h * 0.5, 0, 0x5c6875));

      // Collapsed riot gate on pavement outside pen along facing
      rubble.push(
        makeBox(
          h * 0.8,
          0.1,
          d * 0.82,
          dirX * 0.95,
          0.06,
          dirZ * 0.95,
          COLOR_POLICE_NAVY,
          0,
          0.12,
          0.04,
        ),
      );
      rubble.push(
        makeBox(
          0.32,
          0.12,
          d * 0.78,
          dirX * 0.65,
          0.09,
          0.05 + dirZ * 0.65,
          COLOR_HAZARD_ORANGE,
          0,
          -0.15,
          0,
        ),
      );
    }

    return {
      intactGeom: this.trackGeometry(mergeAndDispose(parts)),
      glassPanes,
      crackMesh,
      rubbleGeom: this.trackGeometry(mergeAndDispose(rubble)),
    };
  }
}
