# AGENTS.md — I BE ZOMBIE
# Universal Subagent Protocol

1. **Mandatory Context Load:** Before modifying any file, read:
   - `.agent-context/ARCHITECTURE.md`
   - `.agent-context/MEMORY.md`
   - `.agent-context/PROGRESS.md`
2. **Strict File Scope:** Only create or edit files listed in your assigned `Locked Files` scope. Never alter files owned by another active task.
3. **Progress & Memory Reporting:** Before exiting (including if you hit a rate limit, credit exhaustion, or quota error), you MUST write a structured report to `.agent-context/reports/<TASK_ID>-<agent>.md`:
   - **Task ID & Agent:**
   - **Status:** `COMPLETED` | `QUOTA_EXHAUSTED` | `BLOCKED` | `NEEDS_REVIEW`
   - **Completed Work:** (files created/modified and what is already working)
   - **Remaining Work:** (exact functions, files, or steps left unfinished—required if `QUOTA_EXHAUSTED`)
   - **Public Interfaces/Exports Added:**
   - **Verification Run:** (commands executed and pass/fail output)
   - **Memory Notes:** (gotchas, edge cases, or decisions to append to `MEMORY.md`)

Shared conventions for every agent (Claude orchestrator, Codex, Antigravity) working in this repo.
**The game spec is [`docs/1_design.md`](docs/1_design.md)** (referred to by some prompts as GAME_DESIGN.md), extended by
**[`docs/2_intial_recruitment_design.md`](docs/2_intial_recruitment_design.md)** ("recruitment spec": fast opening, cascades,
landmark structures, momentum), and by **[`docs/3_open_world.md`](docs/3_open_world.md)** ("open-world spec": four contiguous
districts, strongholds, territory, fog, mutations, persistence). On gameplay, later specs win over earlier ones; the repo-adapted
decisions are in `.agent-context/ARCHITECTURE.md` §0. When this file and
the spec disagree on *architecture*, this file wins; on *gameplay*, the spec wins.

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Dev server | `npm run dev` (Vite, http://localhost:5173) |
| Type-check + production build | `npm run build` (`tsc --noEmit && vite build`) |
| Tests (headless, no WebGL) | `npm test` (`vitest run`) |
| Single test file | `npx vitest run tests/navigation.test.ts` |
| Type-check only | `npx tsc --noEmit` |

Every task must finish with `npx tsc --noEmit` and `npm test` passing. Do not leave failing or skipped tests.

## Stack (fixed — do not add dependencies)

- `three` + `@types/three`, `typescript` (strict), `vite`, `vitest`. Nothing else.
- **Forbidden:** React, Phaser, Rapier/Cannon/Ammo, ECS libs, nav-mesh libs, CDN/runtime downloads, remote assets.
- All art is generated in code from Three.js primitives (flat-shaded low-poly). Audio is synthesized with Web Audio.

## Directory structure & ownership

`[pure]` = no `three` import allowed, must run under Vitest in Node. `[3D]` = may import three.

```text
index.html                     Canvas host + HUD root (#app, #hud)
src/
  main.ts                      [3D] Boot: new Game(document.getElementById('app')).start()
  config/balance.ts            [pure] ALL tuning numbers (BALANCE). Orchestrator-owned.
  core/types.ts                [pure] Data model CONTRACT. Orchestrator-owned.
  core/contracts.ts            [pure] Module interface CONTRACT. Orchestrator-owned.
  core/Game.ts                 [3D] Owns renderer, scene, loop (fixed 1/60 accumulator), wires sim->visuals->HUD
  core/InputController.ts      [3D] Keyboard/pointer -> SimInput; click vs drag; raycast picking
  core/ThirdPersonCamera.ts    [3D] Orbit/follow/zoom/occlusion camera
  core/cameraMath.ts           [pure] camera/occluder fade math shared by camera, CityDistrict, Landmarks
  core/gameFlow.ts             [pure] GameFlowState (LOADING/INTRO_CINEMATIC/PLAYING/PAUSED) + central input gate
  core/cinematicMath.ts        [pure] Catmull-Rom camera keys, easing, subtitle cues, narration clock
  core/CinematicController.ts  [3D] scripted camera driver (animates the game camera; no own loop)
  content/intro.ts             [pure] opening cinematic script (cues, keyframes, music cues, first objective)
  world/tropicalLayout.ts      [pure] beach/ocean/palm/traffic-lane data from a DistrictLayout
  world/TropicalScenery.ts     [3D] render-only ocean, beach, palms, umbrellas, ambient traffic
  ui/CinematicOverlay.ts       fade, letterbox, subtitles, Skip Intro, start prompt, objective card (+ ui/intro.css)
  audio/IntroAudio.ts          narration (assets/voiceover/intro2.mp3) + synthesized intro/gameplay music
  sim/Simulation.ts            [pure] implements ISimulation; owns SimContext; fixed step order (below)
  sim/createInitialState.ts    [pure] DistrictLayout + Rng -> GameState (leader, start followers — 0 open world / 5 legacy, 85 ambient incl. 45 held, 16 humans, gate, structures, momentum)
  world/districtLayout.ts      [pure] buildDistrictLayout(seed?): DistrictLayout — the open world (4 districts) as data
  world/layout/*.ts            [pure] roads + per-district builders used by districtLayout
  world/legacyDistrictLayout.ts [pure] buildLegacyDistrictLayout() — recruitment-milestone district; Simulation default + test fixture
  world/worldQueries.ts        [pure] getDistrictAt, chunk math, ChunkStreamer
  content/{abilities,strongholds,districts}.ts [pure] data-driven content. Orchestrator-owned.
  persistence/saveSchema.ts    [pure] WorldSave create/apply/parse(+migrate)
  persistence/SaveStore.ts     localStorage adapter (injectable StorageLike), never throws
  systems/ProgressionSystem.ts [pure] biomass, unlocks, loadout, Horde Frenzy, Brute Evolution
  systems/ConquestSystem.ts    [pure] objectives, capture-once, territory status, alert/reinforcements, nests, discovery
  systems/RespawnSystem.ts     [pure] leader death -> respawning -> nest respawn
  systems/PopulationSystem.ts  [pure] dormant flags (active radius), budgeted respawns, caps
  world/CollisionWorld.ts      [pure] implements ICollisionWorld
  world/NavigationGrid.ts      [pure] implements INavigationGrid (+ FlowField implements IFlowField)
  world/CityDistrict.ts        [3D] Builds city meshes from DistrictLayout (merged/instanced)
  world/Checkpoint.ts          [3D] Checkpoint meshes, gate damage visuals, pick proxies
  entities/ZombieLeader.ts     [pure] createLeader, computeMoveVector, updateStamina, updateLeader
  entities/Zombie.ts           [pure] createZombie (ambient / converted)
  entities/HumanGuard.ts       [pure] createGuard
  entities/Structure.ts        [pure] createGate, createStructures (layout.structures -> StructureState[])
  systems/HordeSystem.ts       [pure] applyHordeCommands, updateHorde (recruit, rally, rush, flocking, ambient wander)
  systems/NavigationSystem.ts  [pure] updateNavigation (shared flow fields, effective target, replans <= 5 Hz)
  systems/CombatSystem.ts      [pure] updateCombat + damage helpers + resolveTarget
  systems/HumanAISystem.ts     [pure] updateHumanAI (FSM PATROL/ALERT/COMBAT/RETREAT/DEAD, LOS, shooting)
  systems/ConversionSystem.ts  [pure] updateConversion (delayed 70% rise, cap)
  systems/VictorySystem.ts     [pure] checkVictory (gate destroyed AND every post==='checkpoint' human DEAD)
  systems/StructureSystem.ts   [pure] findStructure, damageStructure, updateStructures (destroy -> release held zombies)
  systems/MomentumSystem.ts    [pure] addMomentum, updateMomentum, momentumTier, recruitRadiusMultiplier, speedMultiplier
  systems/HordeHealthSystem.ts [pure] Horde Strength (the Alpha's only survival resource): shared Alpha damage, core, Last Brain Standing
  world/Landmarks.ts           [3D] Bus, locked alley, convenience store, police barricade/pen meshes + damage/release visuals + pick proxies
  visuals/LowPolyCharacters.ts [3D] Human (guard/police/civilian) rigs + procedural animation
  visuals/zombieRig.ts         [pure] zombie skeleton dims, ZombiePose, leg FK/grounding helpers
  visuals/zombieProfiles.ts    [pure] deterministic per-id looks (8 archetypes) + gait personalities (6 body types), atlas tile ids
  visuals/zombieAnimation.ts   [pure] zombie animation controller: IK gait, springs, twitches/lurches, attack keys, death/rise
  visuals/zombieModel.ts       [3D] zombie part/accessory geometry, atlas material patch, composeBones, Alpha hero rig
  visuals/zombieTextures.ts    [3D] procedural seamless texture atlas + normal map (canvas)
  visuals/HordeRenderer.ts     [3D] InstancedMesh-per-part renderer for all ZombieAgents (side-table of profiles/anim state, LOD)
  visuals/EntityRenderer.ts    [3D] Leader + guards + gate sync from GameState (interpolated)
  visuals/Effects.ts           [3D] Pooled tracers, muzzle flashes, rings/pulses, sparkles, dust, camera shake requests
  audio/AudioSystem.ts         [3D-side, no three needed] Web Audio synth SFX; unlock on gesture; mute-safe
  ui/HUD.ts                    DOM/CSS overlay (no framework), reads GameState + events; renders hudModel view models
  ui/hudModel.ts               [pure] HUD view models (Horde Strength, horde, objective, abilities, context actions, banners, minimap math)
  ui/hudIcons.ts               [pure] SVG icon set drawn in code (icon(), abilityIcon())
  ui/hudTheme.css              design tokens (--hz-*), --hz-u scale unit, surfaces, key caps, buttons, keyframes, reduced motion
  ui/hud.css                   gameplay HUD layout/components; ui/hudPanels.css menus/modals/nest/world-map frame
  world/boundaryLayout.ts      [pure] world-edge segments/colliders + backdrop rects (expand spec)
  world/BoundaryScenery.ts     [3D] render-only edge dressing + backdrop (instanced, ~18 draw calls)
  systems/AwarenessSystem.ts   [pure] zombie vision (identified/seen, LOS budget) + sense cues; isIdentified/isSeen/canTarget
  core/visionMath.ts           [pure] hazeFactor, tierBlend, lerpProfile, humanVisual
  visuals/VisionFog.ts         [3D] world-space vision haze material patch (shared uniforms)
  ui/SenseIndicators.ts        screen-edge sense-cue arcs (pooled DOM)
  graphics/performance/GraphicsQuality.ts [pure] low/medium/high presets + reducedMotion, localStorage `ibz.graphics.v1`
  graphics/performance/{frameStats,benchmark}.ts [pure] frame p50/p95 window; `?bench=1|2` stress population
  graphics/performance/GraphicsDiagnostics.ts  F3 graphics panel (calls, tris, casters, particles)
  graphics/materials/surfaceDetailMath.ts [pure] surface ids + tileable detail atlas bytes
  graphics/materials/SurfaceDetail.ts [3D] world-space detail patch (`aSurface` attr) + foliage wind
  graphics/lighting/LightingController.ts [3D] sun/hemi/fill, shadow size per preset, follows focus
  graphics/postfx/PostProcessingPipeline.ts [3D] display-referred grade + saturated-only bloom (copy canvas → quad)
  graphics/vfx/vfxRules.ts     [pure] emitter configs, GameEvent → VfxName mapping, budgets, footstep picker, surfaceAt
  graphics/vfx/{EmitterPool,VFXManager}.ts [3D] 2 instanced billboard pools; event adapter + footsteps/charge/ambient
  visuals/humanProfiles.ts     [pure] human archetype (tourist/resident/worker/security/defender) + look per id
  systems/trafficControl.ts    [pure] traffic network (merged lanes, junctions), signal clock, stop rules helpers
  systems/vehicleModels.ts     [pure] vehicle body types: footprint, handling, spawn pick
  world/TrafficSignals.ts      [3D] traffic lights (live bulbs), stop signs, stop lines (instanced)
  world/layout/ringRoad.ts     [pure] perimeter ring road (N/W/E edges)
  systems/CityActivityDirector.ts [pure] district heat → alert (5 stages) + control, weighted event scheduling, staging, responders
  systems/{RewardSystem,CompanionSystem,PlayerVehicleSystem,HideoutSystem,WorldInteractionSystem}.ts [pure] living-city rewards
  content/{events,rewards}.ts  [pure] event catalog; cosmetics/companions/vehicles/hideouts/secrets/achievements (data only)
  visuals/{CityVisuals,CityEventProps,InteractableProps,CosmeticMeshes,BrainPickups}.ts [3D] living-city render layers
  ui/CollectionPanel.ts        wardrobe/companions/garage/hideouts/trophies/secrets (I key)
  utils/math.ts                [pure] vec helpers (allocation-free variants with `out` params), angle lerp, clamp
  utils/spatialHash.ts         [pure] implements ISpatialHash (uniform grid)
  utils/rng.ts                 [pure] mulberry32(seed): Rng
tests/                         Vitest, [pure] imports only
```

Agents only create/edit files listed in their task brief. **Never edit `src/core/types.ts`, `src/core/contracts.ts`,
`src/config/balance.ts`, `src/content/**`, `package.json`, or `AGENTS.md`** — if a contract change is needed, stop and report it
(optional extra fields that you need privately belong in a local `WeakMap`/side-table, not the contract).

## World conventions

- Meters. X/Z ground plane, Y up. Ground at Y=0. Open world (expand spec): walkable `layout.playArea` x∈[-400,400], z∈[-480,160];
  `layout.bounds` = playArea + a 20 m boundary band (x∈[-420,420], z∈[-500,180]) that holds the indestructible world edge.
  16 districts on a 4 × 4 grid (columns x -420/-200/0/200/420, rows z -500/-320/-160/0/180); the original four (suburbs SW,
  police NW, shopping SE, industrial NE of the old 400 × 320 world) keep their coordinates as the bottom-middle 2 × 2.
  Legacy district x∈[-120,120], z∈[-90,90]. Chunks are 80 m (11 × 9); discovery cells 20 m (42 × 34).
- **North = -Z, East = +X.** Park/plaza start is southwest (≈ x -85, z +60). Checkpoint is northeast (≈ x +80, z -60).
- Facing angle `a`: forward = `(sin a, cos a)` on (x,z); `a=0` faces +Z. Three.js: `mesh.rotation.y = a`.
- Camera yaw uses the same convention: yaw = direction the camera *looks* along the ground (yaw=0 looks toward +Z,
  so screen-right is −X). `computeMoveVector(fwd, right, yaw, out)`:
  `out = fwd·(sin yaw, cos yaw) + right·(−cos yaw, sin yaw)`, then normalized if |out| > 1 (diagonals never faster).
  Camera position for yaw y, horizontal distance d: `leader − d·(sin y, cos y)` (camera sits *behind* along −forward).
- Gameplay collision is 2D AABBs (`ColliderDef`). Three.js raycasts are used **only** for pointer picking and camera occlusion.
- LOS height rule: a sight segment from height h0 at `a` to h1 at `b` is blocked by a `blocksSight` collider iff the segment
  crosses its footprint at a point where the interpolated line height < collider.height. Tower guards (eye 5.2 m) see over
  compound walls (2.4 m) but not buildings (≥ 6 m). Cars are 1.7 m and block ground-level (1.5 m) sight.
- **Climbing:** any `vehicle`/`prop`/`wall` collider with `height <= horde.crawlMaxHeight` (1.8 m, a car is 1.7) is climbable
  (`isCrawlable`, `climbHeightAt` in CollisionWorld): every follower (not brutes, not ambient/held) and the Alpha walk over it,
  slower on top (`crawlSpeedMultiplier` / `leaderClimbSpeedMultiplier`), with `elevation` rising to its height. The horde
  always plans on `crawlNavGrid`. Compound walls (2.4 m), buildings, gates, towers, breakables and boundaries never climb.
- Gate: one `ColliderDef` with `tag: 'gate'`, `kind: 'gate'`, blocksMove+blocksSight. Destroyed ⇒ `collision.setEnabled(id,false)`
  then `navGrid.rebuild()` + `crawlNavGrid.rebuild()` exactly once, emit `gateDestroyed`.
- Towers: `kind:'tower'` blocking 3×3 m footprints inside the compound's front corners. Occupant stands on the platform
  (elevation ≈ 4 m). **Defeat mechanic: climb** — zombies within `attackRange + guard.radius + towerMeleeReachBonus` of the occupant
  (horizontal, clear move-access ignoring the tower's own collider) start climbing at `towerClimbSpeed` (max
  `towerMaxClimbers` at once); only zombies on the platform (`elevation` ≈ platform height) can hit the occupant, and the
  leader can't hit it from the ground (docs/todos.md item 3).

## Simulation conventions

- Logical state in `GameState` is truth; meshes mirror it. Never read gameplay values back from meshes.
- Fixed step `BALANCE.sim.fixedDt` (1/60). `Game` uses a bounded accumulator (`maxFrameDt`, `maxStepsPerFrame`).
- Systems are plain functions `(ctx: SimContext, dt: number, input: SimInput) => void`. No classes with hidden globals,
  no module-level mutable state (restart must be clean). Scratch vectors may be module-level **only** if overwritten before use.
- Randomness only via `ctx.rng` (injectable). Never `Math.random()` in `[pure]` code.
- Events go through `ctx.emit(...)`; visuals/audio/HUD consume `Simulation.drainEvents()` once per frame.
- `state.followerCount` must equal the number of `state==='follower'` zombies after every step. Capacity check for
  recruit/convert: `followers + rising < BALANCE.horde.maxFollowers`.
- Recruited zombies never return to `ambient`. Dead zombies stay `dead` (corpse) and are removed after `corpseFadeTime`.
- Dead entities never deal damage, never block movement, are never valid targets.
- Avoid per-agent per-step allocation in hot loops (use `out` params / scratch objects).

### Recruitment, structures & momentum (recruitment spec)

- **Beach start (open world):** the Alpha starts alone on the suburbs start beach (`START_BEACH` sand ground, playerStart ≈ (−150, 156))
  with `openWorld.startFollowers` 0 and base cap `openWorld.maxFollowers` 0, so nothing can be recruited until a nest opens.
  First objective: walk into the **walk-in nest** by the bus (`NestDef.claim`, `nest_start` ≈ (−124, 125), within
  `nest.claimRadius`). Claiming (ConquestSystem `claimNests`, `state.claimedNests`, saved as `player.claimedNests`) activates it
  and the first claim raises `openWorld.firstNestHorde` (10) free followers (`hordeUnlocked`, once). Every active claim or
  stronghold nest adds `followersPerNest` (10) cap; stronghold captures give no free horde. Until a nest is active the Alpha
  respawns / reloads on the beach. Nest activity rules live in pure `systems/nests.ts` (`isNestActiveIn`) — use it, never
  `strongholdId === null`. Old 5 / 40 economy tests call `usePreBeachEconomy()` (tests/support; also pre-claims the nest via
  `openWorld.startNestClaimed`); the beach start itself is tests/beachStart.test.ts.
- **Start (legacy district):** `BALANCE.horde.startFollowers` (5) followers spawn inside `layout.startFollowerArea` with `recruitGen 0`,
  `pulseAt -1` (they do not pulse), counted in `followerCount` but NOT in `stats.recruited`, no momentum.
- **Recruitment generations:** leader proximity / rally / conversion ⇒ gen 0. Every newly recruited zombie (gen < `recruitPulse.maxGeneration`)
  schedules exactly one pulse at `time + U(delayMin, delayMax)`; when it fires (`pulseAt` → -1) it recruits up to
  `maxRecruitsPerPulse` ambient, **unheld** (`heldBy === 0`) zombies within `radius × recruitRadiusMultiplier` (spatial hash query)
  whose segment to the pulser is not move-blocked; they get gen + 1. A zombie pulses at most once ever ⇒ no loops.
  Leader proximity recruitment also requires a non-move-blocked segment (no recruiting through walls / the bus shell).
  Capacity rule unchanged: `followers + rising < maxFollowers`; hitting it emits `capReached` as before.
- **Held zombies** (`heldBy = structureId`) are ambient, wander only inside their spawn zone rect, are never recruited
  (not by leader, rally or pulse). When that structure is destroyed they are released (`heldBy = 0`) and stumble out.
- **Structures** (`layout.structures`, `state.structures`) are attackable like the gate via `TargetRef { kind:'structure', id }`.
  Collider kind `'breakable'` (never crawlable). Destroy ⇒ disable collider, rebuild both nav grids once, release, events.
  Attack field goals = `approachOutside`. Orders on a human with an intact `shelter` structure redirect (effectiveTarget) to it.
- **Humans:** `GuardAgent.role` ('soldier' shoots; 'civilian' never shoots, flees threats inside `homeArea`), `post`.
  `BALANCE.guard.count` = number of `post==='checkpoint'` humans (8). Any human killed by zombies uses the normal conversion roll.
- **Momentum:** only `MomentumSystem` mutates `state.momentum`. Multipliers are read live (never cached on agents):
  recruit radius (leader + pulses + rally), speed (leader walk/sprint + follower speed).

### Open world (docs/3_open_world.md, ARCHITECTURE.md)

- `Game` passes `buildDistrictLayout()` (open world) explicitly; `new Simulation()` defaults to the legacy district (tests).
- Discovery (fog bits) never changes territory status. Status: unknown → human (discovered) → contested → infected (captured only).
- Capture happens exactly once per stronghold and is the only unlock path: `unlockAbility` is idempotent; biomass never negative;
  `activateAbility` checks + spends atomically.
- Only `ConquestSystem` mutates `state.strongholds`/`state.districts`/`state.discovery`; only `ProgressionSystem` mutates
  `state.progression` (other systems call `addBiomass`/`unlockAbility`).
- Dormant agents (beyond `population.activeRadius`) are skipped by every system; followers are never dormant.
- Humans killed by the Alpha (`killedByAlpha`) always convert; others use the normal roll. One damage path: CombatSystem helpers.
- Saves contain canonical data only (`WorldSave`); followers are transient. Corrupt/incompatible saves ⇒ clean start, never a crash.

### Expanded world & zombie vision (docs/5_expand_world.md, ARCHITECTURE.md §EW)

- **World edge:** colliders with `kind: 'boundary'` (from `world/boundaryLayout.ts`) are never breakable, never a structure, never
  disabled. `BoundaryScenery` dresses them per `BoundaryKind` (render-only, never pickable, no shadows cast). Backdrop rects
  (ocean, bay, mangroves, highway, skyline, airfield) lie outside `bounds`.
- **Vision is sim truth:** only `AwarenessSystem` writes `state.vision` (sorted `identified` / `seen` id arrays, fuzzed `cues`,
  `revision`). It reads only `leader.pos` + `progression.visionTier` (never camera/zoom), LOS-budgeted at `vision.updateHz`.
  While respawning, `identified` collapses to the engaged set. **Every living human inside the rendered vision limit
  (`hazeRadius × (1 + VISION_EDGE_BAND)`) is at least `seen`** (hazed silhouette, no LOS needed, like the scenery
  around it), so a human is never invisible next to a visible tree; identification still needs clear sight + LOS. Legacy layout: no awareness, everyone counts as identified.
- **Eyesight tiers** 1–4 (`BALANCE.vision.tiers`) are bought with biomass at an active nest (`buyVision` in ProgressionSystem;
  costs `vision.tierCosts`). Save v3 stores `visionTier`; v2 fog is remapped (+11 cols, +17 rows).
- **Targeting gate:** open-world horde attack orders on a human with `!canTarget(state, id)` become a move to its position.
  Client picks, hover labels, health bars, silhouettes and minimap/world-map humans use the same helpers
  (`isIdentified` / `isSeen` / `visionMath.humanVisual`): identified ⇒ full, seen ⇒ silhouette, otherwise hidden (never a mesh
  or dot at a live position). Structures/gates are geography and stay targetable.
- **Haze & vision limit:** `VisionFog` patches materials once (`onBeforeCompile`, shared uniforms) around the interpolated Alpha.
  **Everything past the vision limit is hidden:** past `hazeRadius` the haze ramps to fully opaque over `VISION_EDGE_BAND`
  (visionMath `visionVisibility`, mirrored in the GLSL) and `Game` sets the sky/background + scene fog to the haze colour.
  Effects skip the shader (`userData.noVisionHaze`), so `Game` drops effect events whose origin is past `visionFog.hiddenBeyond`.
  Attack/move order markers are culled past the limit (`Effects.setMarkerCull`, `Game.markerFor`) and never sit on an
  unidentified human. Deliberate exception: the player's own world-map waypoint beacon (navigation UI, not world info).
  Any new always-visible 3D overlay must cull itself the same way. Quality `low` (touch / DPR ≤ 1) drops desaturation. New meshes must be
  re-patched (Game re-patches on chunk changes). `visionFog.suspend()` turns it all off during the intro cinematic.
- **Senses:** cues (gunshot, scream, siren, crowd) are aggregated, fuzzed and capped (`BALANCE.senses`); UI shows screen-edge arcs
  (`SenseIndicators`), soft map blobs and panned audio, never exact positions. **Gunshots and screams are warnings:** they cue
  whenever within hearing range (even inside clear sight, with proportional fuzz so the bearing holds), are evicted last, and
  show a ⚠ icon with a direction arrow at ≥ `WARNING_CUE_MIN_OPACITY`. Sirens/scent cue only outside clear sight.

### Horde Strength (docs/13_hode_health.md, ARCHITECTURE §HH)

- **The Alpha has no HP.** `LeaderState` has no `hp`/`maxHp`; survival is `state.horde` (HordeHealthState), written ONLY by
  `HordeHealthSystem`. Strength is derived once per step, never subtracted: `clamp(Σ follower values (walker 1, companion 2,
  brute 3) + (alphaCore − coreDamage), 0, alphaCore + followerCap)`. The Alpha core (`hordeHealth.alphaCore`, 6 units) is the
  shared-damage accumulator, so a solo Alpha on the beach still survives ≈ 96 damage.
- **Alpha damage enters only through `damageLeader(ctx, amount, source)`** (`'bullet'|'melee'|'explosion'|'vehicle'|'hazard'`):
  ignored while `graceLeft > 0`; during Last Brain it is the finishing hit (`finishLastBrain`); otherwise `applyAlphaDamage`
  pours `amount × alphaDamageMultiplier` nearest-first into followers within `shareRadius` (≤ `maxRecipients`, via
  `damageZombie`), then the core (`unitHp` per unit), then the nearest followers anywhere. One `sharedDamage` event per hit.
  Kill followers only via `damageZombie`; never write strength. Death goes only through `killLeader`.
- **Shielding:** shots at the Alpha are intercepted by the first live follower on the 2D segment (`findShotInterceptor`, LOS
  height rule for elevated shooters); guards target the nearest visible threat. Splash is not intercepted (followers take their
  own splash once, the Alpha's share once).
- **Last Brain Standing:** strength 0 while alive ⇒ `lastBrainStart` (6 s, ×1.35 speed, `entryGrace`); any strength back ⇒
  `recovered` + `recoveryGrace`; a hit ⇒ `finished` death; timer ⇒ `expired` death. Respawn = `resetHordeHealth` (core full).
- Heals (shop drinks, convoy supplies) restore core units only (`restoreStrength`, HP × multiplier / unitHp), refused at full core.
  Saves store `player.alphaCoreDamage` (v4 optional, clamped); followers stay transient.

### Traffic & car attacks (todos #12 + car attacks)

- Only `TrafficSystem` writes `state.vehicles`. Cars are agents, not colliders. A live (non-stalled) car is a
  `TargetRef { kind: 'vehicle', id }`: melee reach is measured to its footprint (`vehicleOverlap`), damage goes through
  `damageVehicle` (wears `hp` = driver's grip, slows + bogs the car); at 0 the car stalls and the driver is dragged out as a
  dazed, hurt civilian (`driverBailed` with `pulled: true`, ignores the human cap). Followers auto-engage a car within
  `traffic.engageReach`; attack orders on cars are accepted. Every body a car hits costs speed and adds `bogTime`
  (no acceleration + drag), so a car that ploughs into the horde rolls to a stop beside it.
  Any clawed driver panics (`TrafficSystem` side-table, `isPanicking`): reverses out of the mob (`rammer.panicBackup`), then
  rams the centroid of nearby zombies + Alpha for `rammer.maxPasses` passes at rammer damage, then flees. While bogged it gets
  only `rammer.panicBogAccel` of its acceleration, so a large mob still pins it and drags the driver out.
- **Traffic control** (`systems/trafficControl.ts` [pure], shared by sim + `world/TrafficSignals.ts`): the road network is
  rebuilt as merged through-lanes + junctions from `layout.ground` roads (split patches with gaps <= 16 m are one road).
  Main-road (>= 12 m) and city-core junctions are lit (`signalFor(junction, axis, time)` — N-S then E-W, never both);
  the rest are 4-way stops (full stop, `stopHold`, first come first served, same road goes together, a granted car holds
  the junction until it is through). Lane cars keep `followGap`, never enter a box they can't leave, swerve round wrecks
  through a clear oncoming lane, turn onto a crossing road at the end of a lane (ring road corners) or U-turn at a dead
  end / after `pedestrianPatience` s behind people standing in the road; `junctionPatience` breaks any residual wait.
  Only waiting at a wall counts toward `stuckTime`. Out-of-control cars (`ram`/`turn`/`flee`) ignore all of it; when one
  overlaps another vehicle (`carOverlap`) at >= `crashMinSpeed` closing speed it is a `vehicleCrash`: the vehicle hit is
  wrecked by mass ratio (driver bails), the wild one too at `crashWreckSpeed`.
- **Vehicle models** (`VehicleAgent.model`, optional = sedan; `systems/vehicleModels.ts`, `BALANCE.vehicleModels`): sedan,
  hatchback, pickup, van, box truck, bus, police — footprint, speed/accel scale, crash mass, spawn weight, rammer-capable.
  Use `halfLength(v)`/`halfWidth(v)`, never `traffic.carLength`, for a vehicle's footprint. Police drivers bail as `police`.
- **Ring road** (`world/layout/ringRoad.ts`): N/W/E edges, 1 m inside the play area (never touching the boundary band),
  abutting (never overlapping) the existing carriageways; city blocks keep >= 14 m from the edge so it fits.

### Living city & rewards (docs/11_cityupgrade.md, ARCHITECTURE.md §CU)

- **Alert vs control:** only `CityActivityDirector` writes `DistrictState.heat/alert/control`. Heat comes from step events
  (shots, kills, conversions, crashes, props) and decays; captured ⇒ `overrun` + `zombieControlled`. Alert is local per district.
- **Dynamic events** are data (`content/events.ts`: tags, alert/control filters, weight, cooldown, duration, Brains). A new kind
  needs a `DynamicEventKind`, a catalog row and a `stageEvent` case (dressing = `ActiveDynamicEvent.props`, render-only).
  Events spawn **past the rendered vision limit** (`visibleLimit(state)` + `eventSpawnBeyondVision`), never the same kind twice
  in a row or at a recent spot, capped by `eventMaxConcurrent` / `eventMaxHumans` / `policeMaxExtraActive`, and are suppressed
  near a contested stronghold. Responders walk in from `responderArriveDist`. Resolved participants become ordinary street
  people and are removed only once out of sight (never delete a visible actor). Post-conquest pools use `allowedControl`.
- **Rewards:** one grant path (`grantReward`, unique ⇒ exactly once), one currency (`addBrains`), purchases via `buyReward`
  (check → deduct → grant). Achievements are typed stat keys (`recordAchievementProgress`), saved in `achievementProgress`.
  Cosmetics never change stats. Rewards/secrets/achievement progress persist in save v4 (`player.rewards`); events, companion
  bodies and the parked vehicle are transient.
- **V (interact)** priority, mirrored by `hudModel.interactPrompt`: vehicle mount/dismount > discovered shortcut > nearest prop.
  Touch: the USE button. Props also trigger on attack, sprint-bump or ramming in the cart.
- **Companions** are followers with an entry in `state.companions` (≤ `maxActiveCompanions`), respawn near the Alpha after
  `companionRecoverTime`; perks fire only when they have a target (Larry recruits strays, Chef freezes civilians, Grandma wallops).

### `Simulation.step(dt, input)` order (authoritative; legacy list first, open-world order below)

1. Copy `pos→prevPos`, `facing→prevFacing` for leader, zombies, guards.
2. If `phase !== 'playing'`: only advance anim timers / corpse fades, then return.
3. `applyHordeCommands` (attack/recall order changes, rally, rush activation, cooldown ticking)
4. `updateLeader` (movement, stamina; leader auto-melee is resolved in `updateCombat`)
5. `updateNavigation` (flow fields / effective target; ≤ 5 Hz replans + immediate on order change / nav version change)
6. `updateHorde` (spatial hash rebuild, passive recruit, **fire due recruit pulses**, ambient/held wander, follower steering & engagement selection)
7. `updateHumanAI` (perception at 10 Hz, FSM, movement, shooting → damage helpers)
8. `updateCombat` (follower + leader melee resolution, gate damage, deaths, corpse timers)
9. `updateConversion`
9b. `updateStructures` (release steering, hitFlash) then `updateMomentum` (decay, tiers)
10. `checkVictory` (victory: gate destroyed AND all guards DEAD; defeat: leader dead) → set phase, emit once
11. Tick `hitFlash`, `animTime`, `capReachedFlash`; `state.time += dt`.

Open-world order: 1 copy prev · 2 `updatePopulation` · 3 `applyHordeCommands` · 4 `updateProgression` ·
5 `updateLeader` (skipped while respawning) · 6 `updateNavigation` · 7 `updateHorde` · 8 `updateHumanAI` · 9 `updateCombat` ·
10 `updateConversion` · 11 `updateStructures`, `updateMomentum` · 12 `updateConquest` · 12a `updateHordeHealth` · 13 `updateRespawn` · 13a resistance, traffic, shops, then living city: `updateHideouts` (fast travel,
shortcut) → `updateWorldInteractions` → `updateCompanions` → `updateCityDirector` → `updateRewards` (both read this step's
events; `updatePlayerVehicle` runs right after `updateLeader`) · 13b `updateAwareness(ctx, dt, eventsOfThisStep)` · 14 timers, `time += dt`.
No victory/defeat; the world keeps simulating while `phase === 'respawning'`.

## Visual conventions

- Flat-shaded `MeshLambertMaterial`/`MeshStandardMaterial({flatShading:true})`, shared geometries/materials, merged static city
  geometry where possible (BufferGeometryUtils from `three/examples/jsm/utils/BufferGeometryUtils.js` is allowed — it ships with three).
- Zombies (up to ~220 incl. corpses) are drawn by `HordeRenderer` with one `InstancedMesh` per body part (L/R limbs share a
  mesh, 2 instances per zombie) + one per accessory kind: ~20 draw calls for the whole horde. Per-instance `aTile` (atlas tile),
  `aSkin` (skin tone) and `instanceColor` (part tint / rush / flash). The Alpha uses the same skeleton + controller as a hero rig.
- Zombie animation is driven ONLY by `animateZombie` (pure, deterministic per id, renderer-side state in a side-table);
  root position/facing always come from the sim. Follower strikes are timed to `attackCooldown → 0` (the damage step),
  the Alpha's to its windup end. New zombie motion = tune `ANIM_TUNING` / `zombieProfiles.ts`, not per-call constants.
- Characters are articulated: head, torso, pelvis, 2 arms, 2 legs; pivot at shoulder/hip; procedural animation from
  `anim`, `animTime`, speed. Feet on ground. Interpolate pos/facing with render alpha.
- Palette: asphalt `#4a5260`, sidewalk `#a9a294`, concrete `#c9b99a`, zombie skin `#7d9a6a`/`#6f8a72`, leader `#4f6b3a`,
  human faction orange `#e0782a` + navy `#2c3e66`, warning lights `#ffb347`. No gore.
- Shadows: sun shadow map on for buildings/leader/guards only; zombies use a cheap blob-shadow instanced disc.
- **Visual polish (docs/8_visual_polish.md, ARCHITECTURE §VP):** all graphics options go through `GraphicsQuality` presets
  (render-only, never in WorldSave). City geometry opts into surface detail with a float `aSurface` vertex attribute
  (`SURFACE` ids); patch new city materials with `applySurfaceDetail` **before** VisionFog patches them. Post-processing is
  display-referred (the vision haze is mixed in sRGB after tone mapping): never switch to a linear EffectComposer chain.
  Particles go through `VFXManager.emit` / `consume` (pooled, capped, culled past `hiddenBeyond`); never add per-burst meshes.
  Camera shake is scaled once in Game by `shakeScale`; flash-type visuals use `flashScale`. Pure/3D twin files need different
  stems (Windows is case-insensitive: `foo.ts` and `Foo.ts` are one file).
- **HUD (docs/9_hud_redesign.md, ARCHITECTURE §HUD):** style only with `hudTheme.css` tokens and `calc(N * var(--hz-u))`
  sizes; icons from `hudIcons.ts` (no emoji / text glyphs); decisions in pure `hudModel.ts` (tested), HUD.ts only renders
  and writes the DOM on signature change. Gameplay widgets live in `.hz-play` (hidden under modals and the cinematic);
  never invent HUD states the sim does not have, never show undiscovered/unidentified things on HUD or minimap.
- Renderer DPR capped at 1.5. One `requestAnimationFrame` loop. `Game.dispose()` must remove all listeners.

## Testing conventions

- Tests live in `tests/*.test.ts`, import only `[pure]` modules, build worlds via `buildDistrictLayout()` or small hand-made
  `DistrictLayout`/`ColliderDef[]` fixtures, and use `mulberry32(seed)` or a scripted `Rng` stub.
- Required coverage: docs/1_design.md §15 items 1–15.

## Phased plan (orchestrator updates checkboxes)

**Who does the work:** the Claude orchestrator delegates the bulk to codex/agy, but also implements tasks itself when
that is the better path — isolated new modules while a worker runs on other files, integration glue, small fixes found
in diff review, or work a blocked worker can't do. The same isolation rules apply to Claude: never edit files a running
worker owns, and every change ends with `npx tsc --noEmit` + `npm test` green.

- [x] **P1 Scaffold** (agy): package.json, tsconfig, vite.config, index.html, main.ts stub, README stub, `districtLayout.ts` + `tests/layout.test.ts`.
- [x] **P2A Collision & Nav** (codex): utils/*, CollisionWorld, NavigationGrid + FlowField, tests/collision + tests/navigation.
- [x] **P1B Visual layer** (agy): CityDistrict, Checkpoint, LowPolyCharacters, HordeRenderer, Effects, HUD, AudioSystem (render-only, driven by state).
- [x] **P2B Leader & Horde** (codex): entities/*, createInitialState, Simulation, ZombieLeader, HordeSystem, NavigationSystem, tests.
- [x] **P2C Combat, AI, Conversion, Victory** (codex): CombatSystem, HumanAISystem, ConversionSystem, VictorySystem, tests.
- [x] **P3 Integration** : Game, InputController, ThirdPersonCamera, EntityRenderer, wiring events→Effects/Audio/HUD.
- [x] **P4 Review, playtest & tuning**: adversarial review, spec audit, browser playthrough, README. (+ docs/todos.md items 1–4)

### Recruitment overhaul (docs/2_intial_recruitment_design.md)

- [x] **R0 Contracts** (orchestrator): types.ts (structures, momentum, cascade fields, human roles, events), balance.ts, contracts.ts, this file.
- [x] **R1 Layout & state scaffolding** (codex — agy headless was permission-blocked): districtLayout (opening pacing, bus/alley/store/barricade landmarks, clustered spawn zones,
      civilians + barricade soldiers), entities (Zombie/HumanGuard/Structure), createInitialState (5 start followers, held zombies,
      structures, momentum), compile shims, tests/layout.test.ts.
- [x] **R2a MomentumSystem** (claude): src/systems/MomentumSystem.ts + tests/momentum.test.ts (pure; wired into call sites by R2).
- [x] **R2 Sim systems** (codex; finished by claude after codex hit its usage limit): cascade pulses + LOS recruitment + held wander + responsiveness (HordeSystem), StructureSystem,
      structure targets in Combat/Navigation, civilian AI + barricade soldiers (HumanAISystem), Victory, Simulation order,
      tests/cascade, tests/structures, tests/momentum, tests/opening (60 s scripted run reaches 30–50 followers).
- [x] **R3 Visuals/HUD/audio/input** (agy): world/Landmarks.ts, pulse rings + recruit flash, momentum HUD meter, counter pop,
      structure picking/markers/labels, audio cues.
- [x] **R4 Review & audit**: codex read-only adversarial review; agy spec/cross-file audit; fixes; browser playthrough of first 90 s.

### Open world (docs/3_open_world.md) — task board in `.agent-context/PROGRESS.md`

- [x] **T001 Contracts** (orchestrator): types/contracts/balance/content, legacy layout fixture, stubs, this file.
- [x] **Wave A**: T002 world layout · T003 nav scale · T004 Alpha combat · T005 progression · T006 persistence
- [x] **Wave B**: T007 horde · T008 humans/population · T009 conquest/respawn · T010 world render · T011 characters/FX
- [x] **Wave C–E**: T012 sim integration · T013 UI/audio · T014 client integration · T015 docs (legacy fields kept as test fixture) · T016 playtest
- [x] **Verification**: V1 spec audit · V2 adversarial review · F1 fixes · V3 final build/test report (PASS)

### Expanded world & vision (docs/5_expand_world.md) — task board in `.agent-context/PROGRESS.md`

- [x] **EW-T001–T006**: contracts, 4 × 4 layout + boundaries, nav/collision scale, AwarenessSystem, eyesight purchase + save v3
- [x] **EW-T007–T010**: boundary scenery, vision haze + gated visuals, sense UI/audio, integration (order gate, wiring)
- [x] **EW-T011–T012**: browser playtest + fixes, docs
