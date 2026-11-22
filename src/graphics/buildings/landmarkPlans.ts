// [pure] VP2 district landmark plans (docs/12_visual_polish2.md §5/§7, ARCHITECTURE §VP2-1).
// planBuilding dispatches archetype === 'landmark' here. No three import, no Math.random.
import { mulberry32 } from '../../utils/rng';
import type { BuildingConfig, BuildingPlan, ComponentInstance } from './buildingTypes';

/** Numeric part IDs for ComponentKind 'landmarkPart' (dispatched by LandmarkComponents.landmarkPartGeometry). */
export const LANDMARK_PART = {
  /** Tapered cylindrical lighthouse shaft with alternating accent/wall bands. */
  LIGHTHOUSE_TOWER: 0,
  /** Circular gallery deck and railing rim atop the lighthouse tower. */
  LIGHTHOUSE_GALLERY: 1,
  /** Glazed lantern drum with conical/domed roof cap. */
  LIGHTHOUSE_LANTERN: 2,
  /** Emissive neon beacon lens inside the lantern. */
  LIGHTHOUSE_BEACON: 3,
  /** Four corner support legs and cross-braces for the water tower. */
  TOWER_LEGS: 4,
  /** Cylindrical water tank bowl with domed roof and catwalk ring. */
  WATER_TANK_BOWL: 5,
  /** Square tapered masonry clock tower shaft with cornice collar. */
  CLOCK_SHAFT: 6,
  /** Circular clock face with bezel, hands, and hour tick marks (no numerals). */
  CLOCK_FACE: 7,
  /** Pyramidal spire crowning the clock tower. */
  CLOCK_SPIRE: 8,
  /** Tapered cylindrical control tower shaft. */
  CONTROL_SHAFT: 9,
  /** Wide glazed observation cab with trim bands. */
  CONTROL_CAB: 10,
  /** Disc roof and small equipment cap atop the control cab. */
  CONTROL_ROOF: 11,
  /** Tapered 4-leg lattice mast with bracing rings and diagonals (4 legs at LOD1). */
  MAST_LATTICE: 12,
  /** Emissive neon beacon light and thin antenna mast tip. */
  MAST_BEACON: 13,
  /** Tiered lathe stone fountain basin. */
  FOUNTAIN_BASIN: 14,
  /** Flat circular water disc inside the fountain basin. */
  FOUNTAIN_WATER: 15,
  /** Central water jet column with crown spray. */
  FOUNTAIN_JET: 16,
  /** Concave quarter/half-dome sail shell opening toward +Z. */
  BANDSHELL_SHELL: 17,
  /** Torus outer rim of the ferris wheel in the X-Y plane. */
  WHEEL_RIM: 18,
  /** Twelve radial spokes connecting hub to rim. */
  WHEEL_SPOKES: 19,
  /** Central cylindrical hub of the ferris wheel. */
  WHEEL_HUB: 20,
  /** A-frame support legs in the Z=0 plane rising to the wheel hub. */
  WHEEL_SUPPORT: 21,
  /** Twelve passenger gondolas hung around the wheel rim. */
  WHEEL_GONDOLA: 22,
  /** Cylindrical observatory base drum with trim ring. */
  DOME_DRUM: 23,
  /** Hemispherical observatory dome shell. */
  DOME_SHELL: 24,
  /** Meridian structural ribs curving over the observatory dome. */
  DOME_RIBS: 25,
  /** Dark telescope viewing slit band on the front of the dome. */
  DOME_SLIT: 26,
  /** Tapered glass skyscraper shaft (with mullion grid at LOD0, plain at LOD1). */
  GLASS_SHAFT: 27,
  /** Stepped skyscraper crown with spire antenna. */
  GLASS_CROWN: 28,
  /** Arch-topped emissive neon span across the portal width. */
  ARCH_SPAN: 29,
  /** Vertical support pylon for the neon arch. */
  ARCH_PYLON: 30,
  /** Half-cylinder barrel vault along X for the hangar. */
  HANGAR_VAULT: 31,
  /** Extruded gable end walls closing the hangar ends. */
  HANGAR_ENDS: 32,
} as const;

export type LandmarkPartId = (typeof LANDMARK_PART)[keyof typeof LANDMARK_PART];

function part(
  variant: LandmarkPartId,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: ComponentInstance['material'],
  lod: 0 | 1,
  rotY = 0,
): ComponentInstance {
  return {
    kind: 'landmarkPart',
    x,
    y,
    z,
    rotY,
    w: Math.max(0.05, w),
    h: Math.max(0.05, h),
    d: Math.max(0.05, d),
    material,
    variant,
    lod,
  };
}

function std(
  kind: ComponentInstance['kind'],
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: ComponentInstance['material'],
  lod: 0 | 1,
  rotY = 0,
  variant = 0,
): ComponentInstance {
  return {
    kind,
    x,
    y,
    z,
    rotY,
    w: Math.max(0.05, w),
    h: Math.max(0.05, h),
    d: Math.max(0.05, d),
    material,
    variant,
    lod,
  };
}

export function planLandmark(cfg: BuildingConfig): BuildingPlan {
  const kind = cfg.landmark ?? 'glassTower';
  const W = Math.max(1, cfg.width);
  const D = Math.max(1, cfg.depth);
  const H = Math.max(0.5, cfg.height);
  const minSide = Math.min(W, D);
  const rng = mulberry32(cfg.seed);
  // Deterministic subtle variation factor in [0.96, 1.04]
  const jitter = 0.96 + rng.next() * 0.08;
  const c: ComponentInstance[] = [];

  switch (kind) {
    case 'lighthouse': {
      const foundH = Math.min(0.4, H * 0.05);
      const foundW = Math.min(W, minSide * 0.92);
      const foundD = Math.min(D, minSide * 0.92);
      c.push(std('foundation', 0, foundH * 0.5, 0, foundW, foundH, foundD, 'concrete', 1));

      const towerTopY = H * 0.82;
      const towerH = Math.max(0.5, towerTopY - foundH);
      const towerW = minSide * 0.72;
      c.push(part(LANDMARK_PART.LIGHTHOUSE_TOWER, 0, foundH + towerH * 0.5, 0, towerW, towerH, towerW, 'wall', 1));

      const doorW = Math.min(1.0, towerW * 0.34);
      const doorH = Math.min(2.0, towerH * 0.38);
      const doorZ = Math.min(D * 0.5 - 0.14, towerW * 0.45);
      c.push(std('door', 0, foundH + doorH * 0.5, doorZ, doorW, doorH, 0.22, 'trim', 0));

      const galH = Math.min(0.75, H * 0.06);
      const galW = Math.min(W + 1.4, towerW * 0.84 + 0.9);
      c.push(part(LANDMARK_PART.LIGHTHOUSE_GALLERY, 0, towerTopY + galH * 0.25, 0, galW, galH, galW, 'trim', 0));

      const lantH = Math.max(0.3, H - towerTopY);
      const lantW = towerW * 0.56;
      c.push(part(LANDMARK_PART.LIGHTHOUSE_LANTERN, 0, towerTopY + lantH * 0.5, 0, lantW, lantH, lantW, 'roof', 1));

      const beacH = Math.max(0.15, lantH * 0.34);
      const beacW = lantW * 0.52;
      c.push(part(LANDMARK_PART.LIGHTHOUSE_BEACON, 0, towerTopY + lantH * 0.3, 0, beacW, beacH, beacW, 'neon', 1));

      const lampY = foundH + Math.min(2.1, towerH * 0.35);
      const lampZ = Math.min(D * 0.5 - 0.12, towerW * 0.44);
      c.push(std('wallLamp', doorW * 0.65, lampY, lampZ, 0.22, 0.3, 0.18, 'neon', 0));
      break;
    }

    case 'waterTower': {
      const legTopY = H * 0.6;
      const legW = Math.min(W * 0.82, minSide * 0.8);
      const legD = Math.min(D * 0.82, minSide * 0.8);
      c.push(part(LANDMARK_PART.TOWER_LEGS, 0, legTopY * 0.5, 0, legW, legTopY, legD, 'metal', 1));

      const tankH = Math.max(0.4, H - legTopY);
      const tankW = Math.min(W * 0.92, minSide * 0.86);
      c.push(part(LANDMARK_PART.WATER_TANK_BOWL, 0, legTopY + tankH * 0.5, 0, tankW, tankH, tankW, 'wall', 1));

      const ladH = Math.max(0.4, legTopY * 0.92);
      const ladZ = Math.min(D * 0.5 - 0.1, legD * 0.42);
      c.push(std('stair', 0, ladH * 0.5, ladZ, 0.45, ladH, 0.16, 'metal', 0));
      break;
    }

    case 'clockTower': {
      const shaftTopY = H * 0.78;
      const shaftW = Math.min(W, D) * 0.68;
      c.push(part(LANDMARK_PART.CLOCK_SHAFT, 0, shaftTopY * 0.5, 0, shaftW, shaftTopY, shaftW, 'wall', 1));

      const faceR = shaftW * 0.28;
      const faceY = shaftTopY * 0.86;
      const faceOffset = shaftW * 0.44;
      const rots = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
      for (const r of rots) {
        const fx = Math.sin(r) * faceOffset;
        const fz = Math.cos(r) * faceOffset;
        c.push(part(LANDMARK_PART.CLOCK_FACE, fx, faceY, fz, faceR * 2, faceR * 2, 0.22, 'sign', 0, r));
      }

      const spireH = Math.max(0.4, H - shaftTopY);
      c.push(part(LANDMARK_PART.CLOCK_SPIRE, 0, shaftTopY + spireH * 0.5, 0, shaftW * 0.86, spireH, shaftW * 0.86, 'roof', 1));

      const doorH = Math.min(2.1, shaftTopY * 0.25);
      const doorZ = Math.min(D * 0.5 - 0.14, shaftW * 0.48);
      c.push(std('door', 0, doorH * 0.5, doorZ, Math.min(1.2, shaftW * 0.32), doorH, 0.22, 'trim', 0));
      break;
    }

    case 'controlTower': {
      const podiumH = Math.min(2.2, H * 0.12);
      const podW = W * 0.78;
      const podD = D * 0.78;
      c.push(std('foundation', 0, podiumH * 0.5, 0, podW, podiumH, podD, 'concrete', 1));

      const shaftTopY = H * 0.76;
      const shaftH = Math.max(0.5, shaftTopY - podiumH);
      const shaftW = minSide * 0.44;
      c.push(part(LANDMARK_PART.CONTROL_SHAFT, 0, podiumH + shaftH * 0.5, 0, shaftW, shaftH, shaftW, 'wall', 1));

      const cabTopY = H * 0.90;
      const cabH = Math.max(0.3, cabTopY - shaftTopY);
      const cabW = Math.min(minSide * 0.92, shaftW * 1.9);
      c.push(part(LANDMARK_PART.CONTROL_CAB, 0, shaftTopY + cabH * 0.5, 0, cabW, cabH, cabW, 'wall', 1));

      const roofTopY = H * 0.94;
      const roofH = Math.max(0.15, roofTopY - cabTopY);
      c.push(part(LANDMARK_PART.CONTROL_ROOF, 0, cabTopY + roofH * 0.5, 0, cabW * 1.04, roofH, cabW * 1.04, 'roof', 0));

      const antH = Math.max(0.2, H - roofTopY);
      c.push(part(LANDMARK_PART.MAST_BEACON, 0, roofTopY + antH * 0.5, 0, 0.4, antH, 0.4, 'neon', 1));

      const doorH = Math.min(2.0, podiumH * 0.85);
      const doorZ = Math.min(D * 0.5 - 0.14, podD * 0.5 - 0.05);
      c.push(std('door', 0, doorH * 0.5, doorZ, Math.min(1.3, podW * 0.25), doorH, 0.22, 'trim', 0));
      break;
    }

    case 'radioMast': {
      const hutW = Math.min(W * 0.4, 2.0);
      const hutD = Math.min(D * 0.4, 2.0);
      const hutH = Math.min(2.1, H * 0.12);
      c.push(
        std(
          'mechanicalBox',
          -W * 0.5 + hutW * 0.5 + 0.1,
          hutH * 0.5,
          -D * 0.5 + hutD * 0.5 + 0.1,
          hutW,
          hutH,
          hutD,
          'metal',
          0,
        ),
      );

      const mastH = H * 0.94;
      const mastW = minSide * 0.74;
      c.push(part(LANDMARK_PART.MAST_LATTICE, 0, mastH * 0.5, 0, mastW, mastH, mastW, 'metal', 1));

      const beacH = Math.max(0.2, H - mastH);
      c.push(part(LANDMARK_PART.MAST_BEACON, 0, mastH + beacH * 0.5, 0, 0.45, beacH, 0.45, 'neon', 1));
      break;
    }

    case 'fountainPlaza': {
      const slabH = Math.min(0.2, H * 0.15);
      c.push(std('terrace', 0, slabH * 0.5, 0, W, slabH, D, 'concrete', 1));

      const basinR = minSide * 0.42;
      const basinH = Math.min(1.1, Math.max(0.25, (H - slabH) * 0.42));
      c.push(part(LANDMARK_PART.FOUNTAIN_BASIN, 0, slabH + basinH * 0.5, 0, basinR * 2, basinH, basinR * 2, 'wall', 1));

      const waterH = Math.min(0.1, basinH * 0.35);
      c.push(part(LANDMARK_PART.FOUNTAIN_WATER, 0, slabH + basinH * 0.55, 0, basinR * 1.72, waterH, basinR * 1.72, 'water', 1));

      const jetBase = slabH + basinH * 0.6;
      const jetH = Math.max(0.2, H - jetBase);
      c.push(part(LANDMARK_PART.FOUNTAIN_JET, 0, jetBase + jetH * 0.5, 0, basinR * 0.55, jetH, basinR * 0.55, 'water', 1));
      break;
    }

    case 'bandshell': {
      const deckH = Math.min(0.3, H * 0.1);
      c.push(std('terrace', 0, deckH * 0.5, 0, W * 0.96, deckH, D * 0.94, 'concrete', 1));

      const shellH = Math.max(0.4, H - deckH);
      c.push(part(LANDMARK_PART.BANDSHELL_SHELL, 0, deckH + shellH * 0.5, -D * 0.04, W * 0.9, shellH, D * 0.82, 'wall', 1));

      const lampY = deckH + 0.25;
      const lampZ = Math.min(D * 0.5 - 0.2, D * 0.35);
      c.push(std('wallLamp', -W * 0.34, lampY, lampZ, 0.22, 0.3, 0.22, 'neon', 0));
      c.push(std('wallLamp', W * 0.34, lampY, lampZ, 0.22, 0.3, 0.22, 'neon', 0));
      break;
    }

    case 'ferrisWheel': {
      const R = Math.min(W * 0.44, H * 0.40);
      const hubY = H - R;
      const wheelD = Math.min(D * 0.42, 2.4);

      const supW = Math.min(W * 0.68, R * 1.3);
      const supD = Math.min(D * 0.85, 3.0);
      c.push(part(LANDMARK_PART.WHEEL_SUPPORT, 0, hubY * 0.5, 0, supW, hubY, supD, 'metal', 1));

      const hubSize = Math.max(0.4, R * 0.22);
      c.push(part(LANDMARK_PART.WHEEL_HUB, 0, hubY, 0, hubSize, hubSize, Math.min(D * 0.65, 2.4), 'trim', 1));

      c.push(part(LANDMARK_PART.WHEEL_RIM, 0, hubY, 0, R * 2, R * 2, wheelD, 'wallAccent', 1));
      c.push(part(LANDMARK_PART.WHEEL_SPOKES, 0, hubY, 0, R * 1.9, R * 1.9, wheelD * 0.85, 'metal', 0));
      c.push(part(LANDMARK_PART.WHEEL_GONDOLA, 0, hubY, 0, R * 2.02, R * 2.02, Math.min(D * 0.72, 2.6), 'wall', 0));
      break;
    }

    case 'domeObservatory': {
      const foundH = Math.min(0.3, H * 0.05);
      const drumR = minSide * 0.46;
      c.push(std('foundation', 0, foundH * 0.5, 0, drumR * 2.04, foundH, drumR * 2.04, 'concrete', 1));

      const drumTopY = H * 0.55;
      const drumH = Math.max(0.4, drumTopY - foundH);
      c.push(part(LANDMARK_PART.DOME_DRUM, 0, foundH + drumH * 0.5, 0, drumR * 2, drumH, drumR * 2, 'wall', 1));

      const domeH = Math.max(0.4, H - drumTopY);
      c.push(part(LANDMARK_PART.DOME_SHELL, 0, drumTopY + domeH * 0.5, 0, drumR * 1.96, domeH, drumR * 1.96, 'roof', 1));
      c.push(part(LANDMARK_PART.DOME_RIBS, 0, drumTopY + domeH * 0.5, 0, drumR * 1.98, domeH, drumR * 1.98, 'trim', 0));
      c.push(part(LANDMARK_PART.DOME_SLIT, 0, drumTopY + domeH * 0.44, drumR * 0.5, drumR * 0.28, domeH * 0.82, drumR * 0.9, 'glassDark', 0));

      const doorH = Math.min(2.0, drumH * 0.75);
      const doorZ = Math.min(D * 0.5 - 0.14, drumR - 0.04);
      c.push(std('door', 0, foundH + doorH * 0.5, doorZ, Math.min(1.2, drumR * 0.3), doorH, 0.22, 'trim', 0));
      break;
    }

    case 'glassTower': {
      const podH = Math.min(3.2, H * 0.10);
      const podW = W * 0.92;
      const podD = D * 0.92;
      c.push(std('foundation', 0, podH * 0.5, 0, podW, podH, podD, 'concrete', 1));

      const shaftTopY = H * 0.88;
      const shaftH = Math.max(0.5, shaftTopY - podH);
      const shaftW = W * 0.82 * Math.min(1.05, jitter);
      const shaftD = D * 0.82 * Math.min(1.05, jitter);
      c.push(part(LANDMARK_PART.GLASS_SHAFT, 0, podH + shaftH * 0.5, 0, shaftW, shaftH, shaftD, 'glass', 1));

      const crownH = Math.max(0.3, H - shaftTopY);
      c.push(part(LANDMARK_PART.GLASS_CROWN, 0, shaftTopY + crownH * 0.5, 0, shaftW * 0.88, crownH, shaftD * 0.88, 'trim', 1));

      const doorH = Math.min(2.2, podH * 0.82);
      const doorZ = Math.min(D * 0.5 - 0.14, podD * 0.5 - 0.04);
      c.push(std('door', 0, doorH * 0.5, doorZ, Math.min(1.8, podW * 0.25), doorH, 0.22, 'trim', 0));
      break;
    }

    case 'neonArch': {
      const plinthH = Math.min(0.4, H * 0.06);
      c.push(std('foundation', 0, plinthH * 0.5, 0, W, plinthH, D, 'concrete', 1));

      const pylonW = Math.min(0.6, W * 0.22);
      const pylonD = Math.min(D * 0.6, 2.5);
      const pylonH = Math.max(0.4, (H - plinthH) * 0.58);
      const px = W * 0.5 - pylonW * 0.5;
      c.push(part(LANDMARK_PART.ARCH_PYLON, -px, plinthH + pylonH * 0.5, 0, pylonW, pylonH, pylonD, 'wallAccent', 1));
      c.push(part(LANDMARK_PART.ARCH_PYLON, px, plinthH + pylonH * 0.5, 0, pylonW, pylonH, pylonD, 'wallAccent', 1));

      const spanH = Math.max(0.4, H - plinthH - pylonH);
      c.push(part(LANDMARK_PART.ARCH_SPAN, 0, plinthH + pylonH + spanH * 0.5, 0, W, spanH, pylonD * 0.85, 'neon', 1));

      const lampY = plinthH + pylonH * 0.5;
      const lampZ = Math.min(D * 0.5 - 0.12, pylonD * 0.5 + 0.05);
      c.push(std('wallLamp', -px, lampY, lampZ, 0.22, 0.28, 0.16, 'neon', 0));
      c.push(std('wallLamp', px, lampY, lampZ, 0.22, 0.28, 0.16, 'neon', 0));
      break;
    }

    case 'hangar': {
      const foundH = Math.min(0.3, H * 0.05);
      c.push(std('foundation', 0, foundH * 0.5, 0, W, foundH, D, 'concrete', 1));

      const vaultH = Math.max(0.5, H - foundH);
      const vaultW = W * 0.96;
      const vaultD = D * 0.96;
      c.push(part(LANDMARK_PART.HANGAR_VAULT, 0, foundH + vaultH * 0.5, 0, vaultW, vaultH, vaultD, 'roof', 1));

      const endW = Math.min(0.32, W * 0.04);
      const endX = vaultW * 0.5 - endW * 0.5;
      c.push(part(LANDMARK_PART.HANGAR_ENDS, -endX, foundH + vaultH * 0.5, 0, endW, vaultH, vaultD * 0.98, 'wall', 1));
      c.push(part(LANDMARK_PART.HANGAR_ENDS, endX, foundH + vaultH * 0.5, 0, endW, vaultH, vaultD * 0.98, 'wall', 1));

      const gH = Math.min(3.5, vaultH * 0.45);
      const gW = Math.min(W * 0.42, 8);
      const gZ = Math.min(D * 0.5 - 0.14, vaultD * 0.5 - 0.05);
      c.push(std('garageDoor', 0, foundH + gH * 0.5, gZ, gW, gH, 0.22, 'metal', 0));
      break;
    }
  }

  return { config: cfg, components: c };
}
