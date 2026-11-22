# EW-T003 - Indestructible world boundaries

- **Task ID & Agent:** EW-T003, codex
- **Status:** COMPLETED (assigned implementation/tests complete; concurrent shared-suite failures and their follow-up results recorded below)

## Completed Work

- `src/world/boundaryLayout.ts`: replaced the contract stub with a pure deterministic generator. Splits the perimeter using adjacent district rectangles/cells/archetypes and road ground patches read at call time; merges equal straight runs; appends full-band `kind: 'boundary'` colliders with 0.1 m join overlap and double-covered corners. Existing colliders and structures are preserved. All required height/sight profiles, blocking flags, stable ids/tags and seeded scenery data are emitted.
- Backdrop: six render-only rectangles for ocean (300 m deep), bay, mangroves, highway, skyline and the airport airfield, outside bounds.
- `tests/boundaries.test.ts`: 16 passing tests covering translated hand-made fixtures, archetype and road-end selection, profiles, determinism, legacy isolation, full-band coverage sampled every 0.5 m, corner overlap, collider/segment references, gameplay-content exclusion, normal/crawl navigation after all destructible colliders are disabled, and 2,400 real Simulation push steps (300 at each edge/corner) with leader, followers and a fleeing human.

### Real-layout geometry snapshot

Seed 4242, expanded layout present during verification: **64 segments / 64 boundary colliders** (target <= 120), six backdrop rectangles. Counts are derived from EW-T002's road geometry and may change if that worker changes roads.

| Side | Segments/colliders | Kinds |
| --- | ---: | --- |
| South | 15 | `deep_water`, `vehicle_blockade` |
| East | 16 | `shipping_containers`, `vehicle_blockade`, `deep_water` |
| West | 17 | `military_perimeter`, `collapsed_bridge`, `mangrove_barrier` |
| North | 16 | `military_perimeter`, `collapsed_bridge`, `urban_fence` |

`concrete_debris` is the northern fallback for ordinary archetypes; the current north row consists of airport, estates, campus and marina, so fixtures cover that fallback.

## Remaining Work

- No implementation work remains in the two assigned files.
- EW-T007 consumes the boundary/backdrop data for rendering. Segment polylines follow the inner edge of the band; colliderTags expose the full-thickness rectangles and corner extensions for matching scenery.
- No other workers' files were edited. The final full-suite run loaded an EW-T002 assertion before that worker corrected it; the corrected world file passed separately afterward. A future orchestrator full-suite verification should use a stable snapshot of all concurrent workers' completed files.

## Public Interfaces/Exports Added

- Existing contract exports retained: `BoundaryDraft` and `buildWorldBoundaries(world: BoundaryDraft, seed: number): void`. No new exports or contract changes.

## Verification Run

- `npx vitest run tests/boundaries.test.ts`: PASS, 16/16.
- `npx tsc --noEmit`: PASS after other workers corrected transient errors in their prop names and vision fixtures. Earlier errors in the assigned test's field names were corrected before the full-suite run.
- First `npm test`: FAIL, 505 passed / 4 failed (509 total, 48 files). All 16 boundary tests passed, including the 2,400-step probe. External failures: two LOS expectations in `tests/vision.test.ts`, `tests/intro.test.ts:187` expected nine intersections but received 49 after road expansion, and `tests/world.test.ts` expected markings < 400 but received 1022.
- Follow-up `npx vitest run tests/boundaries.test.ts tests/vision.test.ts tests/world.test.ts tests/intro.test.ts`: 59 passed / 1 failed. Boundary, vision and intro files passed. Only the world markings expectation failed (1013 vs < 400); EW-T002 updated that assertion while this run was in progress.
- Second `npm test`: FAIL, **515 passed / 1 failed** (516 tests, 48 files; 176.06 s). Boundary tests 16/16 PASS; open-world integration 14/14 PASS, including the ten-minute roam. The only failure was EW-T002's `tests/world.test.ts` population assertion (expected two humans, received four); its loaded version predated that worker's fix. Vision and intro passed in this full run.
- Follow-up `npx vitest run tests/world.test.ts` against EW-T002's corrected file: **PASS, 12/12**. No unresolved failures were observed in the latest focused runs, but the full-suite invocation above itself exited 1; do not report it as a full-suite pass.
- Final `npx tsc --noEmit`: **PASS**, exit 0. An earlier simultaneous check during EW-T002 edits had rejected an unsupported `radius` option in `tests/expansion.test.ts`; the worker corrected it before this final passing invocation.
- Vite SSR read-only geometry inspection: PASS, 64 boundary colliders, 64 segments, six backdrops; kinds/counts per side listed above.

## Memory Notes

- `buildWorldBoundaries` is called once, last, on a fresh world draft. It derives road terminations from `world.ground` and districts from their rect/cell/archetype; never copy literal road coordinates into boundary code.
- Polylines sit on the playArea edge, and their referenced colliders fill the complete band to bounds. First/last colliders extend through corner squares; adjacent runs overlap 0.1 m. Renderers must match these rectangles, including corner coverage.
- Boundary kind remains `boundary` even for water/low blockades, so `isCrawlable` rejects it; no boundary tag is referenced by a StructureDef. Disabling every gate/breakable still leaves both nav grids' exterior cells unwalkable.
- Push tests use real Simulation/collision/nav, a durable civilian fleeing toward the edge, 300 steps at each of eight directions, and periodic zero-delay async yields. Camera yaw 0 maps moveForward=dz and moveRight=-dx.
