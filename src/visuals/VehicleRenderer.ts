// [3D] todos #12: draws state.vehicles (TrafficSystem). One instanced painted body + one fixed-colour trim mesh per
// body type (sedan, hatchback, pickup, van, box truck, city bus, police car); police cars carry a red/blue light bar
// that flashes; hostile drivers ("rammers") get dark paint and a red bull bar. Interpolated with the render alpha;
// hits jolt the body; stalled vehicles sit with hazard lights blinking and sink away before they despawn. Live
// vehicles carry invisible pick proxies (TargetRef 'vehicle') sized to their footprint so the horde can be ordered
// onto them; hovered/targeted vehicles are tinted. Clawed vehicles grime toward soot as the driver's grip wears
// (vehicleLook.vehicleWear); a stalled vehicle's driver door swings open (the driver was dragged out or fled).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALANCE } from '../config/balance';
import type { GameState, TargetRef, VehicleModel } from '../core/types';
import { modelSpec, VEHICLE_MODELS } from '../systems/vehicleModels';
import { doorOpenAngle, SCORCH, vehiclePaint, vehicleWear } from './vehicleLook';

const MAX_CARS = 24;
const SCORCH_TINT = new THREE.Color(SCORCH);
const TARGET_TINT = new THREE.Color(0xff3b30);
const HOVER_TINT = new THREE.Color(0xffb347);
/** The bull bar / hazard geometry is authored for the sedan length. */
const BASE_LENGTH = 4.4;

const GLASS = 0x223344, TYRE = 0x1b1b1b, HEAD = 0xfff3c4, TAIL = 0xd8343a, CHROME = 0x9aa0a6, BLACK = 0x181a1e;

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.getAttribute('position').count, colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

function wheels(w: number, zs: number[], r = 0.32): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const z of zs) for (const s of [-1, 1]) out.push(box(0.3, r * 2, r * 2, s * (w / 2 - 0.05), r, z, TYRE));
  return out;
}

function lights(w: number, l: number, y: number, inset = 0.2): THREE.BufferGeometry[] {
  const lw = Math.min(0.42, w * 0.2);
  return [
    box(lw, 0.18, 0.05, w / 2 - inset - lw / 2, y, l / 2 + 0.01, HEAD), box(lw, 0.18, 0.05, -(w / 2 - inset - lw / 2), y, l / 2 + 0.01, HEAD),
    box(lw, 0.18, 0.05, w / 2 - inset - lw / 2, y, -l / 2 - 0.01, TAIL), box(lw, 0.18, 0.05, -(w / 2 - inset - lw / 2), y, -l / 2 - 0.01, TAIL),
  ];
}

interface ModelParts {
  /** White parts that take the instance paint. */
  body: THREE.BufferGeometry[];
  /** Fixed-colour parts (glass, tyres, lights, cargo box, livery). */
  trim: THREE.BufferGeometry[];
  height: number;
  /** Driver door hinge (car-local) and its height offset. */
  hinge: [number, number, number];
}

/** Low-poly body per model; +Z forward, ground at y = 0. */
function modelParts(model: VehicleModel): ModelParts {
  const { length: L, width: W } = modelSpec(model);
  const P = 0xffffff;
  switch (model) {
    case 'hatchback':
      return {
        body: [box(W - 0.05, 0.66, L, 0, 0.58, 0, P), box(W - 0.22, 0.58, 2.0, 0, 1.18, -0.45, P)],
        trim: [box(W - 0.2, 0.42, 1.85, 0, 1.2, -0.45, GLASS), ...wheels(W, [1.2, -1.2], 0.3), ...lights(W, L, 0.7)],
        height: 1.5, hinge: [W / 2 - 0.04, 0, 0.5],
      };
    case 'pickup':
      return {
        body: [box(W - 0.05, 0.72, L, 0, 0.68, 0, P), box(W - 0.15, 0.78, 1.9, 0, 1.42, 0.65, P),
          box(0.12, 0.42, 2.3, W / 2 - 0.1, 1.24, -1.35, P), box(0.12, 0.42, 2.3, -(W / 2 - 0.1), 1.24, -1.35, P),
          box(W - 0.1, 0.42, 0.12, 0, 1.24, -L / 2 + 0.06, P)],
        trim: [box(W - 0.13, 0.5, 1.75, 0, 1.47, 0.65, GLASS), box(W - 0.3, 0.06, 2.2, 0, 1.05, -1.35, 0x3a3d42),
          box(W, 0.16, 0.18, 0, 0.42, L / 2 + 0.05, CHROME), ...wheels(W, [1.7, -1.6], 0.38), ...lights(W, L, 0.82)],
        height: 1.85, hinge: [W / 2 - 0.04, 0.15, 1.55],
      };
    case 'van':
      return {
        body: [box(W - 0.05, 1.95, L - 0.8, 0, 1.3, -0.4, P), box(W - 0.05, 0.85, 0.85, 0, 0.78, L / 2 - 0.42, P)],
        trim: [box(W - 0.1, 0.62, 0.06, 0, 1.75, L / 2 - 0.83, GLASS), box(0.06, 0.55, 0.8, W / 2 - 0.02, 1.75, 1.2, GLASS),
          box(0.06, 0.55, 0.8, -(W / 2 - 0.02), 1.75, 1.2, GLASS), box(0.04, 0.32, 2.6, W / 2, 1.3, -0.9, 0x2e3a4a),
          box(0.04, 0.32, 2.6, -W / 2, 1.3, -0.9, 0x2e3a4a), ...wheels(W, [1.55, -1.6], 0.36), ...lights(W, L, 0.85)],
        height: 2.3, hinge: [W / 2 - 0.04, 0.3, 1.9],
      };
    case 'boxTruck':
      return {
        body: [box(W - 0.15, 1.95, 2.1, 0, 1.45, L / 2 - 1.05, P), box(W - 0.15, 0.7, 0.6, 0, 0.85, L / 2 - 0.1, P)],
        trim: [box(W - 0.2, 0.42, 7.3, 0, 0.62, -0.1, 0x2b2e33), box(W, 2.75, 5.2, 0, 2.27, -1.15, 0xf2efe6),
          box(W + 0.02, 0.35, 5.0, 0, 1.3, -1.15, 0x2e86ab), box(W - 0.25, 0.7, 0.06, 0, 1.95, L / 2 - 0.02, GLASS),
          box(0.06, 0.6, 0.9, W / 2 - 0.06, 1.95, L / 2 - 0.95, GLASS), box(0.06, 0.6, 0.9, -(W / 2 - 0.06), 1.95, L / 2 - 0.95, GLASS),
          ...wheels(W, [2.6, -1.6, -2.7], 0.45), ...lights(W, L, 0.95, 0.15)],
        height: 3.7, hinge: [W / 2 - 0.1, 0.6, L / 2 - 0.5],
      };
    case 'bus':
      return {
        body: [box(W - 0.05, 2.65, L, 0, 1.75, 0, P)],
        trim: [box(W + 0.01, 0.95, L - 1.6, 0, 2.3, -0.3, GLASS), box(W - 0.2, 1.1, 0.06, 0, 2.2, L / 2 + 0.01, GLASS),
          box(W + 0.02, 0.22, L - 0.4, 0, 1.2, 0, 0xffffff), box(1.4, 0.3, 0.06, 0, 3.0, L / 2 + 0.02, 0x101418),
          box(1.2, 0.18, 0.07, 0, 3.0, L / 2 + 0.03, 0xffb347), box(W, 0.22, 0.2, 0, 0.5, L / 2 + 0.05, BLACK),
          box(W, 0.22, 0.2, 0, 0.5, -L / 2 - 0.05, BLACK), box(0.05, 1.9, 1.1, -W / 2 - 0.01, 1.4, L / 2 - 1.4, 0x2a3a4a),
          ...wheels(W, [L / 2 - 2.0, -L / 2 + 2.4], 0.5), ...lights(W, L, 0.85, 0.15)],
        height: 3.2, hinge: [W / 2 - 0.04, 0.35, L / 2 - 0.4],
      };
    case 'police':
      return {
        body: [box(W - 0.1, 0.7, L, 0, 0.6, 0, P), box(W - 0.3, 0.55, 2.3, 0, 1.22, -0.25, P)],
        trim: [box(W - 0.28, 0.42, 2.1, 0, 1.24, -0.25, GLASS), box(W - 0.06, 0.34, L - 1.6, 0, 0.55, -0.1, BLACK),
          box(W - 0.06, 0.36, 0.9, 0, 0.62, L / 2 - 0.45, BLACK), box(W - 0.06, 0.36, 0.7, 0, 0.62, -L / 2 + 0.35, BLACK),
          box(W - 0.2, 0.18, 0.12, 0, 0.42, L / 2 + 0.06, BLACK), box(0.9, 0.08, 0.32, 0, 1.53, -0.15, 0x2a2d33),
          ...wheels(W, [1.4, -1.4]), ...lights(W, L, 0.72)],
        height: 1.75, hinge: [W / 2 - 0.04, 0, 0.62],
      };
    case 'sedan':
    default:
      return {
        body: [box(1.9, 0.7, L, 0, 0.6, 0, P), box(1.7, 0.55, 2.2, 0, 1.22, -0.25, P)],
        trim: [box(1.72, 0.42, 2.0, 0, 1.24, -0.25, GLASS), ...wheels(W, [1.35, -1.35]),
          box(1.5, 0.18, 0.05, 0, 0.72, L / 2 + 0.01, HEAD), box(1.5, 0.18, 0.05, 0, 0.72, -L / 2 - 0.01, TAIL)],
        height: 1.7, hinge: [0.96, 0, 0.62],
      };
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface ModelMeshes { bodies: THREE.InstancedMesh; trims: THREE.InstancedMesh; parts: ModelParts; count: number }

export class VehicleRenderer {
  readonly group = new THREE.Group();
  private readonly models = new Map<VehicleModel, ModelMeshes>();
  private readonly bars: THREE.InstancedMesh;
  private readonly hazards: THREE.InstancedMesh;
  private readonly hazardMat: THREE.MeshBasicMaterial;
  private readonly sirenRed: THREE.InstancedMesh;
  private readonly sirenBlue: THREE.InstancedMesh;
  private readonly doors: THREE.InstancedMesh;
  private readonly hinge = new THREE.Matrix4();
  private readonly swing = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qTilt = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly color = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly side = new THREE.Vector3(1, 0, 0);
  private readonly proxies: THREE.Mesh[] = [];
  /** Pick proxies of live (not stalled) vehicles this frame. */
  readonly pickables: THREE.Mesh[] = [];
  private hoveredId = -1;
  private readonly targetedIds = new Set<number>();

  constructor() {
    this.group.name = 'Vehicles';
    const lambert = () => this.keepMat(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const bodyMat = lambert(), trimMat = lambert();
    for (const model of VEHICLE_MODELS) {
      const parts = modelParts(model);
      const bodies = new THREE.InstancedMesh(this.keep(mergeGeometries(parts.body)), bodyMat, MAX_CARS);
      const trims = new THREE.InstancedMesh(this.keep(mergeGeometries(parts.trim)), trimMat, MAX_CARS);
      bodies.name = `VehicleBodies_${model}`;
      trims.name = `VehicleTrim_${model}`;
      for (let i = 0; i < MAX_CARS; i++) bodies.setColorAt(i, this.color.setHex(0xffffff));
      for (const geo of [...parts.body, ...parts.trim]) geo.dispose();
      this.models.set(model, { bodies, trims, parts, count: 0 });
    }
    const L = BASE_LENGTH;
    const barGeo = this.keep(mergeGeometries([
      box(2.0, 0.14, 0.14, 0, 0.55, L / 2 + 0.22, 0xb3262b), box(2.0, 0.14, 0.14, 0, 0.9, L / 2 + 0.22, 0xb3262b),
      box(0.14, 0.5, 0.14, -0.7, 0.72, L / 2 + 0.22, 0x6b6f75), box(0.14, 0.5, 0.14, 0.7, 0.72, L / 2 + 0.22, 0x6b6f75),
    ]));
    const hazardGeo = this.keep(mergeGeometries([
      box(0.3, 0.16, 0.06, 0.8, 0.72, L / 2 + 0.03, 0xffffff), box(0.3, 0.16, 0.06, -0.8, 0.72, L / 2 + 0.03, 0xffffff),
      box(0.3, 0.16, 0.06, 0.8, 0.72, -L / 2 - 0.03, 0xffffff), box(0.3, 0.16, 0.06, -0.8, 0.72, -L / 2 - 0.03, 0xffffff),
    ]));
    this.bars = new THREE.InstancedMesh(barGeo, lambert(), MAX_CARS);
    this.hazardMat = this.keepMat(new THREE.MeshBasicMaterial({ color: 0xffb347 })) as THREE.MeshBasicMaterial;
    this.hazards = new THREE.InstancedMesh(hazardGeo, this.hazardMat, MAX_CARS);
    // Police light bar halves (car-local, on the roof); they flash alternately.
    const sirenGeoR = this.keep(new THREE.BoxGeometry(0.4, 0.14, 0.26));
    sirenGeoR.translate(0.22, 1.63, -0.15);
    const sirenGeoB = this.keep(new THREE.BoxGeometry(0.4, 0.14, 0.26));
    sirenGeoB.translate(-0.22, 1.63, -0.15);
    this.sirenRed = new THREE.InstancedMesh(sirenGeoR, this.keepMat(new THREE.MeshBasicMaterial({ color: 0xff2a2a })), MAX_CARS);
    this.sirenBlue = new THREE.InstancedMesh(sirenGeoB, this.keepMat(new THREE.MeshBasicMaterial({ color: 0x2a6bff })), MAX_CARS);
    // Hinge at the origin; the panel runs back along -Z. White panel takes the instance paint, the glass stays dark.
    const doorGeo = this.keep(mergeGeometries([
      box(0.07, 0.62, 1.1, 0.035, 0.62, -0.55, 0xffffff),
      box(0.05, 0.4, 0.95, 0.035, 1.14, -0.5, 0x2a3a4a),
    ]));
    this.doors = new THREE.InstancedMesh(doorGeo, lambert(), MAX_CARS);
    for (let i = 0; i < MAX_CARS; i++) this.doors.setColorAt(i, this.color.setHex(0xffffff));
    this.bars.name = 'RammerBars';
    this.hazards.name = 'VehicleHazards';
    this.sirenRed.name = 'PoliceLightsRed';
    this.sirenBlue.name = 'PoliceLightsBlue';
    this.doors.name = 'VehicleDoors';
    for (const m of this.allMeshes()) {
      m.castShadow = m !== this.hazards && m !== this.sirenRed && m !== this.sirenBlue;
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
    const pickGeo = this.keep(new THREE.BoxGeometry(1, 1, 1));
    pickGeo.translate(0, 0.5, 0);
    const pickMat = this.keepMat(new THREE.MeshBasicMaterial({ visible: false }));
    for (let i = 0; i < MAX_CARS; i++) {
      const proxy = new THREE.Mesh(pickGeo, pickMat);
      proxy.name = `VehiclePickProxy_${i}`;
      proxy.visible = false;
      proxy.matrixAutoUpdate = false;
      this.proxies.push(proxy);
      this.group.add(proxy);
    }
  }

  private allMeshes(): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const m of this.models.values()) out.push(m.bodies, m.trims);
    out.push(this.bars, this.hazards, this.sirenRed, this.sirenBlue, this.doors);
    return out;
  }

  private keep<T extends THREE.BufferGeometry>(g: T): T { this.geometries.push(g); return g; }
  private keepMat(m: THREE.Material): THREE.Material { this.materials.push(m); return m; }

  /** Hover + selected attack targets (tints those vehicles). */
  setHighlight(hovered: TargetRef | null, targeted: readonly TargetRef[]): void {
    this.hoveredId = hovered?.kind === 'vehicle' ? hovered.id : -1;
    this.targetedIds.clear();
    for (const t of targeted) if (t.kind === 'vehicle') this.targetedIds.add(t.id);
  }

  update(state: GameState, alpha: number, time: number): void {
    const cars = state.vehicles;
    const n = Math.min(MAX_CARS, cars.length);
    let bars = 0, hazards = 0, doors = 0, sirens = 0, proxies = 0;
    for (const m of this.models.values()) m.count = 0;
    this.pickables.length = 0;
    const blink = Math.sin(time * 9) > 0;
    const flash = Math.sin(time * 14) > 0;
    for (let i = 0; i < n; i++) {
      const v = cars[i];
      const spec = modelSpec(v.model);
      const meshes = this.models.get(v.model ?? 'sedan')!;
      const x = v.prevPos.x + (v.pos.x - v.prevPos.x) * alpha;
      const z = v.prevPos.z + (v.pos.z - v.prevPos.z) * alpha;
      const yaw = lerpAngle(v.prevFacing, v.facing, alpha);
      const stalled = v.mode === 'stalled';
      const fadeStart = BALANCE.traffic.fadeTime - 1.2; // = vehicleLook.sinkStart()
      const sink = stalled && v.modeTime > fadeStart ? -(v.modeTime - fadeStart) * 1.4 * Math.max(1, meshes.parts.height / 1.7) : 0;
      this.q.setFromAxisAngle(this.up, yaw);
      // Impact jolt: a quick nose-down pitch + roll (heavier vehicles jolt less).
      if (v.hitFlash > 0) {
        this.side.set(Math.cos(yaw), 0, -Math.sin(yaw));
        this.qTilt.setFromAxisAngle(this.side, v.hitFlash * 0.5 / Math.sqrt(spec.mass));
        this.q.premultiply(this.qTilt);
      }
      this.pos.set(x, sink, z);
      this.scale.set(1, 1, 1);
      this.m4.compose(this.pos, this.q, this.scale);
      const slot = meshes.count++;
      meshes.bodies.setMatrixAt(slot, this.m4);
      meshes.trims.setMatrixAt(slot, this.m4);
      this.color.setHex(vehiclePaint(v));
      // Claw grime: up to 45 % toward soot at zero grip, then the wreck darkens further once stalled.
      this.color.lerp(SCORCH_TINT, vehicleWear(v) * 0.45);
      if (stalled) this.color.multiplyScalar(0.8);
      else if (this.targetedIds.has(v.id)) this.color.lerp(TARGET_TINT, 0.55);
      else if (this.hoveredId === v.id) this.color.lerp(HOVER_TINT, 0.45);
      meshes.bodies.setColorAt(slot, this.color);
      if (!stalled) {
        const proxy = this.proxies[proxies++];
        const ref = proxy.userData.target as TargetRef | undefined;
        if (!ref || ref.kind !== 'vehicle' || ref.id !== v.id) proxy.userData.target = { kind: 'vehicle', id: v.id };
        this.scale.set(spec.width + 0.2, meshes.parts.height, spec.length + 0.3);
        proxy.matrix.compose(this.pos, this.q, this.scale);
        this.scale.set(1, 1, 1);
        proxy.matrixWorldNeedsUpdate = true;
        this.pickables.push(proxy);
      }
      // Bull bar / hazards are authored for the sedan: stretch them to this footprint.
      this.local.makeScale(spec.width / 2, 1, spec.length / BASE_LENGTH);
      this.hinge.multiplyMatrices(this.m4, this.local);
      if (v.kind === 'rammer') this.bars.setMatrixAt(bars++, this.hinge);
      if (stalled && blink) this.hazards.setMatrixAt(hazards++, this.hinge);
      if (v.model === 'police' && !stalled) {
        // Lights on while the car is fleeing / fighting, or slow-blinking while on patrol.
        const alarmed = v.mode !== 'cruise' || v.hp < BALANCE.traffic.carHp;
        const on = alarmed ? flash : Math.sin(time * 3) > 0.6;
        if (on) this.sirenRed.setMatrixAt(sirens, this.m4); else this.sirenRed.setMatrixAt(sirens, this.hidden());
        if (alarmed ? !flash : on) this.sirenBlue.setMatrixAt(sirens, this.m4); else this.sirenBlue.setMatrixAt(sirens, this.hidden());
        sirens++;
      }
      const open = doorOpenAngle(v);
      if (open > 0) {
        const [hx, hy, hz] = meshes.parts.hinge;
        // Outward swing about the hinge: rotate by -angle so the panel's rear end moves to +X.
        this.hinge.makeTranslation(hx, hy, hz);
        this.swing.makeRotationY(-open);
        this.hinge.multiply(this.swing).premultiply(this.m4);
        this.doors.setMatrixAt(doors, this.hinge);
        this.doors.setColorAt(doors++, this.color);
      }
    }
    for (const m of this.models.values()) {
      m.bodies.count = m.count;
      m.trims.count = m.count;
      if (m.bodies.instanceColor && m.count > 0) m.bodies.instanceColor.needsUpdate = true;
    }
    for (let i = proxies; i < MAX_CARS; i++) this.proxies[i].userData.target = undefined;
    this.bars.count = bars;
    this.hazards.count = hazards;
    this.sirenRed.count = sirens;
    this.sirenBlue.count = sirens;
    this.doors.count = doors;
    for (const m of this.allMeshes()) m.instanceMatrix.needsUpdate = true;
    if (this.doors.instanceColor && doors > 0) this.doors.instanceColor.needsUpdate = true;
  }

  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private hidden(): THREE.Matrix4 { return this.zero; }

  setVisible(visible: boolean): void { this.group.visible = visible; }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}
