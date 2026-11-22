// [3D] Pooled low-poly dressing for active city events: tour bus, food truck, volleyball net, stage, party lights,
// wreck, convoy truck, barricade. Render-only: the sim never collides with these props.
// Spec: docs/11_cityupgrade.md §2.5-2.6. The props are NOT noVisionHaze (they haze like the city) and cull themselves
// past hiddenBeyond. They live under the scene, so VisionFog.patchScene covers them without extra wiring.
// Forward convention: local +Z is the prop's front; rotation.y = prop.facing (forward = (sin a, cos a)).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityEventProp, CityEventPropKind, GameState } from '../core/types';

/** Pool size per kind. Props of a kind beyond this are not drawn (they are never queued). */
export const MAX_PROPS_PER_KIND = 4;
export const CITY_EVENT_PROP_KINDS: readonly CityEventPropKind[] = [
  'bus', 'foodTruck', 'volleyNet', 'stage', 'partyLights', 'wreck', 'convoyTruck', 'barricade',
];
const KIND_INDEX: Record<CityEventPropKind, number> = {
  bus: 0, foodTruck: 1, volleyNet: 2, stage: 3, partyLights: 4, wreck: 5, convoyTruck: 6, barricade: 7,
};
const BULB_COLORS = [0xff6b6b, 0xf2c14e, 0x5effb8, 0x2ec4b6, 0x9b5de5, 0xff9ec0] as const;

interface BulbSpec { x: number; y: number; z: number; color: number }
interface PropTemplate { body: THREE.BufferGeometry; bulbs: BulbSpec[]; smoke: boolean }
interface PropInstance { group: THREE.Group; bulbs: THREE.Mesh[] }

/** One geometry part: a primitive placed (and vertex-coloured) in the prop's local frame. */
export function part(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}
export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 8): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, seg);
/** Wheel on an axle along X, centred at (x, z), resting on the ground. */
const wheel = (x: number, z: number): THREE.BufferGeometry => part(cyl(0.45, 0.45, 0.36), 0x22262b, x, 0.45, z, 0, 0, Math.PI / 2);

export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error('CityEventProps: geometry merge failed');
  return g;
}

function buildTemplate(kind: CityEventPropKind): PropTemplate {
  switch (kind) {
    case 'bus': {
      const parts = [
        part(box(2.6, 2.1, 10), 0xf4f0e6, 0, 1.55, 0),                 // body
        part(box(2.62, 0.3, 10.02), 0x2e8b84, 0, 1.12, 0),              // teal side stripe
        part(box(2.64, 0.75, 8.2), 0x2c3e66, 0, 2.05, 0),               // window strip
        part(box(2.64, 0.22, 9.0), 0xf2c14e, 0, 0.72, 0),               // yellow "TOURS" stripe
        part(box(1.2, 0.2, 2.0), 0xc9b99a, 0, 2.7, 0),                  // roof unit
        part(box(2.5, 0.3, 0.2), 0x4a5260, 0, 0.45, 5.05),              // bumpers
        part(box(2.5, 0.3, 0.2), 0x4a5260, 0, 0.45, -5.05),
        wheel(1.15, 3.2), wheel(-1.15, 3.2), wheel(1.15, -3.2), wheel(-1.15, -3.2),
      ];
      return { body: mergeParts(parts), bulbs: [], smoke: false };
    }
    case 'foodTruck': {
      const parts = [
        part(box(2.2, 2.4, 4.8), 0xf6e3a1, 0, 1.6, 0),                  // van body
        part(box(2.22, 0.3, 4.82), 0xe0574f, 0, 1.0, 0),                // coral stripe
        part(box(0.06, 0.9, 1.4), 0x2b2f38, 1.12, 1.6, 0.6),            // serving hatch
        part(box(1.0, 0.07, 1.7), 0xe0574f, 1.62, 2.3, 0.6),            // awning
        part(box(1.0, 0.18, 0.04), 0x2e8b84, 1.62, 2.18, 1.45),         // awning valance
        part(cyl(0.0, 0.6, 1.1, 8), 0xf2c14e, 0, 3.35, 0),              // giant taco on the roof
        wheel(1.0, 1.55), wheel(-1.0, 1.55), wheel(1.0, -1.55), wheel(-1.0, -1.55),
      ];
      return { body: mergeParts(parts), bulbs: [], smoke: false };
    }
    case 'volleyNet': {
      const parts = [
        part(cyl(0.06, 0.06, 2.5, 6), 0xf4f0e6, 4.0, 1.25, 0),
        part(cyl(0.06, 0.06, 2.5, 6), 0xf4f0e6, -4.0, 1.25, 0),
        part(box(8.0, 0.8, 0.03), 0xdcdcd0, 0, 1.85, 0),                // net
        part(box(8.0, 0.06, 0.05), 0xe0574f, 0, 2.27, 0),               // top tape
        part(box(9.0, 0.02, 6.0), 0xf6e3a1, 0, 0.03, 0),                // court
        part(new THREE.SphereGeometry(0.25, 8, 6), 0xffb347, 0.9, 0.25, 1.2),
      ];
      return { body: mergeParts(parts), bulbs: [], smoke: false };
    }
    case 'stage': {
      const parts = [
        part(box(6.0, 0.8, 4.0), 0x9b5de5, 0, 0.4, 0),                  // deck
        part(box(6.02, 0.6, 0.06), 0x2ec4b6, 0, 0.3, 2.0),              // front skirt
        part(cyl(0.07, 0.07, 3.2, 6), 0xf4f0e6, 2.85, 1.6, -1.85),
        part(cyl(0.07, 0.07, 3.2, 6), 0xf4f0e6, -2.85, 1.6, -1.85),
        part(cyl(0.07, 0.07, 3.2, 6), 0xf4f0e6, 2.85, 1.6, 1.85),
        part(cyl(0.07, 0.07, 3.2, 6), 0xf4f0e6, -2.85, 1.6, 1.85),
        part(box(6.4, 0.16, 4.4), 0xf2c14e, 0, 3.2, 0),                 // canopy
        part(box(0.9, 1.4, 0.8), 0x2c3e66, 2.4, 1.5, 1.4),              // speakers
        part(box(0.9, 1.4, 0.8), 0x2c3e66, -2.4, 1.5, 1.4),
      ];
      return { body: mergeParts(parts), bulbs: [], smoke: false };
    }
    case 'partyLights': {
      const parts = [
        part(cyl(0.05, 0.05, 3.0, 6), 0x4a5260, 3.0, 1.5, 0),
        part(cyl(0.05, 0.05, 3.0, 6), 0x4a5260, -3.0, 1.5, 0),
        part(box(6.0, 0.02, 0.02), 0x4a5260, 0, 2.85, 0),               // string
      ];
      // Bulbs hang along a sagging string; each pulses on its own phase (see animateBulbs).
      const bulbs: BulbSpec[] = [];
      for (let i = 0; i < 8; i++) {
        const x = -2.6 + i * (5.2 / 7);
        bulbs.push({ x, y: 2.85 - 0.22 * (1 - (x / 3) ** 2), z: 0, color: BULB_COLORS[i % BULB_COLORS.length] });
      }
      return { body: mergeParts(parts), bulbs, smoke: false };
    }
    case 'wreck': {
      // Crumpled sedan, tilted onto one side. Its grey smoke blob is a separate transparent mesh.
      const parts = [
        part(box(1.9, 0.8, 4.2), 0x5f7fa3, 0, 0.75, 0, 0, 0, 0.14),    // body (tilted)
        part(box(1.6, 0.7, 2.2), 0xd9d4c7, 0, 1.5, -0.2, 0, 0, 0.14),  // cabin
        part(box(1.7, 0.45, 1.1), 0xb35c44, 0, 0.85, 2.2, 0.35, 0, 0), // crumpled bonnet
        wheel(0.95, 1.4), wheel(-0.95, 1.4), wheel(0.95, -1.4), wheel(-0.95, -1.4),
      ];
      return { body: mergeParts(parts), bulbs: [], smoke: true };
    }
    case 'convoyTruck': {
      const parts = [
        part(box(2.4, 2.1, 1.7), 0x6b7a3a, 0, 1.4, -2.5),               // cab
        part(box(2.0, 0.6, 0.04), 0x2c3e66, 0, 1.8, -3.36),             // windscreen
        part(box(2.4, 2.6, 4.6), 0x6b7a3a, 0, 1.85, 1.0),               // box body
        part(box(2.44, 0.25, 4.62), 0xc9b99a, 0, 1.0, 1.0),             // sand stripe
        part(box(1.1, 0.9, 1.1), 0x9a7852, 0.4, 3.6, 1.2),              // supply crate on the bed
        wheel(1.1, -2.5), wheel(-1.1, -2.5), wheel(1.1, 0.5), wheel(-1.1, 0.5), wheel(1.1, 2.2), wheel(-1.1, 2.2),
      ];
      return { body: mergeParts(parts), bulbs: [], smoke: false };
    }
    case 'barricade': {
      const parts: THREE.BufferGeometry[] = [];
      for (const sx of [-0.9, 0.9]) {
        // Sawhorse: beam along X, two splayed legs on each side (boxes only, no rounding).
        parts.push(part(box(2.4, 0.14, 0.3), 0xffb347, 0, 0.95, 0));
        parts.push(part(box(0.12, 0.95, 0.12), 0x4a5260, sx, 0.47, -0.18));
        parts.push(part(box(0.12, 0.95, 0.12), 0x4a5260, sx, 0.47, 0.18));
      }
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 4; i++) {
          parts.push(part(box(0.6, 0.3, 0.45), 0xc9b99a, -1.05 + i * 0.7, 0.15 + row * 0.3, 1.0 + (row % 2) * 0.05));
        }
      }
      return { body: mergeParts(parts), bulbs: [], smoke: false };
    }
  }
}

export class CityEventProps {
  private readonly rootGroup = new THREE.Group();
  private readonly templates: (PropTemplate | null)[] = CITY_EVENT_PROP_KINDS.map(() => null);
  private readonly pools: PropInstance[][] = CITY_EVENT_PROP_KINDS.map(() => []);
  private readonly used = new Int32Array(CITY_EVENT_PROP_KINDS.length);
  private visibleTotal = 0;
  private readonly vertexMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly bulbGeo = new THREE.SphereGeometry(0.14, 8, 6);
  private readonly bulbMats = new Map<number, THREE.MeshBasicMaterial>();
  private readonly smokeGeo = new THREE.SphereGeometry(0.9, 8, 6);
  private readonly smokeMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.5, depthWrite: false });
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    this.rootGroup.name = 'CityEventProps';
    this.scene.add(this.rootGroup);
  }

  /** Root of all props. Hazed like the city (VisionFog.patchScene reaches it through the scene). */
  get root(): THREE.Object3D { return this.rootGroup; }

  /** Props currently drawn (diagnostics and tests). */
  get visibleCount(): number { return this.visibleTotal; }

  /**
   * Shows the props of every live event within `hiddenBeyond` of the focus. Props of resolved events vanish, and at most
   * MAX_PROPS_PER_KIND of a kind are drawn. Allocation-free after a kind's first use.
   */
  update(state: GameState, focusX: number, focusZ: number, hiddenBeyond: number, time: number): void {
    if (this.disposed) return;
    const maxD2 = hiddenBeyond * hiddenBeyond;
    this.used.fill(0);
    for (const ev of state.cityEvents) {
      if (ev.resolved) continue;
      for (const p of ev.props) this.place(p, focusX, focusZ, maxD2, time);
    }
    let total = 0;
    for (let k = 0; k < this.pools.length; k++) {
      const pool = this.pools[k];
      const n = this.used[k];
      total += n;
      for (let i = n; i < pool.length; i++) pool[i].group.visible = false;
    }
    this.visibleTotal = total;
  }

  private place(p: CityEventProp, focusX: number, focusZ: number, maxD2: number, time: number): void {
    const k = KIND_INDEX[p.kind];
    if (k === undefined) return;
    const dx = p.pos.x - focusX, dz = p.pos.z - focusZ;
    if (dx * dx + dz * dz > maxD2) return;
    const slot = this.used[k];
    if (slot >= MAX_PROPS_PER_KIND) return;
    this.used[k] = slot + 1;
    const inst = this.instance(k, p.kind, slot);
    inst.group.visible = true;
    inst.group.position.set(p.pos.x, 0, p.pos.z);
    inst.group.rotation.y = p.facing;
    for (let i = 0; i < inst.bulbs.length; i++) {
      const s = 0.8 + 0.3 * (0.5 + 0.5 * Math.sin(time * 5 + i * 0.9));
      inst.bulbs[i].scale.setScalar(s);
    }
  }

  private instance(k: number, kind: CityEventPropKind, slot: number): PropInstance {
    const pool = this.pools[k];
    if (slot < pool.length) return pool[slot];
    const inst = this.instantiate(k, kind);
    pool.push(inst);
    return inst;
  }

  private template(k: number, kind: CityEventPropKind): PropTemplate {
    let t = this.templates[k];
    if (!t) { t = buildTemplate(kind); this.templates[k] = t; }
    return t;
  }

  private bulbMat(color: number): THREE.MeshBasicMaterial {
    let m = this.bulbMats.get(color);
    if (!m) { m = new THREE.MeshBasicMaterial({ color }); this.bulbMats.set(color, m); }
    return m;
  }

  private instantiate(k: number, kind: CityEventPropKind): PropInstance {
    const t = this.template(k, kind);
    const group = new THREE.Group();
    group.visible = false;
    group.name = `CityEventProp:${kind}`;
    const body = new THREE.Mesh(t.body, this.vertexMat);
    body.castShadow = false;
    body.receiveShadow = false;
    group.add(body);
    const bulbs: THREE.Mesh[] = [];
    for (const b of t.bulbs) {
      const m = new THREE.Mesh(this.bulbGeo, this.bulbMat(b.color));
      m.position.set(b.x, b.y, b.z);
      group.add(m);
      bulbs.push(m);
    }
    if (t.smoke) {
      const s = new THREE.Mesh(this.smokeGeo, this.smokeMat);
      s.position.set(0, 2.5, 0.4);
      s.castShadow = false;
      group.add(s);
    }
    this.rootGroup.add(group);
    return { group, bulbs };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of this.templates) t?.body.dispose();
    this.bulbGeo.dispose();
    this.smokeGeo.dispose();
    this.vertexMat.dispose();
    this.smokeMat.dispose();
    for (const m of this.bulbMats.values()) m.dispose();
    this.bulbMats.clear();
    for (const pool of this.pools) pool.length = 0;
    this.rootGroup.clear();
    this.scene.remove(this.rootGroup);
  }
}
