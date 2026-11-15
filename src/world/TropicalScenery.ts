// [3D] Render-only tropical dressing: animated ocean + beach past the south edge, palm rows, beach umbrellas and
// ambient traffic. Traffic brakes for anyone on the road and yields at intersections; after the opening it is
// retired (each car disappears once it is out of the camera's view). Nothing here touches gameplay state.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DistrictLayout, GameState } from '../core/types';
import { buildTropicalLayout, type TropicalLayout } from './tropicalLayout';

const CAR_COLORS = [0xff6f91, 0x35c6c6, 0xffd35c, 0xf8f4ec, 0x6f8cff, 0xff9a4d, 0x9be15d, 0xe85d75];
const UMBRELLA_COLORS = [0xff5f8f, 0x2ec4b6, 0xffd166, 0xf78c6b, 0x7b8cff];
const CARS_PER_LANE = 2;
const CAR_LEN = 4.4;

interface Car {
  lane: number;
  s: number;
  speed: number;
  maxSpeed: number;
  color: number;
  alive: boolean;
  inIntersection: number;
}

function colorize(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colorize(g, color);
}

export class TropicalScenery {
  readonly group = new THREE.Group();
  private readonly data: TropicalLayout;
  private readonly ocean: THREE.Mesh;
  private readonly oceanBase: Float32Array;
  private readonly foam: THREE.Mesh;
  private readonly carBodies: THREE.InstancedMesh;
  private readonly carTrims: THREE.InstancedMesh;
  private readonly cars: Car[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private retiring = false;
  private time = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3(1, 1, 1);
  private readonly c3 = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 3);

  constructor(layout: DistrictLayout) {
    this.group.name = 'TropicalScenery';
    this.data = buildTropicalLayout(layout);
    const d = this.data;

    // Beach sand + wet sand.
    const sandMat = this.keep(new THREE.MeshLambertMaterial({ color: 0xf2dca6 }));
    const sand = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(d.beach.maxX - d.beach.minX, d.beach.maxZ - d.beach.minZ)), sandMat);
    sand.rotation.x = -Math.PI / 2;
    sand.position.set((d.beach.minX + d.beach.maxX) / 2, -0.02, (d.beach.minZ + d.beach.maxZ) / 2);
    sand.receiveShadow = true;
    sand.name = 'Beach';
    const wet = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(d.beach.maxX - d.beach.minX, 6)),
      this.keep(new THREE.MeshLambertMaterial({ color: 0xd9c08a })));
    wet.rotation.x = -Math.PI / 2;
    wet.position.set(sand.position.x, -0.015, d.beach.maxZ - 3);
    this.group.add(sand, wet);

    // Ocean: low-res plane with flat-shaded rolling waves (positions animated, normals from derivatives).
    const ow = d.ocean.maxX - d.ocean.minX, od = d.ocean.maxZ - d.ocean.minZ;
    const oceanGeo = this.keep(new THREE.PlaneGeometry(ow, od, 90, 36));
    oceanGeo.rotateX(-Math.PI / 2);
    oceanGeo.translate((d.ocean.minX + d.ocean.maxX) / 2, -0.35, (d.ocean.minZ + d.ocean.maxZ) / 2);
    const pos = oceanGeo.getAttribute('position') as THREE.BufferAttribute;
    this.oceanBase = new Float32Array(pos.array as Float32Array);
    const colors = new Float32Array(pos.count * 3);
    const shallow = new THREE.Color(0x3fd6cf), deep = new THREE.Color(0x1f6fb8);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, (pos.getZ(i) - d.ocean.minZ) / 120));
      this.c3.copy(shallow).lerp(deep, t);
      colors[i * 3] = this.c3.r; colors[i * 3 + 1] = this.c3.g; colors[i * 3 + 2] = this.c3.b;
    }
    oceanGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.ocean = new THREE.Mesh(oceanGeo, this.keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    this.ocean.name = 'Ocean';
    this.ocean.frustumCulled = false;
    this.foam = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(ow, 2.2)),
      this.keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false })));
    this.foam.rotation.x = -Math.PI / 2;
    this.foam.position.set(sand.position.x, 0.02, d.ocean.minZ + 1.2);
    this.group.add(this.ocean, this.foam);

    this.buildPalms();
    this.buildUmbrellas();

    // Traffic: instanced bodies (per-car colour) + shared trim (cabin glass, wheels, lights).
    const bodyGeo = this.keep(mergeGeometries([
      box(1.9, 0.7, CAR_LEN, 0, 0.6, 0, 0xffffff),
      box(1.7, 0.55, 2.2, 0, 1.22, -0.25, 0xffffff),
    ]));
    const trimGeo = this.keep(mergeGeometries([
      box(1.72, 0.42, 2.0, 0, 1.24, -0.25, 0x223344),
      box(0.3, 0.6, 0.6, 0.95, 0.32, 1.35, 0x1b1b1b), box(0.3, 0.6, 0.6, -0.95, 0.32, 1.35, 0x1b1b1b),
      box(0.3, 0.6, 0.6, 0.95, 0.32, -1.35, 0x1b1b1b), box(0.3, 0.6, 0.6, -0.95, 0.32, -1.35, 0x1b1b1b),
      box(1.5, 0.18, 0.05, 0, 0.72, CAR_LEN / 2 + 0.01, 0xfff3c4), box(1.5, 0.18, 0.05, 0, 0.72, -CAR_LEN / 2 - 0.01, 0xd8343a),
    ]));
    const n = d.lanes.length * CARS_PER_LANE;
    this.carBodies = new THREE.InstancedMesh(bodyGeo, this.keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })), n);
    this.carTrims = new THREE.InstancedMesh(trimGeo, this.keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })), n);
    for (const m of [this.carBodies, this.carTrims]) {
      m.castShadow = true;
      m.frustumCulled = false;
      m.name = m === this.carBodies ? 'TrafficBodies' : 'TrafficTrim';
      this.group.add(m);
    }
    this.resetTraffic();
  }

  /** Respawn the full traffic (new game / intro replay). */
  resetTraffic(): void {
    this.retiring = false;
    this.cars.length = 0;
    let k = 0;
    this.data.lanes.forEach((lane, li) => {
      for (let i = 0; i < CARS_PER_LANE; i++) {
        const max = 8 + ((k * 37) % 7);
        this.cars.push({
          lane: li, s: (lane.length / CARS_PER_LANE) * (i + ((li * 0.37) % 1)), speed: max, maxSpeed: max,
          color: CAR_COLORS[k % CAR_COLORS.length], alive: true, inIntersection: -1,
        });
        k++;
      }
    });
    this.carBodies.count = this.cars.length;
    this.carTrims.count = this.cars.length;
    this.cars.forEach((c, i) => this.carBodies.setColorAt(i, this.c3.setHex(c.color)));
    if (this.carBodies.instanceColor) this.carBodies.instanceColor.needsUpdate = true;
  }

  /** After the opening: cars keep driving but each is removed for good once it leaves the camera's view. */
  retireTraffic(): void { this.retiring = true; }

  update(dt: number, state: GameState, camera: THREE.Camera): void {
    this.time += dt;
    this.animateOcean();
    if (this.cars.length === 0) return;
    if (this.retiring) {
      this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.projView);
    }
    let alive = 0;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (!car.alive) continue;
      this.driveCar(car, i, dt, state);
      const lane = this.data.lanes[car.lane];
      const u = car.s / lane.length;
      const x = lane.from.x + (lane.to.x - lane.from.x) * u;
      const z = lane.from.z + (lane.to.z - lane.from.z) * u;
      if (this.retiring) {
        this.sphere.center.set(x, 1, z);
        if (!this.frustum.intersectsSphere(this.sphere)) { car.alive = false; continue; }
      }
      const yaw = Math.atan2(lane.to.x - lane.from.x, lane.to.z - lane.from.z);
      this.q.setFromAxisAngle(this.up, yaw);
      this.m4.compose(this.v3.set(x, 0, z), this.q, this.s3);
      this.carBodies.setMatrixAt(alive, this.m4);
      this.carTrims.setMatrixAt(alive, this.m4);
      this.carBodies.setColorAt(alive, this.c3.setHex(car.color));
      alive++;
    }
    this.carBodies.count = alive;
    this.carTrims.count = alive;
    this.carBodies.instanceMatrix.needsUpdate = true;
    this.carTrims.instanceMatrix.needsUpdate = true;
    if (this.carBodies.instanceColor) this.carBodies.instanceColor.needsUpdate = true;
    if (alive === 0) this.cars.length = 0;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.carBodies.dispose();
    this.carTrims.dispose();
    this.group.clear();
  }

  // --- internals -----------------------------------------------------------------------------

  private keep<T extends { dispose(): void }>(d: T): T { this.disposables.push(d); return d; }

  private animateOcean(): void {
    const pos = this.ocean.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const base = this.oceanBase;
    const t = this.time;
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i], z = base[i + 2];
      arr[i + 1] = base[i + 1] + Math.sin(x * 0.045 + t * 0.9) * 0.28 + Math.sin(z * 0.08 - t * 1.3 + x * 0.02) * 0.22;
    }
    pos.needsUpdate = true;
    const fm = this.foam.material as THREE.MeshBasicMaterial;
    fm.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.8));
    this.foam.position.z = this.data.ocean.minZ + 1.2 + Math.sin(t * 0.8) * 0.9;
  }

  private driveCar(car: Car, index: number, dt: number, state: GameState): void {
    const d = this.data;
    const lane = d.lanes[car.lane];
    const dirX = (lane.to.x - lane.from.x) / lane.length;
    const dirZ = (lane.to.z - lane.from.z) / lane.length;
    const u = car.s / lane.length;
    const x = lane.from.x + (lane.to.x - lane.from.x) * u;
    const z = lane.from.z + (lane.to.z - lane.from.z) * u;
    let limit = car.maxSpeed;
    // Brake for people on the road ahead (humans or zombies alike).
    const brake = (px: number, pz: number): void => {
      const rx = px - x, rz = pz - z;
      const ahead = rx * dirX + rz * dirZ;
      if (ahead < 1 || ahead > 11) return;
      if (Math.abs(rx * dirZ - rz * dirX) > 1.7) return;
      limit = Math.min(limit, Math.max(0, (ahead - 3.2) * 1.4));
    };
    for (const g of state.guards) if (g.state !== 'DEAD' && !g.dormant) brake(g.pos.x, g.pos.z);
    for (const zb of state.zombies) if (zb.state !== 'dead' && !zb.dormant) brake(zb.pos.x, zb.pos.z);
    if (state.leader.alive) brake(state.leader.pos.x, state.leader.pos.z);
    // Keep distance to the car ahead in the same lane.
    for (let j = 0; j < this.cars.length; j++) {
      const o = this.cars[j];
      if (j === index || !o.alive || o.lane !== car.lane) continue;
      let gap = o.s - car.s;
      if (gap < 0) gap += lane.length;
      if (gap < 14) limit = Math.min(limit, Math.max(0, (gap - CAR_LEN - 2) * 1.2));
    }
    // Yield at intersections occupied by another car.
    const fx = x + dirX * (CAR_LEN * 0.5 + 2.5), fz = z + dirZ * (CAR_LEN * 0.5 + 2.5);
    const ahead = d.intersections.findIndex(r => fx > r.minX && fx < r.maxX && fz > r.minZ && fz < r.maxZ);
    const here = d.intersections.findIndex(r => x > r.minX - 2 && x < r.maxX + 2 && z > r.minZ - 2 && z < r.maxZ + 2);
    car.inIntersection = here;
    if (ahead >= 0 && here !== ahead) {
      for (let j = 0; j < this.cars.length; j++) {
        const o = this.cars[j];
        if (j === index || !o.alive || o.inIntersection !== ahead) continue;
        const ol = d.lanes[o.lane];
        const sameAxis = Math.abs((ol.to.x - ol.from.x) / ol.length * dirX + (ol.to.z - ol.from.z) / ol.length * dirZ) > 0.5;
        if (!sameAxis) { limit = 0; break; }
      }
    }
    const accel = limit < car.speed ? 14 : 3.5;
    car.speed += Math.max(-accel * dt, Math.min(accel * dt, limit - car.speed));
    car.s += car.speed * dt;
    if (car.s >= lane.length) car.s -= lane.length;
  }

  private buildPalms(): void {
    const palms = this.data.palms;
    const trunkGeo = this.keep(new THREE.CylinderGeometry(0.16, 0.26, 1, 6, 4));
    trunkGeo.translate(0, 0.5, 0);
    const crownParts: THREE.BufferGeometry[] = [];
    const leaves = 8;
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2;
      // A drooping blade: two quads bending down from the crown.
      const g = new THREE.BufferGeometry();
      const w = 0.45, l1 = 1.6, l2 = 3.1;
      const verts = new Float32Array([
        0, 0, 0, w, 0.25, l1, -w, 0.25, l1,
        w, 0.25, l1, 0, -1.0, l2, -w, 0.25, l1,
      ]);
      g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      g.computeVertexNormals();
      g.rotateX(-0.15 - (i % 2) * 0.2);
      g.rotateY(a);
      crownParts.push(colorize(g, i % 2 ? 0x3f9b3a : 0x58b847));
    }
    for (let i = 0; i < 3; i++) {
      const nut = new THREE.IcosahedronGeometry(0.18, 0);
      nut.translate(Math.cos(i * 2.1) * 0.22, -0.15, Math.sin(i * 2.1) * 0.22);
      crownParts.push(colorize(nut, 0x6b4a2b));
    }
    const crownGeo = this.keep(mergeGeometries(crownParts));
    for (const p of crownParts) p.dispose();
    const crownMat = this.keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    const trunkMat = this.keep(new THREE.MeshLambertMaterial({ color: 0x9c7a52, flatShading: true }));
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palms.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, palms.length);
    const tilt = new THREE.Quaternion();
    const yawQ = new THREE.Quaternion();
    const xAxis = new THREE.Vector3(1, 0, 0);
    const top = new THREE.Vector3();
    palms.forEach((p, i) => {
      yawQ.setFromAxisAngle(this.up, p.rot);
      tilt.setFromAxisAngle(xAxis, p.lean);
      this.q.copy(yawQ).multiply(tilt);
      this.m4.compose(this.v3.set(p.pos.x, 0, p.pos.z), this.q, this.s3.set(1, p.height, 1));
      trunks.setMatrixAt(i, this.m4);
      top.set(0, p.height, 0).applyQuaternion(this.q).add(this.v3);
      this.m4.compose(top, yawQ, this.s3.setScalar(1 + (p.height - 8) * 0.06));
      crowns.setMatrixAt(i, this.m4);
    });
    this.s3.set(1, 1, 1);
    trunks.castShadow = crowns.castShadow = true;
    trunks.name = 'PalmTrunks';
    crowns.name = 'PalmCrowns';
    this.disposables.push(trunks, crowns);
    this.group.add(trunks, crowns);
  }

  private buildUmbrellas(): void {
    const b = this.data.beach;
    const count = 18;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const x = b.minX + 50 + i * ((b.maxX - b.minX - 100) / count) + Math.sin(i * 7.3) * 6;
      const z = b.minZ + 13 + Math.sin(i * 3.1) * 4;
      const color = UMBRELLA_COLORS[i % UMBRELLA_COLORS.length];
      const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5);
      pole.translate(x, 1.15, z);
      const top = new THREE.ConeGeometry(1.5, 0.6, 8);
      top.translate(x, 2.4, z);
      const towel = new THREE.BoxGeometry(0.9, 0.03, 1.9);
      towel.translate(x + 1.4, 0.02, z + 0.4);
      parts.push(colorize(pole, 0xf2f2f2), colorize(top, color), colorize(towel, UMBRELLA_COLORS[(i + 2) % UMBRELLA_COLORS.length]));
    }
    const geo = this.keep(mergeGeometries(parts));
    for (const p of parts) p.dispose();
    const mesh = new THREE.Mesh(geo, this.keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    mesh.castShadow = true;
    mesh.name = 'BeachUmbrellas';
    this.group.add(mesh);
  }
}
