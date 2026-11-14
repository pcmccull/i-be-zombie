# V2 - adversarial bug / edge-case review (READ-ONLY) - claude (reassigned from codex)

**Task ID & Agent:** V2 / claude-worker
**Status:** COMPLETED (no repo files edited; only this report written)

## Completed Work (findings, most severe first)

No P1 (crash / softlock / data loss / progression break) was substantiated. Hold points, objectives,
captures, unlocks and the respawn path all trace cleanly end to end. Two P2 and several P3 defects are
substantiated below.

### P2-1  Conversion ignores the open-world follower cap (40) and uses the legacy cap (100)
- File: `src/systems/ConversionSystem.ts:34`
  `if (!pending.willConvert || s.followerCount + rising >= BALANCE.horde.maxFollowers) continue;`
- HordeSystem (`followerCap`, line 51) and ConquestSystem (`spawnNestFollowers`, line 255) both switch to
  `BALANCE.openWorld.maxFollowers` (40) when `layout.strongholds.length > 0`. Conversion does not.
- Scenario: followerCount = 40, then 20 pending conversions resolve. Verified with a throwaway vitest
  (scratch dir, real `Simulation(buildDistrictLayout())`): 20 rising zombies were created, so 40 followers
  plus 20 rising become 60. The horde grows to 100.
- Consequences: breaks the "cap 40" spec invariant. HUD shows "HORDE 60 / 40". `capReached` is never raised
  for conversions. `HordeRenderer` has `maxInstances = 220` (`HordeRenderer.ts:108`), and ambient (up to 160)
  plus followers plus corpses can exceed it, so the last zombies in the array (new followers) silently stop
  rendering.
- Fix: export `followerCap(ctx)` from HordeSystem and use it in ConversionSystem. Add a test with 40
  followers plus pending conversions in an open-world layout.

### P2-2  Dead Alpha can still activate abilities (spends biomass and cooldown with no Alpha)
- File: `src/systems/ProgressionSystem.ts` (`updateProgression`, around lines 124-131, and `activateAbility`).
- `Simulation.step` calls `updateProgression` while `phase === 'respawning'`. Neither it nor `canActivate`
  checks `leader.alive`.
- Scenario: Alpha dies, then the player presses Q/E (Frenzy or Brute). Biomass and cooldown are spent. Frenzy
  fires at the corpse position and the 8 s buff mostly elapses during the respawn delay. Brute evolution
  picks followers nearest the corpse.
- Fix: in `canActivate`, return a deny reason (e.g. `'locked'`/`'noTarget'`) when
  `!state.leader.alive || state.phase !== 'playing'`. Frenzy/cooldown timers can keep ticking.

### P2-3  Saved "contested" district status can never revert after load
- Files: `src/persistence/saveSchema.ts` (applySave step 3) and `src/systems/ConquestSystem.ts`
  (`updateStronghold`, lines ~187-195).
- `districts[id].status = 'contested'` is saved and restored, but `StrongholdState.contested` is not saved
  and is `false` after load. The only path back to `'human'` is `if (sh.contested && quiet >= 30)`, which is
  never entered while `sh.contested` is false. When the player later attacks, `if (!sh.contested)` flips it
  true and re-emits, but until then the map and HUD show CONTESTED indefinitely.
- Likelihood: autosave fires on discover/capture/respawn. A discover autosave mid-fight, or a respawn save
  during a fight, writes `'contested'`.
- Fix: in applySave, set `sh.contested = (district.status === 'contested')` for uncaptured strongholds
  (and `r.quiet` starts at 0 so it decays normally). Alternatively normalise `'contested'` to `'human'` on
  load.

### P3 findings
1. **Respawn-nest auto-switch breaks after a reload.** `ConquestSystem.ts:~330`
   (`if (s.activeNestId !== r.autoNest) r.nestChosen = true;`). After loading a save whose `activeNestId` is
   a captured nest, `nestChosen` flips true on the first step. Later captures then never move the active
   (respawn) nest, unlike a no-reload run. Fix: only set `nestChosen` from an explicit player selection, or
   initialise `r.autoNest = state.activeNestId`.
2. **Cooldowns and reinforcement timer are not persisted.** `progression.cooldowns`, `frenzyTimeLeft` and
   `StrongholdState.lastReinforcementAt` (-Infinity on load) reset on reload. Reloading gives a free Frenzy
   or Brute cooldown reset and allows an immediate reinforcement wave. Acceptable if intentional; otherwise
   add them to `WorldSave`.
3. **applySave does not validate that the selected nest is active.** `saveSchema.ts:~320`
   (`requestedNest = layout.nests.find(id)`). A save with `selectedNestId` of a nest whose stronghold is not
   captured places the Alpha in a sealed compound. Only reachable with a hand-edited or inconsistent save.
   Fix: require `nest.strongholdId === null || capturedStrongholds.has(nest.strongholdId)`, else fall back
   to the start nest (the captured set must be computed first).
4. **Captured tower guards stay on the platform as "civilians".** `ConquestSystem.ts capture()` flips
   role/post but leaves `tower`, `towerColliderId` and `elevation = 4`. Industrial tower soldiers become
   street civilians floating at 4 m. Their patrol returns early on `g.tower` and flee steps ignore elevation.
   Fix: on capture, remove tower guards (or reset `tower`/`elevation`, teleport to a walkable point).
   `EntityRenderer` also keeps the soldier rig look after a role flip (cosmetic).
5. **`EntityRenderer.disposableMaterials` grows without bound** (`EntityRenderer.ts:~551`). Each lazily
   created guard rig pushes its materials, and `disposeGuardEntry` disposes them but never removes them from
   the array. With civilian respawn every 20 s per district, long sessions leak JS references. It also
   allocates `new Set()` per frame (`updateGuards`), which is minor GC churn.
6. **`HordeRenderer.maxInstances = 220`** can clip when ambient (cap 160) plus followers (40) plus
   corpses/rising exceed 220. The later array entries (new followers/corpses) vanish. Raise to about 320 or
   cull ambient first.
7. **O(G^2) target scan in `followerSwingTarget`** (`CombatSystem.ts` ~lines 262-275). For each follower
   with cooldown 0 and an attack order it calls `canMelee` for every guard, and `canMelee` begins with the
   linear `guardFor(id)`. With about 100 loaded guards and 40 followers that is roughly 10M+ iterations per
   second. Fix: do the distance test before `canMelee`, or give `canMelee` the `GuardAgent` directly.
8. **Save robustness.**
   - No save on `pagehide`/`visibilitychange`. An autosave deferred by the 2 s throttle (e.g. a capture
     right after a discover save) is lost on tab close.
   - `parseSave` returns null for `version > SAVE_VERSION`, so a downgrade silently starts fresh and the
     next autosave overwrites the newer save.
   - `rng` state is not saved, so the sequence restarts from the seed on load (harmless).
9. **Biomass farming.** Civilians respawn every 20 s per non-infected district. Alpha kills grant 3 biomass
   (+2 on conversion), so a patient player can farm Brute Evolution biomass. This is a tuning/design note;
   infected districts stop respawning, which bounds it.
10. **Minor.**
    - `ConquestSystem.guardHp` Map entries are never deleted (tiny leak).
    - `updateConquest` allocates a `Set` and a `Map` per step.
    - `killDefenders` progress can visually regress when old corpses are pruned by Population after 30 s
      (completion logic is unaffected).
    - Nest panel keys `1-4`/`[`/`]` are handled via `onUiKey` before the modal-key filter, so they work
      under the pause menu too (equip is queued and applied after unpause).
    - Ability keys during a frame with no sim step are retained until the next step (fine).

### Verified OK (no defect found)
- Double rewards/unlocks: `capture()` is guarded by `sh.captured`, and `unlockAbility` is idempotent.
  `damageGuard` rewards fire only on the transition to DEAD. `damageStructure` is guarded by `destroyed`.
- Negative biomass / cooldown bypass: `canActivate` checks biomass and cooldown before spending. Brute count
  is clamped by biomass, cap and eligible targets. Moving a slot preserves the cooldown (keyed by id).
- followerCount invariant: `killZombie`, `recruitWithReservation`, conversion rise, `spawnNestFollowers` (cap
  and rising aware), `applySave` recount and brute evolution are all consistent. Only the conversion cap
  (P2-1) is wrong.
- Softlocks: holdPoint follower counting ignores dormancy correctly (followers are never dormant).
  Objectives only require reachable structures/defenders. Reinforcement waves are capped. `killDefenders`
  with zero defenders completes. A missing active nest falls back to the start nest, which is always active.
- Dormant agents: `damageGuard`/`damageZombie`/`canMelee`/`resolveTargetPos`, HumanAI and perception all
  skip dormant agents. Followers are re-woken every step.
- Unbounded growth: guards are bounded by `maxHumans` and pruned after 30 s. Ambient is bounded by
  `maxAmbient`. Corpses fade. `pendingConversions` are resolved or dropped. Effects use fixed pools. Chunk
  unload disposes geometry/materials/instanced meshes, and chunk listeners unsubscribe in dispose.
- `Game.dispose` removes window/document listeners and disposes input (AbortController), HUD, audio,
  renderers.
- Determinism: no `Math.random`/`Date` in `[pure]` src (only a comment in types.ts).
- Save: `applySave` is idempotent for nav rebuilds, ignores unknown ids, filters objective ids, clamps
  numbers, and rejects bad base64 in `parseSave`.

## Remaining Work (suggested fix plan, in priority order)
1. ConversionSystem: use the shared follower cap (export `followerCap` from HordeSystem). Add a regression
   test: 40 followers plus N pending conversions in an open-world layout => followerCount + rising <= 40.
2. ProgressionSystem: deny activation unless `leader.alive && phase === 'playing'`. Add a test for the
   respawning phase.
3. saveSchema.applySave: after restoring strongholds, set `sh.contested = districts[id].status === 'contested'`
   (or normalise to `'human'`). Also validate `selectedNestId` against captured strongholds.
4. ConquestSystem: initialise `autoNest` from `state.activeNestId` and track `nestChosen` explicitly.
   Retire or re-skin captured tower guards.
5. Optional hardening: `CombatSystem.followerSwingTarget` distance pre-check, `EntityRenderer`
   material-array pruning, raise `HordeRenderer.maxInstances`, save on `pagehide`.

## Public Interfaces/Exports Added
None.

## Verification Run
- Throwaway vitest in the scratchpad (outside the repo): `npx vitest run --root <scratch>` confirmed P2-1
  (rising 20, followerCount 40 => 60 total, cap 40). No repo files changed.
- No repo test/tsc run was needed (read-only task).

## Memory Notes
- ConversionSystem still reads `BALANCE.horde.maxFollowers` (100) in open-world; the cap must go through the
  `followerCap(ctx)` helper everywhere.
- `StrongholdState.contested`, `cooldowns`, `frenzyTimeLeft` and `lastReinforcementAt` are not saved.
  Anything derived from them (status `'contested'`) must be normalised on load.
- Pure-sim scratch tests can run outside the repo with `npx vitest run --root <scratch dir>` and absolute
  imports of repo src.
