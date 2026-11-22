# EW-T001 — Contracts (orchestrator)

- **Task ID & Agent:** EW-T001, orchestrator (Claude)
- **Status:** COMPLETED

## Completed Work
- `src/core/types.ts`: `ColliderKind 'boundary'`; PropKinds `container, jerseyBarrier, chainFence, watchtower, tent, palm, wreck`;
  16 `DistrictId`s (`DISTRICT_IDS` now in grid order r0c0..r3c3), `ThreatTier`, `DistrictArchetype`, 16 `StrongholdId`s;
  `DistrictDef += threatTier, archetype, cell`; `BoundaryKind`, `WorldBoundarySegment`, `BackdropDef`;
  `DistrictLayout += playArea, boundaries, backdrop`; `VisionTier`, `Awareness`, `VisionProfile`, `SenseKind`, `SenseCue`,
  `VisionState`; `GameState.vision`; `ProgressionState.visionTier`; `SimInput.buyVision` (+ `emptyInput`);
  events `visionUpgraded`, `senseCue`; deny reason `'maxVision'`; `PlayerSave.visionTier`.
- `src/core/contracts.ts`: `AbilityDenyReason += 'maxVision'`; EW doc block (boundaryLayout, AwarenessSystem rules, buyVision,
  save v3 migration, HordeSystem order gate).
- `src/config/balance.ts`: `openWorld` bounds −420..420 / −500..180, `play`, `boundaryBand: 20`, `gridX/gridZ`;
  population caps 420/400; `save.version 3`; `expansion.rewardByTier`; `vision` (4 tiers, costs, radii, budgets); `senses`.
- `src/content/districts.ts`: 16 districts (tier, archetype, cell, threat text) + `districtMeta()`.
  `src/content/strongholds.ts`: 12 new strongholds via `ew()` (unlock null, reward by tier; objectives breach/defenders, +take_control at tier ≥ 3).
- Shims: `src/world/districtLayout.ts` (new bounds/playArea, district rects from the grid, districts sorted by DISTRICT_IDS,
  `buildExpansionPlaceholders`: per new district an empty rect, zero budgets, a 12 × 12 m pen-style room with breakable door
  id 100+, 1 police defender, hold point, nest 16 m south; `buildWorldBoundaries` call; exported `districtCellRect(col,row)`);
  `src/world/boundaryLayout.ts` (stub: empties boundaries/backdrop); `legacyDistrictLayout.ts` (playArea = bounds, [] , [],
  district tier/archetype/cell); `createInitialState.ts` (`visionTier: 1`, `createVisionState()`); `saveSchema.ts`
  (`MIGRATIONS[2]` v2→v3: visionTier 1 + default records for the 12 new districts; `sanitizeVisionTier`; create/parse/apply
  pass `visionTier` through); `InputController.ts` (`buyVision: false`); `CityDistrict.ts` (default ground colour for new districts).
- Tests: `tests/world.test.ts` (EW bounds/playArea/16 districts in grid order, clamped queries, nests = strongholds + 1,
  chunk mechanics on a 400 × 320 `grid20` fixture + new 11 × 9 = 99 chunk test, reinforcement road/sight checks limited to
  the original 4 strongholds), `tests/discovery.test.ts` (only the 4 seam districts are discovered).

## Remaining Work (handed to downstream tasks)
- EW-T002: replace `buildExpansionPlaceholders` with real content; restore the reinforcement road/sight assertions for
  every stronghold (remove the `ORIGINAL_STRONGHOLDS` skip in tests/world.test.ts).
- EW-T006: fog-grid remap in `MIGRATIONS[2]` (v2 bits are decoded with the wrong length today: fog lands in the wrong cells,
  no crash), `visionCost`/`buyVision`.

## Public Interfaces/Exports Added
`districtCellRect`, `buildWorldBoundaries`, `BoundaryDraft`, `createVisionState`, `districtMeta`, all types above.

## Verification Run
See PROGRESS.md EW-T001 row (tsc, full suite, build).

## Memory Notes
- World grows into negative Z (north); the coast stays at z = 160, original coordinates unchanged.
- Discovery grid v3 = 42 × 34; old origin maps to col 11 / row 17.
- CRLF files (CityDistrict, saveSchema, InputController): patch with node scripts that normalise line endings.
