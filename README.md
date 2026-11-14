# I BE ZOMBIE

A stylized low-poly 3D third-person urban horde-action prototype built with Three.js, TypeScript, and Vite. Roam a quarantined 240 m × 180 m city district as the undead leader, recruit wandering walkers into an overwhelming swarm, flank through streets and service alleys, and storm a fortified human checkpoint to breach its gate and convert the defenders.

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
- **Victory (`CHECKPOINT OVERRUN`):** Destroy the checkpoint front gate (250 HP) **and** defeat all 8 human guards (6 ground patrol guards + 2 elevated watchtower guards).
- **Defeat (`THE LEADER HAS FALLEN`):** The zombie leader's HP reaches 0. Losing all followers does not end the run as long as the leader survives and can recruit more walkers or fight on.

### Suggested Strategy
1. **Gather your horde (40–60 walkers):** Start in the southwest park/plaza and sweep through the park edge, west/south residential courtyards, commercial block, and north warehouse service alley. Walk within **9 m** of ambient walkers to recruit them passively, or press **`E` (Rally)** to pull in all walkers within **15 m**.
2. **Use urban cover & stage the assault:** Avoid marching small groups straight down the exposed main avenue under guard and watchtower fire. Route through the 5 m north service alley or behind city blocks, and gather your pack in the **east parking lot staging area** (`x: 48..80, z: -19..-5`).
3. **Breach the gate:** Left-click the checkpoint gate (or an interior guard, which automatically redirects the horde to the gate until breached) to order **`ATTACK: GATE`**, then press **`Space` (Rush)** for +45% movement speed and +25% attack rate.
4. **Overrun & convert the defenders:** Once the gate collapses, target remaining guards with Left-Click. Guards killed by zombie melee have a **70% chance** to rise after 3 seconds and join your horde. **Tower guards** are defeated by ordering zombies to attack them—walkers surround the tower base and claw its support legs (attack proxy) to damage the occupant above.

## Controls

All gameplay inputs implemented in [`src/core/InputController.ts`](src/core/InputController.ts) and [`src/core/Game.ts`](src/core/Game.ts):

| Input | Action |
|---|---|
| `W A S D` / `Arrow Keys` | Move leader relative to camera yaw (diagonal input is normalized) |
| `Shift` (`ShiftLeft` / `ShiftRight`) | Sprint while stamina allows (drains 25/s; requires 20% recovery after exhaustion) |
| `Left-Click` on guard / gate | Issue **Attack** order (`ATTACK: GUARD` or `ATTACK: GATE`) via 3D raycast |
| `Left-Click` on empty ground | Place a visual world ping (does not switch to click-to-move) |
| `Right-Click` (without drag) | **Recall** horde to `FOLLOWING` mode (clears active attack target) |
| `Right-Drag` (past 6 px threshold) | Orbit camera yaw and tilt pitch (`20°` to `65°`) |
| `Mouse Wheel` | Zoom camera between close view (`8 m`) and tactical overview (`32 m`) |
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
6. `updateHorde`: rebuild uniform-grid `SpatialHash`, passive 9 m recruitment, ambient wandering, follower flow-field + flocking steering, and local engagement selection.
7. `updateHumanAI`: staggered 10 Hz guard perception and LOS checks, FSM (`PATROL` / `ALERT` / `COMBAT` / `RETREAT` / `DEAD`), A* patrol/retreat movement, and hitscan shooting.
8. `updateCombat`: follower and leader melee damage against guards and gate, death handling, and corpse fade-out removal.
9. `updateConversion`: tick 3 s conversion delays and 1.2 s rising animations, promoting converted guards into active followers when capacity allows.
10. `checkVictory`: transition to `'defeat'` if leader died, or `'victory'` if gate is destroyed and all 8 guards are `DEAD`.
11. Tick `hitFlash`, `animTime`, `capReachedFlash`, and advance `state.time += dt`.

### Directory Structure
```text
index.html                     Canvas host (#app) + HUD root (#hud)
src/
  main.ts                      [3D] Entry point: mounts Game(#app, #hud)
  config/balance.ts            [pure] Centralized tuning constants (BALANCE)
  core/                        types.ts, contracts.ts, cameraMath.ts [pure]; Game.ts, InputController.ts, ThirdPersonCamera.ts [3D]
  sim/                         [pure] Simulation.ts, createInitialState.ts
  world/                       districtLayout.ts, CollisionWorld.ts, NavigationGrid.ts [pure]; CityDistrict.ts, Checkpoint.ts [3D]
  entities/                    [pure] ZombieLeader.ts, Zombie.ts, HumanGuard.ts, Structure.ts
  systems/                     [pure] HordeSystem.ts, NavigationSystem.ts, CombatSystem.ts, HumanAISystem.ts, ConversionSystem.ts, VictorySystem.ts
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
- **Watchtower Attack Proxy:** Tower guards stand on 4 m elevated platforms inside 3×3 m footprints. Rather than requiring stairs or making them invulnerable, zombies within `attackRange + guard.radius + towerMeleeReachBonus` (`2.2 m`) with clear ground access (ignoring the tower's own collider) claw the tower base to damage the occupant.
- **Delayed 70% Conversion & Capacity Reservation:** Guards killed by zombie melee roll `chance = 0.7` via `ctx.rng`. After a `3.0 s` corpse delay, the body enters the `'rising'` state for `1.2 s` before becoming an active `'follower'` and incrementing `followerCount` and `stats.conversions`. Capacity checks (`followers + rising < 100`) reserve slots during the rise animation.
- **Gate Destruction & Single Nav Rebuild:** Destroying the gate disables its collider (`collision.setEnabled(id, false)`), calls `navGrid.rebuild()` exactly once to open paths into the compound, removes the camera/picking gate occluder, and emits `gateDestroyed`.
- **Procedural Geometry & Web Audio SFX:** Every building, prop, character rig, particle, and sound effect (groans, rally pulse, rush roar, gunfire, impacts, gate breach, victory/defeat stingers) is synthesized in code with zero external assets or runtime network requests.

## Tuning (`src/config/balance.ts`)

All gameplay numbers are centralized in [`src/config/balance.ts`](src/config/balance.ts):

| Category | Key Parameters |
|---|---|
| **Simulation & World** | `fixedDt`: `1/60 s`, `maxFrameDt`: `0.25 s`, `maxStepsPerFrame`: `8`, `aiTickHz`: `10`, `navReplanHz`: `5`, bounds `[-120..120] × [-90..90] m`, `navCellSize`: `1.25 m`, `navAgentRadius`: `0.45 m` |
| **Zombie Leader** | `maxHp`: `100`, `walkSpeed`: `5 m/s`, `sprintSpeed`: `7.4 m/s`, `staminaMax`: `100` (drain `25/s`, recovery `15/s`, exhaustion threshold `20`), `attackDamage`: `10`, `attackRange`: `1.7 m`, `attackCooldown`: `1.1 s`, `recruitRadius`: `9 m` |
| **Walker & Horde** | `initialAmbient`: `60`, `maxFollowers`: `100`, `maxHp`: `40`, `speed`: `3.7 m/s` (`ambientSpeed`: `0.9 m/s`, `catchUpMultiplier`: `1.35×` beyond `14 m`), `attackDamage`: `8`, `attackRange`: `1.5 m`, `attackCooldown`: `1.2 s`, `autoEngageRadius`: `6 m`, `corpseFadeTime`: `6 s` |
| **Abilities** | **Rally (`E`):** `radius`: `15 m`, `cooldown`: `8 s` · **Rush (`Space`):** `duration`: `4 s`, `cooldown`: `15 s`, `speedMultiplier`: `1.45×`, `attackRateMultiplier`: `1.25×` |
| **Human Guard** | `count`: `8` (`towerCount`: `2`), `maxHp`: `50`, `speed`: `3 m/s`, `damage`: `10`, `range`: `22 m` (`towerRange`: `30 m`), `fireCooldown`: `0.8 s`, `hitChance`: `0.75`, `eyeHeight`: `1.5 m` (`towerEyeHeight`: `5.2 m`), `detectionFovDeg`: `140°`, `towerMeleeReachBonus`: `2.2 m` |
| **Checkpoint Gate** | `maxHp`: `250` |
| **Conversion** | `chance`: `0.7` (70%), `delay`: `3 s`, `riseDuration`: `1.2 s` |

Tuning changes vs spec: (to be filled in)

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
| [`tests/layout.test.ts`](tests/layout.test.ts) | Authored 240 m × 180 m district verification: 8 guards (2 tower, 3 inside, 3 outside), 60 spawns across 6 zones, single gate collider, obstacle clearances, and flood-fill reachability with gate intact vs open. |
| [`tests/cameraMath.test.ts`](tests/cameraMath.test.ts) & [`tests/utils.test.ts`](tests/utils.test.ts) | Camera offset conventions, 6 px click-vs-drag threshold, shortest-arc angle interpolation, seeded `mulberry32` RNG, and `SpatialHash` queries. |

## Performance

Performance (measured): (to be filled in)

## Known Limitations

- (to be filled in)
- **Desktop browsers only:** Designed for keyboard + mouse input at `1280×720` or larger; no mobile or touch controls are implemented.
- **Single-district vertical slice:** Features one handcrafted city district and one fortified checkpoint objective with no save/load persistence, audio volume slider (beyond `M` mute toggle), or multi-level interior navigation.
- **Web Audio gesture unlock:** Browser autoplay policies require an initial pointer click or key press before synthesized audio begins playing.

## Credits & Licensing

All 3D geometry, materials, animations, UI, and Web Audio sound effects are generated procedurally in TypeScript using Three.js primitives and the Web Audio API. No third-party models, textures, audio files, or copyrighted open-world game assets are included.

---

**Summary:** *I BE ZOMBIE* is a self-contained Three.js + TypeScript urban zombie-horde prototype pairing a deterministic, headless-tested 60 Hz simulation with instanced low-poly 3D visuals and synthesized audio.
