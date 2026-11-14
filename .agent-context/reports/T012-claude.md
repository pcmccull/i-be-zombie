# T012 Report
**Task ID & Agent:** T012 / claude-worker
**Status:** COMPLETED (one brief deviation, see Memory Notes)
**Completed Work:**
- `src/sim/Simulation.ts`: ctor `(layout?, seed?, save?: WorldSave|null)`, `reset(seed?, save?)` -> `applySave(ctx, save)` after createInitialState. Open-world detection = `layout.strongholds.length > 0`.
  Open-world step order: updatePopulation, applyHordeCommands, updateProgression, updateLeader (only when phase==='playing'), updateNavigation, updateHorde, updateHumanAI, updateCombat, updateConversion, updateStructures, updateMomentum, updateConquest, updateRespawn, timers. No checkVictory; both 'playing' and 'respawning' simulate. Legacy (no strongholds): same order minus population/conquest/respawn, plus checkVictory, frozen on victory/defeat (legacy tests unchanged and green). updateProgression runs in both.
- `src/sim/createInitialState.ts`: only a comment (see deviation). Stronghold tower elevations were already set.
- `src/systems/VictorySystem.ts`: unchanged (still used by legacy path).
- `tests/victory.test.ts`: +1 open-world test (no victory/defeat, death -> respawning -> playing).
- `tests/openWorld.test.ts` (new, 13 tests, ~75 s alone).
- No edits to other src files; systems already tolerate a dead leader (item 10 and roam verify).
**Remaining Work:** None. (Optional: t=0 fog reveal, see below.)
**Public Interfaces/Exports Added:** `new Simulation(layout, seed, save)`, `Simulation.reset(seed, save)`.
**Verification Run:** `npx tsc --noEmit` clean except concurrent src/ui/HUD.ts edits by another session earlier (final run: clean). `npm test`: 37 files / 393 tests passed, no unhandled errors. tests/opening.test.ts perf assertion passed (2378 ms) with the new tests in the suite.

| Spec §10 | Test (tests/openWorld.test.ts) | Result |
|---|---|---|
| 1 Seamless city | item 1: walks start -> suburb/police/mall/industrial nests in one sim | pass |
| 2 Fog | item 2: fog reveal does not conquer territory | pass |
| 3 Infection/horde | item 3: Alpha-killed civilian rises as follower | pass |
| 4 Direct fight | item 4: Alpha LMB kills police, takes damage | pass |
| 5 Order attack | item 5: attack order engages followers | pass |
| 6 Stronghold | item 6: capture police_station once, Claws unlocked once | pass |
| 7 Mutation | item 7: equip at nest, Claws combo 3, Frenzy, Brute Evolution | pass |
| 8 Free order | item 8: mall before police coherent | pass |
| 9 Persistence | item 9: createSave -> JSON -> parseSave -> new Simulation(layout, seed, save) | pass |
| 10 Death | item 10: respawn at nest, progression kept, world simulates | pass |
| 11 Streaming/bounds | item 11: 10 sim-min roaming (guards<=86, zombies<=175, followers<=40; ~25-41 s wall) | pass |
| 12 Regression | item 12 (+ Monitor assertions in 6/8/9/11: no duplicate capture/unlock events, biomass >= 0) | pass |
| opening pacing | "opening pacing" test | pass |

**Measured opening:** scripted walk-to-nearest-civilian/ambient + LMB, god-mode off-hp: **21 followers at 30 s** (>= 10 target; no balance change needed).
**Memory Notes:** see MEMORY.md [T012].
