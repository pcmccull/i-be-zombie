# Brief R2 — Simulation systems (agent: codex, sandbox workspace-write)

Read first: `AGENTS.md` (esp. "Recruitment, structures & momentum" and the step order), `docs/2_intial_recruitment_design.md`
§2, §3, §5, §6, §7, `src/core/types.ts`, `src/core/contracts.ts` (MomentumSystem/StructureSystem API comment block),
`src/config/balance.ts` (`recruitPulse`, `structures`, `civilian`, `outposts`, `momentum`, `horde.*` new keys).
R1 already built the layout (`layout.structures`, held spawn zones, civilians, barricade soldiers, 5 start followers) and left
behaviour-neutral `// R2:` shims — replace every one of them with real logic.

**Do not edit** `src/core/types.ts`, `src/core/contracts.ts`, `src/config/balance.ts`, `src/world/districtLayout.ts`,
`package.json`, `AGENTS.md`, or anything under `src/visuals`, `src/ui`, `src/world` (3D), `src/audio`, `src/core/Game.ts`,
`src/core/InputController.ts`. If a contract change is required, stop and report it. Everything you write is `[pure]`
(no `three`), deterministic (`ctx.rng` only), allocation-free in hot loops, no module-level mutable state except scratch
that is overwritten before use (WeakMap side tables keyed by ctx/agent are fine).

## Files you own

`src/systems/HordeSystem.ts`, `src/systems/NavigationSystem.ts`, `src/systems/CombatSystem.ts`,
`src/systems/HumanAISystem.ts`, `src/systems/ConversionSystem.ts`, `src/systems/VictorySystem.ts`,
**new** `src/systems/StructureSystem.ts`, `src/sim/Simulation.ts`,
`src/entities/ZombieLeader.ts` (speed multiplier only), and tests (NOT tests/momentum.test.ts) (new + existing) under `tests/`.

## 1. Momentum wiring (MomentumSystem.ts ALREADY EXISTS — written by the orchestrator, tested in tests/momentum.test.ts)

Do not rewrite `src/systems/MomentumSystem.ts` or `tests/momentum.test.ts`; import from it: `addMomentum(ctx, reason)`,
`updateMomentum(ctx, dt)`, `momentumTier`, `recruitRadiusMultiplier(state)`, `speedMultiplier(state)`, `createMomentum()`.
Your job is the call sites, the multiplier application, and the Simulation step.

Call sites: every new follower via leader/rally/pulse → `'recruit'` (not start followers); `converted` → `'convert'`;
soldier killed with `source:'zombie'` → `'armedKill'` (civilians give nothing on death — they give `convert` if they rise);
destroyed structure with `defensive` and the checkpoint gate → `'structure'`. No double counting of the same event.

Effects: `recruitRadiusMultiplier` scales leader proximity radius, rally radius and pulse radius. `speedMultiplier` scales the
leader's walk/sprint speed (ZombieLeader.updateLeader) and follower speed (HordeSystem). Not ambient wander.

## 2. Cascading recruitment (HordeSystem)

- Shared recruit path (`recruitWithReservation`): sets `recruitGen`, `recruitFlash = horde.recruitBoostTime`, schedules
  `pulseAt = time + delayMin + rng*(delayMax-delayMin)` iff `gen < recruitPulse.maxGeneration`, emits `recruited` with
  `generation`, `stats.recruited++` (and `stats.cascadeRecruits++` when gen ≥ 1), momentum `'recruit'`.
  Refuse `heldBy !== 0` zombies.
- Leader proximity recruit now also requires `!collision.segmentBlocked(leader.pos, z.pos, {mode:'move'})`; same for rally.
- Pulses fire inside `updateHorde` after the hash rebuild: for each follower with `pulseAt >= 0 && pulseAt <= time`: set
  `pulseAt = -1`, query the hash with `radius * recruitRadiusMultiplier`, recruit up to `maxRecruitsPerPulse` closest-first
  eligible ambient zombies (unheld, alive, segment not move-blocked) at `gen + 1`, emit `recruitPulse` (with `recruits` count,
  emitted even if 0). Pulses that become due on the same step all fire that step; zombies recruited by a pulse never fire in the
  same step they joined (their pulseAt is ≥ 0.1 s later). Dead/non-follower zombies' pending pulses are cancelled.
- Converted guards: gen 0, they DO schedule a pulse — but only at the moment they become `'follower'` (end of rise), never at
  `conversionStart` while still `'rising'` (a rising zombie's pulse would be cancelled by the rule above).
- Capacity: unchanged rule; a pulse stops when full (emits `capReached` via the existing flash logic).
- Held zombies: `wander` keeps them in their zone rect (already zone-based) — make sure they never get recruited and ignore the
  leader. After release (`heldBy` 0) they behave as normal ambient zombies (StructureSystem steers them out first).
- **Release must not drift back inside:** on release set `spawnZone = -1`, `stateTime = 0`, `wanderTimer = 0` and the exit
  `wanderTarget`; make `wander()` honour an existing `wanderTarget` even when the zone is missing (move toward it, then idle in
  place) — so released zombies never re-sample points inside their old enclosure.

## 3. Horde responsiveness (§6) — targeted improvements only

- `recruitFlash > 0` ⇒ speed × `horde.recruitBoostMultiplier` and tick it down (in HordeSystem).
- Followers farther than `horde.regroupDistance` from the leader (not engaged) use the follow flow field at catch-up speed
  (no direct-steer to offset), so fast leaders never permanently lose them; after combat, disengaged followers regroup.
- Keep separation stable when 20+ join at once (no explosive impulses); keep the existing stuck-recovery.
- Add a stress test: 100 followers + cascade of 40 in one go, 600 steps, all invariants hold, runtime bounded (< 3 s like the
  existing perf test).

## 4. StructureSystem.ts (new) + Combat/Navigation integration

- `findStructure`, `damageStructure`, `updateStructures` per contracts.ts. Destroy flow per AGENTS.md (disable collider, rebuild
  both nav grids exactly once, release held zombies: `heldBy=0`, one-shot `wanderTarget` = a walkable point `releaseScatter` m
  beyond an approachOutside point (spread across them by `z.id % n`, snapped with `navGrid.nearestWalkable`), `anim 'run'`;
  emit `structureDestroyed`, and `released { count }` **only when count > 0**; `stats.structuresDestroyed++`; momentum if
  `defensive`). `damageStructure` emits both `damage` (target `{kind:'structure',id}`) and `structureDamaged` (incl. `kind`).
  `updateStructures` ticks `hitFlash` and drives the release burst: while a released zombie (tracked in a WeakMap side table
  with its release time) is within `releaseDuration` s of release, it moves to its exit target at `releaseSpeed` (both in
  `BALANCE.structures`) through the opened doorway (direct steer if `navGrid.hasClearWalk`, else the inside→outside approach
  points in order); afterwards normal ambient wander takes over.
- **Target succession:** when an ordered/squad `structure` target is destroyed, retarget that group to the nearest alive human
  whose `shelter === id` (else nearest alive human within `walker.autoEngageRadius * 2` of the structure, else follow) — mirror
  the existing gate→guard succession code (`origin` handling around HordeSystem "Death invalidates resolveTargetPos").
- CombatSystem: `resolveTargetPos`/`isTargetAlive` handle `'structure'` (center; false when destroyed). Melee resolution for
  followers/leader against structures mirrors the gate (nearest-face distance, access ignoring the structure's own collider).
  Leader auto-melee may hit structures it is adjacent to and facing, like the gate.
- HordeSystem engagement for `'structure'` mirrors the gate (goal = `approachOutside[z.id % n]`, nearest-face range test).
  `toggleTarget` accepts structure targets that are alive.
- NavigationSystem: attack field goals for a structure = its `approachOutside`. Effective-target redirect: a `guard` target
  whose `shelter` structure is intact ⇒ effectiveTarget `{kind:'structure', id}` (field to that structure). Shelter is the
  only structure redirect rule (no generic reachability probe). Keep the gate logic.
  Opportunistic auto-engage (follow mode) may pick civilians and barricade soldiers like guards; it must NOT auto-target
  structures (those need an explicit click).

## 5. Humans (HumanAISystem)

- `role === 'soldier'`: existing FSM. Barricade soldiers use `outposts.barricadeRange` instead of `guard.range`; checkpoint
  alert-assist must not chain to/from barricade soldiers across the map (assist only within `alertAssistRadius`, as now).
- `role === 'civilian'`: never shoot. PATROL: walk waypoints at `civilian.walkSpeed`. Perception at aiTickHz: any non-held
  zombie or the leader within `panicRadius` with sight LOS ⇒ `RETREAT` (flee) and emit `guardAlert` once on entry. Flee: move
  away from the nearest threat at `civilian.fleeSpeed`, slide with `collision.moveCircle`, clamp the result inside `homeArea`
  (if set) — cornered civilians cower (anim 'idle'/'hit' flinch is fine). Return to PATROL after `calmTime` without a threat.
  Sheltered civilians inside the intact store only panic, they cannot leave (homeArea clamp).
- `guardDied` events include `role`. Death/conversion path is shared: civilians killed by zombies roll the normal conversion.
  `stats.guardsKilled` counts all humans.

## 6. Victory

`gate.destroyed && every guard with post==='checkpoint' is DEAD`. Defeat unchanged.

## 7. Simulation.step

Insert `updateStructures` and `updateMomentum` after `updateConversion` (AGENTS.md step 9b). HordeSystem owns `recruitFlash`
ticking. Non-playing phase: unchanged. `guardAlert` events now carry `role` (contract updated) — include it.

Known pacing note: only ~11 zombies are free near the start (5 followers + park-edge 6); reaching ~20 by 25 s is intended to
come from breaking the bus (15). The opening autopilot test should therefore break the bus door early on its route.

## 8. Tests (required, all `[pure]`)

- `tests/cascade.test.ts`: generation chain (hand-made layout/fixture: leader recruits A, A's pulse recruits B at gen1, B →
  C gen2, C → D gen3, D never pulses; nothing beyond maxGeneration); stagger (pulse fires in [delayMin, delayMax]); each zombie
  pulses exactly once (no loops, `pulseAt` -1 after); `maxRecruitsPerPulse` bound; capacity never exceeded during a large
  cascade and `followerCount` invariant every step; walls block pulse recruitment; held zombies never recruited by leader, rally
  or pulse; start followers don't pulse; momentum radius multiplier widens a pulse.
- `tests/structures.test.ts`: damaging a structure to 0 disables its collider, bumps nav version once, releases exactly the
  zombies with that heldBy, emits events once, released zombies can then be recruited and reach outside; ordering an attack on a
  sheltered store civilian redirects to the store door; bus/alley/pen enclosures reachable after destruction on the real layout.
- `tests/momentum-integration.test.ts` (new file; `tests/momentum.test.ts` already covers the pure module): each call site
  awards exactly once (recruit, cascade recruit, conversion, soldier kill by zombies, civilian kill gives nothing, defensive
  structure + gate destroy); start followers give nothing; leader walk/sprint speed and follower speed scale with momentum.
- `tests/opening.test.ts` (real layout, seeded): a scripted autopilot (leader steered along a fixed waypoint route via
  `SimInput.cameraYaw`/`moveForward`, with attack clicks on the bus door when near it) must reach **≥ 30 followers within 60 s
  of sim time** and never exceed `maxFollowers`; at t=0 followerCount === 5; the first human is within 10 s walking distance
  (path length via `navGrid.findPath` / walkSpeed ≤ 10). Keep the test under ~10 s runtime.
- `tests/humanAI` additions: civilians never emit `shot`; civilians flee (distance to threat increases) and stay in homeArea;
  barricade soldiers use the shorter range.
- Victory test: barricade/civilian humans alive does not block victory.
- All existing tests keep passing (update expectations only where the new design intentionally changes them, keeping intent).

## Done when

`npx tsc --noEmit` and `npm test` pass. Report: files changed, design decisions, any spec items you could not meet, measured
opening result (followers at 30/60/90 s on the autopilot route), and runtime of the stress test.
