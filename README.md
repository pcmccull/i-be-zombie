# I BE ZOMBIE

A stylized low-poly 3D open-world zombie horde game built with Three.js, TypeScript and Vite. You are the **Alpha**. Infect a seamless
800 m × 640 m city of 16 districts, grow a horde of up to 40, storm human strongholds in any order, claim districts, and unlock permanent mutations.
Progress is saved in the browser.

## What's new: visual polish (docs/8_visual_polish.md)

- **Characters.** Humans read as tourists (Hawaiian shirts, sun hats, cameras), residents, workers (hi-vis, hard hats), security
  (navy + light blue) and defenders (orange vest + navy). Civilians panic with flailing arms, armed humans snap to alert, and
  everyone recoils when hit. The Alpha is recognisable without any hat: lopsided raised shoulder, one oversized right hand,
  mismatched glowing eyes, a slack grin and a torn tourist shirt. It has empty attachment slots for future cosmetics.
- **City surfaces.** World-space detail on the city materials: asphalt grain, cracks and patches, sidewalk slab joints, mottled
  grass, stucco walls with base grime, and rippled sand. The detail fades out with distance so it never shimmers. Palms and trees
  sway in the wind, shops have striped canvas awnings, and apartments have balconies with railings and planters.
- **Effects.** A pooled, capped particle system (2 draw calls) drives footstep dust by surface, hit stars, green/teal recruitment
  wisps, rally arrows, charge dust and speed streaks, muzzle smoke and shell glints, bullet impacts, barricade debris, bus/vehicle
  explosions, unlock confetti and ambient leaves and insects. Effects past the vision limit are never drawn.
- **Lighting and post.** A warm Miami sun with a cool bounce fill, plus a light colour grade, and a glow that only picks up
  bright, saturated light (muzzle flashes, glowing eyes, sparks).
- **Graphics settings** (pause menu): **Graphics: Low / Medium / High**, which sets shadow map size, post-processing, surface
  detail, wind, particle budgets and the pixel-ratio cap, and **Reduced motion**, which cuts camera shake, flashes and particle
  counts. They are stored in the browser and never in the save. The defaults come from the device: touch → Low, DPR 1 → Medium,
  otherwise High; `prefers-reduced-motion` turns Reduced motion on.
- **Diagnostics.** **F3** also shows a graphics panel: frame time p50/p95, draw calls, triangles, geometries and textures, shadow
  casters, and live/max particles. `?bench=1` (100 zombies + 100 humans around the Alpha) and `?bench=2` (260 + 120) load a
  repeatable stress scene that is never saved. `window.__game.graphicsStats` returns the same numbers for scripted runs.
- **Art pipeline.** Everything is still generated in code: no model or texture files, no downloads, no licences to track. The
  spec's glTF/KTX2 pipeline was swapped for cached procedural geometry and canvas/data texture atlases, because the repo forbids
  remote assets (see `.agent-context/ARCHITECTURE.md` §VP-0).

## Earlier: expanded world and zombie vision

Implemented from [`docs/5_expand_world.md`](docs/5_expand_world.md).

- **16 districts on a 4 × 4 grid.** The original four sit in the bottom-middle; around them are the Sunny Boardwalk, Oceanfront
  Hotels, Arts District, Military Stronghold, Palm Park, Financial Core, Neon Nights, Medical Center, International Airport,
  Golf Estates, University Campus and Luxury Marina. Each has its own look, stronghold and a threat tier (1–5) shown when you
  enter it.
- **A real world edge.** Ocean and seawall on the south, a bay with container stacks on the east, mangroves and a military
  perimeter on the west, a collapsed highway and fences on the north, with wrecked-vehicle and broken-bridge gaps. The edge
  can't be broken, climbed or walked through, and the land past it is dressed backdrop.
- **Zombie eyesight.** The Alpha is short-sighted. You can only target humans you have *identified*; beyond your eyesight the
  city fades into haze and **nothing past the vision limit is drawn**.

  | Tier | Name | Clear sight | Vision limit | Also detects | Cost |
  |---|---|---|---|---|---|
  | 1 | Rotten Eyes | 18 m | ~52 m | — | start |
  | 2 | Predator Sight | 28 m | ~72 m | moving humans (40 m) | 20 biomass |
  | 3 | Hunter Vision | 42 m | ~94 m | + stronghold defenders (70 m) | 60 biomass |
  | 4 | Apex Vision | 60 m | ~123 m | + reinforcements (140 m) | 120 biomass |

  Inside the clear-sight radius humans show in full and can be targeted; between it and the vision limit they show as hazed
  silhouettes (you can see them, but must get closer to attack). Past the limit nothing is drawn, humans included.
  Buy tiers in the **Eyesight** section of any active nest's panel. Camera zoom never changes what you can see.
- **Ears and nose.** Every gunshot and scream within earshot puts a ⚠ warning with an arrow at the screen edge, pointing toward
  the sound (red = gunshot, amber = scream). Sirens (blue) and crowd scent (green) show as softer arcs. Cues also appear as fuzzy
  blobs on the map and are panned in stereo. They never give an exact position.
- **Saves upgrade automatically** (save v3): your eyesight tier is stored and old fog-of-war maps are remapped onto the bigger grid.

## Earlier: the open world

Implemented from [`docs/3_open_world.md`](docs/3_open_world.md). The task board and reports are in [`.agent-context/`](.agent-context/).

- **One continuous city with four districts.** There are no loading screens between them.

  | District | Quadrant | Landmark | Stronghold (tier) | Capture reward |
  |---|---|---|---|---|
  | Maple Heights (suburbs) | SW, start | homes, park, start nest | Suburb Police Checkpoint (1) | **Rush**, +15 biomass, nest |
  | Civic Center (police) | NW | fortified police station | Police Station (2) | **Alpha Claws** |
  | Galleria District (shopping) | SE | mall and parking lot | Mall Security Center (1) | **Horde Frenzy** |
  | Dockside Works (industrial) | NE | warehouses, gated yard with towers | Industrial Security Yard (3) | **Brute Evolution** |

- **Strongholds fall to objectives, not extermination.** You break doors, shutters or the gate, overrun defenders and hold control
  points, and the HUD tracks each step. A capture happens exactly once. It grants its unlock, turns the district *infected*, activates
  a nest there, and autosaves.
- **Fog of war is separate from territory.** Walking reveals the map, but a district only changes owner when you capture its
  stronghold. Unexplored, human, contested and infected areas each look different on the minimap and the world map (`M`).
- **Rush, the first unlock.** Civilians outrun the horde at first. Capturing the nearby Suburb Police Checkpoint unlocks Rush
  (auto-equipped on Q): for 4 s the horde runs 45% faster and attacks 25% faster, fast enough to run them down. It costs nothing and
  has a 15 s cooldown. Older saves that already captured the checkpoint get Rush when loaded.
- **Mutations and biomass.** You earn biomass by infecting, killing armed humans, breaking structures and capturing strongholds.
  - **Alpha Claws:** while equipped, LMB becomes a three-hit combo whose finisher staggers.
  - **Horde Frenzy:** nearby followers get +40% speed and +50% attack rate for 8 s.
  - **Brute Evolution:** spend 15 biomass per Brute to mutate the nearest followers into siege Brutes (180 HP, 3.5× structure damage).
  - Change your Q/T/R/F loadout at any active nest.
- **The Alpha fights directly.** LMB bite has windup, recovery and forgiving auto-aim. Humans you kill yourself always rise as
  followers.
- **Nests and respawn.** If the Alpha dies, it respawns at the active nest after 4 s, keeping its unlocks, biomass and territory.
  Standing near an active nest tops the horde back up to 10.
- **Bounded living world.**
  - Only actors within 110 m are simulated.
  - Districts respawn civilians up to their budget, and captured districts thin out.
  - Raised alert brings up to three police reinforcement waves per stronghold. Waves never repeat endlessly.
  - The city renders in 80 m chunks that stream around the camera, with at most 12 loaded.
- **Earlier mechanics carry over:** cascading recruitment pulses, held-zombie landmarks (bus, alley, store, pen), Outbreak Momentum,
  tower climbing, crawling over cars, and civilians who outrun a horde that isn't in Frenzy.

## Requirements & Commands

- **Runtime:** Node.js 18+ (tested with Node 22) and a desktop browser with WebGL2 and Web Audio support.

| Task | Command | Notes |
|---|---|---|
| Install dependencies | `npm install` | Installs `three`, `typescript`, `vite`, and `vitest` |
| Start dev server | `npm run dev` | Serves at `http://localhost:5173` |
| Type-check & production build | `npm run build` | Runs `tsc --noEmit && vite build` |
| Preview production build | `npm run preview` | Serves the built bundle locally via `vite preview` |
| Run automated tests | `npm test` | Headless pure-simulation suites (`vitest run`), including the spec §10 open-world scenarios |

## How to Play

You start in Maple Heights beside the start nest with 5 followers. There is no final victory screen. The goal is to conquer all four
strongholds, in whatever order you like. Saves are automatic on captures, unlocks, discoveries, loadout changes and respawns. You can
also save from the pause menu (`Esc`), which has **Reset Save** to start over.

### 10-minute demo path

1. **0:00–0:30, outbreak.** Walk toward the bus and the nearby walkers. Walking within 9 m recruits passively, and `Space` (Rally)
   pulls in everything within 15 m. Civilians outrun the horde for now; corner one or sprint it down and LMB to infect. A scripted run reaches about 20 followers by 30 s.
2. **0:30–2:00, Suburb Police Checkpoint.** RMB the holding-pen gate. The horde breaks it, the 20 zombies inside join, and the horde
   moves on to the police. Kill the last defender (RMB it, or LMB it yourself).
   - Capture: suburbs turn green, a new nest activates, "SAVED" flashes, and **Rush** unlocks on `Q`. Use it to run down civilians.
   - Keep the Alpha behind the horde. Three police pistols will still kill you if you tank them.
3. **2:00–4:00, a second stronghold, your choice.**
   - **Mall Security Center (tier 1, SE):** RMB the security shutter, then stand your horde inside the office until "Take the security
     office" fills. Reward: Horde Frenzy, auto-equipped on Q.
   - **Police Station (tier 2, NW):** breach the station doors, then hold the command courtyard. Reward: Alpha Claws.
4. **4:00–6:00, mutations.** Use Frenzy (`Q`) before a charge. Visit an active nest to rearrange slots. Press `M` to see territory
   versus fog.
5. **6:00–10:00, the industrial yard (tier 3, NE).** Recruit back up to 40, break the yard gate (Brutes help if you have them), climb
   the towers, and hold the yard office.
6. **Persistence check.** Reload the page. Captures, unlocks, biomass, fog and the active nest return, and the horde restarts at 5 by
   the nest. Die once to see the nest respawn.

## Controls

Implemented in [`src/core/InputController.ts`](src/core/InputController.ts) and [`src/core/Game.ts`](src/core/Game.ts).

| Input | Action |
|---|---|
| `W A S D` / arrows | Move relative to the camera; `Shift` sprints while stamina lasts |
| **LMB** | Alpha attack: bite, or the 3-hit claw combo with Alpha Claws equipped. Auto-aims at the nearest enemy in front |
| **RMB** on human / gate / door | Horde attack order. Hold `E` + RMB to add or removes a split target |
| **RMB** on ground | Horde move order (marker; reverts to follow on arrival or after 20 s) |
| `Space` / `Shift+RMB` | Rally / regroup: pull in and recruit nearby walkers (8 s cooldown) |
| `G` | Recall: everyone follows |
| `Q` `T` `R` `F` | Activate the equipped mutation slot (Rush, Frenzy, Brutes; Claws is passive while equipped) |
| `M` | World map. Click it to set or clear a waypoint |
| `Esc` | Pause menu: Continue, Save, Reset Save (with confirmation), Sound |
| `N` | Mute / unmute |
| Mouse (captured) or LMB/RMB drag | Orbit and tilt the camera. `C` recenters, hold `V` to look back, `Z`/`X` turn, wheel zooms (8–64 m) |
| At a nest | Loadout panel: click a slot then an ability, or use keys `1`–`4` and `[` `]` |
| `Tab` / `F3` | Controls help / debug overlay (FPS, draw calls, chunks, active and dormant actors, district states) |

### Ability slots

You start with no slots. The first slot opens with your first unlock (capturing the Suburb Police Checkpoint gives Rush). The other
slots cost **40 / 70 / 110 biomass** and are bought at a nest: press `B` or use the buy button in the nest panel.

### Touch controls

Shown automatically on touch devices (`pointer: coarse`) and on the first touch anywhere else
([`src/ui/TouchControls.ts`](src/ui/TouchControls.ts), math in [`src/core/touchMath.ts`](src/core/touchMath.ts)).

| Gesture / button | Action |
|---|---|
| Left virtual stick | Move relative to the camera; push to the rim to sprint |
| **ATTACK** | Alpha swing forward (auto-aims) |
| **FOLLOW** / **RALLY** | Recall the horde / rally and recruit nearby walkers |
| Slot buttons (owned slots only) | Activate that mutation, with a cooldown sweep |
| **MAP** / **II** / **CAM** | World map, pause menu, recenter camera |
| One-finger drag on the world | Orbit and tilt the camera |
| Tap on the world | Horde order under the finger: attack the human / gate / structure, else move there |
| Two-finger pinch | Zoom (no tap or orbit while two fingers are down) |

The renderer pixel ratio is capped at 1.0 on touch devices.

## Architecture Overview

The codebase enforces a strict separation between pure gameplay simulation and Three.js presentation:
- **Pure Simulation (`[pure]`):** Located in [`src/sim/`](src/sim/), [`src/systems/`](src/systems/), [`src/entities/`](src/entities/), [`src/world/districtLayout.ts`](src/world/districtLayout.ts), [`src/world/CollisionWorld.ts`](src/world/CollisionWorld.ts), [`src/world/NavigationGrid.ts`](src/world/NavigationGrid.ts), and [`src/utils/`](src/utils/). Zero `three` imports; executes deterministically at a fixed `1/60 s` timestep (`BALANCE.sim.fixedDt`) with a seeded PRNG (`mulberry32`) and runs headlessly in Node/Vitest.
- **3D Visuals & Audio (`[3D]`):** Located in [`src/world/CityDistrict.ts`](src/world/CityDistrict.ts), [`src/world/Checkpoint.ts`](src/world/Checkpoint.ts), [`src/visuals/`](src/visuals/), [`src/audio/AudioSystem.ts`](src/audio/AudioSystem.ts), and [`src/ui/HUD.ts`](src/ui/HUD.ts). Reads `GameState` with render-alpha transform interpolation and consumes per-frame events from `Simulation.drainEvents()` to trigger pooled particles/tracers, camera shake, Web Audio synth cues, and DOM HUD updates.

### Authoritative `Simulation.step(dt, input)` Order (open world)
1. Copy `pos → prevPos`, `facing → prevFacing` (render interpolation).
2. `updatePopulation`: marks actors beyond 110 m dormant (2 Hz) and runs budgeted civilian/ambient respawns under hard caps.
3. `applyHordeCommands`: attack, split, move, regroup and follow orders, plus rally.
4. `updateProgression`: ability slots, loadout at nests, cooldowns, the Frenzy timer and Brute Evolution.
5. `updateLeader`: movement, stamina, and the LMB windup/recovery/combo state machine. Skipped while respawning.
6. `updateNavigation`: bounded (140 m) shared flow fields at ≤ 5 Hz, and effective-target redirects.
7. `updateHorde`: spatial hash, recruitment and cascade pulses, follower steering, move orders, straggler catch-up.
8. `updateHumanAI`: police, soldier and civilian FSMs, aim delay, stagger, patrols and reinforcements.
9. `updateCombat`, then `updateConversion` (the single damage/infection path; Alpha kills always rise).
10. `updateStructures`, then `updateMomentum`.
11. `updateConquest`: fog reveal, objectives, contested/capture-once, district metrics, alert and reinforcements, nest replenishment.
12. `updateRespawn`: death → `respawning` → nest respawn.
13. `updateAwareness`: zombie vision (identified / seen humans, LOS-budgeted from the leader position only) and sense cues from
    this step's events. Runs while respawning too.
14. Timers; `state.time += dt`.

The legacy district (`new Simulation()` without a layout) keeps the recruitment-milestone order with `checkVictory`.

### Directory Structure
```text
index.html                     Canvas host (#app) + HUD root (#hud)
src/
  main.ts                      [3D] Entry point
  config/balance.ts            [pure] All tuning constants (BALANCE), incl. openWorld/alpha/police/frenzy/brute/conquest/nest/save
  content/                     [pure] abilities, strongholds, districts (data-driven content)
  core/                        types.ts, contracts.ts, cameraMath.ts [pure]; Game.ts, InputController.ts, ThirdPersonCamera.ts [3D]
  sim/                         [pure] Simulation.ts, createInitialState.ts
  world/                       districtLayout.ts + layout/* (open world), legacyDistrictLayout.ts, worldQueries.ts (districts,
                               chunks, ChunkStreamer), CollisionWorld.ts, NavigationGrid.ts [pure];
                               boundaryLayout.ts [pure] (world edge + backdrop);
                               CityDistrict.ts (chunk streaming), Checkpoint.ts, Landmarks.ts, NestMarkers.ts, BoundaryScenery.ts [3D]
  entities/                    [pure] ZombieLeader.ts, Zombie.ts, HumanGuard.ts, Structure.ts
  systems/                     [pure] Horde, Navigation, Combat, HumanAI, Conversion, Structure, Momentum, Progression,
                               Conquest, Respawn, Population, Awareness (vision + senses), Victory (legacy)
  persistence/                 saveSchema.ts [pure] (versioned WorldSave, migrations), SaveStore.ts (localStorage, never throws)
  visuals/                     [3D] LowPolyCharacters.ts, HordeRenderer.ts, EntityRenderer.ts, Effects.ts, HealthBars.ts,
                               VisionFog.ts (vision haze + limit); core/visionMath.ts [pure]
  audio/                       AudioSystem.ts (Web Audio synth)
  ui/                          HUD.ts, SenseIndicators.ts, Minimap.ts, WorldMap.ts, PauseMenu.ts, NestPanel.ts, DebugOverlay.ts, mapRender.ts,
                               uiHelpers.ts [pure], hud.css, hudOpenWorld.css
  utils/                       [pure] math.ts, spatialHash.ts, rng.ts
tests/                         Vitest suites importing [pure] modules only (openWorld.test.ts = spec §10 scenarios)
```

## Key Design Decisions

- **Elevated Third-Person Perspective Camera:** Tracks the leader from ~14 m horizontal distance and ~11 m height by default, with right-drag orbit, wheel zoom (`8 m`–`32 m`), raycast boom pull-in against buildings, and automatic transparency fade on occluding structures.
- **2D X/Z AABB Gameplay Collision:** All movement and melee access checks run against lightweight 2D axis-aligned bounding boxes in `CollisionWorld` with smooth tangential wall sliding; Three.js raycasting is used strictly for pointer target picking and camera occlusion.
- **LOS Height Rule:** Sight rays interpolate height between `fromHeight` and `toHeight` across each `blocksSight` collider footprint. Watchtower guards (`towerEyeHeight = 5.2 m`) can see and fire over 2.4 m compound perimeter walls and 1.7 m vehicles, while 6–16 m buildings and the 3 m intact gate block ground-level sight (`1.5 m`).
- **1.25 m Navigation Grid & Shared Flow Fields:** `NavigationGrid` rasterizes dilated `blocksMove` colliders (`navCellSize = 1.25 m`, `navAgentRadius = 0.45 m`, `192 × 144` cells). Instead of per-zombie A*, the entire horde samples shared Dijkstra/octile `FlowField`s (`followField` and `attackField`) combined with `SpatialHash` neighbor separation.
- **`InstancedMesh`-per-Body-Part Horde Renderer:** `HordeRenderer` renders up to ~170 zombies (active followers, ambient walkers, rising converts, and fading corpses) using one `InstancedMesh` per articulated body part (head, torso, pelvis, arms, legs, accessories, blob shadow) with per-instance color tinting for variants, Rush glow, and hit flashes, keeping zombie draw calls under 40.
- **Watchtower Climbing:** Tower guards stand on 4 m platforms. Zombies that reach the base (`attackRange + guard.radius + towerMeleeReachBonus`) climb at 1.6 m/s, at most 5 at once. Only climbers on the platform can hit the occupant.
- **Generic Breakable Structures:** The bus door, alley gate, store door and pen gate are `TargetRef { kind: 'structure' }` with `kind: 'breakable'` colliders. Destroying one disables its collider, rebuilds both nav grids exactly once and releases zombies whose `heldBy` matches. Humans sheltering behind an intact door redirect attack orders to that door. `Landmarks.ts` builds all landmark meshes from layout data, never from literal coordinates.
- **Cascade Bookkeeping:** Each zombie stores `recruitGen` and `pulseAt`. A zombie pulses at most once, and generation 3 never pulses, so chains always end. Pulses query the spatial hash once and run at most one line-of-sight test per candidate.
- **Civilians:** Unarmed humans (`role: 'civilian'`) flee threats within 12 m inside their home area and never shoot. Killed civilians use the normal 70% conversion.
- **Delayed 70% Conversion & Capacity Reservation:** Guards killed by zombie melee roll `chance = 0.7` via `ctx.rng`. After a `3.0 s` corpse delay, the body enters the `'rising'` state for `1.2 s` before becoming an active `'follower'` and incrementing `followerCount` and `stats.conversions`. Capacity checks (`followers + rising < 100`) reserve slots during the rise animation.
- **Gate Destruction & Single Nav Rebuild:** Destroying the gate disables its collider (`collision.setEnabled(id, false)`), calls `navGrid.rebuild()` exactly once to open paths into the compound, removes the camera/picking gate occluder, and emits `gateDestroyed`.
- **Procedural Geometry & Web Audio SFX:** Every building, prop, character rig, particle, and sound effect (groans, rally pulse, rush roar, gunfire, impacts, gate breach, victory/defeat stingers) is synthesized in code with zero external assets or runtime network requests.

## Tuning (`src/config/balance.ts`)

All gameplay numbers are centralized in [`src/config/balance.ts`](src/config/balance.ts):

| Category | Key Parameters |
|---|---|
| **Simulation & World** | `fixedDt`: `1/60 s`, `maxFrameDt`: `0.25 s`, `maxStepsPerFrame`: `8`, `aiTickHz`: `10`, `navReplanHz`: `5`, bounds `[-120..120] × [-90..90] m`, `navCellSize`: `1.25 m`, `navAgentRadius`: `0.45 m` |
| **Zombie Leader** | no HP — survives on **Horde Strength** (core `6` units × `40`, Alpha damage × `2.5` shared nearest-first to followers within `6 m`, Last Brain Standing `6 s` at `1.35×` speed), `walkSpeed`: `5 m/s`, `sprintSpeed`: `7.4 m/s`, `staminaMax`: `100` (drain `25/s`, recovery `15/s`, exhaustion threshold `20`), `attackDamage`: `10`, `attackRange`: `1.7 m`, `attackCooldown`: `1.1 s`, `recruitRadius`: `9 m` |
| **Walker & Horde** | `initialAmbient`: `85` (45 held in landmarks), `startFollowers`: `5` (legacy; the open world starts alone on the beach, first nest raises `10`), `maxFollowers`: `100`, `maxHp`: `40`, `speed`: `3.7 m/s` (`ambientSpeed`: `0.9 m/s`, `catchUpMultiplier`: `1.35×` beyond `14 m`), `attackDamage`: `8`, `attackRange`: `1.5 m`, `attackCooldown`: `1.2 s`, `autoEngageRadius`: `6 m`, `corpseFadeTime`: `6 s` |
| **Abilities** | **Rally (`E`):** `radius`: `15 m`, `cooldown`: `8 s` · **Rush (`Space`):** `duration`: `4 s`, `cooldown`: `15 s`, `speedMultiplier`: `1.45×`, `attackRateMultiplier`: `1.25×` |
| **Human Guard** | `count`: `8` (`towerCount`: `2`), `maxHp`: `50`, `speed`: `3 m/s`, `damage`: `10`, `range`: `22 m` (`towerRange`: `30 m`), `fireCooldown`: `0.8 s`, `hitChance`: `0.75`, `eyeHeight`: `1.5 m` (`towerEyeHeight`: `5.2 m`), `detectionFovDeg`: `140°`, `towerMeleeReachBonus`: `2.2 m` |
| **Checkpoint Gate** | `maxHp`: `400` |
| **Cascade** | `recruitPulse.radius`: `10 m`, delay `0.1–0.3 s`, `maxGeneration`: `3`, `maxRecruitsPerPulse`: `8`; `recruitBoostTime`: `2 s` at `1.35×`; `regroupDistance`: `22 m`; `catchUpLeaderMargin`: `1.12×` leader walk |
| **Structures** | HP: bus door `90`, alley gate `140`, store door `110`, pen gate `120`; release burst `2.6 m/s` for `2.5 s` |
| **Civilians & Outposts** | civilian `maxHp` `30`, flee `6.2 m/s` (followers chasing one are capped at `0.9×` that unless Rushing, then at least `1.15×`), panic radius `12 m`; barricade police: 2, range `16 m`, damage `6`, hit chance `0.55` (checkpoint guards: `10` / `0.75`) |
| **Momentum** | gains +1/+3/+5/+10, `graceTime`: `8 s`, `decayPerSecond`: `1.5`, radius `+0.5%`/pt, speed `+0.2%`/pt, tiers at `30` / `70` |
| **Conversion** | `chance`: `0.7` (70%), `delay`: `3 s`, `riseDuration`: `1.2 s` |

**Tuning changes vs spec (§7) and why:**

- `gate.maxHp` **250 → 400**. In browser playtests, 60 walkers broke a 250 HP gate in about 6 s, so the breach stopped being a decision point. At 400 the 60-walker breach takes about 10 s under tower fire. Scripted assault outcomes are unchanged: 12 walkers wipe out, while 40 and 60 win.
- The spec leaves these values open; they are documented here as chosen values:
  - Tower guards use a 30 m range and a 5.2 m eye height, so they see over the 2.4 m compound walls but not over buildings.
  - Guards hit 75% of the time.
  - Zombies at a tower base can reach the occupant with an extra 2.2 m (the "attack proxy").
- **Order succession (behaviour, not a number):** when an attack target dies, the horde re-targets the nearest *reachable* living guard within 25 m. It reverts to Follow only if none exists. While on any order, followers also swing at a guard that is adjacent to them. Without this, the horde ran back to the leader after every kill, and a 60-walker assault was lost in playtesting.

**Recruitment tuning (R4):**

- **Catch-up floor.** Before, catch-up speed was `3.7 × speedScale × 1.35`, which is below the leader's 5 m/s walk for slow-rolled walkers, so stragglers could never close the gap. Stragglers now move at least `1.12×` the leader's (momentum-scaled) walk. This also brought the opening into the spec band: the scripted run dropped from 69 to about 49 followers at 60 s.
- **Momentum decay.** It was a 5 s grace and 3/s decay, and momentum never got past about 22 even in near-optimal opening play. Now it's an 8 s grace and 1.5/s decay: GROWING OUTBREAK at about 40 s, FULL at about 70 s, and a slow fade when idle.
- **Barricade police.** In the browser playthrough, two police at checkpoint-guard stats (10 damage, 75% hit) killed an idle leader in about 5 s, which is too harsh for a "lightly defended" early encounter. They now do 6 damage at 55%, so an idle leader lasts about 12 s.
- **Opening autopilot** (`tests/opening.test.ts`, seeded, normal controls, one click per door or soldier): 38 / 50 / 74 followers at 30 / 60 / 90 s, first 30 at about 23 s, all four landmarks opened, no defeat.

**Measured balance (scripted "player-like" assault: leader parked at the staging lot, one click per target, Rush on cooldown):**

| Horde | Outcome |
|---|---|
| 20 | Wiped out: gate breached, only 2 of 8 guards killed |
| 40 | Victory in about 43 s; 24 lost, 4 converted |
| 60 | Victory in about 42 s; 24 lost, 5 converted |

## Testing

Automated tests in [`tests/`](tests/) run in Vitest without WebGL and cover all 15 requirement areas in [`docs/1_design.md`](docs/1_design.md) §15 plus district layout, math/spatial hashing, and full-assault balance:

| Test File | Coverage & Spec §15 Mapping |
|---|---|
| [`tests/recruitment.test.ts`](tests/recruitment.test.ts) | **§15.1–4:** Passive 9 m recruitment boundary, Rally 15 m range & 8 s cooldown, idempotent recruitment without duplicates, 100-follower cap with rising-slot reservation, leader exclusion, and dead follower count removal. |
| [`tests/movement.test.ts`](tests/movement.test.ts) | **§15.5–6:** Camera-relative movement and diagonal input normalization (never faster than cardinal), sprint stamina drain (25/s), exhaustion latch, 20% recovery threshold, and smooth building wall sliding. |
| [`tests/combat.test.ts`](tests/combat.test.ts) | **§15.7–8 & Full Assault Balance:** Melee range/cooldowns, Rush cadence boost, friendly/dead filtering, melee line-of-access across walls/vehicles, tower base attack proxy, single gate destruction + nav rebuild, and **scripted full-district assaults (`N = 12, 40, 60` followers)**. |
| [`tests/ai.test.ts`](tests/ai.test.ts) | **§15.9:** Guard 10 Hz perception, patrol cone vs close-range detection, building/gate LOS occlusion, tower guard elevated sight over compound walls, target retention, and reachable retreat behavior. |
| [`tests/conversion.test.ts`](tests/conversion.test.ts) | **§15.10–11:** Conversion triggered strictly on zombie-caused guard deaths, 70% RNG boundary (`0.69` vs `0.70`), 3 s corpse delay + 1.2 s rise duration, and follower cap enforcement across simultaneous deaths. |
| [`tests/victory.test.ts`](tests/victory.test.ts) | **§15.12–13, 15:** Victory requiring both gate destruction and all 8 guards dead, leader death defeat priority, simulation freeze after game over, full deterministic reset (`Simulation.reset()`), and `Attack → Recall → destroyed target` order transitions. |
| [`tests/navigation.test.ts`](tests/navigation.test.ts) | **§15.14:** `NavigationGrid` obstacle dilation, A* string-pulled routing around city blocks, sealed compound reachability before/after gate destruction, and shared `FlowField` guidance through narrow alleys (< 30 ms rebuild benchmark). |
| [`tests/horde.test.ts`](tests/horde.test.ts) | **§15.14–15 & Flocking Integration:** Order transitions, enclosed guard → gate redirection, flow-field replan throttling, Rush speed/order preservation, and leading 40 followers around city blocks and through the north alley as a separated pack. |
| [`tests/collision.test.ts`](tests/collision.test.ts) | 2D circle-vs-AABB collision, tangential sliding (> 70% preserved), anti-tunneling, world bounds clamping, dynamic collider enable/disable, and 3D height-interpolated sight occlusion. |
| [`tests/layout.test.ts`](tests/layout.test.ts) | Authored district: 8 checkpoint guards (2 tower) plus outpost humans, 85 spawns across 8 clustered zones (45 held), one breakable collider per structure, sealed enclosures that open once destroyed, start area, and opening distances. |
| [`tests/cascade.test.ts`](tests/cascade.test.ts) | Generations 0–3, stagger window, single pulse per zombie, closest-first bound, cap reservation during big cascades, wall-blocked recruitment, held exclusion, regroup steering. |
| [`tests/structures.test.ts`](tests/structures.test.ts) | Destroy-once and nav rebuild, release of exactly the held occupants with no drift back, shelter redirect, target succession, structure melee access. |
| [`tests/momentum.test.ts`](tests/momentum.test.ts) & [`tests/momentum-integration.test.ts`](tests/momentum-integration.test.ts) | Gain values, clamp, grace and decay, tier events, spec multipliers; one gain per gameplay event; live leader and follower speed scaling. |
| [`tests/opening.test.ts`](tests/opening.test.ts) | 90 s seeded autopilot of the opening (≥ 30 and ≤ 60 followers at 60 s, every landmark opened, invariants every step), plus a 100-follower + 40-cascade stress test (< 3 s). |
| [`tests/r4d.test.ts`](tests/r4d.test.ts) | Review regressions: slowest straggler catches a walking leader; many same-step hits destroy a structure exactly once. |
| [`tests/cameraMath.test.ts`](tests/cameraMath.test.ts) & [`tests/utils.test.ts`](tests/utils.test.ts) | Camera offset conventions, 6 px click-vs-drag threshold, shortest-arc angle interpolation, seeded `mulberry32` RNG, and `SpatialHash` queries. |

## Performance

**Visual polish benchmark** (2026-11-16, built-in browser pane at 800×600, DPR 1). The `?bench=` scenes ran with the game loop
driven from script, so the numbers are CPU frame time plus `gl.finish()` per frame. The window was not on screen, so real
display timing could not be measured.

| Scene | Preset | Frame p50 | Frame p95 | Draw calls | Shadow casters | Triangles | Live particles |
|---|---|---|---|---|---|---|---|
| bench=1 (100 zombies + 100 humans) | High | 14.9 ms | 25.0 ms | 418 | 152 | 807k | 82 |
| bench=1 | High + reduced motion | 11.5 ms | 18.1 ms | 325 | — | — | 34 |
| bench=1 | Medium | 14.2 ms | 22.0 ms | 320 | 110 | 800k | 46 |
| bench=1 | Low | 12.2 ms | 21.8 ms | 312 | 103 | 798k | 28 |
| bench=2 stress (260 zombies + 120 humans) | High | 13.2 ms | 18.4 ms | 492 | 145 | 866k | 92 |
| bench=2 stress | Low | 11.8 ms | 15.8 ms | 405 | 110 | 859k | 4 |

Before humans were limited to casting shadows near the Alpha, bench=1 drew about 1,260 calls with about 845 shadow casters
(10 meshes per human rig, each drawn again in the shadow pass). Humans now cast dynamic shadows only within 22–26 m of the
Alpha. Post-processing (grade + bloom) costs well under 1 ms. Particles use 2 draw calls at most. No true "before" timings of
the pre-polish build exist for these scenes; the low preset (no post, no surface detail, 1024 shadow map) is the closest
stand-in.

Measured in Chrome 156 (8 logical cores) inside the Claude desktop app's embedded browser pane, at a 1024×768 viewport with DPR 1. The scenario was 94 live followers attacking the checkpoint gate, with 8 guards firing:

| Metric | Average | p95 |
|---|---|---|
| Simulation step (fixed 1/60 s) | 0.58 ms | 0.90 ms |
| `renderer.render` submit | 1.65 ms | 2.5 ms |
| Draw calls (whole scene) | 139 | — |

**Recruitment update playthrough** (same embedded pane, 992×1172, DPR 1, pane visible, 94 live zombies with 72 following):

| Metric | Average | p95 |
|---|---|---|
| Frame interval | 9.97 ms (100 FPS at the display cap) | 10.1 ms |
| Simulation step | 0.72 ms | 0.90 ms |
| `renderer.render` submit | 1.35 ms | 2.1 ms |
| Draw calls | 38 | — |

A full run reached 49 followers at 54 s, opened all four landmarks, and won at 3:15. Details: [`.agent-context/reports/R4c-orchestrator.md`](.agent-context/reports/R4c-orchestrator.md).
| Triangles | ~60k | — |

The embedded pane caps `requestAnimationFrame` at about 50 Hz even when idle, so 60 FPS **could not be confirmed** in this environment. Observed frame intervals averaged 23 ms. The CPU work above uses well under a 16.7 ms frame. Press **F3** in-game to see FPS and draw calls on your own machine. Headless (Node), 100 followers run 600 steps in about 0.3–0.4 s, and a flow-field rebuild takes 4–11 ms.

## Known Limitations

- **Performance.** Measured in the desktop app's browser pane at 1024×768: about 50–97 FPS with 36 followers, 9–12 chunks and
  120–215 draw calls. A sustained 60 FPS on midrange hardware has not been profiled. Vite warns about the chunk size of the bundle.
- **Saves keep progress, not position.** After a reload the Alpha starts at the active nest with 5 fresh followers.
- **The early stronghold defenders are dangerous.** If the Alpha tanks the suburb police instead of sending the horde in, it dies
  in about 12 s. You then respawn at the nest.
- **No recapture.** Humans never take back a captured district (a data hook exists for later).
- **Pounce** exists only as data; nothing unlocks it in this build.
- **Pointer lock** may be unavailable in embedded browsers. Every click then attacks toward the cursor, and drag orbits the camera.
- **Best on desktop** (keyboard and mouse, 1280x720 or larger). Touch controls exist (see Touch controls) but were only tested in an emulated phone viewport, not on real devices.
- **Web Audio** starts after the first click or key press, because of browser autoplay rules.
- **Legacy district.** The recruitment-milestone district is kept as a test fixture (`buildLegacyDistrictLayout()`, the default for
  `new Simulation()`). Its checkpoint victory, Rush and click-to-select rules apply only there.

## Credits & Licensing

All 3D geometry, materials, animations, UI, and Web Audio sound effects are generated procedurally in TypeScript using Three.js primitives and the Web Audio API. No third-party models, textures, audio files, or copyrighted open-world game assets are included.

---

**Summary:** *I BE ZOMBIE* is a self-contained Three.js + TypeScript urban zombie-horde prototype pairing a deterministic, headless-tested 60 Hz simulation with instanced low-poly 3D visuals and synthesized audio.
