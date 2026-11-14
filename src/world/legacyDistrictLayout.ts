import type {
  AABB,
  BuildingDef,
  BuildingStyle,
  CheckpointLayout,
  ColliderDef,
  DistrictLayout,
  GroundPatch,
  GuardSpawn,
  PropDef,
  RoadMarking,
  SpawnZone,
  StructureDef,
  Vec2,
} from '../core/types';

function rect(minX: number, minZ: number, maxX: number, maxZ: number): AABB {
  return { minX, minZ, maxX, maxZ };
}

function addBuilding(
  buildings: BuildingDef[],
  colliders: ColliderDef[],
  props: PropDef[],
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  height: number,
  style: BuildingStyle,
  colorIndex: number,
  tag?: string,
  addRoofAc = true,
): void {
  const footprint = rect(minX, minZ, maxX, maxZ);
  buildings.push({
    footprint,
    height,
    style,
    colorIndex: colorIndex & 7,
  });
  colliders.push({
    minX,
    minZ,
    maxX,
    maxZ,
    kind: 'building',
    height,
    blocksMove: true,
    blocksSight: true,
    ...(tag ? { tag } : {}),
  });
  if (addRoofAc && maxX - minX >= 10 && maxZ - minZ >= 10) {
    props.push({
      kind: 'acUnit',
      pos: { x: minX + 3, z: minZ + 3 },
      rotation: 0,
      variant: colorIndex & 3,
      blocking: false,
    });
  }
}

function addBlockingProp(
  props: PropDef[],
  colliders: ColliderDef[],
  kind: 'car' | 'truck' | 'dumpster' | 'barrier' | 'sandbags',
  x: number,
  z: number,
  rotation: number,
  variant = 0,
): void {
  props.push({
    kind,
    pos: { x, z },
    rotation,
    variant,
    blocking: true,
  });

  // Base dimensions when rotation === 0 (width along X, length along Z)
  let sizeX = 2.0;
  let sizeZ = 4.4;
  let height = 1.7;
  let colliderKind: ColliderDef['kind'] = 'vehicle';
  let blocksSight = true;

  if (kind === 'car') {
    sizeX = 2.0;
    sizeZ = 4.4;
    height = 1.7;
    colliderKind = 'vehicle';
    blocksSight = true;
  } else if (kind === 'truck') {
    sizeX = 2.6;
    sizeZ = 7.0;
    height = 3.0;
    colliderKind = 'vehicle';
    blocksSight = true;
  } else if (kind === 'dumpster') {
    sizeX = 2.0;
    sizeZ = 1.2;
    height = 1.4;
    colliderKind = 'prop';
    blocksSight = false;
  } else if (kind === 'barrier') {
    sizeX = 3.0;
    sizeZ = 0.9;
    height = 1.1;
    colliderKind = 'prop';
    blocksSight = false;
  } else if (kind === 'sandbags') {
    sizeX = 4.0;
    sizeZ = 1.0;
    height = 1.1;
    colliderKind = 'wall';
    blocksSight = false;
  }

  const c = Math.abs(Math.cos(rotation));
  const s = Math.abs(Math.sin(rotation));
  const halfX = 0.5 * (sizeX * c + sizeZ * s);
  const halfZ = 0.5 * (sizeX * s + sizeZ * c);

  colliders.push({
    minX: Number((x - halfX).toFixed(3)),
    minZ: Number((z - halfZ).toFixed(3)),
    maxX: Number((x + halfX).toFixed(3)),
    maxZ: Number((z + halfZ).toFixed(3)),
    kind: colliderKind,
    height,
    blocksMove: true,
    blocksSight,
  });
}

function addNonBlockingProp(
  props: PropDef[],
  kind: PropDef['kind'],
  x: number,
  z: number,
  rotation = 0,
  variant = 0,
): void {
  props.push({
    kind,
    pos: { x, z },
    rotation,
    variant,
    blocking: false,
  });
}

/**
 * The recruitment-milestone single district (240 x 180 m), kept as the deterministic fixture for mechanic tests and as
 * Simulation's default layout. The open world is buildDistrictLayout() in ./districtLayout.ts.
 */
export function buildLegacyDistrictLayout(): DistrictLayout {
  const bounds: AABB = rect(-120, -90, 120, 90);
  const ground: GroundPatch[] = [];
  const markings: RoadMarking[] = [];
  const buildings: BuildingDef[] = [];
  const props: PropDef[] = [];
  const colliders: ColliderDef[] = [];

  // ---------------------------------------------------------------------------
  // 1. STREET GRID & SIDEWALKS
  // E-W main avenue: z -38..-22 (sidewalks -41..-38 and -22..-19)
  // E-W south street: z 23..37 (sidewalks 20..23 and 37..40)
  // N-S west street: x -52..-38 (sidewalks -55..-52 and -38..-35)
  // N-S east street: x 28..42 (sidewalks 25..28 and 42..45)
  // ---------------------------------------------------------------------------
  // Sidewalks first so road patches layer cleanly
  ground.push(
    { kind: 'sidewalk', rect: rect(-120, -41, 120, -38) },
    { kind: 'sidewalk', rect: rect(-120, -22, 120, -19) },
    { kind: 'sidewalk', rect: rect(-120, 20, 120, 23) },
    { kind: 'sidewalk', rect: rect(-120, 37, 120, 40) },
    { kind: 'sidewalk', rect: rect(-55, -90, -52, 90) },
    { kind: 'sidewalk', rect: rect(-38, -90, -35, 90) },
    { kind: 'sidewalk', rect: rect(25, -90, 28, 90) },
    { kind: 'sidewalk', rect: rect(42, -90, 45, 90) },
  );

  // Roads (full extent of bounds)
  ground.push(
    { kind: 'road', rect: rect(-120, -38, 120, -22) },
    { kind: 'road', rect: rect(-120, 23, 120, 37) },
    { kind: 'road', rect: rect(-52, -90, -38, 90) },
    { kind: 'road', rect: rect(28, -90, 42, 90) },
  );

  // Block-specific ground patches
  // SW Block: Park + central Plaza
  ground.push(
    { kind: 'park', rect: rect(-120, 40, -55, 90) },
    { kind: 'plaza', rect: rect(-98, 52, -72, 74) },
  );
  // West-center Residential Courtyard
  ground.push({ kind: 'lot', rect: rect(-102, -10, -72, 10) });
  // South-center Residential Courtyard
  ground.push({ kind: 'lot', rect: rect(-20, 54, 10, 76) });
  // Center Commercial rear lot
  ground.push({ kind: 'lot', rect: rect(-20, -8, 10, 8) });
  // North-center Warehouse Service Alleys (5 m E-W at z=-60 and 5 m N-S at x=-5)
  ground.push(
    { kind: 'lot', rect: rect(-38, -62.5, 28, -57.5) },
    { kind: 'lot', rect: rect(-7.5, -57.5, -2.5, -41) },
  );
  // East-center staging parking lot
  const stagingArea: AABB = rect(48, -19, 80, -5);
  ground.push({ kind: 'lot', rect: stagingArea });
  // NE Checkpoint compound + forecourt
  const compoundBounds: AABB = rect(62, -84, 104, -52);
  ground.push(
    { kind: 'lot', rect: rect(62, -52, 104, -41) },
    { kind: 'compound', rect: compoundBounds },
  );

  // ---------------------------------------------------------------------------
  // 2. ROAD MARKINGS
  // ---------------------------------------------------------------------------
  // E-W lane dashes along z = -30 and z = +30 (skipping N-S intersections)
  const ewSegments: [number, number][] = [
    [-116, -56],
    [-34, 24],
    [46, 116],
  ];
  for (const [x0, x1] of ewSegments) {
    for (let x = x0; x <= x1 - 4; x += 8) {
      markings.push({
        kind: 'laneDash',
        rect: rect(x, -30.15, x + 4, -29.85),
        rotation: 0,
      });
      markings.push({
        kind: 'laneDash',
        rect: rect(x, 29.85, x + 4, 30.15),
        rotation: 0,
      });
    }
  }

  // N-S lane dashes along x = -45 and x = +35 (skipping E-W intersections)
  const nsSegments: [number, number][] = [
    [-86, -42],
    [-18, 19],
    [41, 86],
  ];
  for (const [z0, z1] of nsSegments) {
    for (let z = z0; z <= z1 - 4; z += 8) {
      markings.push({
        kind: 'laneDash',
        rect: rect(-45.15, z, -44.85, z + 4),
        rotation: Math.PI / 2,
      });
      markings.push({
        kind: 'laneDash',
        rect: rect(34.85, z, 35.15, z + 4),
        rotation: Math.PI / 2,
      });
    }
  }

  // Crosswalks and stop lines at all 4 intersections
  const intersections: { x: number; z: number; halfW: number; halfD: number }[] = [
    { x: -45, z: -30, halfW: 7, halfD: 8 },
    { x: 35, z: -30, halfW: 7, halfD: 8 },
    { x: -45, z: 30, halfW: 7, halfD: 7 },
    { x: 35, z: 30, halfW: 7, halfD: 7 },
  ];
  for (const inter of intersections) {
    // North & South crosswalks across N-S streets
    markings.push(
      {
        kind: 'crosswalk',
        rect: rect(inter.x - inter.halfW + 1, inter.z - inter.halfD - 2.5, inter.x + inter.halfW - 1, inter.z - inter.halfD - 0.5),
        rotation: 0,
      },
      {
        kind: 'crosswalk',
        rect: rect(inter.x - inter.halfW + 1, inter.z + inter.halfD + 0.5, inter.x + inter.halfW - 1, inter.z + inter.halfD + 2.5),
        rotation: 0,
      },
      // West & East crosswalks across E-W streets
      {
        kind: 'crosswalk',
        rect: rect(inter.x - inter.halfW - 2.5, inter.z - inter.halfD + 1, inter.x - inter.halfW - 0.5, inter.z + inter.halfD - 1),
        rotation: Math.PI / 2,
      },
      {
        kind: 'crosswalk',
        rect: rect(inter.x + inter.halfW + 0.5, inter.z - inter.halfD + 1, inter.x + inter.halfW + 2.5, inter.z + inter.halfD - 1),
        rotation: Math.PI / 2,
      },
      // Stop lines
      {
        kind: 'stopLine',
        rect: rect(inter.x - inter.halfW + 0.5, inter.z - inter.halfD - 3.3, inter.x - 0.5, inter.z - inter.halfD - 2.8),
        rotation: 0,
      },
      {
        kind: 'stopLine',
        rect: rect(inter.x + 0.5, inter.z + inter.halfD + 2.8, inter.x + inter.halfW - 0.5, inter.z + inter.halfD + 3.3),
        rotation: 0,
      },
    );
  }

  // Parking bays along the commercial block curbs and staging lot
  for (let x = -28; x <= 14; x += 7) {
    markings.push({
      kind: 'parkingBay',
      rect: rect(x, -22.2, x + 5, -19.8),
      rotation: 0,
    });
    markings.push({
      kind: 'parkingBay',
      rect: rect(x, 19.8, x + 5, 22.2),
      rotation: 0,
    });
  }

  // Cracks and drains
  markings.push(
    { kind: 'crack', rect: rect(-68, -32, -63, -29), rotation: 0.4 },
    { kind: 'crack', rect: rect(12, -34, 17, -30), rotation: -0.3 },
    { kind: 'crack', rect: rect(31, -28, 38, -24), rotation: 0.6 },
    { kind: 'crack', rect: rect(-47, 12, -43, 16), rotation: 0.2 },
    { kind: 'drain', rect: rect(-39, -22.5, -37.5, -21.5), rotation: 0 },
    { kind: 'drain', rect: rect(26, -22.5, 27.5, -21.5), rotation: 0 },
    { kind: 'drain', rect: rect(-39, 22.5, -37.5, 23.5), rotation: 0 },
    { kind: 'drain', rect: rect(26, 22.5, 27.5, 23.5), rotation: 0 },
  );

  // ---------------------------------------------------------------------------
  // 3. BUILDINGS BY BLOCK
  // ---------------------------------------------------------------------------

  // --- SW BLOCK (x -120..-55, z 40..90): PARK/PLAZA ---
  // Only a few low buildings on the outer SW edges; interior is open park/plaza
  addBuilding(buildings, colliders, props, -118, 43, -104, 57, 7, 'storefront', 0, 'sw-bldg-1');
  addBuilding(buildings, colliders, props, -118, 72, -102, 87, 7.5, 'garage', 1, 'sw-bldg-2');
  addBuilding(buildings, colliders, props, -96, 80, -80, 88, 6.5, 'storefront', 2, 'sw-bldg-3');

  // --- WEST-CENTER BLOCK (x -120..-55, z -19..20): RESIDENTIAL + COURTYARD ---
  // Courtyard in center (-102..-72, -10..10) with wide open entrances on E and S
  addBuilding(buildings, colliders, props, -118, -17, -104, 17, 14, 'apartment', 3, 'wc-bldg-1');
  addBuilding(buildings, colliders, props, -101, -17, -75, -11, 15, 'apartment', 4, 'wc-bldg-2');
  addBuilding(buildings, colliders, props, -72, -17, -57, -5, 12, 'apartment', 5, 'wc-bldg-3');
  addBuilding(buildings, colliders, props, -101, 11, -84, 18, 14, 'apartment', 6, 'wc-bldg-4');
  addBuilding(buildings, colliders, props, -72, 6, -57, 18, 11, 'apartment', 7, 'wc-bldg-5');

  // --- NW BLOCK (x -120..-55, z -90..-41): DENSE APARTMENTS & WAREHOUSES ---
  addBuilding(buildings, colliders, props, -118, -87, -96, -70, 14, 'warehouse', 0, 'nw-bldg-1');
  addBuilding(buildings, colliders, props, -92, -87, -74, -71, 16, 'apartment', 1, 'nw-bldg-2');
  addBuilding(buildings, colliders, props, -70, -87, -57, -69, 12, 'office', 2, 'nw-bldg-3');
  addBuilding(buildings, colliders, props, -118, -64, -95, -43, 15, 'apartment', 3, 'nw-bldg-4');
  addBuilding(buildings, colliders, props, -90, -62, -73, -43, 11, 'storefront', 4, 'nw-bldg-5');
  addBuilding(buildings, colliders, props, -69, -62, -57, -43, 13, 'apartment', 5, 'nw-bldg-6');

  // --- NORTH-CENTER BLOCK (x -35..25, z -90..-41): WAREHOUSES + SERVICE ALLEY ---
  // E-W service alley at z -63..-57 across x -38..28 (clear width 6 m)
  // N-S service alley at x -8..-2 from z -57.5..-41 (clear width 6 m)
  addBuilding(buildings, colliders, props, -33, -87, -10, -65, 11, 'warehouse', 6, 'nc-bldg-1');
  addBuilding(buildings, colliders, props, -4, -87, 23, -65, 12, 'warehouse', 7, 'nc-bldg-2');
  addBuilding(buildings, colliders, props, -33, -55, -10, -43, 9.5, 'warehouse', 0, 'nc-bldg-3');
  addBuilding(buildings, colliders, props, 0, -55, 23, -43, 10, 'warehouse', 1, 'nc-bldg-4');

  // --- CENTER BLOCK (x -35..25, z -19..20): COMMERCIAL STOREFRONTS + CENTRAL LOT ---
  // Central lot at x -20..10, z -8..8 with wide access from N, S, E, W
  addBuilding(buildings, colliders, props, -33, -17, -12, -9, 8.5, 'storefront', 2, 'cc-bldg-1');
  addBuilding(buildings, colliders, props, -1, -17, 23, -9, 10, 'storefront', 3, 'cc-bldg-2');
  addBuilding(buildings, colliders, props, -33, -5, -22, 7, 9, 'storefront', 4, 'cc-bldg-3');
  addBuilding(buildings, colliders, props, 12, -5, 23, 7, 10.5, 'office', 5, 'cc-bldg-4');
  addBuilding(buildings, colliders, props, -33, 10, -12, 18, 8, 'storefront', 6, 'cc-bldg-5');
  addBuilding(buildings, colliders, props, -1, 10, 23, 18, 9, 'storefront', 7, 'cc-bldg-6');

  // --- SOUTH-CENTER BLOCK (x -35..25, z 40..90): RESIDENTIAL + COURTYARD ---
  // Open courtyard at x -20..10, z 54..76 with wide access on N and W
  addBuilding(buildings, colliders, props, -33, 42, -12, 52, 14, 'apartment', 0, 'sc-bldg-1');
  addBuilding(buildings, colliders, props, -1, 42, 23, 52, 15, 'apartment', 1, 'sc-bldg-2');
  addBuilding(buildings, colliders, props, -33, 62, -22, 87, 16, 'apartment', 2, 'sc-bldg-3');
  addBuilding(buildings, colliders, props, 12, 55, 23, 87, 14, 'apartment', 3, 'sc-bldg-4');
  addBuilding(buildings, colliders, props, -18, 78, 8, 88, 13, 'apartment', 4, 'sc-bldg-5');

  // --- EAST-CENTER BLOCK (x 45..120, z -19..20): MIXED + STAGING PARKING LOT ---
  // Open parking lot at x 48..80, z -19..-5
  addBuilding(buildings, colliders, props, 84, -17, 100, -2, 12, 'office', 5, 'ec-bldg-1');
  addBuilding(buildings, colliders, props, 103, -17, 117, 2, 14, 'office', 6, 'ec-bldg-2');
  addBuilding(buildings, colliders, props, 48, 0, 68, 17, 9.5, 'storefront', 7, 'ec-bldg-3');
  addBuilding(buildings, colliders, props, 72, 0, 94, 17, 11, 'garage', 0, 'ec-bldg-4');
  addBuilding(buildings, colliders, props, 98, 5, 117, 17, 13, 'apartment', 1, 'ec-bldg-5');

  // --- SE BLOCK (x 45..120, z 40..90): DENSE MIXED BUILDINGS ---
  addBuilding(buildings, colliders, props, 58, 42, 70, 58, 11, 'storefront', 2, 'se-bldg-1');
  addBuilding(buildings, colliders, props, 74, 42, 95, 60, 15, 'office', 3, 'se-bldg-2');
  addBuilding(buildings, colliders, props, 99, 42, 117, 62, 14, 'apartment', 4, 'se-bldg-3');
  addBuilding(buildings, colliders, props, 48, 64, 72, 86, 16, 'apartment', 5, 'se-bldg-4');
  addBuilding(buildings, colliders, props, 76, 66, 96, 86, 12, 'warehouse', 6, 'se-bldg-5');
  addBuilding(buildings, colliders, props, 100, 66, 117, 86, 13, 'apartment', 7, 'se-bldg-6');

  // --- NE BLOCK SIDE BUILDINGS (outside checkpoint compound x 62..104, z -84..-52) ---
  addBuilding(buildings, colliders, props, 47, -86, 57, -66, 9, 'warehouse', 0, 'ne-bldg-1');
  addBuilding(buildings, colliders, props, 108, -86, 118, -64, 10, 'warehouse', 1, 'ne-bldg-2');

  // Hollow landmark shells are collision data only; Landmarks renders them in R3.
  const structures: StructureDef[] = [
    {
      id: 1, kind: 'busDoor', landmark: 'bus', tag: 'bus-door',
      rect: rect(-67, 32.6, -64.5, 33), facing: 0, defensive: false,
      enclosure: rect(-71.6, 29.4, -60.4, 32.6),
      approachOutside: [-66.4, -65.75, -65.1].map(x => ({ x, z: 34.2 })),
      approachInside: [-66.2, -65.3].map(x => ({ x, z: 31.6 })),
    },
    {
      id: 2, kind: 'alleyGate', landmark: 'alley', tag: 'alley-gate',
      rect: rect(68, 17.4, 72, 18), facing: 0, defensive: false,
      enclosure: rect(68.4, 0.6, 71.6, 17.2),
      approachOutside: [69, 70, 71].map(x => ({ x, z: 19.2 })),
      approachInside: [69, 71].map(x => ({ x, z: 16.4 })),
    },
    {
      id: 3, kind: 'storeDoor', landmark: 'store', tag: 'store-door',
      rect: rect(51, 42, 54, 42.5), facing: Math.PI, defensive: true,
      enclosure: rect(48.5, 42.5, 56.5, 51.5),
      approachOutside: [51.7, 52.5, 53.3].map(x => ({ x, z: 40.8 })),
      approachInside: [51.7, 53.3].map(x => ({ x, z: 43.5 })),
    },
    {
      id: 4, kind: 'penGate', landmark: 'barricade', tag: 'pen-gate',
      rect: rect(8, 34, 8.4, 36.4), facing: -Math.PI / 2, defensive: true,
      enclosure: rect(8.4, 33.4, 15.6, 36.6),
      approachOutside: [34.65, 35.2, 35.75].map(z => ({ x: 6.8, z })),
      approachInside: [34.8, 35.6].map(z => ({ x: 9.4, z })),
    },
  ];
  const shell = (tag: string, footprint: AABB, kind: ColliderDef['kind'], height: number, blocksSight = true): void => {
    colliders.push({ ...footprint, tag, kind, height, blocksMove: true, blocksSight });
  };
  shell('bus-shell-n', rect(-72, 29, -60, 29.4), 'vehicle', 3.2);
  shell('bus-shell-w', rect(-72, 29, -71.6, 33), 'vehicle', 3.2);
  shell('bus-shell-e', rect(-60.4, 29, -60, 33), 'vehicle', 3.2);
  shell('bus-shell-sw', rect(-72, 32.6, -67, 33), 'vehicle', 3.2);
  shell('bus-shell-se', rect(-64.5, 32.6, -60, 33), 'vehicle', 3.2);
  shell('alley-wall-n', rect(68, -0.5, 72, 0.5), 'wall', 3);
  shell('store-wall-nw', rect(48, 42, 51, 42.5), 'building', 5);
  shell('store-wall-ne', rect(54, 42, 57, 42.5), 'building', 5);
  shell('store-wall-w', rect(48, 42, 48.5, 52), 'building', 5);
  shell('store-wall-e', rect(56.5, 42, 57, 52), 'building', 5);
  shell('store-wall-s', rect(48, 51.5, 57, 52), 'building', 5);
  shell('pen-fence-n', rect(8, 33, 16, 33.4), 'wall', 2.2, false);
  shell('pen-fence-s', rect(8, 36.6, 16, 37), 'wall', 2.2, false);
  shell('pen-fence-e', rect(15.6, 33, 16, 37), 'wall', 2.2, false);
  shell('pen-fence-wn', rect(8, 33, 8.4, 34), 'wall', 2.2, false);
  shell('pen-fence-ws', rect(8, 36.4, 8.4, 37), 'wall', 2.2, false);
  const doorHeights = [2.6, 2.8, 2.6, 2.2];
  structures.forEach((def, i) => shell(def.tag, def.rect, 'breakable', doorHeights[i]));

  // Three roadblock sections leave 2.1 m gaps and open routes around either end.
  for (const z of [24, 27, 30]) addBlockingProp(props, colliders, 'barrier', 20, z, Math.PI / 2);
  addBlockingProp(props, colliders, 'car', 25, 38, Math.PI / 2, 1);

  // Park along the courtyard edges, preserving the entire recruitment rectangle.
  for (const z of [59, 68]) {
    for (const x of [-19, 9]) {
      addBlockingProp(props, colliders, 'car', x, z, 0, 2);
      markings.push({ kind: 'parkingBay', rect: rect(x - 1.3, z - 2.5, x + 1.3, z + 2.5), rotation: 0 });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. CHECKPOINT (NE BLOCK: compound x 62..104, z -84..-52, 42 x 32 m)
  // ---------------------------------------------------------------------------
  // Perimeter walls (thickness 1 m, height 2.4, blocksMove + blocksSight)
  // South wall at z -53..-52 split around gate at x 79.5..86.5 (7 m wide centered at x = 83)
  const gateRect: AABB = rect(79.5, -53, 86.5, -52);
  colliders.push(
    // North perimeter wall
    { minX: 62, minZ: -84, maxX: 104, maxZ: -83, kind: 'wall', height: 2.4, blocksMove: true, blocksSight: true, tag: 'cp-wall-n' },
    // West perimeter wall
    { minX: 62, minZ: -84, maxX: 63, maxZ: -52, kind: 'wall', height: 2.4, blocksMove: true, blocksSight: true, tag: 'cp-wall-w' },
    // East perimeter wall
    { minX: 103, minZ: -84, maxX: 104, maxZ: -52, kind: 'wall', height: 2.4, blocksMove: true, blocksSight: true, tag: 'cp-wall-e' },
    // South-West perimeter wall segment
    { minX: 62, minZ: -53, maxX: 79.5, maxZ: -52, kind: 'wall', height: 2.4, blocksMove: true, blocksSight: true, tag: 'cp-wall-sw' },
    // South-East perimeter wall segment
    { minX: 86.5, minZ: -53, maxX: 104, maxZ: -52, kind: 'wall', height: 2.4, blocksMove: true, blocksSight: true, tag: 'cp-wall-se' },
    // The ONE Gate
    {
      minX: gateRect.minX,
      minZ: gateRect.minZ,
      maxX: gateRect.maxX,
      maxZ: gateRect.maxZ,
      kind: 'gate',
      tag: 'gate',
      height: 3,
      blocksMove: true,
      blocksSight: true,
    },
  );

  // Two guard towers inside the compound's front (south) corners
  const towerWRect: AABB = rect(64, -57, 67, -54);
  const towerERect: AABB = rect(99, -57, 102, -54);
  colliders.push(
    {
      minX: towerWRect.minX,
      minZ: towerWRect.minZ,
      maxX: towerWRect.maxX,
      maxZ: towerWRect.maxZ,
      kind: 'tower',
      tag: 'towerW',
      height: 6,
      blocksMove: true,
      blocksSight: false,
    },
    {
      minX: towerERect.minX,
      minZ: towerERect.minZ,
      maxX: towerERect.maxX,
      maxZ: towerERect.maxZ,
      kind: 'tower',
      tag: 'towerE',
      height: 6,
      blocksMove: true,
      blocksSight: false,
    },
  );

  // Compound interior structures (containers/tents of height 2.8 + low sandbag walls of height 1.1)
  addBuilding(buildings, colliders, props, 66, -80, 76, -73, 2.8, 'garage', 2, 'cp-tent-w', false);
  addBuilding(buildings, colliders, props, 90, -80, 100, -73, 2.8, 'garage', 3, 'cp-tent-e', false);
  addBlockingProp(props, colliders, 'sandbags', 73, -64, 0, 0);
  addBlockingProp(props, colliders, 'sandbags', 93, -64, 0, 1);

  // Forecourt barriers (leaving a clear lane >= 9 m wide in front of gate x = 83)
  addBlockingProp(props, colliders, 'barrier', 66.5, -44, 0, 0);
  addBlockingProp(props, colliders, 'barrier', 99.5, -44, 0, 1);

  // Checkpoint floodlights and warning signs
  addNonBlockingProp(props, 'floodlight', 78, -51.5, 0, 0);
  addNonBlockingProp(props, 'floodlight', 88, -51.5, 0, 0);
  addNonBlockingProp(props, 'floodlight', 64.5, -82, 0.5, 0);
  addNonBlockingProp(props, 'floodlight', 101.5, -82, -0.5, 0);
  addNonBlockingProp(props, 'warningSign', 77, -42, 0, 0);
  addNonBlockingProp(props, 'warningSign', 89, -42, 0, 1);

  // Gate approach points (7 outside at z = -50.5, 7 inside at z = -54.5)
  const gateApproachOutside: Vec2[] = [];
  const gateApproachInside: Vec2[] = [];
  for (let x = 80; x <= 86; x += 1) {
    gateApproachOutside.push({ x, z: -50.5 });
    gateApproachInside.push({ x, z: -54.5 });
  }

  const checkpoint: CheckpointLayout = {
    bounds: compoundBounds,
    gate: { rect: gateRect, facing: 0, tag: 'gate' },
    gateApproachOutside,
    gateApproachInside,
    towers: [
      { id: 'W', rect: towerWRect, platformHeight: 4 },
      { id: 'E', rect: towerERect, platformHeight: 4 },
    ],
    stagingArea,
  };

  // ---------------------------------------------------------------------------
  // 5. VEHICLES, DUMPSTERS & STREET PROPS
  // ---------------------------------------------------------------------------
  // ~20 parked cars along streets and lot edges (carefully clear of spawn zones & waypoints)
  const parkedCars: [number, number, number, number][] = [
    [-108, -23.5, Math.PI / 2, 0],
    [-86, -23.5, Math.PI / 2, 1],
    [-64, -23.5, Math.PI / 2, 2],
    [-28, -23.5, Math.PI / 2, 3],
    [-12, -23.5, Math.PI / 2, 4],
    [8, -23.5, Math.PI / 2, 5],
    [18, -23.5, Math.PI / 2, 0],
    [-26, 24.5, Math.PI / 2, 1],
    [-8, 24.5, Math.PI / 2, 2],
    [12, 24.5, Math.PI / 2, 3],
    [-92, 24.5, Math.PI / 2, 4],
    [-68, 24.5, Math.PI / 2, 5],
    [60, 24.5, Math.PI / 2, 0],
    [88, 24.5, Math.PI / 2, 1],
    [-50.5, -75, 0, 2],
    [-50.5, -10, 0, 3],
    [-50.5, 58, 0, 4],
    [29.5, 10, 0, 5],
    // Parked cars at edges of the east-center staging lot (x 48..80, z -19..-5)
    [77.5, -16, 0, 2],
    [77.5, -8, 0, 4],
    // Angled car near the broken intersection (x = 35, z = -30)
    [48, -26, 0.45, 1],
  ];
  for (const [cx, cz, rot, variant] of parkedCars) {
    addBlockingProp(props, colliders, 'car', cx, cz, rot, variant);
  }

  // 3 abandoned trucks (some angled on/near the broken intersection x = 35, z = -30)
  addBlockingProp(props, colliders, 'truck', 32, -33, 0.55, 0);
  addBlockingProp(props, colliders, 'truck', 41, -25, -0.4, 1);
  addBlockingProp(props, colliders, 'truck', -75, -36, Math.PI / 2, 2);

  // Dumpsters in the north service alley (leaving >= 3.5 m clear width and clear of 'alley' spawn zone)
  addBlockingProp(props, colliders, 'dumpster', -31, -61.8, 0, 0);
  addBlockingProp(props, colliders, 'dumpster', -26, -61.8, 0, 1);
  addBlockingProp(props, colliders, 'dumpster', 15, -61.8, 0, 0);
  addBlockingProp(props, colliders, 'dumpster', 21, -61.8, 0, 1);

  // Additional street barriers
  addBlockingProp(props, colliders, 'barrier', 26, -36, 0.3, 0);
  addBlockingProp(props, colliders, 'barrier', 44, -36, -0.3, 1);

  // Non-blocking park trees, bushes, benches in SW block (x -120..-55, z 40..90)
  const parkTrees: [number, number, number][] = [
    [-112, 62, 0],
    [-106, 68, 1],
    [-100, 46, 2],
    [-92, 45, 0],
    [-82, 46, 1],
    [-95, 76, 2],
    [-76, 82, 0],
    [-64, 78, 1],
    [-60, 66, 2],
    [-108, 84, 0],
    [-70, 72, 1],
    [-88, 50, 2],
  ];
  for (const [tx, tz, v] of parkTrees) {
    addNonBlockingProp(props, 'tree', tx, tz, v * 1.1, v);
  }

  const parkBushes: [number, number][] = [
    [-104, 60],
    [-96, 50],
    [-78, 76],
    [-66, 74],
    [-62, 60],
    [-90, 78],
  ];
  for (const [bx, bz] of parkBushes) {
    addNonBlockingProp(props, 'bush', bx, bz, 0, 0);
  }

  const benches: [number, number, number][] = [
    [-92, 56, 0],
    [-78, 56, 0],
    [-92, 70, Math.PI],
    [-78, 70, Math.PI],
    [-74, 62, -Math.PI / 2],
  ];
  for (const [bx, bz, rot] of benches) {
    addNonBlockingProp(props, 'bench', bx, bz, rot, 0);
  }

  // Streetlights every ~20 m along sidewalks
  for (let x = -110; x <= 110; x += 22) {
    addNonBlockingProp(props, 'streetlight', x, -39.5, 0, 0);
    addNonBlockingProp(props, 'streetlight', x, -20.5, Math.PI, 0);
    addNonBlockingProp(props, 'streetlight', x, 21.5, 0, 0);
    addNonBlockingProp(props, 'streetlight', x, 38.5, Math.PI, 0);
  }
  for (let z = -80; z <= 80; z += 22) {
    addNonBlockingProp(props, 'streetlight', -53.5, z, Math.PI / 2, 0);
    addNonBlockingProp(props, 'streetlight', 43.5, z, -Math.PI / 2, 0);
  }

  // Traffic lights at all 4 intersections
  for (const inter of intersections) {
    addNonBlockingProp(props, 'trafficLight', inter.x - inter.halfW - 1.5, inter.z - inter.halfD - 1.5, 0, 0);
    addNonBlockingProp(props, 'trafficLight', inter.x + inter.halfW + 1.5, inter.z - inter.halfD - 1.5, Math.PI / 2, 0);
    addNonBlockingProp(props, 'trafficLight', inter.x + inter.halfW + 1.5, inter.z + inter.halfD + 1.5, Math.PI, 0);
    addNonBlockingProp(props, 'trafficLight', inter.x - inter.halfW - 1.5, inter.z + inter.halfD + 1.5, -Math.PI / 2, 0);
  }

  // Hydrants, trash cans, signs, utility poles, debris
  const streetFurniture: [PropDef['kind'], number, number, number][] = [
    ['hydrant', -36, -18.5, 0],
    ['hydrant', 24, -18.5, 0],
    ['hydrant', -36, 19.5, 0],
    ['hydrant', 46, -18.5, 0],
    ['trashCan', -25, -18.5, 0],
    ['trashCan', 5, -18.5, 0],
    ['trashCan', -15, 19.5, 0],
    ['trashCan', -80, 54, 0],
    ['sign', -54, -18.5, 0],
    ['sign', 26, -18.5, 0],
    ['sign', 46, -39.5, 0],
    ['utilityPole', -36.5, -70, 0],
    ['utilityPole', -36.5, -45, 0],
    ['utilityPole', 26.5, -70, 0],
    ['utilityPole', 26.5, -45, 0],
    ['debris', 36, -29, 0.2],
    ['debris', 33, -26, 1.1],
    ['debris', 76, -46, 0.7],
    ['debris', -12, -60, 0.4],
  ];
  for (const [kind, px, pz, rot] of streetFurniture) {
    addNonBlockingProp(props, kind, px, pz, rot, 0);
  }

  // ---------------------------------------------------------------------------
  // 6. PLAYER START, CLUSTERED AMBIENT SPAWNS (85), AND HUMANS
  // ---------------------------------------------------------------------------
  const playerStart: Vec2 = { x: -85, z: 62 };
  const playerStartFacing = Math.atan2(-65.75 - playerStart.x, 32.8 - playerStart.z);
  const startFollowerArea = rect(-90, 57, -80, 67);

  const spawnZones: SpawnZone[] = [
    { name: 'park-edge', rect: rect(-75, 42, -58, 54), count: 6 },
    // A 0.65 m inset retains the existing >= 0.6 m spawn clearance guarantee.
    { name: 'bus', rect: rect(-70.95, 30.05, -61.05, 31.95), count: 15, heldBy: 1 },
    { name: 'parking-lot', rect: rect(-16, 56, 6, 72), count: 12 },
    { name: 'police-pen', rect: rect(9.05, 34.05, 14.95, 35.95), count: 10, heldBy: 4 },
    { name: 'alley', rect: rect(69.05, 1.25, 70.95, 16.55), count: 20, heldBy: 2 },
    { name: 'commercial', rect: rect(-16, -6, 6, 6), count: 8 },
    { name: 'residential-west', rect: rect(-96, -8, -78, 8), count: 6 },
    { name: 'east-lot', rect: rect(52, -16, 72, -8), count: 8 },
  ];

  const guards: GuardSpawn[] = [
    // 2 Tower occupants ('W' and 'E')
    {
      pos: { x: 65.5, z: -55.5 },
      facing: 0,
      tower: 'W',
      waypoints: [{ x: 65.5, z: -55.5 }],
    },
    {
      pos: { x: 100.5, z: -55.5 },
      facing: 0,
      tower: 'E',
      waypoints: [{ x: 100.5, z: -55.5 }],
    },
    // 3 Inside compound patrol guards
    {
      pos: { x: 83, z: -59 },
      facing: 0,
      tower: null,
      waypoints: [
        { x: 79, z: -59 },
        { x: 87, z: -59 },
        { x: 87, z: -70 },
        { x: 79, z: -70 },
      ],
    },
    {
      pos: { x: 67, z: -61 },
      facing: 0,
      tower: null,
      waypoints: [
        { x: 67, z: -61 },
        { x: 67, z: -70 },
      ],
    },
    {
      pos: { x: 99, z: -61 },
      facing: 0,
      tower: null,
      waypoints: [
        { x: 99, z: -61 },
        { x: 99, z: -70 },
      ],
    },
    // 3 Outside forecourt/avenue patrol guards within ~25 m of gate (x 65..105, z -50..-40)
    {
      pos: { x: 74, z: -47 },
      facing: 0,
      tower: null,
      waypoints: [
        { x: 71, z: -47 },
        { x: 77, z: -47 },
        { x: 77, z: -42 },
        { x: 71, z: -42 },
      ],
    },
    {
      pos: { x: 83, z: -45 },
      facing: 0,
      tower: null,
      waypoints: [
        { x: 80, z: -45 },
        { x: 86, z: -45 },
      ],
    },
    {
      pos: { x: 92, z: -47 },
      facing: 0,
      tower: null,
      waypoints: [
        { x: 89, z: -47 },
        { x: 95, z: -47 },
        { x: 95, z: -42 },
        { x: 89, z: -42 },
      ],
    },
  ];

  for (const guard of guards) {
    guard.role = 'soldier';
    guard.post = 'checkpoint';
  }
  const streetHome = rect(-82, 41, -56, 58);
  for (const waypoints of [
    [{ x: -74, z: 47 }, { x: -64, z: 49 }],
    [{ x: -70, z: 52 }, { x: -62, z: 44 }],
  ]) {
    guards.push({ role: 'civilian', post: 'street', homeArea: streetHome,
      pos: { ...waypoints[0] }, facing: Math.PI, tower: null, waypoints });
  }
  for (const z of [27, 33]) {
    const pos = { x: 23, z };
    guards.push({ role: 'soldier', post: 'barricade', pos, facing: -Math.PI / 2, tower: null, waypoints: [{ ...pos }] });
  }
  for (const pos of [{ x: 50, z: 45 }, { x: 54.5, z: 45 }, { x: 50, z: 49 }, { x: 54.5, z: 49 }]) {
    guards.push({ role: 'civilian', post: 'store', shelter: 3, homeArea: structures[2].enclosure,
      pos, facing: Math.PI, tower: null, waypoints: [{ ...pos }] });
  }

  return {
    bounds,
    ground,
    markings,
    buildings,
    props,
    colliders,
    playerStart,
    playerStartFacing,
    spawnZones,
    checkpoint,
    guards,
    structures,
    startFollowerArea,
    districts: [{
      id: 'suburbs', name: 'Legacy District', rect: { ...bounds }, strongholdId: null,
      civilianBudget: 0, ambientBudget: 0, landmark: 'Recruitment-milestone test district',
      spawnPoints: spawnZones.filter(z => !z.heldBy).slice(0, 4).map(z => ({ x: (z.rect.minX + z.rect.maxX) / 2, z: (z.rect.minZ + z.rect.maxZ) / 2 })),
    }],
    strongholds: [],
    nests: [{ id: 'start', districtId: 'suburbs', pos: { ...playerStart }, strongholdId: null }],
  };
}
