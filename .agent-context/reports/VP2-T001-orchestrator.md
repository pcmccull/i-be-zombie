# VP2-T001 — orchestrator

- **Task ID & Agent:** VP2-T001, orchestrator
- **Status:** COMPLETED (contracts) — baseline captures appended below when taken

## Completed Work
- `src/core/types.ts`: `BuildingArchetype`, `CityLandmarkKind` (renamed from the spec's `LandmarkKind`, which already names
  structure landmarks), `Facing4`; optional `BuildingDef.{archetype, seed, frontage, lot, landmark, sharedWalls}`;
  13 new `PropKind`s (busStop, mailbox, newsStand, bikeRack, bollard, planter, patioTable, gasPump, utilityBox, crates,
  shoppingCart, constructionBarrier, basketballHoop); `GroundKind` + `'court'`.
- Compile shims: `ui/mapRender.ts` court colour, `graphics/vfx/vfxRules.ts` court → concrete surface.
- `src/world/districtLayout.ts`: `LayoutPasses.{buildingArchetypes, urbanInfill, streetFurniture}` (no-ops until T006).
- New contract files: `src/content/districtStyles.ts` (16 `DISTRICT_STYLES`, `STYLE_ARCHETYPES`,
  `ARCHETYPE_MIN_FOOTPRINT`, `SignageStyle`, `SidewalkStyle`), `src/graphics/buildings/buildingTypes.ts`,
  `src/graphics/environment/environmentKinds.ts`, `src/graphics/characters/characterTypes.ts` (21 bones, `HB`, `BONE_PARENT`,
  `REGION`, body shapes, clip names).
- Stubs for T012: `src/graphics/buildings/landmarkPlans.ts` (`planLandmark`), `src/graphics/buildings/LandmarkComponents.ts`
  (`landmarkPartGeometry`).
- `GraphicsQuality.ts`: `characterLod0Distance`, `boneUpdateTiers`, `buildingLod1Distance`, `dressingTier`,
  `maxDressingPerChunk` per preset + monotonic test in `tests/graphicsQuality.test.ts`.

## Public Interfaces/Exports Added
See ARCHITECTURE §VP2-1 (exact shapes). Note the rename: `CityLandmarkKind`.

## Verification Run
- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 74 files / 821 tests passed (one earlier run showed 7 failures in a 75th file belonging to a
  concurrent session — see Memory Notes).

## Memory Notes
- `LandmarkKind` already exists (structure landmarks: bus/alley/store/...). VP2 district set pieces are `CityLandmarkKind`.
- A second Claude session is working in this folder at the same time (docs/13 horde health + heavy defenses): it edits
  `types.ts`, `EntityRenderer.ts`, `Effects.ts`, `AudioSystem.ts`, `NavigationGrid.ts`, `layout/compounds.ts`,
  `tests/{world,expansion,heavyDefenses}.test.ts`. Full-suite results can include its in-progress tests.

## Baseline (2026-11-21, dev server :5181, quality medium, DPR 1, vision tier forced to 4 for captures)
- Captures: `docs/captures/vp2-before-{alpha,residential,commercial,downtown,industrial}.jpg` (800×600 browser shots).
  Poses (leader x, z, camera yaw, zoom): alpha (-140, 145, 0.4, 9); residential (-60, 95, 2.4, 32); commercial (90, 70, 3.6, 32);
  downtown (-100, -235, 0.8, 34); industrial (110, -70, 2.2, 34). Teleport helper: set leader + follower `pos`/`prevPos`,
  `cameraRig.yaw/viewYaw/zoom/targetZoom`.
- Horde: `vp2-before-horde.jpg` = copy of `vp-after-bench1-crowd.jpg` (zombie visuals unchanged since VP); the browser pane
  was hidden so a fresh screenshot timed out.
- bench=1 (432 zombies, 425 humans), frames driven by `__game.frame(t)` + `gl.finish()` (pane hidden), 60 measured frames:
  **727 draw calls, 931 602 triangles, 680 geometries, 8 textures, frame p50 37.9 ms / p95 45.1 ms (CPU + GPU finish),
  JS heap 212 MB.** Note: hidden-pane timings run as a background page and read high; compare only against the same method.
