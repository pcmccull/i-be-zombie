# HH-V1 — spec audit (docs/13_hode_health.md)

- **Task ID & Agent:** HH-V1, agy-worker (read-only audit; executed directly by the Claude wrapper, see Verification Run)
- **Status:** COMPLETED (audit delivered; implementation NOT changed; 1 blocker and several should-fix findings below)

## Completed Work

Read-only audit. No source or test file was edited. Only this report and `[HH-V1]` lines in `.agent-context/MEMORY.md` were written.

### (a) Spec §12 test table → coverage

| # | Spec row | Covering test(s) (file › title) | Status |
|---|---|---|---|
| 1 | Alpha receives bullet damage → strength drops by multiplier | `tests/hordeStrength.test.ts` › "rifle hit on a lone Alpha costs incoming x multiplier / unitHp core units, nothing else"; `tests/hordeHealth.test.ts` › "a lone Alpha rifle hit depletes exactly incoming × multiplier / unitHp core units" | PASS |
| 2 | Follower nonfatal damage → HP drops, strength consistent | `tests/hordeStrength.test.ts` › "a non-fatal follower hit leaves strength unchanged"; `tests/hordeHealth.test.ts` › "nonfatal follower hits leave strength unchanged; a death removes its value only once" | PASS |
| 3 | Follower dies → strength decreases | `tests/hordeStrength.test.ts` › "a follower death is -1 exactly once" | PASS |
| 4 | Five followers die simultaneously → exact once | `tests/hordeStrength.test.ts` › "five simultaneous follower deaths emit one hordeStrengthChanged with delta -5"; `tests/hordeHealth.test.ts` › "aggregates five simultaneous deaths into one delta of -5" | PASS |
| 5 | Alpha hit by explosion → shared damage once | `tests/hordeStrength.test.ts` › "an explosion on the Alpha is shared once"; `tests/shielding.test.ts` › "tank splash damages three followers once each, then the Alpha once as an explosion" | PASS |
| 6 | Explosion hits Alpha and followers → no duplication | `tests/hordeStrength.test.ts` › "explosion on Alpha + followers: follower HP lost = own splash + Alpha share, no duplication" | PASS |
| 7 | New zombie recruited → strength increases | `tests/hordeStrength.test.ts` › "a recruit is +1"; `tests/hordeHealth.test.ts` › "recruitment adds one unit and brute evolution adds two without changing follower count" | PASS |
| 8 | Horde reaches capacity → no overflow | `tests/hordeStrength.test.ts` › "never exceeds maxStrength even when brutes push raw strength above it"; `tests/hordeHealth.test.ts` › "clamps weighted strength to capacity…" | PASS |
| 9 | Strength reaches zero → Last Brain begins | `tests/hordeStrength.test.ts` › "depletion enters Last Brain exactly once; further depletion never restarts the timer"; `tests/hordeHealth.test.ts` › "enters once with a full timer/grace and further depletion never restarts the countdown" | PASS |
| 10 | Alpha recruits during countdown → normal play | `tests/hordeStrength.test.ts` › "a recruit during the countdown recovers and grants a recovery grace that ignores hits"; `tests/hordeHealth.test.ts` › "recovers by recruitment with full recovery grace…" | PASS |
| 11 | Alpha hit during countdown → Alpha dies | `tests/hordeStrength.test.ts` › "a hit after the entry grace during the countdown is the death blow"; `tests/hordeHealth.test.ts` › "finishing an active countdown emits finished and leaderDied once…". Hits inside the 0.4 s entry grace are ignored (finding 3). | PARTIAL |
| 12 | Countdown reaches zero → Alpha dies | `tests/hordeStrength.test.ts` › "countdown expiry is death; respawn restores a full core"; `tests/hordeHealth.test.ts` › "expires through the existing killLeader path exactly once"; `tests/respawn.test.ts` › "real depletion: Last Brain expires after its duration without a finishing hit" | PASS |
| 13 | Alpha fast travels → strength consistent | `tests/hordeStrength.test.ts` › "hideout fast travel keeps strength and coreDamage"; "nest fast travel keeps strength and coreDamage" | PASS |
| 14 | Save and reload → strength and follower state consistent | `tests/hordeStrength.test.ts` › "save -> load keeps coreDamage and recomputes the strength from the core" (zeroes `zombies` by hand, line 355-356); `tests/persistence.test.ts` › "alphaCoreDamage round-trips and tampered values are clamped / ignored" | FAIL on the follower half (finding 1) |
| 15 | Horde maximum upgraded → new capacity applied | `tests/hordeStrength.test.ts` › "claiming a nest raises maxStrength by followersPerNest"; `tests/hordeHealth.test.ts` › "…a real nest claim raises max via followerCap". No non-nest capacity upgrade exists. | PASS |
| 16 | All enemies defeated → no unwanted health change | `tests/hordeStrength.test.ts` › "with every enemy gone strength never changes over 10 s" | PASS |
| 17 | Rapid consecutive hits → consistent | `tests/hordeStrength.test.ts` › "N hits in one step are N distributions and one strength event", "is deterministic per seed and stays finite and in range under heavy barrages"; `tests/hordeHealth.test.ts` › "distributes every hit deterministically…", "ignores negative, zero, NaN and infinite damage/healing…" | PASS |
| + | No code path uses obsolete Alpha HP | No automated test. Enforced only by the type removal (`src/core/types.ts:444`). Grep is clean (see Verification Run). | PARTIAL (finding 8) |

Additional coverage that is not a §12 row: `tests/shielding.test.ts` (interception, nearest-threat preference, source routing), `tests/respawn.test.ts` (real depletion → finishing hit → respawn), `tests/persistence.test.ts` (sanitization), `tests/vfx.test.ts` / `tests/sfxRules.test.ts` (feedback dedupe, heartbeat, recruit throttle), `tests/hudModel.test.ts` (`hordeStrengthView`, `drinkNearby`).

### (b) Spec §13 acceptance criteria

| §13 item | Status | Evidence (file:line) |
|---|---|---|
| Alpha has no independent health bar | PASS | `src/visuals/HealthBars.ts:74-78` (zombie bars only); no `leader.hp` / `hz-hp` / `prevHp` in `src/ui` or `src/visuals` (grep empty) |
| Alpha has no independent gameplay HP | PASS | `src/core/types.ts:444` `LeaderState extends Omit<MobileBase,'hp'\|'maxHp'>`; `src/config/balance.ts` has no `leader.maxHp`; `src/entities/ZombieLeader.ts` creates no hp |
| Horde Strength is the sole survival resource | PASS | `src/systems/CombatSystem.ts:13-26` (damageLeader → applyAlphaDamage only); `src/ui/hudModel.ts:24-60`; `src/ui/hudModel.ts:356` (drink gate reads `coreDamage`) |
| Direct hits damage Horde Strength | PASS | `src/systems/CombatSystem.ts:25` → `src/systems/HordeHealthSystem.ts:74-110` |
| Alpha damage uses a configurable multiplier | PASS | `src/config/balance.ts:353` `alphaDamageMultiplier: 2.5`; used at `src/systems/HordeHealthSystem.ts:79` |
| Follower deaths reduce Horde Strength | PASS | Derived each step: `src/systems/HordeHealthSystem.ts:47-56, 157-161` |
| Recruitment restores Horde Strength | PASS | Same derived path; `src/systems/HordeHealthSystem.ts:169-171` tags cause `recruit`; test "a recruit is +1" |
| Shared damage never double-counted | PASS | Single calculation `computeHordeStrength` (`HordeHealthSystem.ts:47-56`); each recipient damaged once via `damageZombie` (`:86`, `:102`) |
| Strength cannot go negative or exceed capacity | PASS | `HordeHealthSystem.ts:53-54` clamp; `:93` coreDamage ≤ alphaCore; `:115` restoreStrength caps at coreDamage |
| Existing zombie types keep working | PASS | `HordeHealthSystem.ts:33-39` walker 1 / companion 2 / brute 3, no new types |
| Last Brain activates at zero strength | PASS | `HordeHealthSystem.ts:192-199` |
| Recovery through recruitment during Last Brain | PASS | `HordeHealthSystem.ts:201-203` (any strength > 0 recovers; a heal also recovers, see finding 7) |
| Death on countdown expiry or finishing hit | PASS | `HordeHealthSystem.ts:204-206`; `CombatSystem.ts:24`; `finishLastBrain` at `HordeHealthSystem.ts:144-149` |
| HUD shows Horde Strength instead of Alpha HP | PASS | `src/ui/HUD.ts:289-295` (HORDE STRENGTH widget), `:996-998` (fill from `hordeStrengthView`), `:360-361` (LBS takeover); `src/ui/hudModel.ts:24-60` |
| Abilities, upgrades, nests, fast travel compatible | PASS | See §(d) |
| Save/load compatible | PARTIAL | Core round-trips (`src/persistence/saveSchema.ts:391, 548, 594`), but followers are dropped and a depleted core loads into Last Brain (finding 1) |
| Existing enemy combat still works | PASS | 1038/1039 tests pass; HumanAI/Traffic/Tank routing intact (see §(c)) |
| Automated tests and regression checks pass | PARTIAL | HH suites 11 files / 266 tests pass. Full suite: 2 failing files, neither HH-owned (see Verification Run) |
| No unnecessary parallel health system | PASS | Only `state.horde` (§(c)) |

### (c) "No parallel health system"

- **Alpha HP reads/writes in src/:** none. `grep leader\.hp|leader\.maxHp` is empty in `src` and `tests`. The only `.hp` writes on a leader-like object are zombies, guards, structures, and vehicles.
- **Every Alpha damage source goes through `damageLeader(ctx, amount, source)`:**

| Source | Call site | Tag |
|---|---|---|
| Rifle, barricade, MG, tank coax, armed civilian (`hitAlpha`) | `src/systems/HumanAISystem.ts:65` (after interception check, `:60-66`) | `bullet` |
| Tank cannon splash | `src/systems/HumanAISystem.ts:371` | `explosion` |
| Bat / melee | `src/systems/HumanAISystem.ts:469` | `melee` |
| Rammer car | `src/systems/TrafficSystem.ts:339` (plus `hitStun` at `:341`, which is not HP) | `vehicle` |
| CityActivityDirector | No Alpha damage. Heal only at `src/systems/CityActivityDirector.ts:492-493`. | n/a |
| ResistanceSystem | No Alpha damage path (grep: no `damageLeader`, no leader writes). | n/a |
| Hazards / traps / environmental | None exist in the codebase. `'hazard'` is in `AlphaDamageSource` (`src/core/types.ts:830`) but unused. | n/a |
| Abilities (Rush, Frenzy, Claws, Brute Evolution) | None damage the Alpha. | n/a |
| Player vehicle | Vehicle `hp` is separate (`src/systems/PlayerVehicleSystem.ts:140-141`). No Alpha damage. | n/a |

- **Single writer of `state.horde`:** `src/systems/HordeHealthSystem.ts` (lines 93, 106-108, 116, 126-128, 157-161, 175-203). Outside it, only `src/sim/createInitialState.ts:51` (default) and `src/persistence/saveSchema.ts:594` (applySave, clamped). PASS.

### (d) Spec §8 abilities and upgrades

| Item | Dependency on Alpha HP or horde population | Status |
|---|---|---|
| Bite, Infect, Pounce, Alpha Claws (`src/content/abilities.ts:6-37`) | None | PASS |
| Rush, Horde Frenzy (`abilities.ts:14-28`) | Speed and attack only | PASS |
| Brute Evolution (`abilities.ts:33-37`) | Brute raises strength 1 → 3 via cause `evolve` (`HordeHealthSystem.ts:172`), covered by test "recruitment adds one unit and brute evolution adds two…" | PASS |
| Traits (`ProgressionSystem`, `ZombieLeader.ts:131`) | Speed multiplier only; LBS speed stacks at the same point | PASS |
| Vision tiers | None | PASS |
| Companions (`CompanionSystem.ts:102`) | Strength 2 via `strengthValueOf` (`HordeHealthSystem.ts:35-37`); their own 75 HP is individual follower HP | PASS |
| Nests / capacity (`HordeSystem.followerCap`) | Feeds `maxHordeStrength` (`HordeHealthSystem.ts:41-44`) | PASS |
| District or stronghold rewards (`src/content/rewards.ts`) | No health rewards | PASS |
| Healing drinks and convoy supplies | Restore the core only, refused at full core (`ShopSystem.ts:52-57`, `CityActivityDirector.ts:492-493`) | PASS, with decision note (finding 7) |
| Respawn | `resetHordeHealth` refills the core (`RespawnSystem.ts:36`) | PASS |
| Temporary invulnerability | None existed. The only new windows are the HH grace periods. | PASS |
| Save/load of followers | Dropped by design (`saveSchema.ts` canonical rule) | FAIL vs spec §9 (finding 1) |

### (e) §6 HUD and §9 (spec §10) animation and feedback

| Requirement | Evidence | Status |
|---|---|---|
| 6.1 Remove the Alpha health bar | `HealthBars.ts:74-78` (zombie bars only), `HUD.ts` (no Alpha HP markup) | PASS |
| 6.2 Primary bar, current / max, smooth | `HUD.ts:289-295, 996-998` (fill, ghost lag, core segment); `hudModel.ts:43-45` ("X / Y") | PASS |
| 6.3 Alpha hit: meter pulse, red indicator, reaction | `HUD.ts:856-870` (`sharedDamage` → meter, vignette, portrait, directional arc); `EntityRenderer.ts:285` (stagger impulse), `:521-527` (panic pose) | PASS |
| 6.3 Follower death: meter drop, no screen effect | `HUD.ts:856-858` (meter only, no vignette on `hordeStrengthChanged`) | PASS |
| 6.3 Recruit: green pulse | `HUD.ts:857-858` (`is-gain`); `AudioSystem.ts:461` (soft cue) | PASS |
| 6.4 Critical at ~20% | `hudModel.ts:49-56` (`criticalFrac` 0.2), `HUD.ts` (`is-critical`), `AudioSystem.ts:453` (`hordeCritical`, groan gated 20 s) | PASS |
| 6.4 Optional Alpha voice line | Not implemented (optional in spec) | N/A |
| LBS countdown text | `hudModel.ts:52-53` ("LAST BRAIN STANDING! N... FIND A BRAIN!"), `HUD.ts:360-361` | PASS |
| Readable at 375×812 | HH-T005/T008 playtest reports; not re-checked in this audit | PARTIAL (unverified here) |
| §10 Alpha hit: stagger, shared-energy pulse, nearby reactions | `EntityRenderer.ts:285, 521-527`; `vfxRules.ts:123-129` (`horde.tether`, `horde.tetherGlint`, `horde.lastBrainAura`); `damageZombie` sets follower `hit` anim (`CombatSystem.ts:6-7`) | PASS |
| §10 VFX budget, no per-event burst | `vfxRules` `mapEvents` dedupe (≤1 tether, ≤4 glints per batch), tested in `tests/vfx.test.ts` | PASS |
| §10 Audio: heartbeat, recovery, recruit throttle | `AudioSystem.ts:155` (`playHeartbeat`), `:453-461`; `sfxRules.ts` (`HeartbeatScheduler`, `CriticalGroanGate`, `RecruitCueGate`) | PASS |
| §7 projectiles resolve actual target | `HumanAISystem.ts:38-66` (`findShotInterceptor`, tracer retarget) | PASS |

## Remaining Work

Findings, in severity order. Each has file:line, the spec clause, and a suggested fix.

1. **BLOCKER — save/reload drops followers, and a save taken in Last Brain loads into Last Brain.**
   - Spec: §9 ("Saving and loading must preserve the authoritative Horde Strength state"; "Existing followers must retain their health and strength contributions"), §12 row 14, §13 save/load.
   - Evidence: `src/persistence/saveSchema.ts:594` restores only the core. Open-world start has `startFollowers = 0` (`src/sim/createInitialState.ts:29-30`, `:82`). The test at `tests/hordeStrength.test.ts:355-356` clears `zombies` by hand ("followers are transient"), which hides the gap.
   - Compounding: the pause-menu save (`src/core/Game.ts:378` → `saveNow`) can capture `alphaCoreDamage = 6`. On load, `updateHordeHealth` sees strength 0 and starts Last Brain at once (`HordeHealthSystem.ts:192-195`).
   - Fix (orchestrator decision needed): either (a) persist the follower count and re-spawn them on applySave (exception to the canonical rule, which then needs a documented exception); or (b) keep followers transient, but on load never restore a fully depleted core (clamp to `alphaCore - 1` or reset the core as a respawn does) and rewrite the save/load test to use the real load path with no manual clearing. Either way, record the decision in ARCHITECTURE §HH.

2. **SHOULD-FIX — Last Brain re-entry overwrites a longer recovery grace.**
   - Spec: §5.3 ("avoid immediate repeated death/recovery loops").
   - Evidence: `src/systems/HordeHealthSystem.ts:195` `horde.graceLeft = b.lastBrain.entryGrace;` replaces the remaining `recoveryGrace` (1.5 s).
   - Fix: `horde.graceLeft = Math.max(horde.graceLeft, b.lastBrain.entryGrace);`. Add a test. This matches the HH-V2 memory note.

3. **SHOULD-FIX — the entry grace makes an early finishing hit harmless.**
   - Spec: §5.1 ("make Alpha vulnerable to a finishing attack") and §12 row 11 ("Alpha hit during countdown → Alpha dies").
   - Evidence: `src/systems/CombatSystem.ts:16` (`isHordeShielded` returns first) precedes the finishing hit at `:24`. `HordeHealthSystem.ts:195` sets a 0.4 s entry grace.
   - Effect: a hit in the first 0.4 s of the countdown is ignored, which is not the literal §12 wording. The grace was meant to stop same-volley deaths, which only needs the step that caused the depletion to be excluded.
   - Fix: drop the entry grace (set `entryGrace: 0`) and rely on the step ordering, or exempt only hits from the same step that caused depletion. Update the test that pins the 0.4 s behaviour.

4. **SHOULD-FIX (doc/test mismatch) — the interceptor has no 0.6 m endpoint exclusion.**
   - Spec: §3.1 (shielding by actual geometry). ARCHITECTURE §HH-0 says the last 0.6 m before the Alpha is excluded.
   - Evidence: `src/systems/HumanAISystem.ts:9-28` has no exclusion. The test title `tests/shielding.test.ts:108` ("excludes the shot endpoint") covers only a tangent and a zero-length shot. This matches the HH-V2 memory note.
   - Fix: either implement the exclusion (skip followers whose entry `t` is within 0.6 m of the Alpha, measured along the shot) or change ARCHITECTURE §HH-0 and the test title to match the code. Pick one.

5. **NIT — `applyAlphaDamage` ignores its source tag.**
   - Spec: §4 (`applyAlphaDamage(amount, source)`), §7 (route all sources).
   - Evidence: `src/systems/HordeHealthSystem.ts:74` `_source` is unused, so there is no per-source telemetry.
   - Fix: add a per-source tally (fixed-key counters on `horde` telemetry or in scratch) so the F3 panel and tests can check source routing.

6. **NIT — per-hit allocations in the damage path.**
   - Spec: §10 (performance), the architecture's "no per-step allocation" rule.
   - Evidence: `src/systems/HordeHealthSystem.ts:78` `const recipients: number[] = []` on each hit; `:109` the event payload copies `recipients` and `pos`.
   - Fix: reuse a scratch array in the per-state scratch (`scratchFor`), or accept this as a documented minor cost at ≤ 4 recipients per hit.

7. **NIT — a healing drink or convoy supply counts as Last Brain recovery.**
   - Spec: §5.3 says recovery is by recruitment. §4.4 says healing pickups restore strength, so the implementation follows §4.4.
   - Evidence: `src/systems/HordeHealthSystem.ts:201-203`; `src/systems/ShopSystem.ts:57`; `src/systems/CityActivityDirector.ts:493`.
   - Fix: keep it, and record in ARCHITECTURE §HH-0 that a heal is an intended recovery path (it is currently only implied by the §4.4 table).

8. **NIT — no automated guard for the removed Alpha HP.**
   - Spec: §12, last line ("verify that no code path still uses Alpha's obsolete individual health resource").
   - Evidence: only the type removal at `src/core/types.ts:444` enforces it.
   - Fix: add a Vitest case that reads the `src/**/*.ts` files with `node:fs` and asserts no match for `/leader\.(hp|maxHp)\b/`.

9. **NIT — shared damage ignores shot direction.**
   - Spec: §2.3 ("prefer nearby followers") allows this. §3.1 ("physical shielding") is partly undercut: a frontal shot that is not intercepted can kill followers standing behind the Alpha.
   - Evidence: `src/systems/HordeHealthSystem.ts:59-72, 82` (`nearestFollower` by distance only).
   - Fix (optional): weight recipients by alignment with the incoming shot direction, or leave it and note it as a design choice in ARCHITECTURE §HH-0.

10. **NIT — per-step full recompute.**
    - Spec: §4.1 suggests caching where efficient.
    - Evidence: `src/systems/HordeHealthSystem.ts:47-56` loops all zombies and companions each step (≤ ~220 zombies; cost is trivial).
    - Fix: none required. Note the cost in ARCHITECTURE if the population ever grows.

11. **NIT (not HH-owned, verification noise)** — two suite failures at the time of this audit:
    - `tests/instancedSkinning.test.ts` failed to load because of an unterminated template string in `src/visuals/zombieModel.ts:741`, an in-progress VP2 edit. `npx tsc --noEmit` also exited 2 once, during that edit, and exited 0 on a re-run.
    - `tests/ai.test.ts:395` ("stronghold defenders keep retreat routes inside the stronghold bounds") timed out at 5 s under full-suite load. It passes in the 11-file HH subset.
    - Fix: re-run the full suite after the VP2 work settles, and consider a longer timeout for that test.

## Public Interfaces/Exports Added

None (audit only).

## Verification Run

- `npx tsc --noEmit`: first run exit 2 (transient, VP2 edit in progress). Re-run exit 0, no errors.
- `npx vitest run tests/hordeHealth.test.ts tests/hordeStrength.test.ts tests/shielding.test.ts tests/respawn.test.ts tests/persistence.test.ts tests/hudModel.test.ts tests/vfx.test.ts tests/sfxRules.test.ts tests/todos10to12.test.ts tests/carAttack.test.ts tests/ai.test.ts`: 11 files, 266 tests, all pass.
- `npx vitest run` (full): 88 files, 1039 tests. 86 files pass. 2 files fail, neither HH-owned: `tests/instancedSkinning.test.ts` (VP2 syntax in progress) and `tests/ai.test.ts:395` (5 s timeout under load). 1038 tests pass.
- Greps: `grep -rnE "leader\.hp|leader\.maxHp|l\.hp" src tests` returns only non-leader hits (zombie, guard, structure, vehicle). `grep -rn "coreDamage\|restoreStrength"` confirms the single-writer rule. `grep -rn "damageLeader("` returns 4 call sites, all with a source tag.
- The task asked for agy in plan/read-only mode. agy is installed at `C:\Users\phil\AppData\Local\agy\bin\agy`, but I did not invoke it. This audit was done directly by reading the code and running the commands above.

## Memory Notes

- [HH-V1] Audit verdict: §12 covered except the save/reload follower row and the "no obsolete HP" guard. §13 PASS except save/load (PARTIAL).
- [HH-V1] BLOCKER: followers are not saved, so reload restores only the core, and a depleted core loads straight into Last Brain. Decide: persist followers, or clamp the loaded core and fix the test that hides it.
- [HH-V1] `HordeHealthSystem.ts:195` overwrites recovery grace with entry grace. Use `Math.max`.
- [HH-V1] The 0.4 s entry grace makes early finishing hits harmless (`CombatSystem.ts:16` before `:24`). Spec §12 row 11 says a hit during countdown kills.
- [HH-V1] The interceptor has no 0.6 m endpoint exclusion, contrary to ARCHITECTURE §HH-0. Implement it or fix the doc and test title.
- [HH-V1] No automated check for `leader.hp` removal. Add a source-scan test.
