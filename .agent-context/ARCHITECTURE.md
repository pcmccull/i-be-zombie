# Architecture & Interface Contracts — Open World milestone (OW)

Spec: `docs/3_open_world.md` ("open-world spec"). Earlier specs (`docs/1_design.md`, `docs/2_intial_recruitment_design.md`)
still govern the mechanics they define (cascade recruitment, structures, momentum, towers, crawling) unless overridden here.
`AGENTS.md` stays authoritative for stack, purity rules (`[pure]` = no three, runs in Vitest/Node), world conventions and
the Simulation step order. It gets rewritten in T001 to match this file. **The code of `src/core/types.ts`, `src/core/contracts.ts`
and `src/config/balance.ts` written in T001 is the contract.** This file is the map and the reasoning behind it.

## 0. Adapting the spec to this repo (decisions)

| Spec says | This repo does | Why |
|---|---|---|
| `src/app, player/, agents/, combat/, conquest/, progression/, render/` | Keep the existing layout: `core/` (Game wiring), `sim/`, `systems/`, `entities/`, `world/`, `visuals/`, `ui/`, `audio/`, plus new `content/` and `persistence/` | Spec §1.1/§2: "retain functional systems; adapt to the repository". All 216 tests and the R-milestone mechanics live in these files. |
| String `EntityId`, `actor:damaged` style event bus with `on/off` | Numeric `EntityId`; `GameEvent` discriminated union via `ctx.emit` + `Simulation.drainEvents()` once per frame | Already typed and used by Effects/Audio/HUD. New events are added to the union (§4). |
| `GameEvent`'s `'human:infected'`, `'stronghold:captured'` ... | `converted`, `strongholdCaptured`, `districtDiscovered`, `districtStatus`, `abilityUnlocked`, `leaderRespawned` ... | Same information, repo naming. |
| One global checkpoint + victory/defeat | Four strongholds with objectives; no global victory; leader death ⇒ `phase: 'respawning'` ⇒ respawn at a nest | Spec §0 / §7. |
| Rush (Space) | **Horde Frenzy** replaces Rush (unlocked at the mall; +40 % move, +50 % attack rate, 8 s) | Spec §4E. Same mechanic, gated + retuned. todos #5 "Rush chase factor" now applies during Frenzy. |
| Horde cap 100 | `BALANCE.horde.maxFollowers = 40` (configurable) | Spec §4C / §9. Brutes count as followers. |
| Separate worktrees per agent | Branch `open-world`; workers share the checkout under strict non-overlapping locks; orchestrator commits after each VERIFIED task (pending user approval) | MEMORY: worktrees need a commit base and agy/codex ran fine in-place for R1/R2; locks below never overlap within a wave. |
| Chunks 128 m | World is fully generated as data at boot (cheap, deterministic). **Rendering** streams 80 m chunks (5 × 4 = 20 chunks) and **simulation** activates actors within `population.activeRadius` | 400/128 does not tile; 80 m divides both axes. Collision/nav need the whole world anyway (≈ 82 k nav cells). |

## 1. World

- Bounds `x∈[-200,200]`, `z∈[-160,160]` (400 × 320 m). North = −Z, East = +X. Four contiguous districts in a 2 × 2 grid split by
  two boulevards (x = 0 N–S, z = 0 E–W), connected by ≥ 3 street crossings per shared edge; no walls between districts.

| DistrictId | Quadrant | Character / landmark | Stronghold (unlock) |
|---|---|---|---|
| `suburbs` | SW (x<0, z>0) | houses, yards, park, start nest | `suburb_checkpoint` — small police barricade/pen (no unlock, biomass; claims suburbs fast) |
| `police` | NW (x<0, z<0) | civic center, fortified station, parking | `police_station` — tier 2 (**alpha_claws**) |
| `shopping` | SE (x>0, z>0) | mall, big parking lot, storefronts | `mall_security` — tier 1 (**horde_frenzy**) |
| `industrial` | NE (x>0, z<0) | warehouses, loading yards, the existing gated checkpoint with towers | `industrial_yard` — tier 3 (**brute_evolution**) |

- Player start ≈ (−150, 115) in suburbs, beside the start nest, 5 start followers, first civilians within 15 s walk.
- Landmarks from the recruitment milestone (bus, locked alley, convenience store, police pen) are redistributed: bus + alley +
  store in suburbs/shopping, police pen = `suburb_checkpoint`. The gate + W/E towers become `industrial_yard`.
- `src/world/districtLayout.ts` → `buildDistrictLayout(seed?)` returns the **whole world** (`DistrictLayout` gains `districts`,
  `strongholds`, `nests`, `chunks` metadata). Content per district lives in `src/world/layout/{roads,suburbs,police,shopping,industrial}.ts`.
  The current single-district builder is preserved as `src/world/legacyDistrictLayout.ts` (`buildLegacyDistrictLayout()`) and the
  existing mechanic tests run on it unchanged.
- `src/world/worldQueries.ts` [pure]: `getDistrictAt(layout, p)`, `chunkIdAt(p)`, `chunkRect(id)`, `chunksInRadius(p, r, out)`,
  `ChunkStreamer` (desired set + load/unload diff, bounded by `world.chunkLoadRadius`).
- Nav grid stays 1.25 m over the whole world. `buildFlowField(goals, reuse?, maxDistance?)` gains an optional search bound
  (`nav.flowFieldMaxDistance`, default 140 m) so 5 Hz replans stay cheap; outside the bound `sample` returns false and the horde falls
  back to direct steering / catch-up.

## 2. Simulation scale (population)

- All humans and ambient zombies exist in `GameState` from the start (bounded by district budgets in the layout), but only those
  within `population.activeRadius` (110 m) of the leader are simulated each step (`dormant` flag, refreshed at 2 Hz by
  `PopulationSystem`). Dormant agents keep their state; nothing is simulated "elsewhere".
- Civilians killed in a human-held district respawn from that district's budget after `population.civilianRespawnDelay`, only at spawn
  points ≥ `population.minRespawnDistance` from the leader. Ambient zombie counts per district top up the same way. Hard caps:
  `population.maxHumans`, `population.maxAmbient`, `horde.maxFollowers`. No unbounded growth (test-enforced).

## 3. New / changed data model (written to `types.ts` in T001)

```ts
type DistrictId = 'suburbs' | 'police' | 'shopping' | 'industrial';
type TerritoryStatus = 'unknown' | 'human' | 'contested' | 'infected';
type StrongholdId = 'suburb_checkpoint' | 'police_station' | 'mall_security' | 'industrial_yard';
type AbilityId = 'bite' | 'infect' | 'alpha_claws' | 'horde_frenzy' | 'pounce' | 'brute_evolution'; // pounce: data only
type HumanRole = 'civilian' | 'police' | 'soldier';           // police = pistol, soldier = rifle (towers, yard)
type HumanPost = 'stronghold' | 'street' | 'store' | 'patrol'; // replaces 'checkpoint' | 'barricade'
GuardSpawn/GuardAgent += strongholdId: StrongholdId | null; GuardAgent += dormant, staggerTime
ZombieAgent += dormant: boolean; brute: boolean
LeaderState += attackPhase: 'ready'|'windup'|'recovery'; attackTimer; comboStep; comboWindow; hitStun; respawnTimer

interface DistrictDef  { id; name; rect: AABB; strongholdId: StrongholdId | null; civilianBudget; ambientBudget; spawnPoints: Vec2[] }
interface ObjectiveDef { id: string; label: string;
  kind: 'destroyStructure' | 'destroyGate' | 'killDefenders' | 'holdPoint';
  structureId?: number; point?: Vec2; radius?: number; holdTime?: number; minZombies?: number }
interface StrongholdDef { id: StrongholdId; districtId; name; bounds: AABB; center: Vec2; defenseTier: number;
  unlock: AbilityId | null; biomassReward: number; objectives: ObjectiveDef[]; nestId: string;
  reinforcementPoints: Vec2[] }
interface NestDef { id: string; districtId; pos: Vec2; strongholdId: StrongholdId | null } // null = start nest (always active)

interface DistrictState  { id; status: TerritoryStatus; discovered: boolean; infection: number; humanStrength: number;
  alertLevel: number; strongholdCaptured: boolean }        // exactly the spec §3 shape
interface StrongholdState { id; captured: boolean; contested: boolean; defenderStrength: number; objectivesDone: string[];
  holdProgress: number; reinforcementsSpent: number }
interface ProgressionState { biomass: number; unlocked: AbilityId[]; equipped: (AbilityId | null)[]; // length 4 = Q,E,R,F
  cooldowns: Partial<Record<AbilityId, number>>; frenzyTimeLeft: number }
interface DiscoveryState { cellSize: number; cols: number; rows: number; bits: Uint8Array } // fog; independent of territory
GameState += districts: Record<DistrictId, DistrictState>; strongholds: StrongholdState[]; progression: ProgressionState;
  discovery: DiscoveryState; activeNestId: string; phase: 'playing' | 'respawning'
HordeOrder += { type: 'move'; point: Vec2; expiresAt: number }   // falls back to follow on expiry / arrival
```

**Discovery ≠ conquest:** `discovery.bits` (20 m cells revealed within `discovery.revealRadius` of the leader) and
`DistrictState.discovered` never change `status`; status moves `unknown → human` on discovery, `human → contested` when a stronghold
objective takes damage or completes, `contested → infected` only on capture. Captures persist; recapture is a data hook only
(`StrongholdState.captured` is never cleared by the sim in this milestone).

## 4. Input model (published; resolves spec §7 "Controls")

| Input | Action | SimInput |
|---|---|---|
| WASD / Shift | camera-relative move / sprint | `moveForward, moveRight, cameraYaw, sprint` |
| LMB/RMB-drag, Z / X (free cursor, no pointer lock) | orbit camera | — |
| **LMB** | Alpha attack (bite; 3-hit combo when `alpha_claws` equipped). Forgiving auto-aim: nearest enemy/structure in a 100° cone within reach, else swing forward | `attack: boolean` (edge) |
| **RMB** on human / gate / structure | horde attack order; **Ctrl+RMB** adds/removes a split target (existing squads) | `hordeCommand: {type:'attack', target, additive}` |
| **RMB** on ground | horde move order (marker, expires `horde.moveOrderTime` → follow) | `hordeCommand: {type:'move', point}` |
| **Space** / Shift+RMB | Rally / regroup (existing rally: pull + recruit) | `hordeCommand: {type:'regroup'}` |
| **G** | recall: everyone follows | `hordeCommand: {type:'follow'}` |
| **Q E R F** | activate equipped ability slot 0–3 | `abilitySlot: 0..3 \| null` |
| Nest panel click | equip ability into slot (only within `nest.equipRadius` of an active nest) | `equip: {slot, ability} \| null` |
| **M** | full world map toggle (mute moves to pause menu / `N`) | — (UI) |
| **Esc** | pause menu: Continue / Save / Reset Save (confirm) / mute | — (Game) |
| Tab / F3 / C / V / Z X / wheel | help / debug overlay / recenter / look back / turn / zoom (unchanged) | — |

## 5. Systems, APIs and step order

New pure modules (signatures fixed in `contracts.ts` in T001; T001 ships compiling stubs):
- `systems/ProgressionSystem.ts`: `addBiomass(ctx, amount, reason)`, `canActivate(state, id)`, `activateAbility(ctx, id)`,
  `unlockAbility(ctx, id)` (idempotent, auto-equips into the first empty slot, emits `abilityUnlocked` once), `equipAbility(ctx, slot, id)`,
  `updateProgression(ctx, dt, input)`, `hordeSpeedMultiplier(state)`, `hordeAttackRateMultiplier(state)`, `isFrenzyActive(state)`.
  Biomass never goes negative; activation checks unlocked ∧ equipped ∧ cooldown = 0 ∧ biomass ≥ cost atomically.
- `systems/ConquestSystem.ts`: `updateConquest(ctx, dt)` — objectives, contested/capture (exactly once ⇒ `unlockAbility`,
  biomass reward, nest activation, district `infected`), alert level + bounded reinforcement squads, nest replenishment, discovery reveal,
  district status. `objectiveStatus(ctx, strongholdId)` for the HUD.
- `systems/RespawnSystem.ts`: `updateRespawn(ctx, dt)` — leader death ⇒ `phase='respawning'`, timer ⇒ respawn at `activeNestId`
  (or nearest active nest) with `respawn.followers` fresh followers; progression, territory, discovery untouched.
- `systems/PopulationSystem.ts`: `updatePopulation(ctx, dt)` — dormant flags (2 Hz), budgeted respawns, caps.
- `persistence/saveSchema.ts` (pure): `SAVE_VERSION`, `WorldSave` (spec §3 shape + `discoveryBits: string` base64, `activeNestId`,
  `equipped`), `createSave(state, seed)`, `applySave(state, ctx, save)`, `parseSave(raw: unknown): WorldSave | null` (validate + migrate,
  null on corrupt/incompatible). `persistence/SaveStore.ts`: `SaveStore(storage: StorageLike)` with `load/save/clear`, never throws.
- Existing systems keep their APIs; CombatSystem gains `resolveLeaderAttack` (the **single** damage/infection pathway for leader,
  followers, brutes and guards stays `CombatSystem`'s damage helpers).

`Simulation.step` order (replaces AGENTS.md list in T001):
1. copy prev pos/facing · 2. `updatePopulation` · 3. `applyHordeCommands` · 4. `updateProgression` · 5. `updateLeader` (movement + attack
state machine; skipped while respawning) · 6. `updateNavigation` · 7. `updateHorde` · 8. `updateHumanAI` · 9. `updateCombat` ·
10. `updateConversion` · 11. `updateStructures`, `updateMomentum` · 12. `updateConquest` · 13. `updateRespawn` · 14. timers, `time += dt`.
The world keeps simulating while `phase==='respawning'`.

New events (added to `GameEvent`): `attackSwing{combo}`, `districtDiscovered`, `districtStatus`, `strongholdContested`,
`objectiveComplete`, `strongholdCaptured`, `abilityUnlocked`, `abilityEquipped`, `abilityUsed`, `abilityDenied{reason}`, `biomassGain`,
`frenzyStart/End`, `bruteEvolved`, `reinforcements`, `nestActivated`, `leaderRespawned`, `moveOrder`, `autosave{reason}`.
Legacy-only (kept as the legacy-district test fixture, never reached in the open world): `victory`, `defeat`, `rushStart/End`, SimInput `rally/rush/recall/attackTarget`, posts `checkpoint/barricade`.

## 6. Module ownership (this milestone)

- Orchestrator only: `src/core/types.ts`, `src/core/contracts.ts`, `src/config/balance.ts`, `src/content/**`, `AGENTS.md`, `package.json`.
- `[pure]` sim/world/persistence → `@codex-worker` (fallback `@claude-worker`); persistence schema → `@agy-worker` (fallback claude).
- `src/world/{CityDistrict,Landmarks,Checkpoint}.ts`, `src/visuals/**`, `src/ui/**`, `src/audio/**` → `@agy-worker`.
- `src/core/{Game,InputController,ThirdPersonCamera}.ts`, `src/main.ts`, `index.html`, `src/sim/{Simulation,createInitialState}.ts`,
  integration tests → `@claude-worker`.
- Exact per-task locks: `.agent-context/PROGRESS.md`.
