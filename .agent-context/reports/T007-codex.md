# T007 Report (Codex run, written by orchestrator after quota exhaustion)

**Task ID & Agent:** T007 / codex (session ended on usage limit; report written by Claude orchestrator)

**Status:** QUOTA_EXHAUSTED

## Completed Work
- `src/systems/HordeSystem.ts` modified (about 207 lines changed). Code present for: `type === 'move'` order handling, `moveOrder` events, `additive` attack split, `followerCap`, dormant handling, `hordeSpeedMultiplier` / `isFrenzyActive` usage, `rushChaseFactor`, `farCatchUp*` references, `findPath` fallback for stragglers, brute `heldBy` / strongholds / `buildFlowField` references.
- `tests/hordeCommands.test.ts` created (new file, 20 tests). Last run: 20/20 passing.
- Full-run checks at the end of the Codex session and by the orchestrator afterwards:
  - `npx tsc --noEmit`: exit 0.
  - `npx vitest run` (full suite): 35 files passed. An earlier failure in `tests/conquest.test.ts` (another worker's file) was mid-edit and is now green.
- Codex's earlier run also showed `tests/horde`, `cascade`, `recruitment`, `engagement`, `fixes-horde`, `todos`, `r4d`, `opening`, `momentum-integration` at 9 files / 65 tests passing (before the last full run).
- Files unmodified by this task: `tests/horde.test.ts`, `cascade`, `recruitment`, `engagement`, `fixes-horde`, `todos`, `r4d`, `opening`, `momentum-integration` (no changes in git status).
- Other modified files in `git status` belong to other workers (HumanGuard, ConquestSystem, HumanAISystem, PopulationSystem, RespawnSystem, StructureSystem, tests/ai.test.ts) or the other session (Game, InputController, ThirdPersonCamera, cameraMath, ui/*, README, docs/todos.md). Not touched by T007.

## Remaining Work
1. Verify each brief item against the code, since Codex ended before writing its own summary:
   - Item 1: `attack` with `additive:false` replaces selection (clears squads); `additive:true` keeps toggle/split. `move` sets `order` with `expiresAt`, clears squads, emits `orderChanged` and `moveOrder`. Move flow field is in per-ctx scratch (WeakMap) and rebuilt only on order change. Arrival at 80% within 6 m, or expiry, reverts to follow. `regroup` = rally, `follow` = recall.
   - Item 2: followers within `frenzy.radius` of the leader at the `frenzyStart` edge get `hordeSpeedMultiplier`, recorded in scratch. Legacy rush multiplier kept. Buffed followers use `rushChaseFactor`.
   - Item 3: `followerCap(ctx)` returns `BALANCE.openWorld.maxFollowers` when `layout.strongholds.length > 0`, else `horde.maxFollowers`. Confirm every cap read in the file uses it.
   - Item 4: dormant ambient zombies skipped (no wander, no hash insert). Followers never dormant.
   - Item 5: brutes prefer gate/structure targets when an attack order includes one; never crawl. Covered by the tests in `hordeCommands.test.ts`; confirm the code path.
   - Item 6: straggler fallback (`navGrid.findPath` toward leader, cached per zombie, replan <= 1 Hz, bounded per step) where `followField.sample()` returns false, plus the teleport to `nav.farCatchUpOffscreen` for followers beyond `nav.farCatchUpDistance` with no LOS, not engaged, never inside a stronghold. Resolves the T003 follow-up in MEMORY.md (line 21).
   - Item 7: test coverage. Confirm `tests/hordeCommands.test.ts` covers move order (go, auto-engage, revert on arrival and on expiry), frenzy-only buffing, open-world cap 40 vs legacy 100, dormant untouched, straggler catch-up, and brutes not crawling. The last run was 20/20 passing, so this is likely complete.
2. Append T007 notes to `.agent-context/MEMORY.md` (none found by grep). Also mark the T003 straggler follow-up resolved or still open.
3. Update `.agent-context/PROGRESS.md` T007 row. Codex did not do this either.
4. Re-run `npx tsc --noEmit` and `npm test` after any further edits.

## Public Interfaces/Exports Added
- Not confirmed. Expected: `followerCap(ctx)` helper (module-internal per brief). Verify whether it is exported.

## Verification Run
- `npx tsc --noEmit`: exit 0 (orchestrator, after Codex stopped).
- `npx vitest run`: 35 files passed (orchestrator, after Codex stopped).
- `npx vitest run tests/hordeCommands.test.ts`: 20 passed (Codex, last run).
- Codex's final state was "ERROR: You've hit your usage limit ... try again at 4:29 PM".

## Memory Notes
- Codex hit its usage limit mid-run. It did not write this report or append MEMORY/PROGRESS.
- The T003 straggler follow-up (MEMORY.md line 21) is addressed in code (`findPath` fallback and `farCatchUp` references present), but has not been verified.
- Failover: T007 was assigned to codex and codex is exhausted. Per policy, the fallback order is `@claude-worker` (or `@agy-worker` if quota remains) for the remaining work. Resume from this report.
