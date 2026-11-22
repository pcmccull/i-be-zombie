// [3D] Render-only traffic control furniture from the shared traffic network (systems/trafficControl.ts): a signal
// pole with a mast-arm head on the near-right corner of every approach into a lit junction (bulbs follow
// `signalFor(junction, axis, state.time)`, the same rule the sim obeys), a stop sign at every approach into a
// 4-way-stop junction, and a white stop line across each approaching lane. ~6 instanced draw calls in total.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DistrictLayout } from '../core/types';
import { buildTrafficNetwork, junctionApproaches, signalFor, type Approach, type Junction, type SignalColor } from '../systems/trafficControl';
import { GROUND_TOP } from './groundLevels';

const POLE = 0x3d434c, HOUSING = 0x22262c, SIGN_RED = 0xc8242b, SIGN_WHITE = 0xf2f2f2;
const LIT: Record<SignalColor, number> = { red: 0xff3b30, yellow: 0xffc83a, green: 0x3dff7a };
const DIM: Record<SignalColor, number> = { red: 0x3a1512, yellow: 0x3a3012, green: 0x12351c };
const ORDER: SignalColor[] = ['red', 'yellow', 'green'];
const ARM = 3.4;

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  const c = new THREE.Color(color), n = geo.getAttribute('position').count, colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colored(g, color);
}

export class TrafficSignals {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly lights: { approach: Approach; junction: Junction; last: SignalColor | null }[] = [];
  private readonly bulbs: THREE.InstancedMesh | null = null;
  private readonly color = new THREE.Color();

  constructor(layout: DistrictLayout) {
    this.group.name = 'TrafficSignals';
    if (layout.strongholds.length === 0) return; // legacy district: no simulated traffic
    const net = buildTrafficNetwork(layout);
    const approaches = junctionApproaches(net);
    const lit = approaches.filter(a => net.junctions[a.junction].control === 'light');
    const stops = approaches.filter(a => net.junctions[a.junction].control === 'stop');
    const lambert = this.keepMat(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));

    // Local frame per approach: origin at the pole base, +Z = travel direction, +X = toward the lane (left of travel).
    const poleGeo = this.keep(mergeGeometries([
      colored(new THREE.CylinderGeometry(0.1, 0.14, 4.8, 6).translate(0, 2.4, 0), POLE),
      boxAt(ARM, 0.14, 0.14, ARM / 2, 4.6, 0, POLE),
      boxAt(0.44, 1.2, 0.36, ARM - 0.2, 4.15, 0, HOUSING),
      boxAt(0.56, 1.36, 0.06, ARM - 0.2, 4.15, 0.2, HOUSING),
    ]));
    const signGeo = this.keep(mergeGeometries([
      colored(new THREE.CylinderGeometry(0.06, 0.07, 2.3, 6).translate(0, 1.15, 0), POLE),
      colored(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8).translate(0, 2.35, -0.07), SIGN_WHITE),
      colored(new THREE.CylinderGeometry(0.41, 0.41, 0.05, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8).translate(0, 2.35, -0.09), SIGN_RED),
      boxAt(0.5, 0.08, 0.02, 0, 2.35, -0.12, SIGN_WHITE),
    ]));
    const lineGeo = this.keep(boxAt(1, 0.02, 0.45, 0, GROUND_TOP.signalStopLine - 0.01, -0.25, 0xf4f1e8));
    const bulbGeo = this.keep(new THREE.BoxGeometry(0.24, 0.24, 0.1));

    const poles = new THREE.InstancedMesh(poleGeo, lambert, Math.max(1, lit.length));
    const signs = new THREE.InstancedMesh(signGeo, lambert, Math.max(1, stops.length));
    const lines = new THREE.InstancedMesh(lineGeo, lambert, Math.max(1, approaches.length));
    const bulbMat = this.keepMat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, Math.max(1, lit.length * 3));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0), local = new THREE.Matrix4();
    const place = (a: Approach, side: number): void => {
      // Near-right corner: one lane-half plus the curb gap to the right of the lane line, just before the stop line.
      const yaw = Math.atan2(a.dx, a.dz), rx = -a.dz, rz = a.dx, out = a.laneOffset + side;
      p.set(a.line.x + rx * out - a.dx * 0.6, 0.14, a.line.z + rz * out - a.dz * 0.6);
      q.setFromAxisAngle(up, yaw);
      s.set(1, 1, 1);
      m4.compose(p, q, s);
    };
    lit.forEach((a, i) => {
      place(a, 1.4);
      poles.setMatrixAt(i, m4);
      for (let k = 0; k < 3; k++) {
        local.makeTranslation(ARM - 0.2, 4.15 + 0.38 - k * 0.38, -0.2);
        bulbs.setMatrixAt(i * 3 + k, local.premultiply(m4));
        bulbs.setColorAt(i * 3 + k, this.color.setHex(DIM[ORDER[k]]));
      }
      this.lights.push({ approach: a, junction: net.junctions[a.junction], last: null });
    });
    stops.forEach((a, i) => { place(a, 1.3); signs.setMatrixAt(i, m4); });
    approaches.forEach((a, i) => {
      p.set(a.line.x, 0, a.line.z);
      q.setFromAxisAngle(up, Math.atan2(a.dx, a.dz));
      s.set(a.laneOffset * 2 - 0.4, 1, 1);
      m4.compose(p, q, s);
      lines.setMatrixAt(i, m4);
    });
    poles.count = lit.length; signs.count = stops.length; lines.count = approaches.length; bulbs.count = lit.length * 3;
    poles.castShadow = true; signs.castShadow = true;
    lines.receiveShadow = true;
    poles.name = 'SignalPoles'; signs.name = 'StopSigns'; lines.name = 'StopLines'; bulbs.name = 'SignalBulbs';
    for (const m of [poles, signs, lines, bulbs]) {
      m.instanceMatrix.needsUpdate = true;
      this.group.add(m);
    }
    this.bulbs = bulbs;
  }

  private keep<T extends THREE.BufferGeometry>(g: T): T { this.geometries.push(g); return g; }
  private keepMat(m: THREE.Material): THREE.Material { this.materials.push(m); return m; }

  /** Bulbs follow the sim's signal clock. */
  update(time: number): void {
    const bulbs = this.bulbs;
    if (!bulbs) return;
    let dirty = false;
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const now = signalFor(l.junction, l.approach.axis, time);
      if (now === l.last) continue;
      l.last = now;
      dirty = true;
      for (let k = 0; k < 3; k++) bulbs.setColorAt(i * 3 + k, this.color.setHex(ORDER[k] === now ? LIT[now] : DIM[ORDER[k]]));
    }
    if (dirty && bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}
