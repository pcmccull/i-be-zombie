# T005 Progression implementation report

**Task ID & Agent:** T005 / codex

**Status:** COMPLETED

**Completed Work:**
- Implemented `src/systems/ProgressionSystem.ts`: registry-based eligibility and cooldowns, finite positive biomass gains, innate unlock checks, idempotent unlocks with first-empty-slot auto-equip, and nest-gated loadout changes with slot validation and duplicate-free moves.
- Implemented atomic ability activation with ordered denial reasons, no cooldown bypass or double spend, full-duration Horde Frenzy, and nearest-follower Brute Evolution constrained by affordability, per-activation count, and living-brute capacity. All ability/evolution events snapshot positions.
- Added `evolveToBrute` in `src/entities/Zombie.ts`: configured health/radius/speed mutation, idempotent on existing brutes.
- Added `tests/progression.test.ts`: 20 tests using the legacy `new Simulation()` fixture, covering unlock/equip invariants, active/captured nest eligibility, dead leaders, activation denial precedence, passive slot input, cooldown preservation, Frenzy timing, partial affordability, nearest/tied targets, dormant/dead exclusions, brute cap/death capacity, and reset isolation.
- Appended T005 decisions and integration notes to `.agent-context/MEMORY.md`.
- Edited only the assigned source/test files, the append-only memory file, and this report. No contracts, balance/content, branches, or commits changed by this task.

**Remaining Work:**
- No unfinished T005 implementation or tests.
- T012 must wire `updateProgression(ctx, dt, input)` into the published simulation step order; the current legacy Simulation does not call it. Tests call it directly against `sim.ctx`.
- T007 must apply Frenzy activation-radius filtering in HordeSystem. The multiplier helpers report the global active Frenzy factors; `frenzyStart` publishes a copied position and configured radius for follower eligibility. Combat/horde integration remains with their owners.
- Full-check green status requires fixes outside this file scope in the concurrently edited combat/conversion work, detailed below. Those files were left untouched.

**Public Interfaces/Exports Added:**
- All existing ProgressionSystem contract exports implemented with unchanged signatures: `addBiomass`, `isUnlocked`, `isEquipped`, `canActivate`, `activateAbility`, `unlockAbility`, `equipAbility`, `updateProgression`, `isFrenzyActive`, `hordeSpeedMultiplier`, `hordeAttackRateMultiplier`.
- New export: `evolveToBrute(z: ZombieAgent): void` from `src/entities/Zombie.ts`.
- No contract changes required.

**Verification Run:**
- `npx vitest run tests/progression.test.ts`: PASS, 1 file / 20 tests.
- `npx tsc --noEmit`: FAIL on both runs, exclusively in the concurrently edited `src/systems/CombatSystem.ts`: TS2339 at 210:16 and 210:42 (`kind` on `never`), 211:24 (`kind` on `never`), and 211:91 (`id` on `never`). No diagnostics in T005 files.
- `npm test`: run twice, including after the final T005 source change. Final result: 26 files passed / 3 failed; 263 tests passed / 3 failed / 0 skipped. All 20 progression tests passed in both complete runs.
- Out-of-scope failures in the final full run:
  - `tests/combat.test.ts:74`, `leader prefers ordered targets, falls back to nearest guard, and cannot melee while sprinting`: expected guard HP 40, received 50. Concurrent CombatSystem changes remove leader auto-melee in favor of the explicit attack state machine.
  - `tests/structures.test.ts:82`, `allows facing leader auto-melee and follower melee at the nearest face, with cover still blocking access`: expected bus HP 80, received 90. Same legacy leader auto-melee expectation.
  - `tests/conversion.test.ts:51`, `waits three seconds, then rises for the full duration and counts only when joining`: exact event list now contains the extra `biomassGain { amount: 2, total: 6, reason: 'convert' }` emitted by the concurrently edited ConversionSystem's new `addBiomass` call.
- Read-only diff inspection confirmed these concurrent combat/conversion changes; none were modified or reverted by T005.

**Memory Notes:**
- Innate actions are treated as unlocked even if absent from the unlocked array; they are never slotted. Pounce remains data-only and is denied activation rather than consuming a cooldown for an unimplemented effect.
- Cooldowns and existing Frenzy time advance before new slot input, preserving a new activation's full configured duration. Passive slot keys produce no event; direct attempts to activate a passive return `locked`.
- Brute cost is per actual conversion. Existing brutes cannot be healed or slowed again by repeated evolution. Living brute counts include dormant agents; dormant agents cannot be evolution targets.
- Loadout changes require both `leader.alive` and positive HP and proximity to any active nest, independent of `activeNestId`. Moving an ability clears its former slot without clearing its cooldown.
