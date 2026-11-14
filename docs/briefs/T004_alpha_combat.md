# T004 — Alpha direct combat (codex)

Read first: `AGENTS.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md` (input model §4), `docs/3_open_world.md` §4B, §7 "Controls",
`src/core/types.ts` (LeaderState attack fields, GuardAgent `staggerTime`/`killedByAlpha`, ZombieAgent `brute`, SimInput `attack`/`aimPoint`,
events `attackSwing`, `biomassGain`), `src/config/balance.ts` (`alpha`, `police`, `brute`, `progression`), `src/systems/ProgressionSystem.ts`
(stub; call `addBiomass`, `isEquipped`, `hordeAttackRateMultiplier` — do not edit it), `src/entities/ZombieLeader.ts`,
`src/systems/CombatSystem.ts`, `src/systems/ConversionSystem.ts`.

## Locked files
`src/entities/ZombieLeader.ts`, `src/systems/CombatSystem.ts`, `src/systems/ConversionSystem.ts`, `tests/combat.test.ts`,
`tests/conversion.test.ts`, `tests/movement.test.ts`, `tests/alphaCombat.test.ts` (new). You may make **minimal** edits to other existing
test files under `tests/` only where they break because the leader no longer auto-melees (list each in the report) — except
`tests/{navigation,fixes-nav,navScale,world,persistence,pointerLock}.test.ts`, which belong to others.

## Deliver
1. **LMB attack state machine** in `updateLeader` (or a helper it calls): `input.attack` edge while `attackPhase==='ready'` and not
   `hitStun` ⇒ `windup` (`alpha.biteWindup` / `clawWindup`) ⇒ hit resolution ⇒ `recovery` (`biteRecovery` / `clawRecovery[step]`) ⇒ `ready`.
   The leader no longer auto-melees. Forgiving auto-aim at swing start: nearest living enemy human, or the gate/structure if none, within
   `aimRange` inside an `aimConeDeg` cone around facing (bias toward `aimPoint` direction if given); turn to face it. Movement is slowed to
   ~40 % during windup. Emit `attackSwing{pos, facing, combo, hit}`.
2. **Hit resolution in CombatSystem** (`resolveLeaderAttack(ctx)` exported, called at the end of windup — single damage pathway via existing
   `damageGuard`/`damageGate`/`damageStructure`): bite = `biteDamage` within `biteRange`. With `alpha_claws` equipped (`isEquipped`), LMB is a
   3-hit combo: `comboStep` 1→2→3 if the next press lands within `comboWindow` after recovery, else restart at 1; damage `clawDamage[step-1]`,
   range `clawRange`; hit 3 sets the target's `staggerTime = alpha.staggerTime` (HumanAI will respect it). Structures/gate take
   `damage × alpha.structureDamageMultiplier`. Tower occupants remain unhittable from the ground (existing rule).
3. **Infect:** a human killed by the leader's attack gets `killedByAlpha = true` and its pending conversion `willConvert = true`
   (`alpha.infectChance`); horde kills keep the normal roll. Conversion still respects the follower cap.
4. **Hit stun:** `damageLeader` with a single hit ≥ `alpha.hitStunDamage` sets `hitStun = alpha.hitStunTime` (no move/attack); tick it down.
5. **Followers:** attack rate × `hordeAttackRateMultiplier(state)` (keep the legacy Rush multiplier as well until T015); brutes
   (`z.brute`) use `brute.attackDamage` and deal `× brute.structureDamageMultiplier` to gate/structures.
6. **Biomass:** civilian killed by the leader ⇒ `addBiomass(progression.biomassInfect,'infect')`; armed human (soldier/police) killed by
   zombies or leader ⇒ `biomassKill,'kill'`; conversion rise ⇒ `biomassConvert,'convert'`.
7. `role === 'police'` humans: when CombatSystem needs per-role numbers (none today) read `BALANCE.police`; do not change HumanAI.
8. `tests/alphaCombat.test.ts`: bite kills a police officer in the expected number of presses; windup/recovery timing; pressing during
   recovery is ignored; claws combo chaining + window expiry; finisher staggers; leader kill always converts (seeded rng that would fail the
   normal roll); hit stun blocks movement; biomass awarded once per kill; leader can't hit tower occupant from ground; no auto-melee.

## Done when
`npx tsc --noEmit` and `npm test` pass. Report `.agent-context/reports/T004-codex.md` (AGENTS.md format), MEMORY notes.
