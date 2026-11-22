# EW-T007 — Boundary scenery, backdrop, new props

- **Task ID & Agent:** EW-T007, agy-worker
- **Status:** COMPLETED (assigned implementation, tests, type-check, and production build pass; full `npm test` hit CPU-contention timeouts under parallel load and one pre-existing/parallel-worker failure in `tests/touristChatter.test.ts`, which was not touched per lock rules; all timed-out files passed when re-run sequentially)

## Completed Work

- `src/world/BoundaryScenery.ts` (new, `[3D]`):
  - Implemented `BoundaryScenery(scene: THREE.Scene, layout: DistrictLayout)` with `readonly root: THREE.Group`, `readonly drawCalls: number`, `update(time: number): void`, and `dispose(): void`.
  - Render-only, never pickable, never in `occluders`, `fog: true`, `castShadow = false` everywhere (`receiveShadow = true` on band meshes, `false` on backdrop meshes).
  - Band dressing derived from `layout.boundaries` (`kind`, `points`, `scenerySeed`, `colliderTags`) and matched to every `layout.colliders` entry with `kind === 'boundary'` (covering full band thickness and corner extensions, height ≈ collider height):
    - `deep_water`: concrete seawall + bollards + band water slabs.
    - `urban_fence`: chain-link panels + posts + concrete curb + scattered band barriers/debris.
    - `vehicle_blockade`: angled car/bus wrecks with seeded palette variation + jersey barriers.
    - `concrete_debris`: tilted/stacked concrete slabs + protruding steel rebar.
    - `shipping_containers`: 2-high stacked containers in EW-4 palette colours (`#e0782a`, `#2c3e66`, `#2e8b84`, `#9a4a2a`, `#e8c547`) with seeded rotation/offset.
    - `military_perimeter`: olive/concrete blast walls + quarantine yellow stripe + dark `#3a3f45` razor-wire zigzag + periodic watchtowers.
    - `mangrove_barrier`: dense mangrove cone/root clusters in `#3f6b3a`/`#2e5230` over canal water.
    - `collapsed_bridge`: tilted highway deck slabs on broken piers + jersey barriers + wrecks.
  - Backdrop dressing derived from `layout.backdrop`:
    - `ocean` and `bay`: animated wave-vertex water planes (`#2f8fa3` → `#1d5f78`) placed at `y = -0.45 / -0.46` (below `TropicalScenery` ocean/bay so there is no Z-fighting).
    - `skyline`: instanced low-detail boxes (`castShadow = false`), skipping points inside any `airfield` rect.
    - `mangroves`: instanced low-detail mangrove cones, skipping points inside any `airfield` rect.
    - `highway`: instanced elevated highway deck slabs + piers + broken spans.
    - `airfield`: flat tarmac + runway + centerline dashes (`y = -0.08`) drawn cleanly over overlapping backdrop rects + instanced hangars.
- `src/world/CityDistrict.ts` (CRLF preserved: 1960 CRLF lines, 0 LF-only):
  - Added per-chunk `InstancedMesh` rendering for all 7 new `PropKind`s (`container`, `jerseyBarrier`, `chainFence`, `watchtower`, `tent`, `palm`, `wreck`) via `addChunkInstancedProps`.
  - Added archetype building looks in `createBuildingGeometry`: glassy curtain-wall + spire for `downtown` offices, turquoise balcony/terrace accents for `resort` hotels, neon trim for `nightlife`, arched hangar roofs/stripes for `airport` warehouses, olive-drab + yellow hazard trim for `military`, and hospital white/teal for `medical` civic buildings.
  - Removed the dark surround skirt under the old world edge in `buildChunkGroundAndMarkings`.
  - Added ground base colours for all 16 `DistrictId`s and split chunk ground slabs at all district seam coordinates (`xSeamCoords`, `zSeamCoords`) so all 99 chunks (11 × 9 of 80 m) align cleanly across district borders.
- `src/world/tropicalLayout.ts` & `src/world/TropicalScenery.ts`:
  - Added `bay: AABB` to `TropicalLayout` covering the east edge (`x >= layout.bounds.maxX`, `z: minZ - 300 .. maxZ + 22`) and rendered/animated `bay` water in `TropicalScenery` alongside full-width south `beach` (`x: -480..480`) and `ocean`.
  - Doubled beach umbrella count (`18 → 36`) in `TropicalScenery.buildUmbrellas()` so umbrellas span the full south beach across `sunny_boardwalk` and `oceanfront_hotels`.
  - Kept `lanes` and `intersections` on real roads; `tests/intro.test.ts` remains 14/14 green.
- `tests/tropicalLayout.test.ts` (new): 2 tests verifying full south-edge beach/ocean, east-edge bay, and promenade palms across southern districts.

## Draw-Call Estimate (per part)

- `BoundaryScenery` (worst-case when all 8 band kinds + 6 backdrop kinds are present): **18 draw calls total** (budget ≤ 30):
  - Band `InstancedMesh`es (up to 11): `BandSeawalls` (1), `BandWater` (1), `BandFences` (1), `BandWrecks` (1), `BandDebris` (1), `BandContainers` (1), `BandMilWalls` (1), `BandWatchtowers` (1), `BandMangroves` (1), `BandBridgeSlabs` (1), `BandJerseyBarriers` (1).
  - Backdrop meshes (up to 7): `BackdropOcean` (1), `BackdropBay` (1), `BackdropGround` (1), `BackdropSkyline` (1), `BackdropMangroves` (1), `BackdropHighway` (1), `BackdropHangars` (1).
- `CityDistrict`: +1 draw call per active new `PropKind` present in a loaded chunk (only created when count > 0).
- `TropicalScenery`: +1 draw call (`Bay` mesh).

## Remaining Work

- None in EW-T007 scope. EW-T010 wires `BoundaryScenery` into `Game.ts`.

## Public Interfaces/Exports Added

For EW-T010 wiring in `src/core/Game.ts`:

```ts
// src/world/BoundaryScenery.ts
export class BoundaryScenery {
  readonly root: THREE.Group;
  readonly drawCalls: number;
  constructor(scene: THREE.Scene, layout: DistrictLayout);
  update(time: number): void;
  dispose(): void;
}
```

- `src/world/tropicalLayout.ts`: `TropicalLayout` gained `bay: AABB`.

## Verification Run

- `npx tsc --noEmit`: **PASS** (exit 0).
- `npx vitest run tests/intro.test.ts tests/tropicalLayout.test.ts`: **PASS** (2 files, 16/16 tests).
- `npm run build` (`tsc --noEmit && vite build`): **PASS** (exit 0, 96 modules transformed).
- `npm test` (full suite under concurrent machine load): **FAIL** (41/53 files passed, 562/576 tests passed; 13 failures were CPU-starvation 5 s timeouts / perf-budget flakes + 1 `Timeout calling "onTaskUpdate"` RPC error; 1 failure was `tests/touristChatter.test.ts` `TypeError: rand is not a function` in `src/audio/touristChatter.ts` — parallel worker EW-T009 file, not touched).
- Sequential re-run of all 10 timed-out/flaked test files (`--maxWorkers=1`):
  - `tests/navScale.test.ts`, `tests/opening.test.ts`, `tests/recruitment.test.ts`, `tests/rush.test.ts`, `tests/structures.test.ts`: **PASS** (5 files, 29/29 tests).
  - `tests/ai.test.ts`, `tests/capacity.test.ts`, `tests/combat.test.ts`, `tests/followup.test.ts`, `tests/horde.test.ts`: **PASS** (5 files, 65/65 tests).
- `CityDistrict.ts` line-ending check: `LF only count: 0 CRLF count: 1960`.

## Memory Notes

- Appended to `.agent-context/MEMORY.md`.
