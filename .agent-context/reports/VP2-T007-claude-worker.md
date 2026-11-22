# VP2-T007 — environmentPopulation (pure placement)

- **Task ID & Agent:** VP2-T007, claude-worker (failover from codex, QUOTA_EXHAUSTED at startup; codex wrote nothing)
- **Status:** COMPLETED

## Completed Work

- `src/graphics/world/environmentPopulation.ts` (NEW, [pure]): `populateChunk(layout, chunkId)`, `populationStats`, plus
  exported tables (`LOW_KINDS`, `WALL_MOUNTED_KINDS`, `dressingHalfExtents`, constants).
  - Per-layout index in a `WeakMap<DistrictLayout, Index>` (grids over colliders, roads, sidewalks, ground, interiors, buildings,
    spawn zones, guard points, props, traffic lanes (`buildTrafficNetwork`), junctions, crosswalks). Built lazily on the first call.
  - Chunk-independent "fixed" items built once per layout and bucketed by chunk: curbs (<= 3 m pieces along every road-adjacent
    sidewalk edge, gaps where crossing roads cut the curb line / at driveways / at crosswalk ends), curb ramps (crosswalk ends that
    reach a sidewalk), driveway aprons (buildings facing a curb <= 12 m away; chance by building class).
  - Per chunk: manholes on lane centre lines (44 m lattice), road patches, storm drains at curbs, median hatching on roads >= 12 m
    (cut at junctions/crosswalks), traffic islands at wide junction corners; sidewalk strip streetlight rhythm (skips layout
    streetlights within 6 m), palms from `DISTRICT_STYLES[d].palms` (every 2nd tier 0), furniture from `style.furniture`
    (weights; storefront/building proximity raises odds; bollard triples); building edges: vines (wall-mounted, centre <= 0.8 m
    outside), house hedges/flowering shrubs, planter boxes beside doors, parked bikes, back-of-house clutter (`style.clutter`, only
    with >= 1.7 m unpaved space behind), restaurant patios (archetype data only; tables+umbrellas in `lot`, or tables hugging the
    wall), front-yard grass/flowers; parks/plazas/lots/yards: trees + palms, bushes, flower beds, grass; basketball hoops at both
    ends of `court` patches.
  - Frontage: `BuildingDef.frontage` when set, else the nearest curb side the building faces, else the nearest road.
  - Determinism: all random draws are `mulberry32(fnv(SEED, chunkId, category))` consumed in index order; lattice phases use an
    FNV hash of (side/lane id, tag). No `Math.random`. Result independent of call order / chunk reloads / fresh layout object.
  - Caps: <= 900 per chunk (tier 2 dropped first, hashed order); every kind present keeps at least one tier-0 item (promoted).
- `tests/environmentPopulation.test.ts` (NEW, 12 tests, all 99 chunks, yields every 6 chunks, 60 s timeout): determinism (twice,
  fresh layout, order), in-chunk/playArea/<=900/sorted, no collider intersection, tall-item zones, road items FLAT only + no
  non-flat on lanes, district palms, curbs per sidewalk chunk, START_BEACH/start line/nest circle/guard clearance, tier-0
  completeness, stats consistency, synthetic restaurant patio + court hoops (layout clone).

## Remaining Work

None for the brief. Notes for downstream: curb ramps are sparse (16 world-wide) because only 40 of 199 crosswalk markings reach a
sidewalk in the current layout; the VP2 layout passes (archetype/frontage/lot/court) are not yet in the base world, so patios/hoops
are exercised only by the synthetic test. Richer density can be tuned in the lattice spacings/probabilities without contract changes.

## Public Interfaces/Exports Added

`DressingInstance`, `PopulationStats`, `populateChunk`, `populationStats`, `dressingHalfExtents`, `LOW_KINDS`, `WALL_MOUNTED_KINDS`,
`MAX_ITEMS_PER_CHUNK` (900), `STRIP_DEPTH` (1.2), `WALL_BAND` (0.8), `SPAWN_CLEARANCE` (1.5), `GUARD_CLEARANCE` (1.2),
`START_LINE_CLEARANCE` (2), `LANE_CLEARANCE` (1.6).

## Verification Run

- `npx tsc --noEmit`: PASS (clean).
- `npx vitest run tests/environmentPopulation.test.ts`: 12/12 PASS (no skips). `tests/world.test.ts` + `tests/intro.test.ts`: PASS (38 tests total with the new file).
- Timing, default world (99 chunks): first call (includes building the per-layout index) 60-134 ms; per chunk min/median/max
  0.14 / 1.48 / ~1.6 ms once warm (the max in the run is the cold first call); warm pass over all 99 chunks 83 ms total.
- Items: 12 978 total, densest chunk 289 (id 14); tiers [0,1,2] = [8756, 2343, 1879].
- Per kind (world): curb 6452, grassClump 1355, vine 578, stormDrain 615, flowersTropical 461, streetlight 442, manhole 406,
  palmRoyal 356, palmCoconut 276, shrubFlowering 247, bushRound 215, bollard 197, palmFan 191, planterBox 151, palmCluster 135,
  roadPatch 113, ornamentalTree 100, medianHatch 89, crates 73, driveway 70, hedge 68, planter 48, bench 43, trashBags 41,
  trashCan 38, patioTable 27, utilityBox 26, roadSign 24, newsStand 20, dumpster 19, constructionBarrier 18, bikeRack 17,
  curbRamp 16, mailbox 13, trafficCone 10, parkedBike 9, fenceSection 7, shoppingCart 6, trafficIsland 4, hydrant 2.
- Full `npx vitest run`: 84/85 files, 989/994 tests PASS. The 5 failures are all in `tests/shielding.test.ts` (physical horde shielding), a file and system this task did not touch (another session's work); not fixed here.

## Memory Notes

- Radius table `DIMS` (local half extents X along width / Z depth, scaled; flat kinds use `sx/2`, `sz/2`); `dressingHalfExtents`
  applies rotation: local X maps to world (cos a, -sin a). Wall-parallel items use `rotY = atan2(nx, nz)` of the wall normal.
- Low kinds (<= 0.5 m, free of the tall-zone rule): all FLAT_KINDS + grassClump, flowersTropical, trashBags. Wall-mounted: vine only.
- Tall zones: strip = inside a sidewalk rect and 0 < road distance <= 1.2; band = distance to a building footprint <= 0.8; interior =
  inside park/plaza/court/lot/building.lot, >= 1.5 m from spawn rects, >= claimRadius + 1.5 from nests.
- Non-flat items keep >= 1.6 m + radius from lane centrelines and `0.8 r` from road rects; all items keep START_BEACH (+0.5 m), the
  playerStart -> start-nest segment (2 m + radius), nest circles (claim + 1.5 m), guard waypoints (1.2 m).
- Seed constant `0x7a1c0de5`; cache = `WeakMap<DistrictLayout, Index>` (never mutated after build; clone a layout to invalidate).
- Vitest: loops with `expect()` per item x collider are too slow (RPC/timeouts); use plain checks + throw inside the loops.
