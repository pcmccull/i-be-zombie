# Architecture & Interface Contracts — Todos milestone (TD: docs/todos.md items 7–9)

Spec: `docs/todos.md` open items. Everything from the Open World milestone (below the rule) still holds unless this section
overrides it. `AGENTS.md` stays authoritative for stack, purity and step order. **The code written to `src/core/types.ts`,
`src/core/contracts.ts` and `src/config/balance.ts` in TD-T001 is the contract**; this section is the map and the reasons.

| # | Todo | Short form |
|---|---|---|
| 7 | Add mobile controllers | Touch UI: virtual stick, camera drag/pinch, action buttons, tap-to-order |
| 8 | Don't repeat notices (Horde at capacity repeats); make sure it isn't slowing the game | Emit `capReached` once per entry into capacity; HUD toast dedupe; no wasted recruit scans at cap |
| 9 | Hide ability slots until the first unlock, then show one slot; the other 3 are purchased | `slotsOwned` 0→1 on first unlock, slots 2–4 bought with biomass at a nest |

## TD-0. Decisions (where the todo text is open)

| Question | Decision | Why |
|---|---|---|
| What counts as the "first unlock"? | The first `unlockAbility` of a `slotBehavior:'slot'` ability (in practice Rush from `suburb_checkpoint`). Innate bite/infect never count. | Rush is auto-equipped on Q today; it keeps landing in Q. |
| What do slots cost? | Biomass, escalating: `BALANCE.progression.slotCosts = [0, 40, 70, 110]` (index = slot; slot 0 is the free one). | Stronghold rewards are 15/30/30/40 plus 2–5 per kill, so slot 2 is affordable around the second capture and slot 4 near the end. Tunable. |
| Where are slots bought? | At an active nest, from the nest panel (same place loadout changes happen). `SimInput.buySlot: boolean` edge. | Keeps "loadout changes happen at nests" consistent; no new modal UI. |
| Unlock with no free owned slot? | Unlocked but not equipped; existing toast "equip it at a nest". Equip into a slot `>= slotsOwned` is denied `'locked'`; activating such a slot is denied `'empty'`. | Purchase becomes the meaningful choice. |
| Old saves | `WorldSave.player.slotsOwned` (PlayerSave) is new and optional on read. Missing ⇒ `max(highest non-null equipped index + 1, any slot ability unlocked ? 1 : 0)`, clamped 0..4. Bump `BALANCE.save.version` 1 → 2 with a v1→v2 migration (no data loss). | Players who already have 3 equipped abilities keep them. |
| Capacity notice | Sim emits `capReached` only on the transition into capacity (`state.atCapacity` false → true). The latch clears when `followers + rising < cap`. `capReachedFlash` (the "HORDE FULL" badge) is set on that same transition only. | The event was re-emitted every 1.5 s while any ambient zombie was in range, and each one made a new toast DOM node. |
| Flapping at the edge (one dies, one rejoins) | The latch clears only after the horde has been below cap continuously for `BALANCE.horde.capNoticeRearm` (4 s). The HUD also never shows the same toast text twice while it is visible: it restarts that toast's timer instead of adding a node. | Two independent guards: one in the sim, one in the HUD. |
| Performance at cap | While `followers + rising >= cap`, passive leader recruitment and rally recruitment skip their spatial scans and `segmentBlocked` calls entirely. Due recruit pulses still fire and are consumed (`pulseAt = -1`) but recruit nothing, so no pulse is left pending forever. `countRising` stays at once per pass. | Every recruit attempt at cap used to run LOS checks for each candidate every step. |
| Touch detection | Touch UI turns on at boot when `matchMedia('(pointer: coarse)').matches`, and also on the first `pointerdown` with `pointerType === 'touch'`. Mouse/keyboard keep working at the same time. | Covers phones, tablets and touch laptops. |
| Tap on the 3D view | A tap (touch click, not a drag) issues the **horde order** under the finger: same `hordeCommandForRightClick` as desktop RMB (attack target / move to ground). Attacking with the Alpha is the ATTACK button. | Point-and-order is the main horde control and needs a free finger; the Alpha attack auto-aims anyway (100° cone). |
| Camera on touch | One finger dragging on the 3D view (not on a control) orbits; two-finger pinch zooms. | Same as left-drag orbit and wheel zoom. |
| Sprint on touch | Pushing the stick past `BALANCE.touch.sprintThreshold` (0.85 of its radius) sprints. | No extra button needed. |

## TD-1. Directory & asset map (this milestone)

No new 3D models, rigs, textures or shaders. Everything new is pure TypeScript or DOM/CSS.

```text
src/core/types.ts            [pure] + ProgressionState.slotsOwned, GameState.atCapacity, SimInput.buySlot, GameEvent slotPurchased   (orchestrator)
src/config/balance.ts        [pure] + progression.slotCosts, horde.capNoticeRearm, touch.*, save.version 2                         (orchestrator)
src/core/contracts.ts        [pure] + doc lines for buySlot / ownedSlotCount; AbilityDenyReason gains 'maxSlots'                    (orchestrator)
src/sim/createInitialState.ts[pure] defaults only: slotsOwned 0, atCapacity false                                                   (orchestrator, T001)
src/systems/HordeSystem.ts   [pure] capacity latch + scan early-out                                                                 (T002)
src/systems/ProgressionSystem.ts [pure] slot ownership, buySlot, unlock/equip/activate respect slotsOwned                            (T003)
src/persistence/saveSchema.ts[pure] slotsOwned in WorldSave, v1→v2 migration                                                         (T003)
src/ui/uiHelpers.ts          [pure] visibleSlotCount, slot view models, nextSlotCost, toast text for slotPurchased                   (T004)
src/ui/HUD.ts, NestPanel.ts, hudOpenWorld.css   owned slots only; nest "Buy slot" button + onBuySlot; toast dedupe                     (T004)
src/core/touchMath.ts        [pure] NEW: joystick + pinch + tap math                                                                (T005)
src/ui/TouchControls.ts, src/ui/touch.css       NEW: DOM touch overlay (stick, buttons), callbacks only                              (T005)
src/core/InputController.ts  touch pointers: tap→order, 1-finger orbit, pinch zoom, external move/attack/ability injection           (T006)
src/core/Game.ts, index.html, README.md         create TouchControls, wire buy-slot + touch, viewport meta                           (T006)
```

## TD-2. Locked interfaces (exact shapes for T001)

```ts
// types.ts
interface ProgressionState { ...; /** Ability slots the player owns, 0..BALANCE.progression.slots. Slots >= slotsOwned are hidden and unusable. */ slotsOwned: number }
interface GameState        { ...; /** true from the step a recruit was refused at capacity until the horde has been below cap for horde.capNoticeRearm s. Only HordeSystem writes it. */ atCapacity: boolean }
interface SimInput         { ...; /** Nest panel edge: buy the next ability slot (cost slotCosts[slotsOwned]). Only within nest.equipRadius of an active nest. */ buySlot: boolean }
GameEvent += { type: 'slotPurchased'; slot: number; cost: number }
PlayerSave += slotsOwned: number           // WorldSave.player.slotsOwned; v1 saves migrate (MIGRATIONS[1])
emptyInput() sets buySlot: false

// contracts.ts
type AbilityDenyReason = 'locked' | 'cooldown' | 'biomass' | 'noTarget' | 'notAtNest' | 'empty' | 'maxSlots';
// ProgressionSystem (doc block):
//   ownedSlotCount(state): number                 // clamp(slotsOwned, 0, slots)
//   nextSlotCost(state): number | null            // slotCosts[slotsOwned], null when all owned or slotsOwned === 0 (first is granted, not bought)
//   buySlot(ctx): boolean                         // needs slotsOwned >= 1, < slots, at an active nest, biomass >= cost; spends atomically,
//                                                 // slotsOwned++, emits slotPurchased + autosave{reason:'equip'}; else abilityDenied{abilityId:null, reason}
//   unlockAbility: first 'slot' unlock with slotsOwned === 0 sets slotsOwned = 1; auto-equip only into an empty slot < slotsOwned
//   equipAbility: slot >= slotsOwned ⇒ denied 'locked'
//   updateProgression: input.abilitySlot >= slotsOwned ⇒ denied 'empty'; input.buySlot ⇒ buySlot(ctx)

// balance.ts
progression.slotCosts: [0, 40, 70, 110]
horde.capNoticeRearm: 4          // seconds below cap before capReached can fire again
touch: { stickRadius: 56, deadZone: 0.12, sprintThreshold: 0.85, tapMaxMove: 12, tapMaxMs: 280,
         orbitSensitivity: 1.0, pinchZoomScale: 2.5, lowDpr: 1.0 }   // px / ms / multipliers
save.version: 2
```

### Pure helpers T005 must export from `src/core/touchMath.ts` (tested in `tests/touchMath.test.ts`)

```ts
interface StickOutput { moveForward: number; moveRight: number; sprint: boolean; mag: number } // -1..1, |v| <= 1
stickFromOffset(dx: number, dy: number, radius: number, deadZone: number, sprintThreshold: number, out: StickOutput): StickOutput
// screen up (dy < 0) ⇒ moveForward +1; screen right ⇒ moveRight +1; inside deadZone ⇒ zero; clamped to the unit circle
isTap(dxPx: number, dyPx: number, ms: number, maxMovePx: number, maxMs: number): boolean
pinchZoomDelta(prevDistPx: number, distPx: number, scale: number): number   // > 0 = zoom out (same sign as wheel deltaY)
```

### UI → Game callbacks (T004/T005 provide, T006 wires)

```ts
NestPanel / HUD:  onBuySlot(cb: () => void)                                   // Game sets pendingBuySlot → SimInput.buySlot for one step
TouchControls:    constructor(root: HTMLElement); enable(): void; disable(): void; isEnabled(): boolean;
                  readStick(out: StickOutput): StickOutput                     // polled by InputController.sample() each frame
                  onAttack(cb), onRegroup(cb), onFollow(cb), onAbility(cb: (slot: number) => void),
                  onMap(cb), onPause(cb), onRecenter(cb)
                  setSlots(views: { key: string; name: string; kind: string; remainingFrac: number }[])  // only owned slots; [] hides the strip
                  containsPoint(clientX, clientY): boolean                     // so InputController ignores touches that start on a control
                  dispose(): void                                              // removes all listeners and DOM
InputController:  setTouchSource(src: { readStick(out): StickOutput; containsPoint(x, y): boolean } | null)
                  queueAttack(): void; queueAbility(slot: number): void; queueCommand(cmd: HordeCommand): void
```

## TD-3. Art & 3D technical contract

Not applicable this milestone: no meshes, rigs, bones, textures or shaders are added or renamed. Touch UI is DOM/CSS on `#hud`,
using the existing HUD palette (`#e0782a` orange, `#2c3e66` navy, `#7d9a6a` zombie green) and the HUD's panel classes.
Touch controls must: sit inside `env(safe-area-inset-*)`, have hit targets ≥ 48 px, use `pointer-events:auto` only on the
controls themselves (the overlay root stays `pointer-events:none`), and never cover the minimap/objective tracker.
On touch devices Game caps DPR at `BALANCE.touch.lowDpr` (1.0) instead of 1.5.

## TD-4. Invariants added (tests must cover)

1. Holding the horde at cap with ambient zombies in range for 60 s produces exactly one `capReached`.
2. Dropping below cap for less than `capNoticeRearm` and refilling emits no second `capReached`; staying below for longer re-arms it.
3. At cap, a step with many ambient zombies near the leader makes zero `segmentBlocked` calls from passive/rally recruitment (spy on `ctx.collision`).
4. Fresh state: `slotsOwned === 0`; HUD shows no slots. First slot-ability unlock ⇒ `slotsOwned === 1` and it is equipped in slot 0.
5. Second unlock with one slot owned ⇒ unlocked, not equipped, `abilityUnlocked.slot === null`.
6. `buySlot`: denied away from a nest (`notAtNest`), without enough biomass (`biomass`), with 0 slots (`locked`), at 4 (`maxSlots`); success spends exactly `slotCosts[n]`, never goes negative, emits `slotPurchased` once.
7. Slots `>= slotsOwned` can't be equipped or activated.
8. Save round-trip keeps `slotsOwned`; a v1 save with 3 equipped abilities loads with `slotsOwned === 3` and the same loadout.
9. `stickFromOffset` is clamped, dead-zoned, sprint only past the threshold; screen-up = forward.


---

# Background: Open World milestone contracts (OW, complete; still authoritative where TD does not override)

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
