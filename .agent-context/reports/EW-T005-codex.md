# EW-T005 — AwarenessSystem

- **Task ID & Agent:** EW-T005, codex
- **Status:** NEEDS_REVIEW (implementation complete; full-suite failures in the concurrent EW-T002 world tests require their owner's review)

## Completed Work
- Added `src/systems/AwarenessSystem.ts`, a pure module implementing all seven contracted exports without changing any contracts or wiring Simulation.
- Implemented tier profiles, immediate-first/5 Hz identification, bounded round-robin LOS with cached results, tower height/support handling, engagement memory, moving/defender/reinforcement silhouettes, and dead/respawning restrictions. Identified/seen ids remain sorted, disjoint and updated in place; revision increments only when contents change.
- Implemented fuzzed gunshot/scream/siren/crowd cues with attenuation, deterministic RNG, source aggregation, refresh events, expiry and weakest-first cap enforcement. Cues never identify humans. Scratch state is keyed by GameState in a WeakMap; guard memory is allocated once per new id and scratch arrays/cells are reused.
- Added `tests/vision.test.ts` (17 tests) and `tests/senses.test.ts` (11 tests), using legacy layouts only. Coverage includes camera independence, tiers, cover/height, engagement/expiry, target gating, dormant/dead agents, sorted/disjoint arrays, revisions, 300-human LOS fairness/budget, reset/determinism and every requested sensory cue behavior.
- Appended the Memory Notes below to `.agent-context/MEMORY.md`. No other implementation/test files were edited.

## Remaining Work
- No EW-T005 implementation work remains.
- EW-T010 must call `updateAwareness(ctx, dt, stepEvents)` after combat/respawn using only that fixed step's events, and wire consumers to the contracted helpers. This is intentionally outside this task's locks.
- EW-T002 owner must resolve its current `tests/world.test.ts` failure and run global verification on a stable world-layout snapshot. Those files were left untouched.

## Public Interfaces/Exports Added
- `visionProfile(tier: VisionTier): VisionProfile`
- `updateAwareness(ctx: SimContext, dt: number, stepEvents: readonly GameEvent[]): void`
- `isIdentified(state: GameState, id: EntityId): boolean`
- `isSeen(state: GameState, id: EntityId): boolean`
- `awarenessOf(state: GameState, id: EntityId): Awareness`
- `canTarget(state: GameState, id: EntityId): boolean`
- `isWorldPositionInSight(state: GameState, p: Vec2): boolean`

## Verification Run
- `npx vitest run tests/vision.test.ts tests/senses.test.ts`: **PASS**, 2 files / 28 tests, including a rerun after the final implementation edit.
- `npx tsc --noEmit`: final check **PASS**, exit 0. Earlier checks observed temporary errors in EW-T002 `archetypes.ts`/`expansion.ts` (`sandbag` vs `sandbags`) and EW-T003 `boundaries.test.ts` (incorrect field names); their owners corrected those files.
- First `npm test`: **FAIL**, 47 files passed / 1 failed; 508 tests passed / 1 failed (509 total). Only failure: `tests/world.test.ts`, geometry-budget assertion, actual 1013 versus expected `<400`. The file changed under the run; its owner subsequently updated that assertion.
- Final `npm test`: **FAIL**, 47 files passed / 1 failed; 515 tests passed / 1 failed (516 total), 149.75 s. Only failure: `tests/world.test.ts:132`, `has exact district population budgets, defender roles, held zombies and nearby opening encounters`: police-patrol count expected 2, got 4. All 28 EW-T005 tests and the full 14-test open-world integration file passed. No tests were skipped. The remaining failure belongs to concurrent EW-T002 world authoring and was not modified.
- `git diff --check -- src/systems/AwarenessSystem.ts tests/vision.test.ts tests/senses.test.ts`: exit 0 (new files were untracked).

## Memory Notes
- **[EW-T005 Awareness]** `updateAwareness(ctx, dt, stepEvents)` is ready for EW-T010 integration after combat/respawn; pass only this fixed step's events. It copies the progression tier each call, scans sight at 5 Hz (first call immediate), and uses state.time for engaged-memory expiry. Sight depends only on leader.pos; identified/seen arrays retain their identity and revision changes only with their contents.
- **[EW-T005 LOS/engagement]** LOS results, round-robin cursor, prior civilian states and reinforcement membership live in a WeakMap keyed by GameState (reset-safe). Never-checked LOS is false. Tower sight uses elevation + guard.eyeHeight and ignores the occupant's tower collider. Damage events have no shooter id, so engagement attribution uses shot.guardId plus the shooter's target / endpoint near the leader or followers (including HumanAISystem's 1.2 m maximum miss offset).
- **[EW-T005 Senses]** Cue positions are fuzzed only on creation/refresh. Private source anchors aggregate repeated nearby sounds before fuzz can split them; true source positions are never put in VisionState. Crowd cues are sensed, other kinds heard; these never add human ids to identified/seen. Reinforcement membership uses new patrol ids within 15 m of a reinforcements event; call awareness regularly before waves to establish existing ids.
