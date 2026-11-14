# T002 — Open-world layout

**Task ID & Agent:** T002 / codex

**Status:** COMPLETED

**Completed Work:**

- Replaced `src/world/districtLayout.ts` placeholder with deterministic `buildDistrictLayout(seed = BALANCE.sim.seed)`, composing `src/world/layout/{common,roads,suburbs,police,shopping,industrial}.ts`.
- Built the exact four contiguous districts, two 14 m boulevards with 3 m sidewalks, local streets in every district, lane/crosswalk/parking markings, and district scenery. Layout has 44 buildings and 116 colliders, well below the 260/1500 limits.
- Realized all four content strongholds without changing their metadata/objective identities: suburban police pen, fortified station courtyard, mall security yard and translated industrial checkpoint with the single tagged gate and two towers. Hold points include required prerequisites and specified radius/time/follower counts.
- Added six hollow, individually sealed breakable landmarks, five nests, walkable street reinforcement points screened from the start, start followers, 96 free ambient zombies plus 45 held zombies, and 86 humans (56 civilians, 24 stronghold defenders, 6 patrol police). Civilian/ambient budgets and defender roles/counts match the brief.
- Added `src/world/worldQueries.ts`: district/stronghold queries, row-major 80 m chunk queries, radius intersection and bounded load/unload streaming.
- Added twelve acceptance/regression tests in `tests/world.test.ts`, including exact tiling, determinism, content references, whole spawn-area clearance, guard waypoints, entrances/nests, twelve seam crossings, sealed-to-open navigation, all-cell flood-fill connectivity, 120 simulation steps and streaming loops/teleports.
- Appended integration notes to `.agent-context/MEMORY.md`. All writes stayed inside the assigned scope. No commits or branch changes.

**Remaining Work:**

- None within T002. Downstream rendering/integration tasks remain with their owners. In particular, T010 should render the authored hollow shells and extend tower platform decks to cover the walkable edge positions described below.

**Public Interfaces/Exports Added:**

- `buildDistrictLayout(seed?: number): DistrictLayout` now returns the complete open world; the legacy builder is unchanged.
- `getDistrictAt(layout, p): DistrictId`; `strongholdAt(layout, p): StrongholdDef | undefined`.
- `chunkCols(layout)`, `chunkRows(layout)`, `chunkIdAt(layout, p)`, `chunkRect(layout, id, out?)`, `chunksInRadius(layout, p, radius, out)`.
- `ChunkStreamer(layout)` with `readonly loaded: ReadonlySet<number>` and `update(p): { load: number[]; unload: number[] }`.
- Internal layout exports: `WorldDraft`, geometry/population authoring helpers and `buildRoads`, `buildSuburbs`, `buildPolice`, `buildShopping`, `buildIndustrial`. No shared contract changes.

**Verification Run:**

- `npx vitest run tests/world.test.ts` — PASS, 12/12 tests (standalone run before the final nest/patrol refinements).
- Final `npx tsc --noEmit` — PASS, exit 0, no diagnostics.
- Final `npm test` — PASS, 28 files / 246 tests, zero failed or skipped; duration 21.51 s. The final run includes all twelve world tests with the nest/patrol refinements.
- Checked git status to distinguish concurrent workers' changes; did not alter any of their files.

**Memory Notes:**

- Structure ids are stable: 1 bus, 2 alley, 3 convenience store, 4 suburban pen, 5 station, 6 mall security. Nests use `nest_start` and `nest_<strongholdId>`.
- District boundaries use half-open ownership internally (east/south owns seams); maximum world edges remain included. District/chunk point queries clamp outside the world. Chunk ids run NW-to-SE, row-major 0–19. Invalid chunk ids throw RangeError; chunkRect/out-array reuse is supported.
- Radius intersection alone can cover all 20 chunks near the world center with the configured 150 m load radius. To satisfy the brief's <=12 acceptance budget, streaming keeps the containing/nearest twelve candidates, retains older chunks through the 190 m hysteresis band when capacity permits, and may evict nearer than the unload radius when over budget.
- Tower ground supports retain their 3 x 3 m blocking footprints. To satisfy the explicit requirement that every human spawn passes CollisionWorld.isBlocked, tower occupants stand on inward deck edges 0.6 m beyond those supports (W x=147.6, E x=178.4, z=-115.5, elevation supplied through tower metadata). Render decks need at least 4.2 m width; legacy 3.3 m decks need adjustment by T010. This needs no contract change.
- Shell tags are unique and data-derived (`<landmark>-<id>-...`); future rendering should use StructureDef/enclosures/tagged colliders rather than old literal coordinates or tag names. The industrial checkpoint is translated (+80,-60) from legacy.
- All walkable nav cells are connected after opening entrances; initially only deliberately sealed rooms/compound interiors are excluded. Geometry is fixed for gameplay, while seeded RNG varies building heights/styles/colors and prop variants.
