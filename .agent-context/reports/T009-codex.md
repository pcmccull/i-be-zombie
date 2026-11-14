# T009 Report (written by orchestrator fallback, not by Codex)

**Task ID & Agent:** T009 / codex (Codex hit its usage limit before writing this report; written by the Claude wrapper per the quota fallback policy)

**Status:** QUOTA_EXHAUSTED

**Completed Work:**
- Codex ran `codex exec --sandbox workspace-write` against `docs/briefs/T009_conquest_respawn.md`. The run ended with `ERROR: You've hit your usage limit ... try again at 4:29 PM`.
- Files present in the workspace from this task (not committed):
  - `src/systems/ConquestSystem.ts` (342 lines, modified): exports `ObjectiveStatus`, `isNestActive`, `revealAround`, `objectiveStatus`, `spawnNestFollowers`, `updateConquest`. Source contains discovery, objective kinds (destroyStructure, destroyGate, killDefenders, holdPoint), contested/capture, reinforcements, and nest replenish hooks.
  - `src/systems/RespawnSystem.ts` (41 lines, modified): exports `updateRespawn`; emits `leaderRespawned`.
  - `src/systems/StructureSystem.ts` (94 lines, modified, +15/-1): exports `takeStructureHits`, `findStructure`, `isReleaseBurst`, `damageStructure`, `updateStructures`. Contains the biomass-on-structure-destroy hook (`biomassStructure`).
  - `tests/conquest.test.ts` (281 lines, new), `tests/discovery.test.ts` (94 lines, new), `tests/respawn.test.ts` (141 lines, new).
- Verification by the wrapper on the workspace as left:
  - `npx vitest run tests/conquest.test.ts tests/discovery.test.ts tests/respawn.test.ts`: 3 files, 34 tests, all passing.
  - `npx tsc --noEmit`: no output (clean) at the time of the check.
- Not part of T009 (other workers' files, left untouched by this wrapper): `src/systems/HordeSystem.ts`, `HumanAISystem.ts`, `PopulationSystem.ts`, `src/entities/HumanGuard.ts`, `tests/ai.test.ts`, `tests/hordeCommands.test.ts`, `tests/population.test.ts`, `tests/pointerLock.test.ts`, `docs/briefs/T012_sim_integration.md`.

**Remaining Work:**
- Brief item 7: the `lastHitAt` scratch hook that marks a stronghold objective structure as contested (described as "e.g." in the brief) was not found by name in the three modules. Verify whether `takeStructureHits` covers it, or add it inside `StructureSystem.ts` without a contract change.
- Brief item 9 coverage is partially confirmed by the 34 passing tests. Confirm each listed case exists: any capture order (mall before police), reinforcement waves bounded, captured district no waves, nest replenish invariant, death→respawn keeps unlocks/biomass/territory, respawn at newly captured nest.
- Run a full `npm test` after the other workers settle. Earlier Codex output showed `tsc` and `npm test` were started but the output was not captured.
- Append T009 gotchas to `.agent-context/MEMORY.md` (not done by this wrapper).
- Confirm the Simulation step wiring is left to T012 (the brief says Simulation does not call these systems yet).

**Public Interfaces/Exports Added:**
- `src/systems/ConquestSystem.ts`: `ObjectiveStatus` (interface), `isNestActive`, `revealAround`, `objectiveStatus`, `spawnNestFollowers`, `updateConquest`.
- `src/systems/RespawnSystem.ts`: `updateRespawn`.
- `src/systems/StructureSystem.ts`: `takeStructureHits`, `findStructure`, `isReleaseBurst`, `damageStructure`, `updateStructures`. (Some of these may have existed before T009; diff shows only +15/-1 in this file.)

**Verification Run:**
- `npx vitest run tests/conquest.test.ts tests/discovery.test.ts tests/respawn.test.ts`: PASS, 3 files, 34 tests.
- `npx tsc --noEmit`: PASS (no output) at check time.
- Full `npm test`: not run by the wrapper; Codex's own output for it was not captured.

**Memory Notes:**
- Codex's usage limit was reached mid-task; the workspace state above is partial but tests in the T009 files pass.
- No contract changes were made; no commits or branch changes.
