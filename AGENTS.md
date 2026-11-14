# AGENTS.md — I BE ZOMBIE

Shared conventions for every agent (Claude orchestrator, Codex, Antigravity) working in this repo.
**The game spec is [`docs/1_design.md`](docs/1_design.md)** (referred to by some prompts as GAME_DESIGN.md). When this file and
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
  sim/Simulation.ts            [pure] implements ISimulation; owns SimContext; fixed step order (below)
  sim/createInitialState.ts    [pure] DistrictLayout + Rng -> GameState (leader, 60 ambient, 8 guards, gate)
  world/districtLayout.ts      [pure] buildDistrictLayout(): DistrictLayout — the authored city as data
  world/CollisionWorld.ts      [pure] implements ICollisionWorld
  world/NavigationGrid.ts      [pure] implements INavigationGrid (+ FlowField implements IFlowField)
  world/CityDistrict.ts        [3D] Builds city meshes from DistrictLayout (merged/instanced)
  world/Checkpoint.ts          [3D] Checkpoint meshes, gate damage visuals, pick proxies
  entities/ZombieLeader.ts     [pure] createLeader, computeMoveVector, updateStamina, updateLeader
  entities/Zombie.ts           [pure] createZombie (ambient / converted)
  entities/HumanGuard.ts       [pure] createGuard
  entities/Structure.ts        [pure] createGate
  systems/HordeSystem.ts       [pure] applyHordeCommands, updateHorde (recruit, rally, rush, flocking, ambient wander)
  systems/NavigationSystem.ts  [pure] updateNavigation (shared flow fields, effective target, replans <= 5 Hz)
  systems/CombatSystem.ts      [pure] updateCombat + damage helpers + resolveTarget
  systems/HumanAISystem.ts     [pure] updateHumanAI (FSM PATROL/ALERT/COMBAT/RETREAT/DEAD, LOS, shooting)
  systems/ConversionSystem.ts  [pure] updateConversion (delayed 70% rise, cap)
  systems/VictorySystem.ts     [pure] checkVictory
  visuals/LowPolyCharacters.ts [3D] Articulated humanoid builders + procedural animation
  visuals/HordeRenderer.ts     [3D] InstancedMesh-per-body-part renderer for all ZombieAgents
  visuals/EntityRenderer.ts    [3D] Leader + guards + gate sync from GameState (interpolated)
  visuals/Effects.ts           [3D] Pooled tracers, muzzle flashes, rings/pulses, sparkles, dust, camera shake requests
  audio/AudioSystem.ts         [3D-side, no three needed] Web Audio synth SFX; unlock on gesture; mute-safe
  ui/HUD.ts                    DOM/CSS overlay (no framework), reads GameState + events
  ui/hud.css
  utils/math.ts                [pure] vec helpers (allocation-free variants with `out` params), angle lerp, clamp
  utils/spatialHash.ts         [pure] implements ISpatialHash (uniform grid)
  utils/rng.ts                 [pure] mulberry32(seed): Rng
tests/                         Vitest, [pure] imports only
```

Agents only create/edit files listed in their task brief. **Never edit `src/core/types.ts`, `src/core/contracts.ts`,
`src/config/balance.ts`, `package.json`, or `AGENTS.md`** — if a contract change is needed, stop and report it
(optional extra fields that you need privately belong in a local `WeakMap`/side-table, not the contract).

## World conventions

- Meters. X/Z ground plane, Y up. Ground at Y=0. District bounds x∈[-120,120], z∈[-90,90].
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
- Gate: one `ColliderDef` with `tag: 'gate'`, `kind: 'gate'`, blocksMove+blocksSight. Destroyed ⇒ `collision.setEnabled(id,false)`
  then `navGrid.rebuild()` exactly once, emit `gateDestroyed`.
- Towers: `kind:'tower'` blocking 3×3 m footprints inside the compound's front corners. Occupant stands on the platform
  (elevation ≈ 4 m). **Defeat mechanic: attack proxy** — zombies within `attackRange + guard.radius + towerMeleeReachBonus`
  of the occupant (horizontal) and with clear move-access (ignoring the tower's own collider) can claw it. Visuals show
  zombies clawing the tower legs and the occupant flinching.

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

### `Simulation.step(dt, input)` order (authoritative)

1. Copy `pos→prevPos`, `facing→prevFacing` for leader, zombies, guards.
2. If `phase !== 'playing'`: only advance anim timers / corpse fades, then return.
3. `applyHordeCommands` (attack/recall order changes, rally, rush activation, cooldown ticking)
4. `updateLeader` (movement, stamina; leader auto-melee is resolved in `updateCombat`)
5. `updateNavigation` (flow fields / effective target; ≤ 5 Hz replans + immediate on order change / nav version change)
6. `updateHorde` (spatial hash rebuild, passive recruit, ambient wander, follower steering & engagement selection)
7. `updateHumanAI` (perception at 10 Hz, FSM, movement, shooting → damage helpers)
8. `updateCombat` (follower + leader melee resolution, gate damage, deaths, corpse timers)
9. `updateConversion`
10. `checkVictory` (victory: gate destroyed AND all guards DEAD; defeat: leader dead) → set phase, emit once
11. Tick `hitFlash`, `animTime`, `capReachedFlash`; `state.time += dt`.

## Visual conventions

- Flat-shaded `MeshLambertMaterial`/`MeshStandardMaterial({flatShading:true})`, shared geometries/materials, merged static city
  geometry where possible (BufferGeometryUtils from `three/examples/jsm/utils/BufferGeometryUtils.js` is allowed — it ships with three).
- Zombies (up to ~170 incl. corpses) are drawn by `HordeRenderer` with one `InstancedMesh` per body part
  (head, torso, pelvis, upperArmL/R, legL/R, + accessory) and `instanceColor` for variants/rush tint/hit flash. Target < 40 draw calls for all zombies.
- Characters are articulated: head, torso, pelvis, 2 arms, 2 legs; pivot at shoulder/hip; procedural animation from
  `anim`, `animTime`, speed. Feet on ground. Interpolate pos/facing with render alpha.
- Palette: asphalt `#4a5260`, sidewalk `#a9a294`, concrete `#c9b99a`, zombie skin `#7d9a6a`/`#6f8a72`, leader `#4f6b3a`,
  human faction orange `#e0782a` + navy `#2c3e66`, warning lights `#ffb347`. No gore.
- Shadows: sun shadow map on for buildings/leader/guards only; zombies use a cheap blob-shadow instanced disc.
- Renderer DPR capped at 1.5. One `requestAnimationFrame` loop. `Game.dispose()` must remove all listeners.

## Testing conventions

- Tests live in `tests/*.test.ts`, import only `[pure]` modules, build worlds via `buildDistrictLayout()` or small hand-made
  `DistrictLayout`/`ColliderDef[]` fixtures, and use `mulberry32(seed)` or a scripted `Rng` stub.
- Required coverage: docs/1_design.md §15 items 1–15.

## Phased plan (orchestrator updates checkboxes)

- [x] **P1 Scaffold** (agy): package.json, tsconfig, vite.config, index.html, main.ts stub, README stub, `districtLayout.ts` + `tests/layout.test.ts`.
- [x] **P2A Collision & Nav** (codex): utils/*, CollisionWorld, NavigationGrid + FlowField, tests/collision + tests/navigation.
- [x] **P1B Visual layer** (agy): CityDistrict, Checkpoint, LowPolyCharacters, HordeRenderer, Effects, HUD, AudioSystem (render-only, driven by state).
- [x] **P2B Leader & Horde** (codex): entities/*, createInitialState, Simulation, ZombieLeader, HordeSystem, NavigationSystem, tests.
- [x] **P2C Combat, AI, Conversion, Victory** (codex): CombatSystem, HumanAISystem, ConversionSystem, VictorySystem, tests.
- [x] **P3 Integration** : Game, InputController, ThirdPersonCamera, EntityRenderer, wiring events→Effects/Audio/HUD.
- [ ] **P4 Review, playtest & tuning**: adversarial review (codex read-only), spec audit (agy), browser playthrough, README.
