import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ColliderDef, DistrictLayout, GateState } from '../core/types';

const COLOR_FACTION_ORANGE = 0xe0782a;
const COLOR_FACTION_NAVY = 0x2c3e66;
const COLOR_WARNING_LIGHT = 0xffb347;
const COLOR_CONCRETE = 0xb5ac99;
const COLOR_DARK_STEEL = 0x3b424c;

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
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segs);
  g.translate(x, y, z);
  const painted = paintGeometry(g, hexColor);
  g.dispose();
  return painted;
}

interface GateSegment {
  group: THREE.Group;
  baseX: number;
  baseY: number;
  baseZ: number;
  hideBelowHpFrac: number;
  tiltSign: number;
}

export class CheckpointVisual {
  readonly group: THREE.Group;
  readonly gatePickMesh: THREE.Mesh;

  private readonly gateIntactGroup: THREE.Group;
  private readonly gateRubbleGroup: THREE.Group;
  private readonly gateHighlightMesh: THREE.Mesh;
  private readonly gateSegments: GateSegment[] = [];
  private readonly gateMaterial: THREE.MeshLambertMaterial;
  private readonly gateSparkMesh: THREE.Mesh;
  private readonly gateSparkMat: THREE.MeshBasicMaterial;
  private readonly searchlights: THREE.Object3D[] = [];
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly pointLights: THREE.PointLight[] = [];
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];
  private readonly gateCx: number;
  private readonly gateCz: number;
  private readonly gatePickY: number;

  private highlighted = false;

  constructor(layout: DistrictLayout) {
    this.group = new THREE.Group();
    this.group.name = 'CheckpointVisual';

    this.gateMaterial = this.trackMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    this.gateSparkMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({ color: 0xffaa33 }),
    );
    this.beaconMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({ color: COLOR_WARNING_LIGHT }),
    );

    // 1. Static compound structures (perimeter walls, sandbags, towers, tents/containers, floodlight glow)
    this.buildStaticCompound(layout);

    // 2. Destructible Gate + Rubble + Pick Proxy
    this.gateIntactGroup = new THREE.Group();
    this.gateIntactGroup.name = 'GateIntact';
    this.group.add(this.gateIntactGroup);

    this.gateRubbleGroup = new THREE.Group();
    this.gateRubbleGroup.name = 'GateRubble';
    this.gateRubbleGroup.visible = false;
    this.group.add(this.gateRubbleGroup);

    const gateRect = layout.checkpoint.gate.rect;
    const gateW = gateRect.maxX - gateRect.minX;
    const gateD = gateRect.maxZ - gateRect.minZ;
    const gateH = 3.0;
    const gateCx = 0.5 * (gateRect.minX + gateRect.maxX);
    const gateCz = 0.5 * (gateRect.minZ + gateRect.maxZ);
    this.gateCx = gateCx;
    this.gateCz = gateCz;
    this.gatePickY = (gateH + 1.0) * 0.5;

    this.buildGateSegments(gateCx, gateCz, gateW, gateH, gateD);
    this.buildGateRubble(gateCx, gateCz, gateW, gateD);

    // Sparks mesh shown when gate is damaged or hit
    const sparkGeom = this.trackGeometry(new THREE.OctahedronGeometry(0.28, 0));
    this.gateSparkMesh = new THREE.Mesh(sparkGeom, this.gateSparkMat);
    this.gateSparkMesh.position.set(gateCx, 1.6, gateCz + 0.55);
    this.gateSparkMesh.visible = false;
    this.gateIntactGroup.add(this.gateSparkMesh);

    // Highlight outline mesh when hovered or targeted
    const hlGeom = this.trackGeometry(new THREE.BoxGeometry(gateW + 0.35, gateH + 0.25, gateD + 0.35));
    const hlMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: COLOR_FACTION_ORANGE,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.gateHighlightMesh = new THREE.Mesh(hlGeom, hlMat);
    this.gateHighlightMesh.position.set(gateCx, gateH * 0.5, gateCz);
    this.gateHighlightMesh.visible = false;
    this.gateIntactGroup.add(this.gateHighlightMesh);

    // Slightly enlarged invisible pick box over the gate
    const pickGeom = this.trackGeometry(
      new THREE.BoxGeometry(gateW + 1.4, gateH + 1.2, gateD + 1.6),
    );
    const pickMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      }),
    );
    this.gatePickMesh = new THREE.Mesh(pickGeom, pickMat);
    this.gatePickMesh.position.set(this.gateCx, this.gatePickY, this.gateCz);
    this.gatePickMesh.name = 'GatePickProxy';
    this.gatePickMesh.userData.target = { kind: 'gate' };
    this.group.add(this.gatePickMesh);
  }

  update(gate: GateState, _dt: number, time: number): void {
    // Animate tower searchlight sweep and gatehouse beacon pulse
    for (let i = 0; i < this.searchlights.length; i++) {
      this.searchlights[i].rotation.y = Math.sin(time * 0.85 + i * 2.1) * 0.45;
    }
    const beaconPulse = 0.65 + 0.35 * Math.sin(time * 6.0);
    this.beaconMat.color.setRGB(1.0 * beaconPulse, 0.7 * beaconPulse, 0.28 * beaconPulse);

    if (gate.destroyed) {
      this.gateIntactGroup.visible = false;
      this.gateRubbleGroup.visible = true;
      this.gateHighlightMesh.visible = false;
      this.gateSparkMesh.visible = false;
      this.gatePickMesh.visible = false;
      this.gatePickMesh.userData.target = null;
      this.gatePickMesh.position.set(this.gateCx, -1000, this.gateCz);
      return;
    }

    this.gateIntactGroup.visible = true;
    this.gateRubbleGroup.visible = false;
    this.gatePickMesh.visible = true;
    this.gatePickMesh.position.set(this.gateCx, this.gatePickY, this.gateCz);
    if (!this.gatePickMesh.userData.target) {
      this.gatePickMesh.userData.target = { kind: 'gate' };
    }

    const hpFrac = Math.max(0, Math.min(1, gate.hp / Math.max(1, gate.maxHp)));
    const dmg = 1.0 - hpFrac;

    // Degrade individual gate segments: planks/panels go missing and buckle
    for (let i = 0; i < this.gateSegments.length; i++) {
      const seg = this.gateSegments[i];
      if (hpFrac <= seg.hideBelowHpFrac) {
        seg.group.visible = false;
      } else {
        seg.group.visible = true;
        const shake = gate.hitFlash > 0 ? Math.sin(time * 55 + i * 1.9) * 0.08 : 0;
        seg.group.position.set(
          seg.baseX + shake * 0.5,
          seg.baseY - dmg * 0.22 * (i % 2 === 0 ? 1 : 0.6),
          seg.baseZ + shake,
        );
        seg.group.rotation.z = seg.tiltSign * dmg * 0.24;
        seg.group.rotation.x = dmg * 0.18 * seg.tiltSign;
      }
    }

    // Darken/scorch material as hp drops + hitFlash / highlight emissive
    const scorch = 1.0 - dmg * 0.55;
    this.gateMaterial.color.setRGB(scorch, scorch * 0.95, scorch * 0.9);

    if (gate.hitFlash > 0) {
      this.gateMaterial.emissive.setHex(0x884418);
    } else if (this.highlighted) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 7.0);
      this.gateMaterial.emissive.setRGB(0.32 * pulse, 0.14 * pulse, 0.04 * pulse);
    } else if (dmg > 0.5) {
      const flicker = Math.max(0, Math.sin(time * 18.0)) * 0.15 * dmg;
      this.gateMaterial.emissive.setRGB(flicker, flicker * 0.4, 0);
    } else {
      this.gateMaterial.emissive.setHex(0x000000);
    }

    this.gateHighlightMesh.visible = this.highlighted;

    // Show sparks when hit or heavily damaged
    if (gate.hitFlash > 0 || (dmg > 0.35 && Math.sin(time * 23.0) > 0.65)) {
      this.gateSparkMesh.visible = true;
      this.gateSparkMesh.rotation.y = time * 11.0;
      this.gateSparkMesh.rotation.z = time * 7.0;
      const s = gate.hitFlash > 0 ? 1.35 : 0.85;
      this.gateSparkMesh.scale.setScalar(s);
      this.gateSparkMat.color.setHex(gate.hitFlash > 0 ? 0xfff0a8 : 0xff8822);
    } else {
      this.gateSparkMesh.visible = false;
    }
  }

  setGateHighlight(on: boolean): void {
    this.highlighted = on;
    this.gateHighlightMesh.visible = on && !this.gateRubbleGroup.visible;
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
    this.gateSegments.length = 0;
    this.searchlights.length = 0;
    this.pointLights.length = 0;
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

  private buildStaticCompound(layout: DistrictLayout): void {
    const staticGeoms: THREE.BufferGeometry[] = [];
    const glowGeoms: THREE.BufferGeometry[] = [];
    const cpBounds = layout.checkpoint.bounds;

    // 1. Perimeter walls & Sandbag walls from layout.colliders within checkpoint bounds (expanded by ~1 m)
    const wallPad = 1.0;
    for (let i = 0; i < layout.colliders.length; i++) {
      const c = layout.colliders[i];
      const overlapsCheckpoint =
        c.maxX >= cpBounds.minX - wallPad &&
        c.minX <= cpBounds.maxX + wallPad &&
        c.maxZ >= cpBounds.minZ - wallPad &&
        c.minZ <= cpBounds.maxZ + wallPad;
      if (c.kind === 'wall' && overlapsCheckpoint && c.height >= 2.0) {
        this.appendPerimeterWall(c, staticGeoms);
      } else if (c.kind === 'wall' && overlapsCheckpoint && c.height < 2.0) {
        this.appendSandbagWall(c, staticGeoms);
      } else if (
        c.kind === 'building' &&
        c.minX >= cpBounds.minX &&
        c.maxX <= cpBounds.maxX &&
        c.minZ >= cpBounds.minZ &&
        c.maxZ <= cpBounds.maxZ
      ) {
        this.appendCompoundTentOrContainer(c, staticGeoms);
      }
    }

    // 2. Gatehouse flanking pillars + warning beacons
    const gateRect = layout.checkpoint.gate.rect;
    const gateCz = 0.5 * (gateRect.minZ + gateRect.maxZ);
    const pillarXs = [gateRect.minX - 0.35, gateRect.maxX + 0.35];
    for (const px of pillarXs) {
      staticGeoms.push(makeBox(0.95, 3.5, 1.35, px, 1.75, gateCz, COLOR_DARK_STEEL));
      staticGeoms.push(makeBox(1.02, 0.45, 1.42, px, 2.6, gateCz, COLOR_FACTION_ORANGE));
      staticGeoms.push(makeBox(1.02, 0.45, 1.42, px, 1.4, gateCz, COLOR_FACTION_NAVY));

      const beaconGeom = this.trackGeometry(new THREE.CylinderGeometry(0.18, 0.22, 0.32, 6));
      const beacon = new THREE.Mesh(beaconGeom, this.beaconMat);
      beacon.position.set(px, 3.66, gateCz);
      this.group.add(beacon);
    }

    // 3. Two Open-Frame Watchtowers (4 legs, platform at platformHeight, railing, roof, searchlight)
    for (const tower of layout.checkpoint.towers) {
      const r = tower.rect;
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const cx = 0.5 * (r.minX + r.maxX);
      const cz = 0.5 * (r.minZ + r.maxZ);
      const platY = tower.platformHeight; // 4.0 m
      const roofY = platY + 2.45;

      // 4 heavy steel legs from ground up to roof
      const legOffsets: [number, number][] = [
        [r.minX + 0.2, r.minZ + 0.2],
        [r.maxX - 0.2, r.minZ + 0.2],
        [r.minX + 0.2, r.maxZ - 0.2],
        [r.maxX - 0.2, r.maxZ - 0.2],
      ];
      for (const [lx, lz] of legOffsets) {
        staticGeoms.push(makeBox(0.26, roofY, 0.26, lx, roofY * 0.5, lz, COLOR_DARK_STEEL));
      }

      // Cross-bracing struts on lower tower legs (so zombies clawing tower legs look natural)
      for (let h = 1.3; h < platY; h += 1.35) {
        staticGeoms.push(makeBox(w - 0.2, 0.14, 0.14, cx, h, r.minZ + 0.2, 0x4d5662));
        staticGeoms.push(makeBox(w - 0.2, 0.14, 0.14, cx, h, r.maxZ - 0.2, 0x4d5662));
        staticGeoms.push(makeBox(0.14, 0.14, d - 0.2, r.minX + 0.2, h, cz, 0x4d5662));
        staticGeoms.push(makeBox(0.14, 0.14, d - 0.2, r.maxX - 0.2, h, cz, 0x4d5662));
      }

      // Access ladder on north (inside compound) side of tower
      staticGeoms.push(makeBox(0.08, platY, 0.08, cx - 0.3, platY * 0.5, r.minZ + 0.05, 0x6b7480));
      staticGeoms.push(makeBox(0.08, platY, 0.08, cx + 0.3, platY * 0.5, r.minZ + 0.05, 0x6b7480));
      for (let ry = 0.4; ry < platY; ry += 0.45) {
        staticGeoms.push(makeBox(0.64, 0.06, 0.06, cx, ry, r.minZ + 0.05, 0x8a929e));
      }

      // Platform deck at platformHeight (top at y = platY so occupant stands flush)
      staticGeoms.push(makeBox(w + 0.3, 0.22, d + 0.3, cx, platY - 0.11, cz, 0x5c4c3c));
      staticGeoms.push(makeBox(w + 0.36, 0.12, d + 0.36, cx, platY - 0.22, cz, COLOR_DARK_STEEL));

      // Waist-high armored railings (height 0.95 m above platform, leaving clear sight from 5.2 m eye)
      const railH = 0.92;
      const railY = platY + railH * 0.5;
      staticGeoms.push(
        makeBox(w + 0.25, railH, 0.14, cx, railY, r.maxZ + 0.06, COLOR_FACTION_NAVY),
        makeBox(w + 0.25, railH, 0.14, cx, railY, r.minZ - 0.06, COLOR_FACTION_NAVY),
        makeBox(0.14, railH, d + 0.25, r.minX - 0.06, railY, cz, COLOR_FACTION_NAVY),
        makeBox(0.14, railH, d + 0.25, r.maxX + 0.06, railY, cz, COLOR_FACTION_NAVY),
      );
      // Faction orange stripe band around tower shield
      staticGeoms.push(
        makeBox(w + 0.3, 0.22, 0.18, cx, railY + 0.15, r.maxZ + 0.07, COLOR_FACTION_ORANGE),
        makeBox(0.18, 0.22, d + 0.3, r.minX - 0.07, railY + 0.15, cz, COLOR_FACTION_ORANGE),
        makeBox(0.18, 0.22, d + 0.3, r.maxX + 0.07, railY + 0.15, cz, COLOR_FACTION_ORANGE),
      );

      // Pitched canopy roof
      staticGeoms.push(makeBox(w + 0.7, 0.18, d + 0.7, cx, roofY, cz, COLOR_FACTION_NAVY));
      staticGeoms.push(makeCylinder(0.2, w * 0.72, 0.65, 4, cx, roofY + 0.38, cz, COLOR_DARK_STEEL));

      // Swiveling searchlight on front of tower
      const searchGroup = new THREE.Group();
      searchGroup.position.set(cx, platY + 1.05, r.maxZ + 0.18);
      const housingGeom = this.trackGeometry(new THREE.BoxGeometry(0.42, 0.34, 0.52));
      const housingMat = this.trackMaterial(
        new THREE.MeshLambertMaterial({ color: COLOR_DARK_STEEL, flatShading: true }),
      );
      const housing = new THREE.Mesh(housingGeom, housingMat);
      searchGroup.add(housing);

      const lensGeom = this.trackGeometry(new THREE.BoxGeometry(0.34, 0.26, 0.08));
      const lens = new THREE.Mesh(lensGeom, this.beaconMat);
      lens.position.set(0, 0, 0.25);
      searchGroup.add(lens);

      this.group.add(searchGroup);
      this.searchlights.push(searchGroup);
    }

    // 4. Compound warning signs & floodlight emissive heads
    const signPositions: [number, number][] = [
      [78.2, -51.8],
      [87.8, -51.8],
    ];
    for (const [sx, sz] of signPositions) {
      staticGeoms.push(makeBox(1.1, 0.7, 0.1, sx, 1.5, sz, COLOR_FACTION_ORANGE));
      staticGeoms.push(makeBox(0.9, 0.22, 0.12, sx, 1.5, sz, COLOR_FACTION_NAVY));
      glowGeoms.push(makeBox(0.55, 0.26, 0.22, sx, 3.85, sz + 0.3, COLOR_WARNING_LIGHT));
    }

    // Merge static compound geometry into 1 shadow-casting mesh
    const mergedStatic = this.trackGeometry(mergeGeometries(staticGeoms, false));
    for (const g of staticGeoms) g.dispose();
    const staticMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    const staticMesh = new THREE.Mesh(mergedStatic, staticMat);
    staticMesh.castShadow = true;
    staticMesh.receiveShadow = true;
    staticMesh.name = 'CheckpointStatic';
    this.group.add(staticMesh);

    if (glowGeoms.length > 0) {
      const mergedGlow = this.trackGeometry(mergeGeometries(glowGeoms, false));
      for (const g of glowGeoms) g.dispose();
      const glowMesh = new THREE.Mesh(mergedGlow, this.beaconMat);
      this.group.add(glowMesh);
    }

    // At most 2 real PointLights (no shadows) bathing the gate and compound in warm #ffb347 glow
    const light1 = new THREE.PointLight(COLOR_WARNING_LIGHT, 1.6, 26, 1.5);
    light1.position.set(83, 4.4, -50.5);
    light1.castShadow = false;
    this.group.add(light1);
    this.pointLights.push(light1);

    const light2 = new THREE.PointLight(COLOR_WARNING_LIGHT, 1.2, 26, 1.5);
    light2.position.set(83, 4.8, -66.0);
    light2.castShadow = false;
    this.group.add(light2);
    this.pointLights.push(light2);
  }

  private appendPerimeterWall(c: ColliderDef, out: THREE.BufferGeometry[]): void {
    const w = c.maxX - c.minX;
    const d = c.maxZ - c.minZ;
    const cx = 0.5 * (c.minX + c.maxX);
    const cz = 0.5 * (c.minZ + c.maxZ);
    const h = c.height; // 2.4 m

    // Heavy concrete base (lower 1.25 m)
    out.push(makeBox(w, 1.25, d, cx, 0.625, cz, COLOR_CONCRETE));
    // Upper corrugated navy barrier panel (1.25..2.35 m)
    out.push(makeBox(w * 0.98, h - 1.25, d * 0.72, cx, 1.25 + (h - 1.25) * 0.5, cz, COLOR_FACTION_NAVY));
    // Faction orange stripe along mid-wall
    out.push(makeBox(w + 0.04, 0.22, d + 0.04, cx, 1.32, cz, COLOR_FACTION_ORANGE));

    // Steel stanchion posts + angled barbed wire top hint every ~3.5 m
    if (w >= d) {
      for (let x = c.minX + 0.4; x <= c.maxX - 0.3; x += 3.5) {
        out.push(makeBox(0.24, h + 0.35, d + 0.14, x, (h + 0.35) * 0.5, cz, COLOR_DARK_STEEL));
        out.push(makeBox(0.12, 0.38, 0.45, x, h + 0.25, cz, 0x6e7680, 0.45, 0, 0));
      }
      out.push(makeBox(w, 0.06, 0.06, cx, h + 0.28, cz - 0.12, 0x8b939c));
      out.push(makeBox(w, 0.06, 0.06, cx, h + 0.38, cz + 0.12, 0x8b939c));
    } else {
      for (let z = c.minZ + 0.4; z <= c.maxZ - 0.3; z += 3.5) {
        out.push(makeBox(w + 0.14, h + 0.35, 0.24, cx, (h + 0.35) * 0.5, z, COLOR_DARK_STEEL));
        out.push(makeBox(0.45, 0.38, 0.12, cx, h + 0.25, z, 0x6e7680, 0, 0, 0.45));
      }
      out.push(makeBox(0.06, 0.06, d, cx - 0.12, h + 0.28, cz, 0x8b939c));
      out.push(makeBox(0.06, 0.06, d, cx + 0.12, h + 0.38, cz, 0x8b939c));
    }
  }

  private appendSandbagWall(c: ColliderDef, out: THREE.BufferGeometry[]): void {
    const w = c.maxX - c.minX;
    const d = c.maxZ - c.minZ;
    const cx = 0.5 * (c.minX + c.maxX);
    const cz = 0.5 * (c.minZ + c.maxZ);
    out.push(makeBox(w, 0.42, d, cx, 0.21, cz, 0xa89572));
    out.push(makeBox(w * 0.94, 0.38, d * 0.86, cx, 0.6, cz, 0x948260));
    out.push(makeBox(w * 0.86, 0.34, d * 0.72, cx, 0.94, cz, 0xa89572));
  }

  private appendCompoundTentOrContainer(c: ColliderDef, out: THREE.BufferGeometry[]): void {
    const w = c.maxX - c.minX;
    const d = c.maxZ - c.minZ;
    const cx = 0.5 * (c.minX + c.maxX);
    const cz = 0.5 * (c.minZ + c.maxZ);
    const h = c.height; // 2.8 m

    // Military field command barracks / container with pitched olive-navy roof & faction stripe
    const bodyCol = c.tag === 'cp-tent-w' ? 0x4b5c49 : COLOR_FACTION_NAVY;
    out.push(makeBox(w, h * 0.78, d, cx, h * 0.39, cz, bodyCol));
    out.push(makeBox(w + 0.12, 0.28, d + 0.12, cx, h * 0.52, cz, COLOR_FACTION_ORANGE));
    // Pitched tent/container roof ridge
    out.push(makeBox(w + 0.3, 0.35, d + 0.3, cx, h * 0.84, cz, 0x3b463b));
    out.push(makeBox(w * 0.92, 0.36, d * 0.62, cx, h + 0.12, cz, 0x4f5c4e));
    // Doorway facing south toward compound center
    out.push(makeBox(1.8, 2.0, 0.18, cx, 1.0, c.maxZ + 0.04, 0x262c34));
    // Vertical ribs along sides
    for (let x = c.minX + 1.0; x <= c.maxX - 1.0; x += 1.6) {
      out.push(makeBox(0.16, h * 0.76, d + 0.14, x, h * 0.38, cz, 0x353e47));
    }
  }

  private buildGateSegments(
    gateCx: number,
    gateCz: number,
    gateW: number,
    gateH: number,
    gateD: number,
  ): void {
    // 6 articulated gate panels across the 7 m width so planks/segments go missing progressively
    const numSegs = 6;
    const segW = gateW / numSegs;
    // Order of disappearance (middle segments break out first as hp drops)
    const hideThresholds = [0.05, 0.22, 0.58, 0.74, 0.38, 0.12];

    for (let i = 0; i < numSegs; i++) {
      const segCx = gateCx - gateW * 0.5 + (i + 0.5) * segW;
      const segGroup = new THREE.Group();
      segGroup.position.set(segCx, 0, gateCz);

      const parts: THREE.BufferGeometry[] = [];
      // Heavy steel panel core
      parts.push(makeBox(segW - 0.06, gateH - 0.15, gateD * 0.62, 0, gateH * 0.5, 0, COLOR_FACTION_NAVY));
      // Reinforced horizontal wood/metal planks with faction orange hazard stripes
      parts.push(makeBox(segW - 0.04, 0.42, gateD * 0.85, 0, 0.65, 0, COLOR_FACTION_ORANGE));
      parts.push(makeBox(segW - 0.04, 0.38, gateD * 0.82, 0, 1.5, 0, 0x7d6549));
      parts.push(makeBox(segW - 0.04, 0.42, gateD * 0.85, 0, 2.35, 0, COLOR_FACTION_ORANGE));
      // Vertical steel stiles & diagonal cross brace
      parts.push(makeBox(0.14, gateH, gateD * 0.9, -segW * 0.42, gateH * 0.5, 0, COLOR_DARK_STEEL));
      parts.push(makeBox(0.14, gateH, gateD * 0.9, segW * 0.42, gateH * 0.5, 0, COLOR_DARK_STEEL));
      parts.push(
        makeBox(
          segW * 0.85,
          0.18,
          gateD * 0.92,
          0,
          gateH * 0.5,
          0,
          COLOR_DARK_STEEL,
          0,
          0,
          i % 2 === 0 ? 0.65 : -0.65,
        ),
      );

      const merged = this.trackGeometry(mergeGeometries(parts, false));
      for (const p of parts) p.dispose();

      const segMesh = new THREE.Mesh(merged, this.gateMaterial);
      segMesh.castShadow = true;
      segMesh.receiveShadow = true;
      segGroup.add(segMesh);

      this.gateIntactGroup.add(segGroup);
      this.gateSegments.push({
        group: segGroup,
        baseX: segCx,
        baseY: 0,
        baseZ: gateCz,
        hideBelowHpFrac: hideThresholds[i],
        tiltSign: i % 2 === 0 ? 1 : -1,
      });
    }
  }

  private buildGateRubble(
    gateCx: number,
    gateCz: number,
    gateW: number,
    gateD: number,
  ): void {
    const rubbleParts: THREE.BufferGeometry[] = [];
    // Collapsed planks, twisted steel beams, and concrete chunks across the gate footprint
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const rx = gateCx - gateW * 0.45 + t * gateW * 0.9;
      const rz = gateCz + ((i * 7) % 5 - 2) * (gateD * 0.38);
      const rotY = (i * 1.37) % Math.PI;
      const col =
        i % 3 === 0
          ? COLOR_FACTION_ORANGE
          : i % 3 === 1
            ? COLOR_FACTION_NAVY
            : COLOR_DARK_STEEL;
      rubbleParts.push(makeBox(0.95, 0.16, 0.34, rx, 0.09, rz, col, 0.08, rotY, -0.06));
    }

    const mergedRubble = this.trackGeometry(mergeGeometries(rubbleParts, false));
    for (const p of rubbleParts) p.dispose();
    const rubbleMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    const rubbleMesh = new THREE.Mesh(mergedRubble, rubbleMat);
    rubbleMesh.receiveShadow = true;
    this.gateRubbleGroup.add(rubbleMesh);
  }
}
