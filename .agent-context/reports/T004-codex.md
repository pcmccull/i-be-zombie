# T004 Alpha direct combat

**Task ID & Agent:** T004 / codex

**Status:** COMPLETED

**Completed Work:**

- `src/entities/ZombieLeader.ts`: LMB-only bite/claw attacks, windup and recovery timing with elapsed-time carryover, three-hit combo chaining and expiry after recovery, ignored recovery presses, target-facing lock during swings, 40% movement speed during windup, and no movement/attacks while stunned. Dead leaders cannot attack.
- `src/systems/CombatSystem.ts`: exported Alpha aim/impact helpers; nearest reachable living human in the configured cone/range takes priority over gate/structure targets, measured at their nearest face. Impact rechecks range, cover, living/dormant state, and tower elevation. Emits `attackSwing` for hits/misses and retains `melee` events for hits. Removed all automatic leader melee.
- Central damage helpers now attribute lethal Alpha hits, guarantee infection using `alpha.infectChance`, award civilian infection/armed-kill biomass once, apply claw finisher stagger, and cancel attacks/combos on large-hit stun. Existing horde callers retain normal conversion rolls.
- Followers use Frenzy attack rate multiplied by legacy Rush; brutes use configured attack damage and siege multiplier against gates/structures. Dormant combatants are skipped. Combat and conversion continue in `respawning` for the upcoming simulation integration.
- `src/systems/ConversionSystem.ts`: conversion-rise biomass is awarded once when a zombie becomes a follower. Guaranteed Alpha conversions still obey the existing follower-plus-rising cap. Dormant rising zombies reserve capacity without advancing.
- `tests/alphaCombat.test.ts` (new): 23 tests cover police bite presses, no automatic melee, timing, ignored recovery presses, combo chaining/expiry/finisher stagger, equipped requirement, auto-aim/cone/aim hints, range/cover/tower restrictions, hit/miss events, infection attribution, one-time biomass, hit stun, Frenzy/Rush cadence, brute damage, and dormant/respawn behavior.
- `tests/combat.test.ts`: replaced the obsolete leader automatic-melee test with explicit LMB attacks independent of horde orders; all assault tests retained and passing.
- `tests/conversion.test.ts`: updated the expected rise event stream for biomass; added guaranteed-infection cap and dormant/respawn rise/reward coverage.
- `tests/movement.test.ts`: added immediate windup slowdown coverage for a leader already sprinting.
- **Only extra pre-existing test file edited:** `tests/structures.test.ts`. Minimal changes add the explicit bite windup and configured bite-damage expectation to the former automatic-melee assertion. No other extra test files were edited; all specifically forbidden test files were untouched.
- Appended T004 decisions and downstream handoff notes to `.agent-context/MEMORY.md`.

**Remaining Work:**

- None within T004.
- T008 owns consumption/ticking of `GuardAgent.staggerTime` in HumanAISystem (no movement/shooting during stagger); T004 only sets the finisher state as required.
- T012 owns the open-world simulation step order and continued simulation during respawn. Both modified systems already accept that phase.
- No shared contracts, balance/content files, other workers' implementation files, Git branches, or commits were changed by this task.

**Public Interfaces/Exports Added:**

- `aimLeaderAttack(ctx: SimContext, aimPoint: Vec2 | null): void` selects/stores the swing target and turns the Alpha at attack start.
- `resolveLeaderAttack(ctx: SimContext): void` resolves an expired windup exactly once, transitions to recovery, routes damage through existing helpers, and emits swing feedback.
- `damageGuard` gains an optional fifth argument, `byAlpha = false`; its existing four-argument API remains compatible. No change to `DamageSource` or any shared model contract.

**Verification Run:**

- Initial targeted run (`npx vitest run tests/alphaCombat.test.ts tests/combat.test.ts tests/conversion.test.ts tests/movement.test.ts`): exposed two obsolete assertions and one aim-cone fixture placement error; corrected.
- Initial full `npm test`: 290/291 passing; the sole remaining failure was the permitted structure test's obsolete automatic-melee assertion; updated that assertion to an explicit bite.
- **Final `npx tsc --noEmit`: PASS**, exit 0, no diagnostics.
- **Final `npm test`: PASS**, exit 0; **30 test files / 292 tests passed**, none skipped, duration 21.53 seconds. This includes all pre-existing suites and concurrent T002/T005 work present at verification time.

**Memory Notes:**

- `SimInput.attack` is already an edge; recovery presses are discarded instead of buffered. Combo windows start after recovery. The attack type is captured by `comboStep` at swing start so a current attack does not change if equipment changes mid-swing.
- The optional Alpha damage flag applies to the lethal hit only, preserving the normal horde roll after an earlier nonlethal Alpha hit. Biomass is emitted through T005's `addBiomass`, never by directly mutating progression in combat/conversion.
- Target metadata lives in a leader-keyed WeakMap and is replaced at every windup. Impact revalidates access rather than damaging a target that moved out of reach or behind cover.
- Stun cancels pending attacks and combo state; a fresh attack edge is required after stun. Claw stagger is recorded here and must be respected by the HumanAI owner.
