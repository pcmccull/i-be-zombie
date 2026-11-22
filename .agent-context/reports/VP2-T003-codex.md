# VP2-T003 - Generator (pure)

- **Task ID & Agent:** VP2-T003, codex
- **Status:** COMPLETED

## Completed Work

- Created `src/graphics/buildings/buildingArchetypes.ts`: all 12 non-landmark rule sets, exported individually and through `BUILDING_ARCHETYPES`; nominal floor modules, allowed roofs/facades/windows/entrances, balcony ranges, signage policies, roof-kit count ranges, and contract-aligned minimum sizes.
- Created `src/graphics/buildings/buildingPlan.ts`: deterministic config selection and palette streams, local-frame dimensions/shared walls/lot margins, facade bay grids, frontage entrances, roof systems, roof kits, per-archetype architectural details, safe lot extras, and landmark delegation. Sources import no Three.js and use no `Math.random`, dependencies, or mutable generator globals.
- Created `tests/buildingPlan.test.ts`: determinism and invariants a-i for every default-world building; 50 seeds per archetype with rotated frontages, shared sides, front lots and pump blockers; weighted fallback reachability; exact four-way rotation/margin checks; landmark delegation; input immutability; palette stability; nominal-floor residuals; roof-kit counts/heights; aligned upper-floor window bays; unsafe-pump rejection.
- Added this report and appended one `[VP2-T003]` bullet to `.agent-context/MEMORY.md`.
- Kept within the assigned locks. No contract/layout/3D files were edited, and no git commands were run.

## Remaining Work

- None within VP2-T003. Final TypeScript and full-suite verification passed.
- The first full run had two out-of-scope failures in `tests/meshUtils.test.ts:267` (window glass/opaque triangles 74 > 60) and `tests/meshUtils.test.ts:492` (gas-station showcase LOD1 triangles 472 > 400). They were resolved by concurrent work in the owning files before the final run; no edits were made to those files in this task.

## Public Interfaces/Exports Added

- `configForBuilding(b: BuildingDef, index: number, style: DistrictStyle): BuildingConfig`
- `planBuilding(cfg: BuildingConfig): BuildingPlan`
- `StandardArchetype`, `RoofKitKind`, `ArchetypeRules`, `BUILDING_ARCHETYPES`, and the 12 named rule sets: `bungalow`, `artDecoHotel`, `apartment`, `convenienceStore`, `restaurant`, `office`, `warehouse`, `gasStation`, `beachShop`, `parkingGarage`, `villa`, `municipal`.
- `floorsForHeight(height: number, rules: ArchetypeRules): { floors: number; floorHeight: number }`

## Verification Run

- `npx tsc --noEmit`: PASS, exit 0 after final source/test refinements and again during the final full run. An earlier run found 10 transient errors in the concurrently edited `src/graphics/geometry/meshUtils.ts`; these disappeared without editing that file.
- `npx vitest run tests/buildingPlan.test.ts`: PASS, 22/22 tests; final focused run 2.62 s test time / 9.39 s total under concurrent load. Earlier focused run before added assertions: 0.527 s test time / 1.57 s total.
- `npx vitest run`: exit 1; 76 passed / 1 failed files, 854 passed / 2 failed tests (856 total), 359.62 s. Both failures are in the out-of-scope `tests/meshUtils.test.ts` noted above; all 21 generator tests present at that run passed.
- `npm test -- --maxWorkers=2`: PASS, exit 0; 79/79 files and 886/886 tests passed, no failed or skipped tests, 397.77 s. The npm script output shows `vitest run` without the requested worker argument. Both previously failing mesh tests passed; newly available concurrent rig/body tests also passed. All 22 final generator tests passed (1.857 s test time in this full run).

## Default-world Archetype Distribution

Default `buildDistrictLayout()` in the shared checkout, buildings assigned by centre into `layout.districts` and `DISTRICT_STYLES` (223 buildings):

| Archetype | Count |
|---|---:|
| bungalow | 21 |
| artDecoHotel | 16 |
| apartment | 18 |
| convenienceStore | 12 |
| restaurant | 20 |
| office | 38 |
| warehouse | 23 |
| gasStation | 22 |
| beachShop | 9 |
| parkingGarage | 3 |
| villa | 9 |
| municipal | 32 |

All 12 occur naturally; no supplementary fixture was needed to fill default-world reachability. The test retains unforced weighted fixtures for future base worlds that lack a compatible building.

## Memory Notes

- Canonical local frame is +Z front, +X right, +Y up. Ignore the stale `BuildingConfig.sharedWalls` field comment that calls south the back; the contract's frame block is authoritative.
- Clockwise direction order is `[south, east, north, west]`. Subtract the frontage index to convert world shared-wall directions to local directions. World frontage maps to local south; the next clockwise side maps to local east. Front/right/back/left lot margins use the same rotation; east/west frontages swap footprint width/depth.
- Archetype fit compares shorter footprint side >= minimum w, longer side >= minimum d, and collider height >= minimum h; weight filtering also respects `STYLE_ARCHETYPES`. Explicit archetype overrides win. Empty filtered weights fall back to the first fitting compatible archetype, then the first style entry, as required for undersized legacy garages.
- Derived seeds use FNV-1a over `index:minXcm:minZcm:maxXcm:maxZcm`, extents rounded to centimetres, unsigned 32-bit result. Explicit seeds (including 0) are preserved. Palette RNG uses a separate `seed ^ 0x50414c` stream, making the palette independent of archetype draw count.
- Integer nominal storeys cannot always satisfy both 2.8-3.6 m modules and a +/-0.5 m product error (e.g. a 4.6 m collider: nearest products are 3.6 and 5.6). `floorsForHeight` minimizes that unavoidable nominal error, preferring the archetype's floor count when exact modules exist. Rendered wall/floor spacing uses `height / floors`; wall tops and roof bases equal collider height exactly. No collider is stretched to match a module.
- A shared frontage cannot satisfy both the no-shared-wall-openings and mandatory-front-entrance invariants. Both config/planning reject local-front shared walls with `RangeError`; T006 must choose an unshared frontage.
- Pump islands only use caller-provided valid front blockers within 9 m; canopy components cover those rectangles, or an empty explicit front lot. No unsupported ground columns are emitted. Other front-lot extras remain within provided margins; pool/terrace flat tops stay <=0.3 m.
- Geometric invariant tests validate `ComponentInstance` rotated AABBs. Mesh construction, actual emitted mesh extents/triangle budgets, and playable-world wiring remain the separate T004/T010 responsibilities.
