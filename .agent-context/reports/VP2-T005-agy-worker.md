# VP2-T005 Report

- **Task ID & Agent:** VP2-T005, agy-worker (Gemini 4 Hydrogen, dispatched headless via `agy --model "gemini-4-hydrogen" -p`; wrapper verified and re-ran the checks)
- **Status:** COMPLETED

## Completed Work
- `src/graphics/environment/StreetFurnitureFactory.ts` (new, [3D], three only): `furnitureGeometry(kind, variant, lod)` cached through `GeometryCache` (shared instance), `furnitureFootprint(kind)`, `disposeFurnitureCaches()`, exhaustive `never` switch over all 32 `FurnitureKind`s. Flat kinds keep every vertex y in [0, 0.15]. Curb is a 1 m bevelled segment along X with top at `SIDEWALK_TOP`.
- `src/graphics/environment/VegetationFactory.ts` (new, [3D], three only): `plantGeometry(kind, variant, lod)` returns `{ wood, foliage }` (cached, shared), `plantFootprint(kind)`, `disposeVegetationCaches()`, exhaustive switch over all 12 `PlantKind`s. Palms have curved, ringed trunks and arched, notched fronds. `wood` is null for shrubs, bushes, grass, flowers, hedge and vine.
- `tests/environmentAssets.test.ts` (new, Node-runnable): 7 tests (all kinds at LOD 0/1 × variants 0–2; attributes and finiteness; triangle budgets; flat-kind height and curb top; cache identity; deterministic hash across dispose and rebuild; footprints; variant distinctness).
- Every item uses the exact attribute set `position, normal, color, uv, aSurface` (via `mergeTagged`), metric UVs, and `mulberry32` seeded from kind + variant. No `Math.random`.
- agy's first run left two LOD1 budget misses (`bikeRack` 84 and `flowersTropical` 84 against the 80 cap). agy fixed both before finishing. My re-run confirms them at 36 and 42.

## Triangle counts (variant 0, LOD0 / LOD1)
Furniture (budget 300 / 80):
streetlight 172/54, busStop 176/72, bench 196/48, trashCan 172/48, mailbox 120/48, newsStand 124/36, bikeRack 184/36, hydrant 260/72, bollard 140/48, planter 212/72, roadSign 80/24, utilityBox 104/24, patioTable 200/54, patioUmbrella 52/18, dumpster 180/36, trashBags 216/72, crates 124/24, shoppingCart 204/60, parkedBike 220/48, constructionBarrier 172/48, fenceSection 192/72, gasPump 174/48, basketballHoop 188/48, trafficCone 144/36, manhole 180/36, stormDrain 96/36, roadPatch 16/12, curb 44/12, curbRamp 36/12, driveway 44/12, medianHatch 48/36, trafficIsland 156/72.

Plants, wood + foliage combined (palm and tree budget 900 / 200; other plants 300 / 80):
palmCoconut 396/90, palmRoyal 252/110, palmFan 196/80, palmCluster 360/168, ornamentalTree 368/100, shrubFlowering 188/48, bushRound 128/20, grassClump 80/20, flowersTropical 140/42, hedge 44/12, planterBox 164/64, vine 48/20.

## Public Interfaces/Exports Added
- `src/graphics/environment/StreetFurnitureFactory.ts`: `SIDEWALK_TOP` (0.15), `furnitureGeometry(kind: FurnitureKind, variant: number, lod: 0 | 1): THREE.BufferGeometry` (shared, do not dispose), `furnitureFootprint(kind): { w; d; h }`, `disposeFurnitureCaches(): void`.
- `src/graphics/environment/VegetationFactory.ts`: `PlantGeometrySet` interface, `plantGeometry(kind: PlantKind, variant: number, lod: 0 | 1): { wood: THREE.BufferGeometry | null; foliage: THREE.BufferGeometry }` (shared, do not dispose), `plantFootprint(kind): { w; d; h }`, `disposeVegetationCaches(): void`.

## Verification Run
- `npx tsc --noEmit`: PASS (0 errors), re-run after the agy edits settled.
- `npx vitest run tests/environmentAssets.test.ts`: PASS, 7/7.
- `npx vitest run` (full suite): PASS, 82 files / 958 tests. No failures, including from the concurrent session.

## Remaining Work
- Nothing is wired into a renderer. T010 (CityDistrict) must consume these: `plantGeometry` foliage gets `applyFoliageWind` on its own material (wood on a trunk material), and `furnitureGeometry` / `plantGeometry` are instanced or merged per chunk and LOD.
- Height mismatch to resolve in T010 or T014: CityDistrict sidewalk paving top is 0.155 m (`makeColoredBox(..., 0.145, ..., 0.02)` in `world/CityDistrict.ts`), while `SIDEWALK_TOP` is clamped to 0.15 by the flat-kind cap. `groundLevels.ts` has no sidewalk constant (it is not in this task's locked files). Either the paving or the curb should move, and `SIDEWALK_TOP` should move to `groundLevels.ts`.

## Memory Notes
- The factories are the sole geometry source for their kinds: the `never` switches catch any new `FurnitureKind` or `PlantKind` at compile time.
- Furniture variants wrap with `((variant % 3) + 3) % 3`, so any integer is safe.
- `furnitureFootprint` and `plantFootprint` describe LOD0 variant 0 extents.
- The agy wrapper ran headless with `</dev/null` and waited on the background process. Its output lands only at exit, and its file edits continued after the first summary-looking output.
