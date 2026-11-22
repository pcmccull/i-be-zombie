// [3D] Renders player vehicles, companion discovery beacons, secret caches, hideout zombie flags, and the Living City
// overlays: companion accessories that follow their zombie, zombie banners + graffiti on controlled districts, and
// storm-drain shortcut markers. Respects the EW hiddenBeyond vision limit. Spec: docs/11_cityupgrade.md §2.9, §4.1.B, §6.
// Two roots: `root` (noVisionHaze, existing vehicle + beacons, culled by distance) and `world` (hazed like the zombies and
// the city it sits in, so a companion's accessories fade with the companion itself).
import * as THREE from 'three';
import { COMPANIONS, HIDEOUTS, SECRETS } from '../content/rewards';
import type { CompanionId, DistrictLayout, GameState, PlayerVehicleKind, ZombieAgent } from '../core/types';
import { mulberry32 } from '../utils/rng';
import { lerpAngle } from '../utils/math';
import { box, cyl, mergeParts, part } from './CityEventProps';
import { DECAL_Y } from '../world/groundLevels';

const BANNERS_PER_CONTROLLED = 6;
const GRAFFITI_PER_CONTROLLED = 6;
const GRAFFITI_PER_INFLUENCED = 2;
const GRAFFITI_COLORS = [0x5effb8, 0x9be35a, 0xb983ff, 0xff9ec0] as const;
/** The focus must move this far before district dressing is re-culled (instance matrices are rewritten). */
const DISTRICT_RECULL_DIST = 2;
const DISTRICT_RECULL_DIST2 = DISTRICT_RECULL_DIST * DISTRICT_RECULL_DIST;

function flatMat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function buildVehicleMesh(kind: PlayerVehicleKind): THREE.Group {
  const root = new THREE.Group();
  const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 8);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = flatMat(0x22262b);

  const addWheels = (wx: number, wz: number) => {
    for (const sx of [-wx, wx]) {
      for (const sz of [-wz, wz]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(sx, 0.28, sz);
        root.add(w);
      }
    }
  };

  if (kind === 'golf_cart') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.55, 2.3), flatMat(0xf4f0e6));
    body.position.y = 0.55;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 1.9), flatMat(0x2ec4b6));
    roof.position.y = 1.68;
    for (const sx of [-0.6, 0.6]) {
      for (const sz of [-0.75, 0.75]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), flatMat(0x8a95a5));
        post.position.set(sx, 1.25, sz);
        root.add(post);
      }
    }
    root.add(body, roof);
    addWheels(0.75, 0.8);
  } else if (kind === 'scooter') {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 1.5), flatMat(0xff6b6b));
    deck.position.y = 0.42;
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.85, 0.14), flatMat(0xf4f0e6));
    stem.position.set(0, 0.9, 0.55);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.08), flatMat(0x2d3240));
    bar.position.set(0, 1.32, 0.55);
    root.add(deck, stem, bar);
    for (const sz of [-0.55, 0.55]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(0, 0.28, sz);
      root.add(w);
    }
  } else if (kind === 'ice_cream_truck') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 3.8), flatMat(0xffe5ec));
    body.position.y = 1.05;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.35, 3.82), flatMat(0x5effb8));
    stripe.position.y = 0.85;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 7), flatMat(0xf2c14e));
    cone.position.set(0, 2.15, 0.4);
    cone.rotation.x = Math.PI;
    root.add(body, stripe, cone);
    addWheels(0.95, 1.25);
  } else {
    // parade_float
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.65, 4.4), flatMat(0x9b5de5));
    deck.position.y = 0.65;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.15, 6, 12, Math.PI), flatMat(0xfee440));
    arch.position.set(0, 1.1, -0.6);
    const palm = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.1, 6), flatMat(0x00f5d4));
    palm.position.set(0, 1.8, 1.0);
    root.add(deck, arch, palm);
    addWheels(1.2, 1.45);
  }
  return root;
}

/** Zombie banner: green flag with a skull (cranium + jaw boxes) on a pole. One merged, vertex-coloured unit. */
function bannerGeometry(): THREE.BufferGeometry {
  return mergeParts([
    part(cyl(0.05, 0.05, 3.4, 6), 0x4a5260, 0, 1.7, 0),
    part(box(1.5, 0.95, 0.05), 0x6fb84a, 0.8, 2.85, 0),
    part(box(0.5, 0.42, 0.07), 0xf4f0e6, 0.8, 2.99, 0.01),
    part(box(0.36, 0.16, 0.07), 0xf4f0e6, 0.8, 2.72, 0.01),
  ]);
}

/** Graffiti: a flat quad lying just above the street (polygon offset keeps it off the ground's z-fight). */
function graffitiGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(3.2, 2.2);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Deterministic 32-bit FNV-1a: the same district always gets the same banner and graffiti spots. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

interface CompanionAccessory { body: THREE.Group; head: THREE.Group }
/** Writes the world head-bone matrix of a drawn zombie into `out`; false if it is not drawn (HordeRenderer.headMatrixOf). */
export type HeadMatrixLookup = (zombieId: number, out: THREE.Matrix4) => boolean;

interface DecalSpec { x: number; z: number; ry: number; color: number }
interface ShortcutEnd { secretId: string; x: number; z: number; group: THREE.Group }

function findZombie(zombies: readonly ZombieAgent[], id: number): ZombieAgent | undefined {
  for (const z of zombies) if (z.id === id) return z;
  return undefined;
}

export class CityVisuals {
  /** noVisionHaze: vehicle + beacons (unchanged behaviour), culled by distance only. */
  private readonly root = new THREE.Group();
  /** Hazed like the city: companions, district dressing, shortcut markers. */
  private readonly world = new THREE.Group();
  private vehicleRoot: THREE.Group | null = null;
  private vehicleKind: PlayerVehicleKind | null = null;
  private readonly beacons = new Map<string, THREE.Group>();

  private readonly lambertCache = new Map<number, THREE.MeshLambertMaterial>();
  private readonly vertexMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  /** Per companion: `body` follows the zombie root, `head` rides its animated head bone (hats, bun, whistle). */
  private readonly accessories = new Map<CompanionId, CompanionAccessory>();
  private headLookup: HeadMatrixLookup | null = null;
  private readonly scratchHead = new THREE.Matrix4();
  private readonly shortcutEnds: ShortcutEnd[] = [];

  private readonly layout: DistrictLayout | null;
  private readonly banners: THREE.InstancedMesh | null;
  private readonly graffiti: THREE.InstancedMesh | null;
  private bannerSpecs: DecalSpec[] = [];
  private graffitiSpecs: DecalSpec[] = [];
  private districtSignature = -1;
  private districtDirty = true;
  private cullX = 0;
  private cullZ = 0;
  private cullLimit = NaN;
  private readonly scratchObj = new THREE.Object3D();
  private readonly scratchColor = new THREE.Color();

  /**
   * @param layout the world layout; needed for zombie banners/graffiti on controlled districts (omitted = no district dressing).
   */
  constructor(private readonly scene: THREE.Scene, layout?: DistrictLayout) {
    this.root.name = 'CityVisuals';
    this.root.userData.noVisionHaze = true;
    this.scene.add(this.root);
    this.world.name = 'CityVisualsWorld';
    this.scene.add(this.world);
    this.initBeacons();

    for (const c of COMPANIONS) {
      const acc = this.buildAccessory(c.id);
      acc.body.visible = false;
      acc.head.visible = false;
      this.world.add(acc.body, acc.head);
      this.accessories.set(c.id, acc);
    }
    for (const s of SECRETS) {
      if (!s.shortcutTo) continue;
      for (const end of [s.pos, s.shortcutTo]) {
        const g = this.buildShortcutMarker();
        g.position.set(end.x, 0, end.z);
        g.visible = false;
        this.world.add(g);
        this.shortcutEnds.push({ secretId: s.id, x: end.x, z: end.z, group: g });
      }
    }

    this.layout = layout ?? null;
    if (layout) {
      const districts = Math.max(1, layout.districts.length);
      this.banners = new THREE.InstancedMesh(bannerGeometry(), this.vertexMat, districts * BANNERS_PER_CONTROLLED);
      this.banners.count = 0;
      this.banners.frustumCulled = false;
      this.banners.castShadow = false;
      this.banners.receiveShadow = false;
      this.world.add(this.banners);
      const graffitiMat = new THREE.MeshLambertMaterial({
        color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.graffiti = new THREE.InstancedMesh(graffitiGeometry(), graffitiMat, districts * GRAFFITI_PER_CONTROLLED);
      this.graffiti.count = 0;
      this.graffiti.frustumCulled = false;
      this.graffiti.receiveShadow = false;
      this.world.add(this.graffiti);
    } else {
      this.banners = null;
      this.graffiti = null;
    }
  }

  private lambert(color: number): THREE.MeshLambertMaterial {
    let m = this.lambertCache.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color }); this.lambertCache.set(color, m); }
    return m;
  }

  private initBeacons(): void {
    const makeBeacon = (key: string, color: number, height: number) => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, height, 6), flatMat(0x4a5260));
      pole.position.y = height * 0.5;
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), flatMat(color));
      orb.position.y = height + 0.35;
      g.add(pole, orb);
      g.visible = false;
      this.root.add(g);
      this.beacons.set(key, g);
    };
    for (const c of COMPANIONS) makeBeacon(`comp:${c.id}`, 0x5effb8, 2.2);
    for (const s of SECRETS) makeBeacon(`sec:${s.id}`, 0xffd166, 1.8);
    for (const h of HIDEOUTS) makeBeacon(`hide:${h.id}`, 0x8be04e, 2.8);
  }

  /** HordeRenderer.headMatrixOf: lets head accessories follow the animated head (nod, sway, lurch, death fall). */
  setHeadLookup(lookup: HeadMatrixLookup | null): void {
    this.headLookup = lookup;
  }

  /**
   * Companion accessories, built once per companion. `body` parts are in root space (ground at y 0, head ~1.65 m);
   * `head` parts are in the zombie head-bone frame (same frame as zombieModel's hardHat/policeCap: crown at y ~0.3,
   * face toward +z), so they move and scale exactly like the built-in hats.
   */
  private buildAccessory(id: CompanionId): CompanionAccessory {
    const body = new THREE.Group();
    body.name = `Companion:${id}`;
    const head = new THREE.Group();
    head.name = `CompanionHead:${id}`;
    head.matrixAutoUpdate = false;
    const add = (g: THREE.Group, geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void => {
      const m = new THREE.Mesh(geo, this.lambert(color));
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = false;
      g.add(m);
    };
    switch (id) {
      case 'larry_lifeguard':
        // Red rescue tube hung on the shoulder, whistle at the mouth.
        add(body, new THREE.TorusGeometry(0.17, 0.06, 6, 12), 0xff3b30, 0.36, 1.32, 0, 0, Math.PI / 2, 0);
        add(head, new THREE.CylinderGeometry(0.025, 0.025, 0.1, 6), 0xc0c6cf, 0, 0.06, 0.19, Math.PI / 2, 0, 0);
        break;
      case 'chef_brainsley':
        // Tall white toque on a band, seated on the crown.
        add(head, new THREE.CylinderGeometry(0.158, 0.155, 0.1, 8), 0xf4f0e6, 0, 0.33, -0.005);
        add(head, new THREE.CylinderGeometry(0.2, 0.15, 0.36, 8), 0xffffff, 0, 0.55, -0.005);
        break;
      case 'grandma_rot':
        // White hair bun at the back of the head, purple handbag held at the hip.
        add(head, new THREE.SphereGeometry(0.1, 8, 6), 0xf4f0e6, 0, 0.27, -0.15);
        add(body, new THREE.BoxGeometry(0.3, 0.24, 0.12), 0x9b5de5, 0.42, 0.98, 0.14);
        add(body, new THREE.BoxGeometry(0.22, 0.04, 0.04), 0x6a3fb0, 0.42, 1.14, 0.14);
        break;
    }
    return { body, head };
  }

  /** Storm-drain marker: dark grate disc + green arrow sign on a pole. */
  private buildShortcutMarker(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'ShortcutMarker';
    const grate = new THREE.Mesh(new THREE.CircleGeometry(0.9, 12).rotateX(-Math.PI / 2), this.lambert(0x1c2430));
    grate.position.y = DECAL_Y;
    grate.castShadow = false;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), this.lambert(0x4a5260));
    pole.position.set(0, 1.1, 0.9);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.05), this.lambert(0x2e8b84));
    board.position.set(0, 2.35, 0.9);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 3), this.lambert(0x5effb8));
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(0.85, 2.35, 0.9);
    g.add(grate, pole, board, arrow);
    return g;
  }

  update(state: GameState, time: number, focusX: number, focusZ: number, hiddenBeyond: number, alpha = 1): void {
    const maxD2 = hiddenBeyond * hiddenBeyond;

    // 1. Player vehicle
    const pv = state.playerVehicle;
    if (!pv) {
      if (this.vehicleRoot) this.vehicleRoot.visible = false;
    } else {
      if (this.vehicleKind !== pv.kind) {
        if (this.vehicleRoot) {
          this.root.remove(this.vehicleRoot);
        }
        this.vehicleRoot = buildVehicleMesh(pv.kind);
        this.vehicleKind = pv.kind;
        this.root.add(this.vehicleRoot);
      }
      if (this.vehicleRoot) {
        const dx = pv.pos.x - focusX;
        const dz = pv.pos.z - focusZ;
        this.vehicleRoot.visible = dx * dx + dz * dz <= maxD2;
        this.vehicleRoot.position.set(pv.pos.x, 0, pv.pos.z);
        this.vehicleRoot.rotation.y = pv.facing;
      }
    }

    // 2. World discovery / hideout beacons
    const bob = Math.sin(time * 2.5) * 0.14;
    for (const c of COMPANIONS) {
      const b = this.beacons.get(`comp:${c.id}`);
      if (!b) continue;
      const unlocked = state.rewards.unlockedCompanionIds.includes(c.id);
      const dx = c.unlockPos.x - focusX;
      const dz = c.unlockPos.z - focusZ;
      b.visible = !unlocked && dx * dx + dz * dz <= maxD2;
      if (b.visible) {
        b.position.set(c.unlockPos.x, bob, c.unlockPos.z);
        b.rotation.y = time * 1.4;
      }
    }
    for (const s of SECRETS) {
      const b = this.beacons.get(`sec:${s.id}`);
      if (!b) continue;
      const found = state.rewards.discoveredSecretIds.includes(s.id);
      const dx = s.pos.x - focusX;
      const dz = s.pos.z - focusZ;
      b.visible = !found && dx * dx + dz * dz <= maxD2;
      if (b.visible) {
        b.position.set(s.pos.x, bob, s.pos.z);
        b.rotation.y = -time * 1.6;
      }
    }
    for (const h of HIDEOUTS) {
      const b = this.beacons.get(`hide:${h.id}`);
      if (!b) continue;
      const unlocked = state.rewards.unlockedHideoutIds.includes(h.id);
      const dx = h.pos.x - focusX;
      const dz = h.pos.z - focusZ;
      b.visible = unlocked && dx * dx + dz * dz <= maxD2;
      if (b.visible) {
        b.position.set(h.pos.x, 0, h.pos.z);
        b.rotation.y = time * 0.8;
      }
    }

    // 3. Living City overlays (hazed world group)
    this.updateCompanions(state, focusX, focusZ, maxD2, alpha);
    for (const e of this.shortcutEnds) {
      const dx = e.x - focusX;
      const dz = e.z - focusZ;
      e.group.visible = state.rewards.discoveredSecretIds.includes(e.secretId) && dx * dx + dz * dz <= maxD2;
    }
    if (this.layout) this.updateDistricts(state, focusX, focusZ, hiddenBeyond);
  }

  /** Accessories follow their companion's zombie (interpolated with the render alpha); hidden when it is gone or far. */
  private updateCompanions(state: GameState, focusX: number, focusZ: number, maxD2: number, alpha: number): void {
    for (const acc of this.accessories.values()) { acc.body.visible = false; acc.head.visible = false; }
    for (const c of state.companions) {
      const acc = this.accessories.get(c.id);
      if (!acc) continue;
      const z = c.zombieId === null ? undefined : findZombie(state.zombies, c.zombieId);
      if (!z || z.state === 'dead' || z.dormant) continue;
      const x = z.prevPos.x + (z.pos.x - z.prevPos.x) * alpha;
      const zp = z.prevPos.z + (z.pos.z - z.prevPos.z) * alpha;
      const dx = x - focusX, dz = zp - focusZ;
      if (dx * dx + dz * dz > maxD2) continue;
      acc.body.visible = true;
      acc.body.position.set(x, z.elevation, zp);
      acc.body.rotation.y = lerpAngle(z.prevFacing, z.facing, alpha);
      // Head parts only show while the head is drawn (never float at a stale or guessed spot).
      if (this.headLookup && this.headLookup(z.id, this.scratchHead)) {
        acc.head.visible = true;
        acc.head.matrix.copy(this.scratchHead);
        acc.head.matrixWorldNeedsUpdate = true;
      }
    }
  }

  /** Numeric control signature (base 3 per district in layout order): changes only when a district's control changes. */
  private controlSignature(state: GameState): number {
    let sig = 0;
    for (const d of this.layout?.districts ?? []) {
      const c = state.districts[d.id]?.control;
      sig = sig * 3 + (c === 'zombieControlled' ? 2 : c === 'zombieInfluenced' ? 1 : 0);
    }
    return sig;
  }

  private updateDistricts(state: GameState, focusX: number, focusZ: number, hiddenBeyond: number): void {
    const sig = this.controlSignature(state);
    if (sig !== this.districtSignature) {
      this.districtSignature = sig;
      this.rebuildDistricts(state);
      this.districtDirty = true;
    }
    const moved = (focusX - this.cullX) ** 2 + (focusZ - this.cullZ) ** 2 > DISTRICT_RECULL_DIST2;
    if (this.districtDirty || moved || hiddenBeyond !== this.cullLimit) {
      this.cullX = focusX;
      this.cullZ = focusZ;
      this.cullLimit = hiddenBeyond;
      this.districtDirty = false;
      this.placeDistrictInstances(focusX, focusZ, hiddenBeyond);
    }
  }

  /** Deterministic spots: banners and graffiti on a district's spawn points (6 + 6 controlled, 2 graffiti influenced). */
  private rebuildDistricts(state: GameState): void {
    this.bannerSpecs = [];
    this.graffitiSpecs = [];
    for (const d of this.layout?.districts ?? []) {
      const control = state.districts[d.id]?.control;
      if (control !== 'zombieControlled' && control !== 'zombieInfluenced') continue;
      const controlled = control === 'zombieControlled';
      const rng = mulberry32(hashId(d.id));
      const pts = d.spawnPoints.length > 0 ? d.spawnPoints
        : [{ x: (d.rect.minX + d.rect.maxX) / 2, z: (d.rect.minZ + d.rect.maxZ) / 2 }];
      const pickPoint = () => pts[Math.min(pts.length - 1, Math.floor(rng.next() * pts.length))];
      if (controlled) {
        for (let k = 0; k < BANNERS_PER_CONTROLLED; k++) {
          const p = pickPoint();
          this.bannerSpecs.push({ x: p.x + (rng.next() * 2 - 1) * 1.5, z: p.z + (rng.next() * 2 - 1) * 1.5,
            ry: rng.next() * Math.PI * 2, color: 0 });
        }
      }
      const decals = controlled ? GRAFFITI_PER_CONTROLLED : GRAFFITI_PER_INFLUENCED;
      for (let k = 0; k < decals; k++) {
        const p = pickPoint();
        this.graffitiSpecs.push({ x: p.x + (rng.next() * 2 - 1) * 2, z: p.z + (rng.next() * 2 - 1) * 2,
          ry: rng.next() * Math.PI * 2, color: GRAFFITI_COLORS[Math.min(GRAFFITI_COLORS.length - 1, Math.floor(rng.next() * GRAFFITI_COLORS.length))] });
      }
    }
  }

  /** Writes the instance matrices/colours of the decals inside the vision limit; the rest are simply not drawn. */
  private placeDistrictInstances(focusX: number, focusZ: number, limit: number): void {
    if (!this.banners || !this.graffiti) return;
    const r2 = limit * limit;
    let n = 0;
    for (const s of this.bannerSpecs) {
      const dx = s.x - focusX, dz = s.z - focusZ;
      if (dx * dx + dz * dz > r2) continue;
      this.setInstance(this.banners, n++, s.x, 0, s.z, s.ry);
    }
    this.banners.count = n;
    this.banners.instanceMatrix.needsUpdate = true;

    let m = 0;
    for (const s of this.graffitiSpecs) {
      const dx = s.x - focusX, dz = s.z - focusZ;
      if (dx * dx + dz * dz > r2) continue;
      this.setInstance(this.graffiti, m, s.x, DECAL_Y, s.z, s.ry);
      this.scratchColor.setHex(s.color);
      this.graffiti.setColorAt(m, this.scratchColor);
      m++;
    }
    this.graffiti.count = m;
    this.graffiti.instanceMatrix.needsUpdate = true;
    if (this.graffiti.instanceColor) this.graffiti.instanceColor.needsUpdate = true;
  }

  private setInstance(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, ry: number): void {
    this.scratchObj.position.set(x, y, z);
    this.scratchObj.rotation.set(0, ry, 0);
    this.scratchObj.updateMatrix();
    mesh.setMatrixAt(i, this.scratchObj.matrix);
  }

  dispose(): void {
    const disposeObj = (o: THREE.Object3D) => {
      o.traverse(c => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
    };
    disposeObj(this.root);
    disposeObj(this.world);
    for (const m of this.lambertCache.values()) m.dispose();
    this.lambertCache.clear();
    this.vertexMat.dispose();
    this.scene.remove(this.root);
    this.scene.remove(this.world);
  }
}
