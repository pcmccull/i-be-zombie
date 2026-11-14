# I BE ZOMBIE

A stylized low-poly 3D third-person urban horde-action prototype built with Three.js, TypeScript, and Vite. Roam a quarantined 240 m × 180 m city district as the undead leader, start an outbreak that cascades through the neighbourhood, break open landmarks packed with the infected, and storm a fortified human checkpoint to breach its gate and convert the defenders.

## What's new: fast opening & outbreak recruitment

Implemented from [`docs/2_intial_recruitment_design.md`](docs/2_intial_recruitment_design.md):

- **Start with 5 followers** in the park plaza, with 2 civilians and the abandoned bus in view.
- **Cascading recruitment:** every new recruit sends one staggered pulse (0.1–0.3 s, 10 m) that recruits up to 8 nearby wandering zombies, up to 3 generations deep. Pulses never pass through walls, never re-fire, and respect the 100-zombie cap. Ground rings, recruit highlights and an aggregated "+N" counter show the spread.
- **Landmarks with trapped zombies:**

  | Landmark | Inside | Defenders |
  |---|---|---|
  | Abandoned bus | 15 zombies | none |
  | Police barricade holding pen | 10 zombies | 2 armed police |
  | Convenience store | 4 sheltering civilians | none |
  | Locked alley | 20 zombies | none |

  Click a door or gate to break it. Freed zombies burst out and can be recruited, and the navigation grid reopens.
- **Outbreak Momentum (0–100):** recruits +1, conversions +3, armed kills +5, defensive structures and the gate +10. Momentum raises recruit radius (up to +50%) and horde speed (up to +20%). It decays slowly after 8 s idle. The HUD meter shows DORMANT / GROWING OUTBREAK / FULL OUTBREAK.
- **Responsiveness:** fresh recruits get a short speed boost. Stragglers beyond 14 m move faster than the leader walks, and beyond 22 m they regroup via the shared flow field.

## Requirements & Commands

- **Runtime:** Node.js 18+ (tested with Node 22) and a desktop browser with WebGL2 and Web Audio support.

| Task | Command | Notes |
|---|---|---|
| Install dependencies | `npm install` | Installs `three`, `typescript`, `vite`, and `vitest` |
| Start dev server | `npm run dev` | Serves at `http://localhost:5173` |
| Type-check & production build | `npm run build` | Runs `tsc --noEmit && vite build` |
| Preview production build | `npm run preview` | Serves the built bundle locally via `vite preview` |
| Run automated tests | `npm test` | Runs headless pure-simulation unit/integration suites (`vitest run`) |

## How to Play

### Objective
Capture the fortified human checkpoint in the northeast block (`CAPTURE THE CHECKPOINT`):
- **Victory (`CHECKPOINT OVERRUN`):** Destroy the checkpoint front gate (400 HP) **and** defeat all 8 checkpoint guards (6 ground patrol guards + 2 elevated watchtower guards). Civilians and the barricade police are optional.
- **Defeat (`THE LEADER HAS FALLEN`):** The zombie leader's HP reaches 0. Losing all followers does not end the run as long as the leader survives and can recruit more walkers or fight on.

### Suggested Strategy
1. **Start the outbreak (first ~60 s):** catch the two civilians at the park edge. Then click the **bus door**; breaking it frees 15 zombies, and their pulses chain into the park-edge walkers.
   - Head east past the **parking-lot courtyard** (12 zombies).
   - Order the horde onto the **two police** at the barricade, then break the **pen gate** (10 zombies).
   - Raid the **convenience store**: click a civilian inside and the horde breaks the door first.
   - Open the **locked alley** across the street (20 zombies).
   - Walking within **9 m** recruits passively; **`E` (Rally)** pulls in everything within **15 m**. Both radii grow with momentum.
   - A reasonably effective run reaches about 30 followers by about 25 s and 30–50 by 60 s.
2. **Use urban cover & stage the assault:** Avoid marching small groups straight down the exposed main avenue under guard and watchtower fire. Route through the 5 m north service alley or behind city blocks, and gather your pack in the **east parking lot staging area** (`x: 48..80, z: -19..-5`).
3. **Breach the gate:** Left-click the checkpoint gate (or an interior guard, which automatically redirects the horde to the gate until breached) to order **`ATTACK: GATE`**, then press **`Space` (Rush)** for +45% movement speed and +25% attack rate.
4. **Overrun & convert the defenders:** Once the gate collapses, target remaining guards with Left-Click. Guards killed by zombie melee have a **70% chance** to rise after 3 seconds and join your horde. **Tower guards** are defeated by ordering zombies to attack them. Up to 5 walkers at a time climb the tower legs, and only those on the platform can hit the occupant.

## Controls

All gameplay inputs implemented in [`src/core/InputController.ts`](src/core/InputController.ts) and [`src/core/Game.ts`](src/core/Game.ts):

| Input | Action |
|---|---|
| `W A S D` / `Arrow Keys` | Move leader relative to camera yaw (diagonal input is normalized) |
| `Shift` (`ShiftLeft` / `ShiftRight`) | Sprint while stamina allows (drains 25/s; requires 20% recovery after exhaustion) |
| `Left-Click` (while mouse is not captured) | Capture the mouse (Pointer Lock) and dismiss the intro without selecting or pinging a target |
| `Mouse Move` (while captured) | Orbit camera yaw and tilt (`20°`–`78°`); the camera stays where you leave it until `C` |
| `Left-Click` on guard / civilian / gate / landmark door | Toggle the target under the centre crosshair (or cursor when not captured) in or out of the attack selection. The horde splits evenly across all selected targets. Clicking a civilian inside the intact store sends the horde to the store door first |
| `Left-Click` on empty ground | Place a visual world ping at the centre crosshair (or cursor when not captured) |
| `Right-Click` (without drag) | **Recall** horde to `FOLLOWING` mode (clears active attack target) |
| `Esc` | Release captured mouse (also released when opening `Tab` help or on Victory / Defeat) |
| `Left-` or `Right-Drag` (past 6 px threshold, when not captured) | Orbit camera yaw and tilt (`20°`–`78°`) when mouse is not captured; stays where you leave it until `C` |
| `Z` / `X` | Rotate camera left / right |
| Hold `V` | Look back at the horde |
| `Mouse Wheel` | Zoom camera between close view (`8 m`) and tactical overview (`48 m`) |
| `Space` | Trigger **Horde Rush** (4 s duration, 15 s cooldown: +45% follower speed, +25% attack rate) |
| `E` | Trigger **Rally** pulse (8 s cooldown: instantly recruits eligible walkers within 15 m) |
| `C` | Smoothly recenter camera behind leader heading |
| `Tab` | Toggle the controls & commands help panel |
| `F3` | Toggle performance & entity debug overlay (FPS, draw calls, live zombies, followers, guards) |
| `M` | Mute / unmute synthesized Web Audio SFX |
| `R` (or HUD `Restart` button) | Restart the game on Victory or Defeat screens |

## Architecture Overview

The codebase enforces a strict separation between pure gameplay simulation and Three.js presentation:
- **Pure Simulation (`[pure]`):** Located in [`src/sim/`](src/sim/), [`src/systems/`](src/systems/), [`src/entities/`](src/entities/), [`src/world/districtLayout.ts`](src/world/districtLayout.ts), [`src/world/CollisionWorld.ts`](src/world/CollisionWorld.ts), [`src/world/NavigationGrid.ts`](src/world/NavigationGrid.ts), and [`src/utils/`](src/utils/). Zero `three` imports; executes deterministically at a fixed `1/60 s` timestep (`BALANCE.sim.fixedDt`) with a seeded PRNG (`mulberry32`) and runs headlessly in Node/Vitest.
- **3D Visuals & Audio (`[3D]`):** Located in [`src/world/CityDistrict.ts`](src/world/CityDistrict.ts), [`src/world/Checkpoint.ts`](src/world/Checkpoint.ts), [`src/visuals/`](src/visuals/), [`src/audio/AudioSystem.ts`](src/audio/AudioSystem.ts), and [`src/ui/HUD.ts`](src/ui/HUD.ts). Reads `GameState` with render-alpha transform interpolation and consumes per-frame events from `Simulation.drainEvents()` to trigger pooled particles/tracers, camera shake, Web Audio synth cues, and DOM HUD updates.

### Authoritative `Simulation.step(dt, input)` Order
1. Copy `pos → prevPos` and `facing → prevFacing` for leader, zombies, and guards (for render interpolation).
2. If `phase !== 'playing'`: advance animation timers and corpse fade timers only, then return.
3. `applyHordeCommands`: process Attack/Follow order changes, Rally pulse, Rush activation, and ability cooldowns.
4. `updateLeader`: camera-relative movement, stamina drain/recovery/exhaustion latch, and 2D circle-vs-AABB sliding collision.
5. `updateNavigation`: update shared `followField` and `attackField` flow fields (throttled to ≤ 5 Hz for moving goals, immediate on order or `navGrid.version` change) and resolve `effectiveTarget` (redirecting enclosed targets to the intact gate).
6. `updateHorde`: rebuild uniform-grid `SpatialHash`, passive 9 m recruitment (line-of-sight), due cascade pulses, ambient and held wandering, follower flow-field + flocking steering, and local engagement selection.
7. `updateHumanAI`: staggered 10 Hz guard perception and LOS checks, FSM (`PATROL` / `ALERT` / `COMBAT` / `RETREAT` / `DEAD`), A* patrol/retreat movement, and hitscan shooting.
8. `updateCombat`: follower and leader melee damage against guards and gate, death handling, and corpse fade-out removal.
9. `updateConversion`: tick 3 s conversion delays and 1.2 s rising animations, promoting converted humans into active followers when capacity allows. Each one sends its own recruit pulse.
9b. `updateStructures` (release bursts, hit flashes), then `updateMomentum` (grace, decay, tier events).
10. `checkVictory`: transition to `'defeat'` if the leader died, or `'victory'` if the gate is destroyed and all 8 checkpoint guards are `DEAD`.
11. Tick `hitFlash`, `animTime`, `capReachedFlash`, and advance `state.time += dt`.

### Directory Structure
```text
index.html                     Canvas host (#app) + HUD root (#hud)
src/
  main.ts                      [3D] Entry point: mounts Game(#app, #hud)
  config/balance.ts            [pure] Centralized tuning constants (BALANCE)
  core/                        types.ts, contracts.ts, cameraMath.ts [pure]; Game.ts, InputController.ts, ThirdPersonCamera.ts [3D]
  sim/                         [pure] Simulation.ts, createInitialState.ts
  world/                       districtLayout.ts, CollisionWorld.ts, NavigationGrid.ts [pure]; CityDistrict.ts, Checkpoint.ts, Landmarks.ts [3D]
  entities/                    [pure] ZombieLeader.ts, Zombie.ts, HumanGuard.ts, Structure.ts
  systems/                     [pure] HordeSystem.ts, NavigationSystem.ts, CombatSystem.ts, HumanAISystem.ts, ConversionSystem.ts, VictorySystem.ts, StructureSystem.ts, MomentumSystem.ts
  visuals/                     [3D] LowPolyCharacters.ts, HordeRenderer.ts, EntityRenderer.ts, Effects.ts
  audio/                       AudioSystem.ts (Web Audio procedural synthesizer)
  ui/                          HUD.ts, hud.css (DOM/CSS overlay)
  utils/                       [pure] math.ts, spatialHash.ts, rng.ts
tests/                         Vitest suites importing [pure] modules only
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
| **Zombie Leader** | `maxHp`: `100`, `walkSpeed`: `5 m/s`, `sprintSpeed`: `7.4 m/s`, `staminaMax`: `100` (drain `25/s`, recovery `15/s`, exhaustion threshold `20`), `attackDamage`: `10`, `attackRange`: `1.7 m`, `attackCooldown`: `1.1 s`, `recruitRadius`: `9 m` |
| **Walker & Horde** | `initialAmbient`: `85` (45 held in landmarks), `startFollowers`: `5`, `maxFollowers`: `100`, `maxHp`: `40`, `speed`: `3.7 m/s` (`ambientSpeed`: `0.9 m/s`, `catchUpMultiplier`: `1.35×` beyond `14 m`), `attackDamage`: `8`, `attackRange`: `1.5 m`, `attackCooldown`: `1.2 s`, `autoEngageRadius`: `6 m`, `corpseFadeTime`: `6 s` |
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

- **60 FPS not verified on a standalone browser** (see Performance). The production bundle is about 650 kB (about 170 kB gzipped), and Vite warns about chunk size.
- **Order succession is automatic.** After one attack order the horde chains to nearby reachable guards by itself; right-click recall always overrides it.
- **Tower occupants never descend.** Zombies have to climb to reach them.
- **Momentum only scales speed and recruit radius.** It has no effect on damage or attack rate.
- **The opening pacing figures come from the scripted autopilot.** Human play varies; the barricade police can kill a leader who walks past without ordering an attack, which is intended as high risk.
- **`R` restarts only from the victory/defeat screens.**
- **Camera:** buildings between the camera and the leader fade out and the camera pulls in (4 m minimum). Very tight gaps can still produce close, steep views.
- **Desktop browsers only:** Designed for keyboard + mouse input at `1280×720` or larger; no mobile or touch controls are implemented.
- **Single-district vertical slice:** Features one handcrafted city district and one fortified checkpoint objective with no save/load persistence, audio volume slider (beyond `M` mute toggle), or multi-level interior navigation.
- **Web Audio gesture unlock:** Browser autoplay policies require an initial pointer click or key press before synthesized audio begins playing.

## Credits & Licensing

All 3D geometry, materials, animations, UI, and Web Audio sound effects are generated procedurally in TypeScript using Three.js primitives and the Web Audio API. No third-party models, textures, audio files, or copyrighted open-world game assets are included.

---

**Summary:** *I BE ZOMBIE* is a self-contained Three.js + TypeScript urban zombie-horde prototype pairing a deterministic, headless-tested 60 Hz simulation with instanced low-poly 3D visuals and synthesized audio.
