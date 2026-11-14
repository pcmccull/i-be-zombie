# V1 — Spec completeness audit (claude-worker, read-only)

- **Task ID & Agent:** V1 / claude-worker (reassigned from agy)
- **Status:** COMPLETED (no P1 gaps found)
- **Verification Run:** `npx tsc --noEmit` 0 errors; `npx vitest run` 38 files / 402 tests pass (37 s). No source/test/config/docs edited.

## Completed Work (audit table: spec requirement -> verdict -> evidence)

### §0 Vertical slice
| Requirement | Verdict | Evidence |
|---|---|---|
| Four connected districts, continuous walk, no loading | MET | tests/openWorld.test.ts:145-170 (one Simulation/state/ctx walks suburbs->police->shopping->industrial); tests/world.test.ts:155 (3 crossings/edge), :204 (no islands) |
| Civilians + police; infect; recruit | MET | openWorld.test.ts:190 (Alpha-killed civilian rises as follower), :210; tests/cascade, recruitment |
| >=2 defended strongholds attacked | MET | openWorld.test.ts:266 (police), :338 (mall); suburb pen headless + browser (T016 report). Industrial NOT captured in any test (see P2-1) |
| Claim a district | MET | ConquestSystem.ts:151-175 `capture` sets district infected; test :266 |
| Unlock + use a mutation | MET | test :288 (Claws combo, Frenzy, Brute) |
| Fog/territory map update | MET | ConquestSystem.ts:67-86 revealAround; ui/mapRender.ts, WorldMap.ts; test :172 |
| Die/respawn keeps progress | MET | RespawnSystem; test :388 |
| Save/reload restores territory + unlocks | MET | persistence/saveSchema.ts createSave/applySave; test :352; T016 browser reload |
| 5 start followers / horde in <30 s | MET | BALANCE.horde.startFollowers=5; test :414 (>=10 at 30 s; T012 measured 21) |
| Desktop browser, no vehicles/interiors, original art | MET | procedural three primitives only |

### §1-3 Contract / architecture
| Requirement | Verdict | Evidence |
|---|---|---|
| Contract skeleton before parallel work | MET | T001; src/core/types.ts, contracts.ts |
| Typed event bus | MET (deviation) | `GameEvent` union + `ctx.emit`/`drainEvents` instead of on/off (ARCH §0, accepted) |
| Spec §3 data shapes (DistrictState exact, StrongholdState, WorldSave) | MET | types.ts; saveSchema.ts:165-236 (adds activeNest, discoveryBits) |
| Fixed-step sim, rAF render, seeded RNG | MET | Game.ts:390-410 accumulator; ctx.rng |
| One damage/infection pathway | MET | CombatSystem damage helpers; `resolveLeaderAttack` shared |
| Persistence never serializes meshes/timers | MET | saveSchema createSave builds plain data |
| Constants data-driven | MET | config/balance.ts; src/content/{abilities,strongholds,districts}.ts |
| 128 m chunks | PARTIAL (deviation) | 80 m render chunks; collision/nav/sim whole-world (ARCH §0). Not a break. |

### §4 Work packages A-H
| Pkg | Requirement | Verdict | Evidence |
|---|---|---|---|
| A | 4 contiguous districts + landmarks, deterministic, collision, POIs, discovery API | MET | world/districtLayout.ts + world/layout/*; tests/world.test.ts:20,37,155 |
| A | Chunk streaming bounded, ids stable | MET | world/worldQueries.ts ChunkStreamer; world.test.ts:242-270; CityDistrict.ts:596-621 unloadChunk disposes geometry/instanced meshes |
| A | "Chunk-based generation" | PARTIAL | Layout generated whole at boot; only rendering streams (documented deviation) |
| B | Chase camera, WASD, sprint, collisions, occlusion | MET | core/ThirdPersonCamera.ts, cameraMath.ts; tests/cameraMath, movement |
| B | Bite, Claws combo, windup/recovery/cooldowns, hit stun, death | MET | ZombieLeader.ts attack state machine; tests/alphaCombat.test.ts (23 tests) |
| B | Pounce | MET (optional) | data-only per spec "only if in scope" (types AbilityId, abilities.ts) |
| B | Fights with zero followers | MET | openWorld.test.ts:210 (zombies=[]) |
| C | Civilians flee / police shoot / zombies follow | MET | HumanAISystem.ts; tests/ai, civilianChase |
| C | Infection->rising->follower pipeline | MET | ConversionSystem.ts; openWorld.test.ts:190 |
| C | 5 start followers; 10-15 in 30 s | MET | test :414 |
| C | Cap 40, no unbounded growth | MET | BALANCE.openWorld.maxFollowers=40 (balance.ts:192); test :440 |
| C | Distant actors cheap | MET | PopulationSystem.ts:28-33 dormant flag (2 Hz), skipped by AI/horde |
| C | Police aim delay, LOS | MET | BALANCE.police.aimDelay; HumanAISystem LOS via collision.segmentBlocked |
| C | Cover positions | MISSING (spec "if feasible") | none found; P3 |
| C | Commands follow/attack/regroup | MET | HordeSystem.ts:104-106,228,262; tests/hordeCommands.test.ts |
| C | 30-40 zombies engage a barricade, acceptable fps | PARTIAL | functionally tested (opening/openWorld :241, T016 browser pen breach 36 horde, 53-97 fps); no automated frame-rate measure |
| D | >=3 strongholds, police first unlock (Claws), mall, industrial | MET | content/strongholds.ts:17-48 |
| D | Objectives (not extermination), shown before/after | MET | ConquestSystem.ts:88-118 objectiveStatus, :178-221; HUD objective tracker (HUD.ts:17,154) |
| D | Territories separate from fog | MET | ConquestSystem setStatus; discovery bits separate; test :172 |
| D | Capture persists; patrol freq. decreases | PARTIAL | reinforcement waves stop after capture (ConquestSystem.ts:228); defenders become civilians (:163). `capturedPatrolFactor` (balance.ts:276) is dead in effect because PopulationSystem.ts:108-110 zeroes budgets when district is `infected`; neighbouring districts' patrols unaffected. See P2-3 |
| D | Alert scaling w/ local aggression, bounded reinforcements | MET | ConquestSystem.ts:226-250 (alert threshold, cooldown, max waves, human cap); conquest.test.ts:197-240 |
| D | Nest on capture: respawn, replenish, equip | MET | ConquestSystem.ts:157-160, replenish :252-297; conquest.test.ts:243-272 |
| D | Recapture hook only | MET | `StrongholdState.captured` never cleared; no recapture system |
| D | Any order; unlock exactly once; persists | MET | openWorld.test.ts:266, :338, :352; ProgressionSystem unlockAbility idempotent (progression.test.ts:57) |
| E | Data-driven registry w/ type, source, cooldown, cost | MET | content/abilities.ts |
| E | Alpha Claws | MET | alphaCombat tests; openWorld :288 maxCombo 3; stagger T008 |
| E | Horde Frenzy +40% move/+50% attack/8 s, cooldown | MET | balance.ts:249-255 exactly; progression.test.ts:184-228 |
| E | Brute Evolution: consume biomass, siege Brute, heavier barricade dmg | MET | balance.ts:256 `brute`; CombatSystem.ts:290 `structureDamageMultiplier`; progression.test.ts:244-355 |
| E | Biomass earned, never negative, no double spend | MET | ProgressionSystem; openWorld :470; mon.minBiomass checks |
| E | 4 slots, eligibility/cooldown/cost pure checks | MET | progression.test.ts:160-243 |
| F | HUD: health, followers, biomass, 4 slots/cooldowns, objective, capture feedback | MET | ui/HUD.ts, uiHelpers.ts; browser T016 |
| F | Minimap + M full map, fog != territory, stronghold annotation (ownership/threat/tier) | MET | ui/Minimap.ts, WorldMap.ts, mapRender.ts:123-181 (tier pips + status colour). Unlock icon not shown on map (P3) |
| F | Waypoint + world marker | MET | WorldMap.onWaypoint -> Game.ts:178-185,225 pillar mesh |
| F | Mutation toast, nest equip UI, no loading screen | MET | HUD toast stack (HUD.ts:159), ui/NestPanel.ts |
| F | Pause: Save, Continue, Reset (confirm) | MET | ui/PauseMenu.ts:5-44 two-step confirm |
| F | Minimal onboarding | MET | HUD.ts:194-278 intro overlay |
| F | Readable at 1280x720 | PARTIAL | verified at 1024x768 in T016; 1280x720 not explicitly recorded |
| G | Readable humans/zombies/Alpha, brute silhouette | MET | visuals/LowPolyCharacters.ts, HordeRenderer.ts; T016 visual check |
| G | Instancing, pooled FX, LOD/culling | MET | HordeRenderer instanced parts + `setView` cull; Effects.ts pools (:114,:336,:366); EntityRenderer.setView cull |
| G | Draw calls/object counts stable after roaming | PARTIAL | chunk unload disposes resources (CityDistrict.ts:596-621); T016 saw 118-215 draws, but no automated check of draw/object growth (P3) |
| G | Dust/capture/frenzy/claw FX | MET | T011 report; Effects.ts |
| H | Versioned LocalStorage save, corrupt/incompatible safe, migrations | MET | saveSchema.ts:19-257 (MIGRATIONS chain), SaveStore.ts never throws; persistence.test.ts:356-470 |
| H | Autosave on milestones + explicit save | MET | `autosave` events, Game flush <=2 s, Pause>Save (T014) |
| H | Required unit tests (infect->recruit, capture->unlock once, discovery!=conquest, cost/cooldown, save round-trip, seed determinism) | MET | recruitment/openWorld:190, :266, discovery.test.ts, progression.test.ts, persistence.test.ts:120, world.test.ts:20 |
| H | Debug overlay (pos, actor counts, chunks, districts, fps, mission flags) | PARTIAL | uiHelpers.ts:365-393 has fps, frame, draws, chunks, human/zombie counts, district status. Missing: player position, scene object count, stronghold/mission flags (P3) |
| H | Smoke checklist | PARTIAL | README "10-minute demo path" (README.md:60) works as a manual route; no dedicated checklist/script file for death/respawn/save-reload |

### §6 Gates
| Gate | Verdict | Evidence |
|---|---|---|
| 0 skeleton compiles | MET | T001, tsc 0 |
| 1 walkable + living NPCs | MET | openWorld :145,:190,:210,:241 |
| 2 territory + progress | MET | :266,:288,:338; map |
| 3 persistence | MET | :352 + browser reload (T016) |
| 4 10-min playthrough, >=50 fps, no memory growth | PARTIAL | headless 10 sim-minute roam bounded (:440); browser fps 53-97 recorded (T016); no 10-min wall-clock human/browser run, no memory measurement |

### §7 Encounter specs
| Requirement | Verdict | Evidence |
|---|---|---|
| Spawn with 5 followers; interactable <10 s; human <15 s | MET | world.test.ts:122-153 (civilian within 40 m, bus/alley <50 m of start); ~4.3 m/s walk |
| Checkpoints = early danger, not instant death; fast recovery | MET | police damage tuned 6->5 (T016); nest replenish + respawn followers (:388) |
| Police station / mall / industrial yard spec features | MET | strongholds.ts; world.test.ts:122 (8 police, 5 police, 8 soldiers + W/E tower guards) |
| Any order, no invisible walls | MET | test :338 |
| Discovery by radius; stored | MET | BALANCE.discovery.revealRadius; discovery.bits persisted |
| Contested on attack/objective damage | MET | ConquestSystem.ts:197-208; conquest.test.ts:130-158 |
| Capture by objective, unlock once, persist | MET | see D rows |
| Zombie reinforcement on capture | MET | nest replenish |
| Local threat escalation, no endless waves | MET | maxReinforcementWaves + cooldown |
| Default follow; RMB attack/move; Shift+RMB / Space regroup | MET | ARCH §4; InputController.ts; hordeCommands.test.ts; input.test.ts |
| Command visual confirmation | MET | move marker (Effects.ts), attack target marker/selection |
| Command expiry/fallback | PARTIAL | move orders expire (HordeSystem.ts:262,335) and attack orders revert on target death (:306); attack orders to a living, unreachable target never expire (P3) |
| No stuck followers; far catch-up teleport | MET | HordeSystem.ts stuck recovery (:759), fallbackWalk, catchUpHidden (MEMORY T007) |
| Controls WASD/Shift/mouse/LMB/RMB/M/QERF/Esc/wheel | MET | ARCH §4, README controls, InputController |

### §8 Data-driven content
| Requirement | Verdict | Evidence |
|---|---|---|
| Strongholds/districts/abilities as immutable config | MET | src/content/*.ts, realized by layout (world.test.ts:59 verifies realization) |
| Entering a district != conquering | MET | openWorld.test.ts:172 |
| District landmark descriptions | PARTIAL | district names/landmarks in content/districts.ts; no in-game blurb (P3) |

### §9 Performance
| Requirement | Verdict | Evidence |
|---|---|---|
| Full AI only in active radius | MET | PopulationSystem dormant (activeRadius 110 m) |
| Pooling, 40 cap, district budgets | MET | Effects pools; budgets world.test.ts:122; caps :141 in population.test |
| Instancing, stable draw calls | MET/PARTIAL | instancing yes; draw-call stability only manually observed |
| Free GPU resources on chunk unload; detach listeners | MET | CityDistrict.ts:596-621; Game.dispose Game.ts:284-312 |
| Spatial hash, no all-to-all | MET | utils/spatialHash.ts; CollisionWorld broadphase (MEMORY T003) |
| Lower update rate at distance | PARTIAL | binary dormant/active only; acceptable ("may") |
| Debug stats | PARTIAL | see H debug overlay |

### §10 Integration tests (all headless in tests/openWorld.test.ts, all passing)
| # | Verdict | Evidence |
|---|---|---|
| 1 Seamless city | MET | :145 |
| 2 Fog != control | MET | :172 (industrial discovered, status 'human', not captured) |
| 3 Infection/horde (follower participates in fighting) | MET (partial participation) | :190 asserts rise+follow; fighting by followers covered by :241 |
| 4 Direct fight, damage received, feedback | MET | :210 (feedback = `attackSwing` event; visuals browser-checked) |
| 5 Order attack | MET | :241 |
| 6 Police station once, Claws once | MET | :266 |
| 7 Equip/use Claws; Frenzy; Brute | MET | :288 (rewards via `unlockAbility`, not via real mall/industrial capture) |
| 8 Free order (mall first) | MET | :338 |
| 9 Persistence | MET | :352 (discovery, capture, mutation, biomass, nest, corrupt save) |
| 10 Death | MET | :388 |
| 11 Streaming bounded | PARTIAL | :440 asserts entity bounds over 10 sim-minutes; renderer chunk bound only in world.test.ts:270 (ChunkStreamer, <=12) and no captured-base-persistence assertion during the roam (captures persisting across applySave in :352) |
| 12 Regression | MET | :470 + minBiomass monitors |

### Final deliverables
| Item | Verdict | Evidence |
|---|---|---|
| Running source, typecheck/build/tests | MET | tsc 0; 402 tests; `npm run build` OK per T016 |
| Play instructions + controls | MET | README.md |
| Reproducible 10-minute demo path | MET | README.md:60-75 |
| Short list of remaining defects | MET | README.md:250 "Known Limitations"; T016 Remaining Work |

## Remaining Work (prioritized gaps)

**P1: none.** All §10 items 1-12 have a passing automated test; slice is playable per T016 browser run.

**P2**
1. **Industrial yard never captured end to end.** Only suburb, police and mall run a real capture (openWorld.test.ts:266/:338; item 7 uses `unlockAbility` shortcut for Brute). The yard objectives (`destroyGate` -> `holdPoint`, ConquestSystem.ts:88-118,178-221) plus Brute Evolution unlock via capture are untested, and the sealed compound + towers make it the riskiest path. Fix: add `capture(sim, mon, 'industrial_yard')` test (gate destroy then hold point) asserting `brute_evolution` unlocked once. Owner: tests/openWorld.test.ts (+ HumanAI/Horde if it fails).
2. **Headless-only evidence for real capture of police/mall/yard in browser, Frenzy/Brute/Claws visuals** (T016 Remaining Work). Fix: one manual GPU playthrough, record in FINAL-VERIFICATION. Owner: orchestrator.
3. **"Captured districts reduce police patrols" only weakly met.** `BALANCE.conquest.capturedPatrolFactor` (balance.ts:276) is effectively dead because PopulationSystem.ts:108-110 zeroes budgets when status is `infected`; no effect on neighbouring districts' patrols (only 2 authored patrol guards in non-suburb districts, world.test.ts:126). Fix: either remove the dead constant/comment or, e.g., in `PopulationSystem`/`HumanAISystem` drop `post==='patrol'` guards or lengthen their idle time in districts adjacent to a captured one. Owner: src/systems/PopulationSystem.ts (balance.ts is orchestrator-owned).
4. **Gate 4 evidence incomplete:** no 10-minute continuous browser run with memory/fps record at 1280x720 (T016 used 1024x768, 53-97 fps, short session). Fix: scripted or manual run, note environment. Owner: orchestrator (V3).

**P3**
- Debug overlay lacks player position, scene object count and stronghold/mission flags (uiHelpers.ts:365-393 `buildDebugLines`; DebugOverlay.ts).
- No automated draw-call/object-count growth check while roaming (spec §G acceptance); could assert `renderer.info` in a smoke script.
- Attack orders on living unreachable targets never expire (HordeSystem.ts around :228,:306); add a timeout fallback to follow.
- No police cover behaviour (spec "if feasible") (HumanAISystem.ts).
- Map does not show a stronghold's unlock reward (mapRender.ts:181 shows tier only); spec says "annotated by ownership/threat/unlock".
- No dedicated smoke checklist file (README demo path serves).
- Uncommitted `src/ui/HUD.ts` diff (T016 flagged unknown author): it removes pointer-lock hints (`showCaptureHint = false`, help rows say orbit by drag). Consistent with fallback play but contradicts T014 locked-mouse mode where LMB first click captures the mouse; decide to keep or discard. Also uncommitted `docs/todos.md`, `.agent-context/PROGRESS.md`.
- Item 11 test does not assert captured bases survive a long roam (relies on :352 for persistence).

## Public Interfaces/Exports Added
None.

## Memory Notes
- Audit found `BALANCE.conquest.capturedPatrolFactor` is dead behind the `infected -> budget 0` rule in PopulationSystem; captured districts get zero civilian/ambient top-ups by design.
- Industrial yard capture path has no automated end-to-end test; add one before final verification.
- Uncommitted HUD.ts diff changes pointer-lock UX copy only; behavior flags `showCaptureHint=false`.
