# T008 Report (claude, failover resume from codex)

**Task ID & Agent:** T008, claude-worker

**Status:** COMPLETED (todos #8 zombie-side give-up skipped: needs HordeSystem)

## Completed Work
- Audited codex's partial edits against brief items 1-7; all valid and kept (HumanGuard police HP, HumanAISystem police/stagger/dormancy/posts, PopulationSystem, tests).
- `src/entities/HumanGuard.ts`: `post:'patrol'` guards whose waypoint 0 is their spawn start at `waypointIndex 1` (reinforcement squads set off immediately).
- `src/systems/HumanAISystem.ts`: `approachPath` fallback for patrols whose waypoint is unreachable (real strongholds are sealed, so squads previously never moved: no path to center); street civilians may flee outside `homeArea` (todos #8 civilian half).
- `tests/ai.test.ts`: new "open-world layout humans" block on `buildDistrictLayout()`: squads leave spawn and approach stronghold, squads engage Alpha on the way (guardAlert + shot), stronghold retreat routes/positions stay inside bounds for all 4 strongholds, fleeing street civilians leave homeArea.
- `tests/population.test.ts` audited: covers dormant flags/cadence/untouched dormant humans, respawn delay/distance/visibility/caps, captured/infected budgets, legacy zero budgets, determinism, corpse pruning, 3-sim-minute bounded roam. Police aim delay and stagger are covered in ai.test.ts.

## Remaining Work
- todos #8 zombie give-up after 2 s unseen civilian: lives in HordeSystem (not locked); not done.

## Public Interfaces/Exports Added
- `updatePopulation(ctx, dt)` in PopulationSystem (unchanged contract). No contract changes.

## Verification Run
- `npx tsc --noEmit`: pass.
- `npm test`: 35 files, 371 tests pass.

## Memory Notes
Appended to .agent-context/MEMORY.md (T008 entries).
