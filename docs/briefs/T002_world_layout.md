# T002 — Open-world layout (codex)

Read first: `AGENTS.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md`, `docs/3_open_world.md` §0, §4A, §7, §8,
`src/core/types.ts` (DistrictLayout, DistrictDef, StrongholdDef, ObjectiveDef, NestDef, GuardSpawn, StructureDef),
`src/content/{strongholds,districts}.ts`, `src/config/balance.ts` (`openWorld`, `chunks`, `structures`),
and `src/world/legacyDistrictLayout.ts` (the style to follow and the checkpoint/landmark geometry to reuse).

## Locked files (create/edit only these)
`src/world/districtLayout.ts`, `src/world/layout/**` (new), `src/world/worldQueries.ts` (new), `tests/world.test.ts` (new).
Do **not** edit `tests/layout.test.ts` (it covers the legacy layout) or any other file. Contract changes → stop and report.

## Deliver
1. `buildDistrictLayout(seed = BALANCE.sim.seed): DistrictLayout` — the whole world, deterministic (same seed ⇒ deep-equal result;
   use `mulberry32(seed)` only for procedural fill such as house variation, props, parked cars). Bounds = `BALANCE.openWorld`.
   Split into `src/world/layout/{common,roads,suburbs,police,shopping,industrial}.ts`; `districtLayout.ts` composes them.
2. Districts tile the bounds exactly: suburbs x[-200,0] z[0,160] (SW), police x[-200,0] z[-160,0] (NW), shopping x[0,200] z[0,160] (SE),
   industrial x[0,200] z[-160,0] (NE). North = −Z. `DistrictDef` per `src/content/districts.ts` (name, landmark, strongholdId), with
   `civilianBudget` (suburbs 16, police 10, shopping 22, industrial 8), `ambientBudget` (suburbs 30, police 18, shopping 26, industrial 22) and
   ≥ 4 walkable `spawnPoints` each.
3. Roads: 14 m boulevards along x = 0 and z = 0 with 3 m sidewalks, plus ≥ 2 local streets per district; ≥ 3 walkable crossings on each
   shared district edge; no blocking colliders across streets. Everything walkable must be connected (no islands except enclosures sealed
   by a structure). Markings like the legacy layout (lane dashes, crosswalks at intersections) but keep counts sane.
4. District character (BuildingStyle `house`/`garage` low 4–7 m in suburbs with yards, trees, fences, a park; `civic`/`office` in police;
   one large `mall` (≈ 70 × 40 m, ~10 m) + `storefront`s and a big parking lot with cars in shopping; `warehouse`s + loading yards, trucks,
   containers (use `truck`/`dumpster`/`barrier`/`fence` props) in industrial). Collider total ≤ 1500; buildings ≤ 260.
5. Strongholds — exactly the four in `src/content/strongholds.ts`, same id/district/name/tier/unlock/biomass/objective ids+kinds+labels, plus
   geometry (`bounds`, `center`, `nestId`, ≥ 2 `reinforcementPoints` outside bounds on walkable street, out of direct line to the start):
   - `suburb_checkpoint` (suburbs, ~60–80 m from start): the legacy police barricade + pen (`penGate` structure, held zombies inside, 3 police
     defenders `role:'police', post:'stronghold', strongholdId`). Objectives: `break_pen` (destroyStructure → the pen gate id), `defenders` (killDefenders).
   - `police_station` (police district, near the suburbs edge): walled compound (`wall` colliders 2.4 m) around a `civic` building with a
     courtyard; `stationDoor` structure (kind `stationDoor`, landmark `station`) in the compound wall; `holdPoint` objective `disable_command`
     inside the courtyard (radius 6, holdTime 6, minZombies 6, requires `['breach']`). 8 police defenders (patrol loops + 2 at the door).
   - `mall_security` (shopping): `securityShutter` structure (landmark `mall`) sealing a walled security office yard on the mall's side;
     holdPoint `take_control` inside (radius 5, holdTime 5, minZombies 5, requires `['disable_security']`). 5 police defenders + mall civilians.
   - `industrial_yard` (industrial, NE corner): reuse the legacy checkpoint compound (gate tag `'gate'`, towers W/E, `layout.checkpoint` points
     at it). Objectives `break_gate` (destroyGate), `take_control` holdPoint inside the compound (radius 7, holdTime 6, minZombies 8,
     requires `['break_gate']`). 8 `soldier` defenders, 2 in towers.
   - Each objective `structureId` must reference an existing `StructureDef`; structure tags/colliders follow the legacy rules (kind
     `'breakable'`, blocksMove + blocksSight, exact footprint; `approachOutside` ≥ 3, `approachInside` ≥ 2, `enclosure`).
6. Recruitment landmarks reused near the start: bus (busDoor) and locked alley (alleyGate) in suburbs within ~50 m of the start; convenience
   store (storeDoor, sheltered civilians) in shopping. Structure ids unique ≥ 1.
7. Nests: `nest_start` (strongholdId null) next to `playerStart` (≈ −150, 115, in suburbs, facing toward the checkpoint), and one nest per
   stronghold (`nest_<strongholdId>`, just outside its bounds, walkable). Each stronghold's `nestId` = its nest.
8. Spawn: `startFollowerArea` around the start; ambient `spawnZones` distributed per district (sum of free zones ≈ ambient budgets; held zones
   inside bus/alley/pen). Humans in `guards`: stronghold defenders above + civilians (`post:'street'`, `homeArea` = a generous street area in
   their district, waypoints) per civilian budget + 2 police patrols (`post:'patrol'`) per non-suburb district. First civilians within 40 m of
   the start. Total humans ≤ `BALANCE.population.maxHumans`.
9. `src/world/worldQueries.ts` [pure]: `getDistrictAt(layout, p): DistrictId` (clamps outside bounds), `strongholdAt(layout, p)`,
   `chunkCols/chunkRows(layout)`, `chunkIdAt(layout, p)`, `chunkRect(layout, id, out?)`, `chunksInRadius(layout, p, r, out)`, and
   `class ChunkStreamer { constructor(layout); readonly loaded: ReadonlySet<number>; update(p: Vec2): { load: number[]; unload: number[] } }`
   using `BALANCE.chunks` (load within loadRadius, unload beyond unloadRadius). Chunk size 80 ⇒ 5 × 4 chunks.
10. `tests/world.test.ts`: districts tile bounds (no gap/overlap, getDistrictAt agrees); determinism; strongholds match content meta; every
    objective/structure/nest reference resolves; all spawn points, nests, guard spawns, playerStart walkable (`CollisionWorld.isBlocked` false);
    a `NavigationGrid` path exists from `playerStart` to every stronghold's `approachOutside`/gate approach and every nest; ≥ 3 crossings per
    shared edge (path between both sides near each crossing); first civilians near start; `new Simulation(buildDistrictLayout())` constructs and
    runs 120 steps without throwing; ChunkStreamer loaded-count stays ≤ 12 while walking a loop through all districts.

## Done when
`npx tsc --noEmit` and `npm test` pass (all existing tests untouched and green). Write `.agent-context/reports/T002-codex.md`
(format in AGENTS.md) and append gotchas to `.agent-context/MEMORY.md`.
