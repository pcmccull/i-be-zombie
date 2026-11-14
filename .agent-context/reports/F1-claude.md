# F1 - fixes from V1/V2 findings (claude-worker)

**Task ID & Agent:** F1 / claude-worker
**Status:** COMPLETED

## Completed Work (item -> change -> test)
1. Conversion cap: `followerCap` exported from HordeSystem; ConversionSystem and ConquestSystem.spawnNestFollowers use it. Test: followup "conversion respects the open-world cap".
2. Dead Alpha abilities: ProgressionSystem `canActivate` returns 'locked' unless leader alive and phase 'playing'; `equipAbility` denies when phase != playing. Test: followup "dead Alpha ...".
3. Saved 'contested': saveSchema applySave normalises to 'human'. Tests: followup round trip; tests/persistence.test.ts line 219 updated (expected value now 'human' for the contested district).
4. Industrial yard: tests/openWorld.test.ts `capture` helper attacks `{kind:'gate'}` for destroyGate objectives; new test "industrial yard ..." passes (gate break + hold office; brute_evolution unlocked once, one capture biomassGain). Yard is NOT a softlock; no source fix needed.
5. Patrols: PopulationSystem.refresh drops dormant, living `post==='patrol'` guards in 'infected' districts (despawn only out of active radius; not respawned since population only respawns civilians). Test: followup "infected districts stand down ...".
6a. ConquestSystem.capture: `tower=null, towerColliderId=null, elevation=0` for stood-down guards. Test: followup "captured tower guards ...".
6b. ConquestSystem runtime `autoNest` initialised from loaded `state.activeNestId`. Test: followup "after a reload ...".
6c. SaveStore only: `save()` refuses to clobber stored version > SAVE_VERSION (load already returned null). Game.ts untouched (Reset still explicitly clears). Test: followup SaveStore.
6d. EntityRenderer: reusable `activeGuardIds` Set; guard rig materials no longer pushed to `disposableMaterials` (disposed by `disposeGuardEntry`, which `dispose()` already calls for all entries). No test (3D).

## Remaining Work
None. Not done (outside request): V2 P3 items 2,3,6,7,8 (non-persisted cooldowns, selectedNest validation, HordeRenderer maxInstances, followerSwingTarget O(G^2), pagehide save).

## Public Interfaces/Exports Added
`followerCap(ctx)` exported from src/systems/HordeSystem.ts.

## Verification Run
`npx tsc --noEmit` pass; `npm test` pass (see summary; one run earlier failed only on the persistence expectation now updated); `npm run build` pass. src/ui/HUD.ts untouched.

## Memory Notes
Appended to MEMORY.md ([F1 fixes]).
