# HH — Horde Strength replaces Alpha health (docs/13_hode_health.md) — IMPLEMENTED (T001–T008 verified 2026-11-21; Phase 3 pending)

Spec: `docs/13_hode_health.md` ("horde-health spec"). Report ids prefixed `HH-` (`reports/HH-T002-codex.md`). Everything below
(VP2 parked, CU, HUD, VP, EW, TD, IN, OW) still holds unless this section overrides it. **Gameplay milestone:** the Alpha loses
its HP; `state.horde` (one pure system, one calculation) becomes the only player-survival resource.

## HH-A. Audit — current damage flow (2026-11-20)

| Area | Today | Change |
|---|---|---|
| Alpha HP | `LeaderState.hp/maxHp` (via `MobileBase`, `BALANCE.leader.maxHp` 100). Only damage writer: `CombatSystem.damageLeader(ctx, amount)` → `hp -= amount`, hit stun ≥ `alpha.hitStunDamage`, `leaderDied` at 0 (sets `alive=false`). | Fields removed from `LeaderState` (HH-T008). `damageLeader` routes into `applyAlphaDamage`. |
| Alpha damage sources | All go through `damageLeader`: soldier/police rifles + barricade (`HumanAISystem.fire`), mounted MG / tank coax (`heavyRound`), tank cannon splash (`fireHeavy`: followers first, then leader), armed civilians bat/gun (`HumanAISystem` ~431/449), rammer cars (`TrafficSystem` ~339). No hazards/traps exist. | Same call sites plus a `source` tag. Fixing `damageLeader` fixes every source. |
| Projectiles | Hitscan: hit roll at fire time, damage straight to `g.target`; a follower standing in the line of fire never blocks. | **Body interception** (HH-T004). |
| Follower HP | `ZombieAgent.hp` (walker 40, brute 180, companion 75); `damageZombie` → `killZombie`; `followerCount` invariant. | Unchanged. Followers keep individual HP. |
| Healing | Shop healing drinks (`ShopSystem`, +35 HP), convoy supplies (`CityActivityDirector`, +45 HP), respawn full heal. No regen, no max-HP upgrade, no damage-reduction ability. | Drinks/convoy restore the **Alpha core** (HH-0). Respawn restores the core. |
| Capacity upgrades | `followerCap(ctx)` (HordeSystem): +`followersPerNest` per active nest. Traits = speed/attack only. | Max strength derives from `followerCap`, so upgrades raise it automatically. |
| Alive checks | ~17 sites test `leader.alive && leader.hp > 0` (Awareness, Combat, Conquest, HumanAI, Population, Progression, Victory, EntityRenderer, VisionFog). `alive ⇔ hp > 0` today. | Mechanical → `leader.alive` (HH-T001, behaviour-neutral). |
| HUD | `hudModel.healthView` (character card HP bar, low/critical), `drinkNearby` (hp < max), HUD.ts `hpMax`/hp bar; `HealthBars.ts` world-space Alpha bar. | Removed. Horde Strength bar is the primary survival widget + Last Brain countdown. |
| Save | No Alpha HP saved. Followers transient (canonical rule). | Optional `PlayerSave.alphaCoreDamage` (v4, no version bump; missing ⇒ 0). |
| Fast travel | `HideoutSystem.relocateParty`, nest travel (`state.nestTravel`): move Alpha + followers, no HP change. | Unchanged; strength is derived, so it cannot duplicate (tested). |

## HH-0. Decisions (where the spec meets this repo)

| Question | Decision | Why |
|---|---|---|
| Single source of truth | **Derived, recomputed once per step**: `computeHordeStrength(ctx)` = `clamp(followerStrength + coreStrength, 0, maxStrength)`, written to `state.horde` by `updateHordeHealth`. Nobody subtracts from `strength`; it falls only because followers die or the core is depleted. | Spec §2.3 "one authoritative method"; no double counting by construction. One loop over ≤ 220 zombies per step is trivial; HUD reads the cached value. |
| Strength contribution | `strengthValueOf(state, z)`: live `follower` only (not rising/ambient/held/dead). walker 1, companion 2, brute 3 (`BALANCE.hordeHealth.values`). No new `ZombieAgent` field. | Spec §4.1 adapted to the types that exist (no new zombie types). |
| Alpha alone (beach start, cap 0) | **Alpha core** = `alphaCore` (6) strength units that belong to the Alpha and are part of Horde Strength (same bar, its own segment). The core *is* the spec's shared-damage accumulator: `coreDamage` (units, fractional) grows only with Alpha damage no nearby follower absorbed. Solo toughness = `6 × unitHp 40 / 2.5` = 96 incoming damage ≈ the old 100 HP, so the beach opening / solo checkpoint stays balanced. | Without it the open world starts at 0 strength = instant Last Brain Standing. Spec: "combined survivability of Alpha and the zombies"; "No horde: nearly defenseless". |
| Max strength | `maxStrength = alphaCore + followerCap(ctx) × capUnitsPerFollower (1)`. Brutes/companions can push raw strength above max → clamped. | Spec §4.2; capacity upgrades keep working unchanged. |
| Alpha damage → strength | `shared = incoming × alphaDamageMultiplier (2.5)` in **follower-HP units**; one strength unit = `unitHp` (40 = walker HP), the normaliser. A rifle hit (10) = 25 HP shared ≈ 0.6 walker. Distribution order (spec §2.3): (1) live, non-dormant followers within `shareRadius` (6 m), nearest first, pouring damage into one until it dies, then the next (≤ `maxRecipients` 4) via `damageZombie` (normal death path, anims, events); (2) remainder → core (`coreDamage += rest / unitHp`, capped at `alphaCore`); (3) still more (core empty) → remaining followers anywhere, nearest first. Chip damage is never spread across the whole horde. | Visible casualties near the Alpha; a large horde absorbs more but direct hits always cost strength (spec §3.2); an Alpha out front loses core. |
| Alpha reaction | `damageLeader` keeps hit flash, hit stun (`alpha.hitStunDamage` on *incoming*), `damage` event (target leader, amount = incoming), then a `sharedDamage` event (recipients + core share) for visuals. | Preserve animation/feedback systems. |
| AoE | Tank splash already damages followers first, then the leader once; the leader's share is distributed *after* the direct splash. A body takes its own splash once and may also absorb the Alpha's share: two different damage instances, never the same one twice. | Spec §2.4. |
| Last Brain Standing | When `strength` hits 0 while `alive && phase==='playing'`: `lastBrain.active = true`, `timeLeft = duration (6)`, `graceLeft = entryGrace (0.4)`; `lastBrainStart` once (already active ⇒ no restart). During it: leader speed × `lastBrain.speedMultiplier` (1.35), panic anim (render); any `damageLeader` with `graceLeft <= 0` is a finishing hit → `killLeader` (`lastBrainEnd` 'finished'); timer 0 → `killLeader` ('expired'). Any strength > 0 (a recruit joins, a drink) → `lastBrainEnd` 'recovered', `graceLeft = recoveryGrace (1.5)`; `damageLeader` ignores hits while `graceLeft > 0` (still flashes). | Spec §5; grace prevents same-volley death and recover/die loops. |
| Death | `killLeader(ctx)` (extracted from the old `damageLeader`) sets `alive=false`, emits `leaderDied` → existing `RespawnSystem` (open world) / `checkVictory` defeat (legacy). Respawn calls `resetHordeHealth`. | Reuse existing death/respawn. |
| Healing | `restoreStrength(ctx, units, 'heal')` restores **core only** (`coreDamage -= units`, ≥ 0), returns applied units. Drinks: `shops.drinkHeal / unitHp` units; convoy supplies likewise; both refuse when the core is full (old "hp ≥ max" rule). Recruitment restores strength by adding followers (derived). Nest replenish stays (existing explicit nest mechanic). No regen added. | Spec §4.4: no invisible health beyond the visible core segment. |
| Shielding | HH-T004 (+F1): a shot aimed at the Alpha resolves against the first live, non-dormant follower whose circle the 2D shot segment crosses (LOS height rule for elevated shooters), ignoring bodies whose centre is behind the shooter or beyond the Alpha and bodies first touched inside the Alpha's own radius (beside / behind him); that body takes the bullet via `damageZombie` and the tracer ends there. Targeting: guards pick the nearest visible threat but only switch away from a still-visible target when the new one is ≥ 1.5 m nearer (`TARGET_SWITCH_MARGIN`, avoids aim-timer thrash). Ambient zombies never intercept. | Spec §3.1 / §7. |
| Legacy layout | Same rules (shared `damageLeader`). Legacy defeat = Alpha dead after Last Brain. | One code path. |
| Persistence | `createSave` writes `alphaCoreDamage = state.horde.coreDamage`; `applySave` clamps to `[0, alphaCore]` (missing/NaN ⇒ 0). Followers stay transient. | Spec §9; older saves never crash. |

### HH-0b. Design notes settled in Phase 3 (HH-V1 / HH-V2)

- **Entry grace kept (0.4 s):** a hit in the first 0.4 s of Last Brain is ignored so one MG burst cannot deplete and finish in the
  same breath; after that any hit kills (spec §12 row 11 holds outside that window). Re-entry keeps the longer remaining grace.
- **Heals count as recovery:** a drink / convoy supply during Last Brain restores core strength and ends it (spec §4.4).
- **Loads keep ≥ 1 core unit:** followers are transient (canonical save rule), so `applySave` clamps `coreDamage ≤ alphaCore − 1`
  and a save taken while depleted never loads into Last Brain. The write side stays exact.
- **Shared damage ignores shot direction** (nearest-first from the Alpha, spec §2.3 allows it).
- **Over-cap clamp:** brutes (3) and companions (2) can push raw strength above `maxStrength`; the bar shows the clamped value, so
  losses inside the surplus do not move it. `hordeCritical` is measured against `maxStrength` (spec §6: 20 % of maximum).
- `applyAlphaDamage` accepts `source` for future per-source telemetry; it does not change the distribution.

## HH-1. Contracts (written by HH-T001; exact shapes)

```ts
// src/core/types.ts
export type AlphaDamageSource = 'bullet' | 'melee' | 'explosion' | 'vehicle' | 'hazard';
export interface LastBrainState { active: boolean; timeLeft: number }
export interface HordeHealthState {
  strength: number;          // authoritative: clamp(followerStrength + (alphaCore - coreDamage), 0, maxStrength)
  maxStrength: number;       // alphaCore + followerCap(ctx) * capUnitsPerFollower
  followerStrength: number;  // Σ strengthValueOf over live followers
  coreDamage: number;        // Alpha-core units depleted, 0..alphaCore (the shared-damage accumulator)
  activeFollowers: number;   // == state.followerCount after the step
  graceLeft: number;         // s of hit protection (Last Brain entry / recovery)
  lastBrain: LastBrainState;
  // session telemetry (not saved; tests + F3)
  alphaDamageTaken: number;  // Σ incoming Alpha damage (pre-multiplier)
  sharedDamageDealt: number; // Σ shared HP routed to followers + core
  strengthGained: number;    // Σ positive per-step deltas
  strengthLost: number;      // Σ negative per-step deltas (stored positive)
}
GameState.horde: HordeHealthState;     // createInitialState: core full, strength = alphaCore until step 1 recomputes
PlayerSave.alphaCoreDamage?: number;   // v4 optional
// LeaderState: hp/maxHp kept until HH-T008, then `LeaderState extends Omit<MobileBase,'hp'|'maxHp'>`; BALANCE.leader.maxHp removed.
// GameEvent additions:
| { type: 'hordeStrengthChanged'; strength: number; maxStrength: number; delta: number;
    cause: 'recruit' | 'death' | 'alphaHit' | 'heal' | 'evolve' | 'capacity' | 'respawn' }  // ≤ 1 per step, dominant cause
| { type: 'sharedDamage'; pos: Vec2; incoming: number; shared: number; recipients: EntityId[]; core: number }
| { type: 'lastBrainStart'; pos: Vec2; duration: number }
| { type: 'lastBrainEnd'; pos: Vec2; outcome: 'recovered' | 'expired' | 'finished' }
| { type: 'hordeCritical'; strength: number; maxStrength: number }  // edge below criticalFrac, re-armed above criticalFrac + 0.05
```

```ts
// src/config/balance.ts
hordeHealth: {
  alphaDamageMultiplier: 2.5, unitHp: 40, alphaCore: 6, capUnitsPerFollower: 1,
  values: { walker: 1, companion: 2, brute: 3 },
  shareRadius: 6, maxRecipients: 4, criticalFrac: 0.2,
  lastBrain: { duration: 6, speedMultiplier: 1.35, entryGrace: 0.4, recoveryGrace: 1.5 },
},
```

### Module interfaces

```ts
// src/systems/HordeHealthSystem.ts [pure] — OWNER HH-T002. The ONLY writer of state.horde
// (besides createInitialState / applySave defaults).
export function strengthValueOf(state: GameState, z: ZombieAgent): number;
export function maxHordeStrength(ctx: SimContext): number;
export function computeHordeStrength(ctx: SimContext): { strength: number; maxStrength: number; followerStrength: number }; // THE calculation
export function applyAlphaDamage(ctx: SimContext, incoming: number, source: AlphaDamageSource): void; // called only by damageLeader
export function restoreStrength(ctx: SimContext, units: number, cause: 'heal'): number;               // core only; returns applied
export function resetHordeHealth(state: GameState): void;   // respawn / new game: core full, Last Brain + grace cleared
export function isDepleted(state: GameState): boolean;      // strength <= 0
export function isLastBrain(state: GameState): boolean;
export function isHordeShielded(state: GameState): boolean; // graceLeft > 0 (damageLeader ignores hits)
export function lastBrainSpeedMultiplier(state: GameState): number;
export function updateHordeHealth(ctx: SimContext, dt: number): void; // recompute, telemetry, events, Last Brain FSM; calls killLeader
export function finishLastBrain(ctx: SimContext): void; // (added in Phase 2) finishing hit: lastBrainEnd 'finished', clear Last Brain, killLeader — T003's damageLeader calls it
// src/systems/CombatSystem.ts — HH-T001 adds the optional param + a killLeader extraction (behaviour-neutral); HH-T003 rewires
export function damageLeader(ctx: SimContext, amount: number, source?: AlphaDamageSource): void;
export function killLeader(ctx: SimContext): void;
// src/ui/hudModel.ts — OWNER HH-T005
export interface HordeStrengthView { strength: number; max: number; frac: number; coreFrac: number; text: string; // "23 / 50"
  level: 'ok' | 'low' | 'critical' | 'lastBrain'; countdown: number; countdownText: string }
export function hordeStrengthView(state: GameState): HordeStrengthView; // replaces healthView
```

Step order (both layouts): … conversion → structures → momentum → conquest → **updateHordeHealth** → respawn → resistance /
traffic / shops / living city → awareness → timers. Damage dealt after `updateHordeHealth` in a step (traffic rammers, convoy
heal) is picked up next step (≤ 16 ms lag, never lost: the derived calc reads live followers + core).

## HH-2. Directory & ownership (this milestone)

| File | Owner task |
|---|---|
| `core/{types,contracts}.ts`, `config/balance.ts`, `sim/createInitialState.ts` (horde default), `systems/CombatSystem.ts` (param + `killLeader` extraction only), mechanical `leader.alive` replacements in Awareness/Conquest/HumanAI/Population/Progression/Victory systems, `visuals/EntityRenderer.ts`, `visuals/VisionFog.ts`, tests broken by the mechanical change | T001 |
| `systems/HordeHealthSystem.ts` (new), `tests/hordeHealth.test.ts` (new) | T002 |
| `systems/{HumanAISystem,TrafficSystem}.ts`, `tests/shielding.test.ts` (new), existing tests broken by interception (listed in report) | T004 |
| `ui/{hudModel,HUD}.ts`, `ui/{hud.css,touch.css}`, `visuals/HealthBars.ts`, `tests/hudModel.test.ts` | T005 |
| `systems/{CombatSystem,RespawnSystem,ShopSystem,CityActivityDirector}.ts`, `sim/Simulation.ts`, `entities/ZombieLeader.ts`, `persistence/saveSchema.ts`, tests asserting Alpha HP | T003 |
| `visuals/{EntityRenderer,Effects}.ts`, `graphics/vfx/{vfxRules,VFXManager}.ts`, `audio/{AudioSystem,sfxRules}.ts`, `tests/{vfx,sfxRules}.test.ts` | T006 |
| `tests/hordeStrength.test.ts` (new, spec §12 end to end), `core/Game.ts` (only if wiring is needed) | T007 |
| Type removal (`LeaderState` hp/maxHp, `BALANCE.leader.maxHp`), tuning, docs | T008 (orchestrator) |

## HH-3. Rules every task follows

- Never write `state.horde` outside `HordeHealthSystem` (createInitialState / applySave defaults only). Never subtract strength
  directly; kill followers via `damageZombie` or deplete the core via `applyAlphaDamage`.
- No code may read or write `leader.hp` / `leader.maxHp` for gameplay or UI. They are removed in T008, so
  `grep -rn "leader\.hp\|leader\.maxHp" src` must be empty before T008 starts.
- Alpha damage enters only through `damageLeader(ctx, amount, source)`. New damage sources pass a `source`.
- No per-step allocation in the distribution loop (scratch in a `WeakMap<GameState,…>` or module scratch overwritten before use).
- HUD: tokens + `--hz-u` only, no emoji/glyphs, decisions in `hudModel` (tested), reduced motion respected, readable at 375 × 812.
- VFX through `VFXManager.emit` (pooled, capped); a 50-follower wipe must not spawn 50 extra bursts (aggregate per step).

## HH-4. Invariants (tests must cover; spec §12)

1. Rifle hit on a lone Alpha: `coreDamage` += `10 × 2.5 / 40`; strength drops by exactly that; followers untouched.
2. Alpha hit with followers within `shareRadius`: nearest follower HP drops by `incoming × 2.5`, carry-over to the next, ≤ maxRecipients; core untouched if absorbed.
3. Follower non-fatal hit: follower HP drops, strength unchanged. Follower death: strength −value exactly once.
4. Five followers killed in one step: strength −5 exactly once; one `hordeStrengthChanged` with delta −5.
5. Tank splash hitting Alpha + followers: each follower's own splash applied once, the Alpha's share applied once; telemetry sums match.
6. Recruit: strength +1 (brute evolution: +2 net); never above `maxStrength`; nest claim raises `maxStrength` by `followersPerNest`.
7. Strength 0 ⇒ Last Brain (one `lastBrainStart`, no timer restart on further depletion); recruit ⇒ recovered + grace; hit (after entryGrace) ⇒ death; timer ⇒ death; death ⇒ existing respawn, core full.
8. Fast travel (hideout + nest travel) and save → load: strength / coreDamage unchanged (followers transient per the canonical rule; core persisted).
9. Rapid hits: N hits in one step = N distributions, deterministic per seed; grace windows ignore hits; no NaN; strength ∈ [0, max].
10. Shot interception: a follower on the segment takes the bullet; clear line ⇒ Alpha; dormant/dead bodies never intercept.
11. No `leader.hp` / `leader.maxHp` in `src/` (T008 type removal makes it a compile error). All enemies defeated ⇒ strength constant.

---

# VP2 — Geometry, skeletal characters & city environment overhaul (docs/12_visual_polish2.md) — PARKED (Phase 1 board only; resumes after HH)

Spec: `docs/12_visual_polish2.md` ("geometry spec"). Report ids prefixed `VP2-`. Everything below (CU, HUD, VP, EW, TD, IN,
OW) still holds unless this section overrides it. **Render + layout milestone:** no sim system, save, balance or gameplay API
changes. The only contract edits are additive optional fields/kinds in `types.ts` plus new pure contract files (VP2-1),
written in VP2-T001.

## VP2-A. Audit (spec §13 Phase 1, 2026-11-20)

| Area | Today | Reuse / replace |
|---|---|---|
| Zombie geometry | `zombieModel.ts`: 15 rigid parts (box/cylinder-ish segments) per zombie, one `InstancedMesh` per part (L/R share), accessories per bone. Reads as "disconnected primitives" at close range. | **Replace** parts with one cohesive skinned body mesh per body shape; keep accessories (re-anchored on the new bones). |
| Zombie animation | `zombieAnimation.ts` (1 247 lines, pure): IK gait with planted feet, springs, lurch/twitch, attack keys synced to the damage step, 3 deaths, rise, deterministic per id. Output = `ZombiePose` (34 scalars). `composeBones` → 15 matrices. | **Keep as the single source of motion.** New 21-bone humanoid rig is driven from `ZombiePose`; add clip overlays (bite, hit, celebrate, turn). |
| Variation | `zombieProfiles.ts`: 8 looks × 6 gait body types, atlas tiles, accessories, Alpha profile. | Keep; add a `BodyShapeId` (5 zombie shapes + alpha) per id. |
| Alpha | `createZombieHeroRig` = same rigid parts at 1.22 scale + slots (hat/glasses/back/hand), emissive glow, asymmetric shoulder, big right hand. | Replace with a real `THREE.SkinnedMesh` + `Skeleton` (alpha body shape); keep cosmetic slots + glow. |
| Humans | `LowPolyCharacters.ts`: ~10 separate meshes per rig, boxes on purpose (**user rule: humans stay blocky**, MEMORY). Draw-call heavy (bench=1 ≈ 320–420 calls). | Pending user decision (VP2-T011). |
| Buildings | `CityDistrict.createBuildingGeometry`: per-style merged boxes (house/civic/mall/apartment/storefront/warehouse/office/garage) with some trims, awnings, balconies; 8 styles, colour index. `BuildingDef = {footprint, height, style, colorIndex}`. 212 buildings. | **Replace** with plan → component factory (12 archetypes + landmarks); footprint/height/colliders untouched. |
| Props | `CityDistrict.buildChunkProps`/`appendPropGeometry`: per-chunk merged/instanced boxes for 26 PropKinds. Trees = cylinder + cones; palms in TropicalScenery. | Replace geometry via environment factories; keep per-chunk instancing. |
| World layout | `districtLayout.ts` + `layout/*` builders, append-only passes (`sidewalkSpawns`, `shops`) with option flags for snapshot tests. Expansion lots leave many empty quads/aprons (EW-T002 notes). | Add append-only passes (archetype assign, infill lots, street furniture) behind flags. |
| Streaming | `ChunkStreamer` 80 m chunks, ≤ 12 loaded, CityDistrict builds each chunk's geometry on load and disposes on unload (rebuilds on reload). | Add a geometry cache so reloads reuse plans/geometry; add per-chunk LOD. |
| Collision deps | Colliders come only from layout (`solid`, `building`, `vehicle`); camera occluders = building proxies keyed by building index; LOS uses collider heights. | Visual meshes never become colliders. Visual main mass height ≈ `BuildingDef.height` (± 0.5 m); roof clutter may add ≤ 3 m. |
| Hot spots | Human rigs (calls), CityDistrict chunk build on load (main-thread hitch), per-part horde calls (~20). | Instanced skinning cuts horde calls; plan cache cuts chunk hitch. |

## VP2-0. Decisions (where the spec meets this repo)

| Question | Decision | Why |
|---|---|---|
| GLB assets vs procedural? | **Procedural only** (AGENTS forbids remote/runtime assets; no source models in repo). Smooth meshes are generated in code: lofted cross-section bodies, bevelled/rounded boxes, lathes, profile extrusions. | Stack rule; deterministic; nothing to load. |
| Skeletal animation for the horde | **Instanced GPU skinning**: one `InstancedMesh` per (body shape × LOD), per-vertex `skinIndex/skinWeight` (≤ 4 influences), bone world matrices for every instance in one `RGBA32F` `DataTexture` (row = instance, 21 bones × 4 texels), read in the vertex shader by `gl_InstanceID`. Plain `InstancedMesh` cannot skin independently (spec §4.3). | ~220 independent skeletons at ≤ 12 body draw calls; no library allowed. |
| Alpha rig | Real `THREE.Bone` hierarchy → `THREE.Skeleton` → `THREE.SkinnedMesh` (alpha shape, LOD0). `SkeletonHelper` behind a debug toggle (F3 panel). Authored clips (`characterClips`) are also converted to `THREE.AnimationClip`s played by an `AnimationMixer` on a hidden **clip skeleton**; final bone rotation = `slerp(procedural, clip, actionWeight)`. | Satisfies §4.1 with the existing IK controller still owning locomotion (three's mixer would otherwise overwrite procedural bone values). |
| Where motion lives | `animateZombie` stays the only motion source (pure, deterministic). Clips are pure keyframe data (`characterClips.ts`) sampled into `ZombiePose` overlays. Both horde and Alpha use them. | One controller, testable in Node, no per-zombie identical motion. |
| Skeleton | 21 bones: spec hierarchy + `jaw` (bite). Leg/arm chain lengths stay `RIG` units so gait/IK/grounding stays valid; body shapes differ in mesh volume, head/hand/foot size, shoulder/neck offsets and overall `scale/width`. Hand bones get a derived wrist droop. | Reuses `ZombiePose` unchanged. |
| Body shapes | `average`, `tallSkinny`, `shortRound`, `heavy`, `lanky` (+ `alpha`). Mapped deterministically per id in `zombieProfiles` (brutes ⇒ `heavy`). | Spec §3 archetypes. |
| Humans | **Open — ask user** (MEMORY: humans stay blocky so they never read as zombies). Proposal: keep blocky silhouettes but render them through the shared instanced-skinning path with bevelled box segments, hands and feet (VP2-T011). | Spec §3 Phase 3 vs explicit user rule. |
| Building archetypes | 12 spec archetypes + `landmark`. Assigned in a pure layout pass from `BuildingStyle` + district style + footprint fit + seed (optional `BuildingDef.archetype/seed/frontage/lot`). Old saves are unaffected (layout isn't saved; same seed ⇒ same world). | Deterministic, gameplay-neutral, legacy layout untouched (fields optional). |
| Ground-level truth | Visual elements below 2.4 m stay inside the collider footprint, except (a) flat items (top ≤ 0.3 m: pool, terrace slab, paving), (b) items co-located with a blocking `PropDef` the layout emitted (gas pumps/canopy posts, patio tables, bus stops), (c) render-only dressing per VP2-3 rules. Above 2.4 m, overhangs ≤ 2.5 m (awnings, balconies, canopies); gas-station canopies ≤ 9 m over their pump props. | Collision/nav stay synchronized without touching CollisionWorld. |
| Density | Three layers: (1) **blocking** street furniture + infill buildings/lots as append-only layout passes (`LayoutPasses.streetFurniture / urbanInfill / buildingArchetypes`, default on, off ⇒ previous world for snapshot tests); (2) **render-only dressing** from a pure per-chunk placement function (vegetation, curbs, decals, wall-mounted/overhead details, low clutter); (3) building facade/roof detail. | Gameplay routes only change through layout, which is tested (nav, spawns, intro path). |
| District identity | `content/districtStyles.ts` (16 entries): archetype weights, height scale, palettes, signage style, vegetation, furniture/clutter weights, sidewalk style, landmarks. | Spec §7. |
| LOD | Characters: LOD0 ≤ 30 m (≤ 25 m on low), LOD1 beyond; bone updates every frame < 25 m, every 2nd 25–50 m, every 4th beyond. Buildings: per-chunk LOD0 (full plan) / LOD1 (mass + roof + windows as colour) by chunk distance (`buildingLod1Distance`). Dressing tier filtered by quality. | Spec §10. The vision limit already hides > ~51–123 m. |
| Medians / islands | Painted hatching + flat (≤ 0.15 m) planted islands only outside lane paths; no new road colliders. | Traffic lanes and swerves stay valid. |
| Budgets | Provisional (VP2-4); T001 measures the baseline, T014 confirms by profiling and edits them. | Spec "budgets from profiling". |

## VP2-1. Contracts (written by T001; exact shapes)

```ts
// ---- src/core/types.ts (additive, optional) ----
export type BuildingArchetype = 'bungalow' | 'artDecoHotel' | 'apartment' | 'convenienceStore' | 'restaurant' | 'office'
  | 'warehouse' | 'gasStation' | 'beachShop' | 'parkingGarage' | 'villa' | 'municipal' | 'landmark';
export type CityLandmarkKind = 'lighthouse' /* LandmarkKind already names structure landmarks */ | 'neonArch' | 'waterTower' | 'clockTower' | 'controlTower' | 'radioMast'
  | 'fountainPlaza' | 'bandshell' | 'ferrisWheel' | 'domeObservatory' | 'glassTower' | 'hangar';
export type Facing4 = 'north' | 'south' | 'east' | 'west';
BuildingDef += archetype?: BuildingArchetype; seed?: number; frontage?: Facing4; lot?: AABB; landmark?: CityLandmarkKind;
  /** Sides that touch a neighbour (shared walls: no windows/trim there). */ sharedWalls?: Facing4[];
PropKind += 'busStop' | 'mailbox' | 'newsStand' | 'bikeRack' | 'bollard' | 'planter' | 'patioTable' | 'gasPump'
  | 'utilityBox' | 'crates' | 'shoppingCart' | 'constructionBarrier' | 'basketballHoop';
GroundKind += 'court';            // basketball/tennis court surface (flat, lot priority); mapRender colour added in T001
LayoutPasses += buildingArchetypes?: boolean; urbanInfill?: boolean; streetFurniture?: boolean;   // default true

// ---- src/content/districtStyles.ts [pure] (T001 data; T006/T007/T003 read) ----
export type SignageStyle = 'none' | 'painted' | 'neon' | 'corporate' | 'industrial' | 'civic';
export type SidewalkStyle = 'plain' | 'pavers' | 'boardwalk' | 'tile' | 'brick';
export interface DistrictStyle {
  id: DistrictId; theme: 'beachfront' | 'residential' | 'downtown' | 'industrial' | 'entertainment' | 'civic' | 'campus'
    | 'resort' | 'military' | 'airport' | 'park';
  archetypeWeights: Partial<Record<BuildingArchetype, number>>;   // filtered by BuildingStyle compatibility + footprint fit
  heightScale: number;            // visual floor-count bias only (collider height is truth)
  infillDensity: number;          // 0..1 target share of empty frontage lots that receive infill
  wallPalette: number[]; accentPalette: number[]; roofPalette: number[];
  signage: SignageStyle; sidewalk: SidewalkStyle;
  vegetation: number;             // 0..1
  palms: PlantKind[]; furniture: Partial<Record<FurnitureKind, number>>; clutter: Partial<Record<FurnitureKind, number>>;
  landmarks: CityLandmarkKind[];      // 1–2 per district, placed by T006
}
export const DISTRICT_STYLES: Readonly<Record<DistrictId, DistrictStyle>>;
export const STYLE_ARCHETYPES: Readonly<Record<BuildingStyle, readonly BuildingArchetype[]>>;
//   house→bungalow|villa · storefront→convenienceStore|restaurant|beachShop · apartment→apartment|artDecoHotel
//   office→office|municipal · warehouse→warehouse · garage→parkingGarage|gasStation · mall→municipal|office · civic→municipal
export const ARCHETYPE_MIN_FOOTPRINT: Readonly<Record<BuildingArchetype, { w: number; d: number; h: number }>>;

// ---- src/graphics/buildings/buildingTypes.ts [pure] (T001) ----
export type ComponentKind = 'foundation' | 'wallPanel' | 'cornerColumn' | 'roundedCorner' | 'floorBand' | 'parapet'
  | 'flatRoof' | 'hipRoof' | 'gableRoof' | 'tileRoof' | 'steppedRoof' | 'column' | 'balcony' | 'stair' | 'exteriorCorridor'
  | 'overhang' | 'canopy' | 'awning' | 'terrace' | 'porch' | 'window' | 'storefront' | 'door' | 'garageDoor' | 'loadingBay'
  | 'decoPanel' | 'verticalFin' | 'railing' | 'shutter' | 'sign' | 'neonSign' | 'wallLamp' | 'acUnit' | 'drainpipe'
  | 'roofVent' | 'mechanicalBox' | 'waterTank' | 'satelliteDish' | 'solarPanel' | 'rooftopPatio' | 'pool' | 'gardenWall'
  | 'rampDeck' | 'guardrail' | 'pumpIsland' | 'chimney' | 'landmarkPart';
export type MaterialSlot = 'wall' | 'wallAccent' | 'trim' | 'roof' | 'roofTile' | 'glass' | 'glassDark' | 'metal' | 'wood'
  | 'concrete' | 'awningA' | 'awningB' | 'sign' | 'neon' | 'foliage' | 'water';
export interface BuildingPalette { wall: number; wallAccent: number; trim: number; roof: number; awningA: number;
  awningB: number; sign: number; neon: number }
export type RoofStyle = 'flat' | 'parapet' | 'hip' | 'gable' | 'tile' | 'stepped' | 'sawtooth';
export type FacadeStyle = 'stucco' | 'deco' | 'glass' | 'brick' | 'metal' | 'siding' | 'concrete';
export type WindowPattern = 'grid' | 'ribbon' | 'paired' | 'punched' | 'storefront' | 'none';
export type EntranceStyle = 'porch' | 'canopy' | 'arch' | 'recessed' | 'glassDoors' | 'rollup' | 'grand';
export interface BuildingConfig { archetype: BuildingArchetype; landmark?: CityLandmarkKind; width: number; depth: number;
  height: number; floors: number; floorHeight: number; roofStyle: RoofStyle; facadeStyle: FacadeStyle;
  palette: BuildingPalette; windowPattern: WindowPattern; balconyFrequency: number; entranceStyle: EntranceStyle;
  signage: SignageStyle; sharedWalls: Facing4[]; lotExtent: { front: number; back: number; left: number; right: number };
  lotBlockers: AABB[];   // building-local rects of blocking props (pumps, patio tables) the plan may build over
  seed: number }
/** Building-local frame: origin = footprint centre at ground, +Z = frontage side, +X = right when facing the street. */
export interface ComponentInstance { kind: ComponentKind; x: number; y: number; z: number; rotY: number;
  w: number; h: number; d: number; material: MaterialSlot; variant: number; lod: 0 | 1 /* 1 = also in LOD1 */ }
export interface BuildingPlan { config: BuildingConfig; components: ComponentInstance[] }

// ---- src/graphics/environment/environmentKinds.ts [pure] (T001) ----
export type FurnitureKind = 'streetlight' | 'busStop' | 'bench' | 'trashCan' | 'mailbox' | 'newsStand' | 'bikeRack'
  | 'hydrant' | 'bollard' | 'planter' | 'roadSign' | 'utilityBox' | 'patioTable' | 'patioUmbrella' | 'dumpster'
  | 'trashBags' | 'crates' | 'shoppingCart' | 'parkedBike' | 'constructionBarrier' | 'fenceSection' | 'gasPump'
  | 'basketballHoop' | 'trafficCone' | 'manhole' | 'stormDrain' | 'roadPatch' | 'curb' | 'curbRamp' | 'driveway'
  | 'medianHatch' | 'trafficIsland';
export type PlantKind = 'palmCoconut' | 'palmRoyal' | 'palmFan' | 'palmCluster' | 'shrubFlowering' | 'bushRound'
  | 'grassClump' | 'flowersTropical' | 'hedge' | 'planterBox' | 'vine' | 'ornamentalTree';
export type DressingKind = FurnitureKind | PlantKind;
export const FLAT_KINDS: ReadonlySet<DressingKind>;          // manhole, stormDrain, roadPatch, curb, curbRamp, driveway, medianHatch
export const PROP_TO_FURNITURE: Readonly<Partial<Record<PropKind, FurnitureKind | PlantKind>>>;

// ---- src/graphics/characters/characterTypes.ts [pure] (T001) ----
export const HUMANOID_BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'shoulderL', 'upperArmL',
  'forearmL', 'handL', 'shoulderR', 'upperArmR', 'forearmR', 'handR', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR',
  'lowerLegR', 'footR'] as const;                            // 21; index = bone id; parents in BONE_PARENT
export type HumanoidBone = (typeof HUMANOID_BONES)[number];
export const BONE_PARENT: readonly number[];                 // -1 for root
export type BodyShapeId = 'average' | 'tallSkinny' | 'shortRound' | 'heavy' | 'lanky' | 'alpha';
export const ZOMBIE_BODY_SHAPES: readonly BodyShapeId[];     // the five horde shapes
export type BodyRegion = 0 /*skin*/ | 1 /*shirt*/ | 2 /*pants*/ | 3 /*shoes*/ | 4 /*eyeWhite*/ | 5 /*pupil*/ | 6 /*mouth*/ | 7 /*hair*/;
export type ClipName = 'celebrate' | 'bite' | 'hitReact' | 'turnL' | 'turnR' | 'lunge' | 'idleLook' | 'riseFlourish';
```

### Module interfaces

```ts
// T002 — src/graphics/characters/humanoidRig.ts [pure]
export interface BodyShape { id: BodyShapeId; scale: number; width: number; headScale: number; neckLength: number;
  torsoWidth: number; torsoDepth: number; belly: number; hunch: number; shoulderSlope: number; shoulderAsym: number;
  armLength: number; handScale: number; footScale: number; thighThickness: number; eyeScale: number }
export const BODY_SHAPES: Readonly<Record<BodyShapeId, BodyShape>>;
export function restBoneOffsets(shape: BodyShape, out?: Float32Array): Float32Array;      // 21 × 3, parent-relative
export function poseToBoneMatrices(pose: ZombiePose, shape: BodyShape, root: ArrayLike<number> /*16, col-major*/,
  out: Float32Array, offset?: number): void;                  // 21 × 16 world matrices; alloc-free; legs match RIG FK
export function bindInverses(shape: BodyShape): Float32Array; // 21 × 16
// T002 — src/graphics/characters/bodyMeshMath.ts [pure]
export interface BodyMeshData { positions: Float32Array; normals: Float32Array; uvs: Float32Array;
  skinIndex: Uint16Array; skinWeight: Float32Array; region: Uint8Array; index: Uint32Array; triangles: number }
export function buildBodyMesh(shape: BodyShape, lod: 0 | 1): BodyMeshData;  // one cohesive watertight mesh incl. head,
  // big eyes (sockets + spheres), brow, nose, jaw/mouth, neck, shoulders, torso, hips, arms, mitten hands + thumb, legs, feet
// T008 — src/graphics/characters/characterClips.ts [pure]
export interface PoseClip { name: ClipName; duration: number; loop: boolean; additive: boolean;
  keys: readonly { t: number; pose: Partial<ZombiePose>; ease?: 'linear' | 'smooth' | 'back' }[] }
export const CLIPS: Readonly<Record<ClipName, PoseClip>>;
export function applyClip(out: ZombiePose, clip: PoseClip, t: number, weight: number, variation: number): void;
// zombieAnimation.ts: ZombieAnimInput += celebrate?: number (time since trigger, < 0 = none); hitDir already exists;
//   states += 'bite' | 'hit' | 'celebrate' | 'turn'; per-id variation on clip speed/amplitude/phase.
// T009 — src/graphics/characters/InstancedSkinning.ts [3D]
export class BoneTexture { constructor(maxInstances: number); readonly texture: THREE.DataTexture;
  readonly data: Float32Array; markRows(count: number): void }   // 21 × 4 texels per row
export function applyInstancedSkinning(mat: THREE.Material, bones: BoneTexture): void; // chains onBeforeCompile; skins
  // position + normal; VisionFog/SurfaceDetail patches chain after; stable customProgramCacheKey
// T009 — src/graphics/characters/CharacterFactory.ts [3D]
export function bodyGeometry(shape: BodyShapeId, lod: 0 | 1): THREE.BufferGeometry;   // cached; attrs skinIndex/skinWeight/aRegion/uv
export interface AlphaCharacter { root: THREE.Group; mesh: THREE.SkinnedMesh; skeleton: THREE.Skeleton;
  helper: THREE.SkeletonHelper; mixer: THREE.AnimationMixer; slots: Record<HeroCosmeticSlot, THREE.Object3D>;
  setPose(pose: ZombiePose, root: THREE.Matrix4): void; play(clip: ClipName): void; update(dt: number): void; dispose(): void }
export function createAlphaCharacter(look: ZombieLook): AlphaCharacter;
// HordeRenderer / EntityRenderer keep their public APIs (Game compiles without changes).

// T003 — src/graphics/buildings/buildingPlan.ts [pure]
export function configForBuilding(b: BuildingDef, index: number, style: DistrictStyle): BuildingConfig;
export function planBuilding(cfg: BuildingConfig): BuildingPlan;     // deterministic in cfg.seed; archetype rules in
// src/graphics/buildings/buildingArchetypes.ts [pure] (one rule set per archetype: floors, roof, facade, entrance, extras)
// T001 stub → T012 — src/graphics/buildings/landmarkPlans.ts [pure]: planLandmark(cfg): BuildingPlan (cfg.landmark set);
//   planBuilding dispatches archetype==='landmark' here.
// T001 stub → T012 — src/graphics/buildings/LandmarkComponents.ts [3D]:
//   landmarkPartGeometry(c: ComponentInstance, palette: BuildingPalette, lod: 0 | 1): THREE.BufferGeometry;
//   BuildingComponents delegates kind 'landmarkPart' here.
// T004 — src/graphics/geometry/{meshUtils,GeometryCache}.ts [3D]
export function bevelBox(w: number, h: number, d: number, bevel: number, segments?: number): THREE.BufferGeometry;
export function roundedBox(...); lathe(profile: Vec2[], segs: number); extrudeProfile(profile: Vec2[], depth: number, bevel?: number);
export function paint(geom, color: number): geom; export function tagSurface(geom, surface: number): geom;
export function mergeTagged(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry;   // keeps position/normal/color/uv/aSurface
export class GeometryCache<K> { get(key: K, build: () => THREE.BufferGeometry): THREE.BufferGeometry; dispose(): void }
// T004 — src/graphics/buildings/{BuildingComponents,BuildingFactory}.ts [3D]
export function componentGeometry(c: ComponentInstance, palette: BuildingPalette, lod: 0 | 1): THREE.BufferGeometry;
export function buildBuildingGeometry(plan: BuildingPlan, lod: 0 | 1): { opaque: THREE.BufferGeometry; glass: THREE.BufferGeometry; emissive: THREE.BufferGeometry };
//   building-local; caller applies footprint centre + frontage rotation. Vertex colours + aSurface (VP SURFACE ids).
// T005 — src/graphics/environment/{StreetFurnitureFactory,VegetationFactory}.ts [3D]
export function furnitureGeometry(kind: FurnitureKind, variant: number, lod: 0 | 1): THREE.BufferGeometry;  // cached
export function plantGeometry(kind: PlantKind, variant: number, lod: 0 | 1): { wood: THREE.BufferGeometry | null; foliage: THREE.BufferGeometry };
//   origin at ground centre, +Z front, vertex-coloured, aSurface; foliage carries the existing wind attribute convention.
// T007 — src/graphics/world/environmentPopulation.ts [pure]
export interface DressingInstance { kind: DressingKind; x: number; y: number; z: number; rotY: number; scale: number;
  sx?: number; sz?: number /* flat stretch for curbs/hatching */; variant: number; tier: 0 | 1 | 2 }
export function populateChunk(layout: DistrictLayout, chunkId: number): DressingInstance[];   // deterministic, sorted
// T010 — src/graphics/world/{ChunkGeometryCache,WorldLOD}.ts [3D] used only by CityDistrict
```

## VP2-2. Directory & ownership (this milestone)

```text
src/core/types.ts, src/content/districtStyles.ts (NEW), src/graphics/{buildings/buildingTypes,environment/environmentKinds,
  characters/characterTypes}.ts (NEW), src/graphics/performance/GraphicsQuality.ts (VP2 profile fields), src/ui/mapRender.ts
  (court colour), src/world/districtLayout.ts (LayoutPasses flags only),
  src/graphics/buildings/{landmarkPlans,LandmarkComponents}.ts (placeholder stubs)                        contracts (T001)
src/graphics/characters/{humanoidRig,bodyMeshMath}.ts            [pure] NEW skeleton + cohesive skinned body mesh   (T002)
src/graphics/buildings/{buildingArchetypes,buildingPlan}.ts      [pure] NEW 12 archetype rule sets + plan generator (T003)
src/graphics/geometry/{meshUtils,GeometryCache}.ts               [3D] NEW smooth/bevel/lathe/extrude/merge helpers  (T004)
src/graphics/buildings/{BuildingComponents,BuildingFactory}.ts   [3D] NEW component library + plan → geometry      (T004)
src/graphics/environment/{StreetFurnitureFactory,VegetationFactory}.ts [3D] NEW furniture/plants/road details     (T005)
src/world/layout/{buildingAssign,urbanInfill,streetFurniture}.ts [pure] NEW append-only layout passes              (T006)
src/graphics/world/environmentPopulation.ts                      [pure] NEW render-only dressing placement          (T007)
src/graphics/characters/characterClips.ts, src/visuals/{zombieAnimation,zombieProfiles}.ts  [pure] clips + states   (T008)
src/graphics/characters/{InstancedSkinning,CharacterFactory}.ts, src/visuals/{HordeRenderer,zombieModel,
  zombieTextures,EntityRenderer}.ts                              [3D] skinned horde + Alpha                         (T009)
src/world/CityDistrict.ts, src/graphics/world/{ChunkGeometryCache,WorldLOD}.ts  [3D] city integration              (T010)
src/visuals/{LowPolyCharacters,humanProfiles}.ts (+ EntityRenderer human path after T009)   humans (T011, if approved)
src/graphics/buildings/{landmarkPlans,LandmarkComponents}.ts     landmarks                                          (T012)
src/core/Game.ts, src/graphics/performance/GraphicsDiagnostics.ts, src/ui/PauseMenu.ts   wiring + debug          (T013)
```

## VP2-3. Rules every task follows

- **Gameplay truth:** layout passes are append-only (existing ids, collider tags and RNG streams untouched), run after
  `placeShops` and before the sand strip/ring road only if they don't overlap them; every pass has a `LayoutPasses` flag;
  with all VP2 flags false `buildDistrictLayout()` equals today's world (snapshot test). Infill never overlaps colliders,
  roads, spawn zones, patrol waypoints ± 2 m, nest/claim radii, stronghold rects, structure approaches, shop doors, traffic
  lanes, the intro camera path; nav connectivity tests stay green.
- **Render-only dressing** never intersects a collider footprint (wall-mounted items sit ≤ 0.8 m outside a building face);
  taller than 0.5 m only in: sidewalk furniture strip (outer 1.2 m beside the curb), building wall bands, park/plaza/yard
  interiors ≥ 1.5 m from spawn zones and nest markers; road surfaces only take `FLAT_KINDS`. Never on `START_BEACH`
  objective path or the nest claim circle.
- **Determinism:** every generator is a pure function of (layout, index/chunk, seed) via `mulberry32`/FNV streams; never
  `Math.random`; same seed ⇒ identical plans/dressing across chunk reloads.
- **Rendering:** vertex colours + `aSurface` (`SURFACE` ids) on city geometry, `applySurfaceDetail` before VisionFog; shared
  materials (≤ 1 opaque + 1 glass + 1 emissive material for all buildings); merged per chunk per LOD; instanced for repeated
  props/plants; no shadows cast by dressing < 1.5 m; nothing new drawn past the vision limit without the haze patch.
- **Ground heights / decals:** `world/groundLevels.ts` only (`GROUND_TOP`, `DECAL_Y`); curbs top = sidewalk top.
- **Characters:** root position/facing from the sim; `animateZombie` is the only pose source; accessories follow bone
  world matrices; Alpha has no hat/glasses by default (cosmetic slots only); no gore.
- **Pure/3D twins** use different stems (Windows case-insensitivity).

## VP2-4. Budgets (provisional; T001 baseline, T014 profiles and finalizes)

| Item | LOD0 | LOD1 / far |
|---|---|---|
| Alpha | ≤ 7 k tris, 1 skinned draw (+ cosmetics) | — |
| Horde zombie | ≤ 1.8 k tris | ≤ 450 tris; body draws ≤ 12 total (6 shapes × 2 LODs) + accessories ≤ 10 |
| Small building (bungalow, shop) | ≤ 3 k tris | ≤ 400 |
| Large building (hotel, office, garage) | ≤ 12 k tris | ≤ 1.5 k |
| Street furniture item | ≤ 300 tris | ≤ 80 |
| Palm / tree | ≤ 900 tris | ≤ 200 |
| Visible city (12 chunks, high) | ≤ 1.5 M tris, ≤ 450 draw calls total scene, p50 frame ≤ 16.7 ms on the dev machine at bench=1 | medium −35 %, low −60 % |
| Chunk load hitch | ≤ 12 ms per chunk (cache warm ≤ 3 ms) | |

## VP2-5. Invariants (tests must cover)

1. Rig: `poseToBoneMatrices` leg/foot positions equal `zombieRig` FK (grounded feet) within 1 mm for 200 random poses;
   no allocation; bind inverses × rest = identity.
2. Body mesh: every vertex has weights summing to 1 (≤ 4 influences, each ≥ 0.01); no boundary edges (watertight per
   shell); bending elbows/knees 0–130° keeps max edge stretch < 2.5× and no vertex crosses the joint plane by > 3 cm;
   tri counts within VP2-4; deterministic.
3. Clips: deterministic; every clip finite at t∈[0,duration]; loops are continuous; per-id variation changes timing.
4. Building plans: deterministic per seed; all 12 archetypes reachable from `configForBuilding` across the default world;
   ground-level components inside footprint except the VP2-0 exceptions; windows/doors never overlap; balconies only on
   floors ≥ 2; shared-wall sides have no openings; main mass height within ± 0.5 m of `BuildingDef.height`.
5. Layout: VP2 flags off ⇒ identical world (fingerprint); flags on ⇒ nav connectivity, spawn/patrol/nest clearance,
   intro camera path, shops, traffic network build all green; empty-lot area per district drops ≥ 40 %; ≥ 1 landmark per
   district.
6. Dressing: deterministic per chunk; never intersects collider footprints; tall items only in allowed zones; road items
   only flat kinds; per-chunk count ≤ budget.
7. Existing suites (save/load, nests, fast travel, conquest, traffic, intro) unchanged and green.

---

# CU — Living City & Expanded Rewards (docs/11_cityupgrade.md)

Builds on an earlier, unrecorded pass that landed the core modules (listed in AGENTS.md). This milestone audited it
against the spec and filled the gaps. Status per spec item: `.agent-context/reports/CU-T005-orchestrator.md`.

## CU-0. Decisions (where the spec meets this repo)

- **Spec module map → repo:** CityActivityDirector = `systems/CityActivityDirector.ts` (DistrictStateService, scheduler,
  HumanResponseManager in one pure file); AmbientPopulationManager = existing `PopulationSystem` (dormancy = near/mid/far tiers);
  TrafficManager = existing `TrafficSystem`/`trafficControl`; WorldInteractionSystem = `systems/WorldInteractionSystem.ts`;
  WorldEventBus = the existing typed `GameEvent` stream (`ctx.emit` → `drainEvents`, no listeners to leak).
- **Alert ≠ difficulty:** heat/alert is per district and transient; district tier (difficulty) is untouched.
- **No visible popping:** events spawn beyond `visibleLimit(state)` (haze radius × (1 + VISION_EDGE_BAND), tier-aware); the
  vision limit hides everything past it, so this is the camera-safe spawn ring. Leftovers are removed only once out of sight.
- **Event dressing is render-only** (`ActiveDynamicEvent.props`): no colliders/nav rebuilds, so events can never trap the player.
- **Interactables:** cars (alarm), warning signs (siren), barriers come from layout props; trash cans (beside benches) and
  hydrants (every 6th streetlight) are generated in `createInitialState` and drawn by `visuals/InteractableProps.ts`.
- **Shortcut:** a `SecretDef.shortcutTo` storm drain; discovery by walking onto it, then V at either end moves Alpha + horde.
- **Vehicle:** golf cart is the pilot (others share `BALANCE.city.playerVehicles`); horde reassembles near the Alpha on dismount.

## CU-1. Contracts added this milestone (types.ts)

`DynamicEventKind` + `'zombie_block_party' | 'survivor_raid'`; `CityEventPropKind`, `CityEventProp`;
`DynamicEventDefinition.allowedControl?`; `ActiveDynamicEvent.{props, pendingSpawns, nextSpawnAt, escalated, disturbed}`;
GameEvents `cityEventEscalated`, `companionPerk`, `shortcutUsed`, `suppliesLooted`. Balance: `BALANCE.city.{eventMaxHumans,
eventSpawnBeyondVision, busUnloadInterval, accidentPoliceDelay, disturbedPoliceDelay, responderArriveDist, convoySupplyHeal,
larryWhistle*, grandma*, shortcutRange, shortcutCooldown}`.

## CU-2. Invariants (tests/cityEvents.test.ts, tests/cityUpgrade.test.ts, tests/hudModel.test.ts)

1. Every catalog kind stages people or dressing; spontaneous events spawn past the vision limit.
2. Bus tourists arrive staggered; accident police arrive after `accidentPoliceDelay`, once, from ≥ 10 m away.
3. Expired participants stay while in view and are removed once out of sight.
4. 3 sim-minutes of roaming: ≥ 3 events, no kind twice in a row, event humans ≤ `eventMaxHumans`.
5. Unique rewards grant once; purchases never double-charge; achievements grant once; save v4 round-trip + v3 migration.
6. V priority (cart beats a trash can); HUD prompt mirrors it; shortcut moves Alpha + followers.

---

# HUD — HUD redesign (docs/9_hud_redesign.md)

UI-only milestone: **no change to `types.ts`, `contracts.ts`, `balance.ts`, content, sim systems or saves.** Everything below
(VP, EW, TD, IN, OW) still holds.

## HUD-0. Decisions
- **DOM/CSS stays** (no canvas HUD, no framework). Three.js already owns world-space markers (attack/move rings, waypoint
  pillar, health bars); the HUD adds none.
- **Design system** `src/ui/hudTheme.css`: palette tokens (`--hz-green/teal/yellow/coral/cream/deep`), surfaces
  (`.ibz-panel`/`.hz-panel`: translucent deep-teal + top highlight + cartoon lip + drop), radii, type, motion tokens, key caps
  (`.hz-key`), buttons (`.ibz-btn`), icons (`.hz-ico`), shared keyframes. **Scale unit `--hz-u`** = 1px at 1920×1080,
  1.33px at 1440p, 2px at 4K, floor 0.8px; every HUD size is `calc(N * var(--hz-u))`. Breakpoints in hud.css hide
  secondary info (names, momentum, eyesight chip, objective details) instead of scaling everything.
- **Icons** `src/ui/hudIcons.ts` [pure]: one 32×32 SVG family drawn in code (`icon(name, size)`, `abilityIcon(id)`); never emoji.
- **View models** `src/ui/hudModel.ts` [pure, tests/hudModel.test.ts]: health levels, status chips (only real states:
  Rush/Frenzy/Dazed/Winded/Sprint), horde mode (following/attacking/moving/split/none), horde milestones (every 10 + cap),
  objective view (explore → stronghold with real `objectiveStatus` progress → complete), primary attack / rally cooldowns,
  context actions (max 3: RMB attack hovered target, G recall + Space regroup while the horde is away, Space rally N free
  walkers, drink nearby when hurt, nest loadout keys), recruit popup tiers, damage-source extraction, major banners
  (OUTPOST OVERRUN / DISTRICT CONQUERED / NEW ABILITY UNLOCKED / GATE BREACHED / HORDE GROWING) with rotating quips,
  centered minimap projection + rim clamp.
- **HUD.ts** renders only; every write goes through a signature cache (`changed/setText/setClass/setScale`). Layout:
  `.hz-play` gameplay layer (char card, objective/target bar/district banner/toasts, minimap slot, banner, popups,
  horde card, ability bar, context, nest panel, sense layer) — faded + `visibility:hidden` under pause/map (`is-modal`),
  hidden by intro.css during the cinematic, panels slide in (`is-arriving`) when control starts. Menus/modals
  (help, intro card, respawn, victory/defeat, pause, world map) sit outside `.hz-play`.
- **Minimap** is circular, north-up, player-centered (85 m radius). Whole-world static layer cached at 1.4 px/m (redrawn
  on `staticLayerKey` change only); per frame (≤ 20 Hz) blit + `drawDynamicLayer` with `centeredProjection`; objective
  star only for discovered strongholds, clamped to the rim. Same fog + AwarenessSystem gates as the world map.
- **Reduced motion**: `HUD.setReducedMotion` (Game.applyGraphics) toggles `html.hz-reduced-motion`; OS
  `prefers-reduced-motion` is honored in CSS. One-shot reveals (banner, popups, floaters) become motionless fades.
- **Input**: no new bindings. The split-target modifier is a held **E** (E+RMB), not Ctrl, so Ctrl+W can never close the tab; ability slot 2 moved E → T.
- **Art pass 2 (user feedback: "looks like a corporate dashboard"):** gameplay widgets are frameless (no `.ibz-panel`
  boxes); legibility comes from `.hz-play` corner shading + ink-outlined type (`--hz-outline`, `--hz-outline-thick`).
  Display face = Bahnschrift bold italic (system font, Win10+; DIN/Avenir Next Condensed/Impact fallbacks; Arial Rounded
  is NOT installed by default, don't rely on it). Bars are skewed (-14deg) with `--hz-ink-w` ink borders, bevel and ticks;
  abilities are solid bevelled gems (`--c1/--c2/--c3` per tone); toasts/district card use fading ink strips; menus keep
  panels but with ink borders.
- HudExtras gained optional `cameraYaw` (Game passes `cameraRig.viewYaw`) for the damage-direction arc.

---

# VP — Visual polish: models, textures, VFX, lighting (docs/8_visual_polish.md)

Spec: `docs/8_visual_polish.md` ("polish spec"). Everything below (EW, TD, IN, OW) still holds. Render-only milestone:
**no change to `types.ts`, `contracts.ts`, `balance.ts`, content, sim systems, saves or gameplay APIs.**

## VP-0. Decisions (where the spec meets this repo)

- **Assets stay procedural.** AGENTS.md forbids remote/runtime downloads and requires code-generated art; there are no source
  models in the repo. So glTF/GLB/KTX2 (spec "Non-negotiable" 4) is replaced by: shared cached geometries + canvas-generated
  texture atlases (mipmapped, anisotropic, sRGB colour / linear data), all built once at boot. Nothing can fail to load, so the
  only fallback is "canvas unavailable (Node/tests) => flat colour". Provenance: 100 % in-repo code, no licences.
- **No second renderer, no new deps.** Post-processing uses `three/examples/jsm/postprocessing/*` (ships with three 0.172, same
  rule as BufferGeometryUtils). Off on `low`.
- **Quality presets** (`src/graphics/performance/GraphicsQuality.ts`, [pure]) low/medium/high + `reducedMotion`, stored in
  localStorage key `ibz.graphics.v1` (never in WorldSave). Default: touch => low, DPR <= 1 => medium, else high;
  `prefers-reduced-motion` seeds `reducedMotion`. The EW vision quality toggle stays separate (haze desaturation).
- **Vehicle explosion** has no sim event: the bus landmark (`structureDestroyed` with landmark `'bus'`) drives the
  "vehicle explosion" VFX. Ability unlock = `abilityUnlocked` + `strongholdCaptured`.
- **Car VFX (2026-11-17):** every `vehicleHit` → `vehicle.impact` (dust + grit + flash along the car heading, speed-scaled;
  replaces the old explosion on lethal hits). Claws on a car come from the `melee` event (`vehicle.claw` at
  `clawPoint`, the panel facing the attacker, paint-chip shards in `vehiclePaint`); `damage` on a vehicle maps to nothing.
  `driverBailed` with `pulled` → `vehicle.glass` + `body.fall` + `human.dazed`. `zombieDied`/`guardDied` → `body.fall`.
  `VFXManager` emits `vehicle.smoke` per frame from stalled (dark) and worn (> 50 %, light steam) cars. Car looks live in
  `visuals/vehicleLook.ts` [pure]: paint, wear grime, smoke rate, driver-door swing (VehicleRenderer `VehicleDoors`).
- **Animation**: the zombie IK/gait controller from docs/6 already covers spec §2 for zombies (seeded phase/cadence, lurch,
  attack keys at the damage step, death/rise, LOD). VP adds human hit/panic reactions and hero face detail only.

## VP-1. Directory & ownership (this milestone)

```text
src/graphics/performance/GraphicsQuality.ts   [pure] presets, settings parse/save, shake/flash scale      (T001)
src/graphics/performance/frameStats.ts        [pure] rolling median/p95 frame-time window                   (T005)
src/graphics/performance/GraphicsDiagnostics.ts      DOM overlay: ms p50/p95, calls, tris, particles, casters (T005)
src/graphics/performance/benchmark.ts         [pure] ?bench=1|2 scripted scene setup on a GameState         (T005)
src/graphics/lighting/LightingController.ts   [3D] warm Miami sun/hemi/fill, shadow map per preset          (T005)
src/graphics/postfx/PostProcessingPipeline.ts [3D] composer: render -> bloom(high) -> grade -> FXAA -> output (T005)
src/graphics/materials/surfaceDetailMath.ts   [pure] surface ids, detail params                             (T004)
src/graphics/materials/SurfaceDetail.ts       [3D] detail atlas + world-space material patch                (T004)
src/graphics/vfx/vfxRules.ts                  [pure] emitter configs, budgets, culling, event mapping       (T002)
src/graphics/vfx/EmitterPool.ts               [3D] one InstancedMesh billboard pool per blend mode          (T002)
src/graphics/vfx/VFXManager.ts                [3D] event adapter + emit API + footsteps/charge/ambient      (T002)
src/visuals/humanProfiles.ts                  [pure] human archetype + palette per id                       (T003)
```

## VP-2. Art bible (shared by every task)

- **Palette (keep):** asphalt `#4a5260`, sidewalk `#a9a294`, concrete `#c9b99a`, zombie skin `#7d9a6a`/`#6f8a72`, Alpha
  `#4f6b3a`, human faction orange `#e0782a` + navy `#2c3e66`, warning `#ffb347`. **Add:** Miami pastels for stucco
  (`#f2b5a7` coral, `#9fd8cf` mint, `#f6e3a1` butter, `#b9c8f0` periwinkle, `#f4f0e6` bone white), awning stripes
  (`#e0574f`, `#2e8b84`, `#f2c14e`), palm green `#4f8a3a`->`#2f5e2a`, sand `#e8d6a8`. Recruitment = green/teal
  (`#5effb8`, `#2fd3c0`) wisps, damage = warm orange/white stars, rally = lime ring + up arrows, charge = tan dust + white streaks.
  Cues differ in **shape and motion** too (wisps spiral up, stars pop out, arrows rise, streaks trail), never colour alone.
- **Materials:** characters MeshStandard roughness 0.6-0.9, metalness 0 (metal props <= 0.6). City stays vertex-coloured
  Lambert/flat (cheap) + world-space surface detail on medium/high. Colour textures sRGB, data textures linear (NoColorSpace).
- **Readability:** detail contrast <= ~12 % luminance on ground (no shimmer at gameplay zoom), detail fades out by ~70 m from the
  camera. The Alpha is identified by silhouette (lean, asymmetric shoulder, oversized right hand) + glowing mismatched eyes,
  never by a hat. Defenders keep orange vest/navy; police navy + light blue; civilians never wear orange+navy together.
- **Texel density:** detail atlas 1024^2, ground detail tiles every 4 m, stucco every 2 m.

## VP-3. Integration contracts

```ts
// T002 — src/graphics/vfx/VFXManager.ts
export type VfxName = 'zombie.footstep' | 'combat.swing' | 'combat.hit' | 'zombie.recruited' | 'horde.rally' | 'horde.charge'
  | 'defender.muzzle' | 'bullet.impact' | 'barricade.destroyed' | 'vehicle.explosion' | 'ability.unlock' | 'ambient.mote';
export type VfxSurface = 'asphalt' | 'sidewalk' | 'grass' | 'sand' | 'concrete' | 'wood' | 'metal' | 'cloth';
export interface VfxPayload { x: number; y?: number; z: number; dirX?: number; dirZ?: number; radius?: number;
  intensity?: number; surface?: VfxSurface; faction?: 'zombie' | 'human' | 'alpha' | 'structure'; color?: number }
export class VFXManager {
  constructor(scene: THREE.Scene, profile: QualityProfile, settings: GraphicsSettings);
  setWorld(layout: DistrictLayout): void;                       // surface lookup for footsteps/impacts
  setQuality(profile: QualityProfile, settings: GraphicsSettings): void;
  emit(name: VfxName, p: VfxPayload): void;                     // pooled, capped, never allocates per particle
  consume(events: readonly GameEvent[], state: GameState): void; // Game passes the already vision-culled events
  update(dt: number, state: GameState, alpha: number, camera: THREE.Camera, focusX: number, focusZ: number, hiddenBeyond: number): void;
  reset(): void; dispose(): void;
  stats(): { live: number; capacity: number; drawCalls: number };
}
// T004 — src/graphics/materials/SurfaceDetail.ts
export function applySurfaceDetail(mat: THREE.Material): void; // idempotent, chains onBeforeCompile; geometry needs aSurface
export function setSurfaceDetailEnabled(on: boolean): void; export function setSurfaceDetailCamera(x: number, y: number, z: number): void;
// T005
export class LightingController { constructor(scene: THREE.Scene); readonly sun: THREE.DirectionalLight;
  setQuality(p: QualityProfile): void; follow(x: number, z: number): void; dispose(): void }
export class PostProcessingPipeline { constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera);
  setQuality(p: QualityProfile, s: GraphicsSettings): void; setSize(w: number, h: number, dpr: number): void;
  render(): void /* falls back to renderer.render when postfx is off */; dispose(): void }
```

- Every VFX/overlay material sets `userData.noVisionHaze = true` and culls itself past `hiddenBeyond` from the Alpha (EW rule).
- Material patches chain the previous `onBeforeCompile`/`customProgramCacheKey`; SurfaceDetail patches at material creation,
  VisionFog patches afterwards (Game re-patch on chunk change already exists).
- Shake goes through one place (`Game`): `shake * shakeScale(settings)`. Flash-type visuals multiply opacity by `flashScale`.

## VP-4. Invariants (tests must cover)

1. `parseGraphicsSettings` never throws, falls back per field; save/load round-trips; storage errors => defaults.
2. VFX pool never exceeds `maxParticles`; bursts beyond budget are dropped, not queued; reset/dispose leave 0 live.
3. Footsteps: only moving zombies within `footstepRadius` of focus, <= `footstepsPerSecond`; none past `hiddenBeyond`.
4. Every mapped `GameEvent` type produces its VfxName (table-driven test of `vfxRules.mapEvent`).
5. Human archetype is deterministic per id; defenders always read as defenders; >= 5 archetypes reachable.
6. frameStats median/p95 correct on known windows; window bounded.

---

# EW — Expanded world, world boundaries, zombie vision (docs/5_expand_world.md)

Spec: `docs/5_expand_world.md` ("expand spec"). Everything below the rule (IN, TD, OW milestones) still holds unless this
section overrides it. `AGENTS.md` stays authoritative for stack, purity and conventions. **The code written to
`src/core/types.ts`, `src/core/contracts.ts`, `src/config/balance.ts` and `src/content/**` in EW-T001 is the contract**;
this section is the map and the reasons.

**Status (2026-11-15):** EW-T001…T012 VERIFIED (Phase 2 done); playtest changes recorded in EW-0 (vision limit, warning cues). Next: Phase 3 (V1 audit, V2 review, F1 fixes, V3 final verification).

## EW-0. Decisions (where the spec is open)

| Question | Decision | Why |
|---|---|---|
| 16 districts? (user, 2026-11-14) | **Grow the world to a 4 × 4 grid.** Existing 4 districts keep their exact coordinates and become the bottom-middle 2 × 2; 12 new districts surround them west, north and east. | User choice. Keeping coordinates leaves the intro cinematic, legacy fixture, structure ids and every existing landmark untouched. |
| Where does the coast go? | South edge (z = 160) stays the ocean beach for the whole width; the **east edge is Biscayne-style bay** (deep water + seawall/docks). West = mangroves/canals, north = highway collapse + quarantine/military perimeter. | The intro flyover already frames the south beach; Miami reads as ocean south/east. |
| Boundary placement | `playArea` = x∈[-400,400], z∈[-480,160]. `layout.bounds` = playArea grown by a **20 m boundary band** on every side ⇒ x∈[-420,420], z∈[-500,180]. All world-edge colliders and edge dressing live in the band. | No existing collider or ground patch is moved. 20 m keeps the discovery (20 m) grid aligned with the old one (old origin = new col 11 / row 17), so v2 fog migrates exactly. |
| District rects | 4 columns x∈[-420,-200,0,200,420], 4 rows z∈[-500,-320,-160,0,180]; rects tile `layout.bounds` (outer districts include the band). Old district rects grow only into the band. | Keeps the "districts tile bounds" invariant. |
| Indestructible edge | New `ColliderKind 'boundary'`. Boundary colliders are never `breakable`, never referenced by a `StructureDef`, never disabled by any system (test-enforced); `CollisionWorld`'s bounds clamp stays as a last-resort backstop. | Spec §3: "mark them explicitly as world boundary". |
| Vision unlock (user) | **Buy tiers 2–4 with biomass at any active nest** (same flow as ability slots). Costs `[0, 20, 60, 120]`. The start nest is always active, so no district is required. | User choice. Tier 2 ≈ six street kills, or the first capture (15) plus a few kills. |
| Where is sight enforced? | Pure `AwarenessSystem` computes `state.vision` (identified / seen ids + cues). **Sim** refuses open-world horde attack orders on humans that are not targetable (turned into a move order to that point). **Client** filters picks, health bars, labels, minimap/world-map humans by the same helpers. Structures/gates are geography and stay targetable. | Single source of truth; zoom/camera can't change it because it only reads the leader position. |
| Haze rendering | World-space haze centred on the (interpolated) Alpha: a fog-chunk patch (`onBeforeCompile`, one shared uniform object) mixes toward a haze colour by `smoothstep(clearRadius, hazeRadius, distXZ)` up to `hazeStrength`, combined (max) with the existing camera-distance fog. No post-processing pass. Quality `low` drops the desaturation term only. | Mobile-cheap, camera-zoom independent, silhouettes stay. |
| Vision limit (user, 2026-11-15 playtest) | **Everything past the vision limit is hidden.** Past `hazeRadius` the haze ramps to fully opaque over `VISION_EDGE_BAND` (12 %), and the sky, background and scene fog switch to the haze colour while playing. Effect events whose origin is past the limit are dropped in Game (effects skip the haze shader). | User request: "objects outside the vision limits should not be rendered" / "everything past vision limit should be hidden". |
| Humans vs haze distance (user, 2026-11-15) | **Every living human inside the vision limit is at least `seen`** (silhouette, hazed like the scenery, no LOS), so humans are visible exactly as far as trees are. Identification/targeting is unchanged (clear sight + LOS). Tier 2/3 moving/defense detection now only matters past the limit (it never is, so those perks reduce to the bigger radii); tier 4 reinforcement sight (140 m) still reaches past it but is hazed out there. | User: "make sure the vision fog distance matches the same distance you can see humans. Currently, you can see a tree but not the human next to it". |
| Gunshot/scream warnings (user, 2026-11-15) | Gunshots and screams **always** cue within hearing range, including inside clear sight (fuzz there is proportional to distance, so the bearing holds); evicted last at the cue cap; drawn as a ⚠ with a direction arrow at opacity ≥ 0.85. | User request: "gunshots and screams should always create a warning icon showing which direction to go". |
| Followers reacting to sounds | Not in this milestone (spec says "may"; existing command rules unchanged). Logged as follow-up. | Avoids touching HordeSystem steering. |
| Vehicles | There are no player/NPC vehicles in the sim; intro traffic is render-only and retires after the intro. "Blocks vehicles" is satisfied by the same colliders. | — |

## EW-1. District grid (content/districts.ts; ids are the contract)

Rows north→south (r0 z∈[-500,-320] … r3 z∈[0,180]), columns west→east (c0 x∈[-420,-200] … c3 x∈[200,420]). (tier)

| | c0 (west, mangroves) | c1 | c2 | c3 (east, bay) |
|---|---|---|---|---|
| r0 (north, highway/quarantine) | `airport` International Airport (5) | `golf_estates` Golf Estates (3) | `university` University Campus (4) | `luxury_marina` Luxury Marina (2) |
| r1 | `palm_park` Palm Park (1) | `financial_core` Financial Core (5) | `neon_nights` Neon Nights (2) | `medical_center` Medical Center (4) |
| r2 | `military_base` Military Stronghold (5) | `police` Civic Center (2) *existing* | `industrial` Dockside Works (3) *existing* | `arts_district` Arts District (1) |
| r3 (south, ocean) | `sunny_boardwalk` Sunny Boardwalk (1) | `suburbs` Maple Heights (1) *existing, start* | `shopping` Galleria District (1) *existing* | `oceanfront_hotels` Oceanfront Hotels (2) |

Every tier-4/5 district shares a road border with a tier-1/2 district (military↔boardwalk/palm park, financial↔palm park,
airport↔palm park, university↔marina/neon, medical↔arts/marina/neon). No gates or level checks between districts.
Each new district has one stronghold (`unlock: null`, biomass reward by tier: 1→15, 2→25, 3→35, 4→50, 5→70) whose
defenders scale by tier (tier 1: 3 police; tier 5: 10+ soldiers, 2 towers, reinforcements). New StrongholdIds:
`park_ranger_post, boardwalk_patrol, neon_security, arts_barricade, hotel_security, marina_crews, golf_gatehouse,
medical_quarantine, campus_security, financial_tower, airport_terminal, military_hq`.
New structure ids start at **100** (existing 1–6 unchanged, saves stay valid).

## EW-2. Directory & ownership map (this milestone)

```text
src/core/types.ts, contracts.ts, config/balance.ts, content/{districts,strongholds}.ts   contracts (orchestrator, T001)
src/world/districtLayout.ts            [pure] bounds/playArea, calls builders + buildWorldBoundaries        (T001 shim → T002)
src/world/layout/roads.ts              [pure] road grid extended to 4×4 (new roads never overlap old colliders) (T002)
src/world/layout/grid.ts               [pure] NEW district cell math, seam crossings                         (T002)
src/world/layout/archetypes.ts         [pure] NEW seeded block/building/prop generator per archetype         (T002)
src/world/layout/expansion.ts          [pure] NEW builds the 12 new districts + their strongholds            (T002)
src/world/boundaryLayout.ts            [pure] NEW buildWorldBoundaries(world): segments, colliders, backdrop  (T001 stub → T003)
src/world/NavigationGrid.ts, CollisionWorld.ts   [pure] scale to ~365 k cells (bounded flow-field resets)  (T004)
src/systems/AwarenessSystem.ts         [pure] NEW vision profile, identified/seen, sense cues                 (T005)
src/systems/ProgressionSystem.ts       [pure] visionTier, buyVision                                           (T006)
src/persistence/saveSchema.ts          [pure] save v3: visionTier, 16-district records, fog remap             (T006)
src/world/BoundaryScenery.ts           [3D] NEW render-only band dressing + backdrop beyond bounds (instanced) (T007)
src/world/CityDistrict.ts              [3D] new PropKinds/BuildingStyle use, dark skirt removed               (T007)
src/world/{TropicalScenery.ts,tropicalLayout.ts}  south beach full width + east bay water                    (T007)
src/core/visionMath.ts                 [pure] NEW haze curve + tier blend math                                (T008)
src/visuals/VisionFog.ts               [3D] NEW material patch + shared uniforms                               (T008)
src/visuals/{HealthBars,EntityRenderer}.ts   hide bars/markers of unidentified humans; 'seen' = silhouette     (T008)
src/ui/SenseIndicators.ts              NEW directional cue arcs (DOM)                                          (T009)
src/ui/{HUD,NestPanel,uiHelpers,Minimap,WorldMap,mapRender}.ts, hudOpenWorld.css   vision panel + buy, district
                                       threat banner, map gating, tutorial toasts                              (T009)
src/audio/AudioSystem.ts               panned/attenuated cue sounds                                            (T009)
src/sim/{Simulation,createInitialState}.ts, src/systems/HordeSystem.ts (order gate only),
src/core/{Game,InputController}.ts, src/ui/PauseMenu.ts (quality toggle)   integration                         (T010)
```

## EW-3. Locked interfaces (exact shapes for T001)

```ts
// ---- types.ts: world ----
type ColliderKind = ... | 'boundary';                       // world edge; never breakable/disabled
type PropKind = ... | 'container' | 'jerseyBarrier' | 'chainFence' | 'watchtower' | 'tent' | 'palm' | 'wreck';
type DistrictId = 'suburbs' | 'police' | 'shopping' | 'industrial' | 'palm_park' | 'sunny_boardwalk' | 'neon_nights'
  | 'arts_district' | 'oceanfront_hotels' | 'luxury_marina' | 'golf_estates' | 'medical_center' | 'university'
  | 'financial_core' | 'airport' | 'military_base';           // DISTRICT_IDS lists all 16 (grid order r0c0..r3c3)
type StrongholdId = <existing 4> | <12 new, EW-1>;
type DistrictArchetype = 'suburban' | 'civic' | 'retail' | 'industrial' | 'park' | 'boardwalk' | 'nightlife' | 'arts'
  | 'resort' | 'marina' | 'estates' | 'medical' | 'campus' | 'downtown' | 'airport' | 'military';
DistrictDef += threatTier: 1|2|3|4|5; archetype: DistrictArchetype; cell: { col: number; row: number }
type BoundaryKind = 'urban_fence' | 'concrete_debris' | 'vehicle_blockade' | 'shipping_containers'
  | 'military_perimeter' | 'deep_water' | 'mangrove_barrier' | 'collapsed_bridge';
interface WorldBoundarySegment {
  id: string; kind: BoundaryKind; points: Vec2[];            // polyline along the edge, inside the band
  isWorldEdge: true; destructible: false; blocksPlayer: true; blocksNPCs: true; blocksVehicles: true;
  scenerySeed: number; colliderTags: string[];               // tags of its 'boundary' colliders in layout.colliders
}
interface BackdropDef { kind: 'skyline' | 'mangroves' | 'ocean' | 'bay' | 'highway' | 'airfield'; rect: AABB; seed: number } // outside bounds, render-only
DistrictLayout += playArea: AABB; boundaries: WorldBoundarySegment[]; backdrop: BackdropDef[]   // legacy: playArea = bounds, [] , []

// ---- types.ts: vision & senses ----
type VisionTier = 1 | 2 | 3 | 4;
type Awareness = 'none' | 'heard' | 'sensed' | 'seen' | 'identified';
interface VisionProfile { tier: VisionTier; name: string; clearRadius: number; hazeRadius: number; hazeStrength: number;
  detectMovingHumans: boolean; movingDetectRadius: number; detectDefenses: boolean; defenseRadius: number;
  detectReinforcements: boolean; reinforcementRadius: number }
type SenseKind = 'gunshot' | 'scream' | 'siren' | 'crowd';
interface SenseCue { id: number; kind: SenseKind; awareness: 'heard' | 'sensed';  // crowd = sensed (scent), rest heard
  pos: Vec2;           // FUZZED source estimate, fixed at creation/refresh, never the live entity position
  intensity: number;   // 0..1 after distance attenuation
  age: number; ttl: number; count: number }                  // count = aggregated events
interface VisionState { tier: VisionTier;                    // mirrors progression.visionTier (AwarenessSystem copies it)
  identified: EntityId[];  // sorted ascending; full info, targetable
  seen: EntityId[];        // sorted ascending; silhouette/marker only, not targetable, no hp/labels
  cues: SenseCue[];        // <= senses.maxCues
  nextCueId: number; revision: number }                      // revision++ whenever identified/seen change
GameState += vision: VisionState                              // transient: never saved
ProgressionState += visionTier: VisionTier                    // persistent
SimInput += buyVision: boolean                                // nest edge, like buySlot; emptyInput() sets false
GameEvent += { type: 'visionUpgraded'; tier: VisionTier; cost: number }
          | { type: 'senseCue'; cueId: number; kind: SenseKind; fresh: boolean }   // fresh=false ⇒ aggregated refresh
abilityDenied.reason += 'maxVision'
PlayerSave += visionTier: VisionTier                          // save v3; missing ⇒ 1

// ---- contracts.ts (doc block; implemented by the named task) ----
// AwarenessSystem (T005):
//   visionProfile(tier): VisionProfile                       // from BALANCE.vision.tiers
//   updateAwareness(ctx, dt, stepEvents: readonly GameEvent[]): void
//       copies tier; at vision.updateHz rebuilds identified/seen for non-dormant living humans within maxRadius;
//       LOS (ctx.collision LOS height rule, eye vision.eyeHeight) budgeted to vision.maxLosChecksPerUpdate round-robin
//       (results cached between updates); turns stepEvents into cues; ages/expires cues; never allocates per agent per step.
//   isIdentified(state, id), isSeen(state, id), awarenessOf(state, id): Awareness, canTarget(state, id): boolean
//       (canTarget === isIdentified; binary search on the sorted arrays)
//   isWorldPositionInSight(state, p): boolean                 // dist(leader, p) <= clearRadius (geometry only, no LOS)
// Identification rules (all distances XZ from leader.pos; leader dead/respawning ⇒ identified = engaged only):
//   identified ⇐ dist <= vision.alwaysRadius
//             ∨ (dist <= clearRadius ∧ LOS)
//             ∨ (engaged: shot/hit the leader or a follower within vision.engagedMemory s ∧ dist <= clearRadius * 2)
//   seen ⇐ ¬identified ∧ ((detectMovingHumans ∧ speed > vision.movingSpeed ∧ dist <= movingDetectRadius ∧ LOS)
//                      ∨ (detectDefenses ∧ strongholdId ≠ null ∧ dist <= defenseRadius)
//                      ∨ (detectReinforcements ∧ spawned by a reinforcement wave ∧ dist <= reinforcementRadius))
// Cues (only for sources beyond clearRadius and within the kind's range): 'shot' → gunshot; civilian entering
//   RETREAT/flee → scream; 'reinforcements' → siren (tier 4: fuzz × vision.reinforcementFuzzFactor); crowd scan at
//   senses.crowdScanHz: ≥ senses.crowdMinHumans living humans within senses.crowdCellSize cell → crowd.
//   pos = source + rng offset of radius clamp(dist*fuzzFrac, fuzzMin, fuzzMax) (ctx.rng). Same kind within
//   senses.aggregateRadius of an existing cue ⇒ refresh (age 0, intensity max, count++), no new cue. Over maxCues ⇒ drop
//   the weakest. Cues never make a human identified/targetable.
// ProgressionSystem (T006):
//   visionCost(state): number | null                          // vision.tierCosts[tier], null at 4
//   buyVision(ctx): boolean                                   // active nest within nest.equipRadius, tier < 4, biomass >= cost;
//       atomic spend, tier++, emit visionUpgraded + autosave{reason:'equip'}; else abilityDenied{abilityId:null, reason:
//       'notAtNest'|'biomass'|'maxVision'}; leader alive ∧ phase 'playing' (else 'locked')
//   updateProgression: input.buyVision ⇒ buyVision(ctx)
// HordeSystem.applyHordeCommands (T010): open world only — attack order whose target is a human with !canTarget ⇒
//   becomes a move order to that human's current position. Legacy layout unchanged.

// ---- balance.ts ----
openWorld: { minX: -420, maxX: 420, minZ: -500, maxZ: 180, play: { minX: -400, maxX: 400, minZ: -480, maxZ: 160 },
             boundaryBand: 20, maxFollowers: 40 }
chunks.size stays 80 (11 × 9 = 99 chunks; streamer budget 12 unchanged)
population: maxHumans 420, maxAmbient 400 (all districts; dormant beyond activeRadius)
vision: { tiers: [
    { name: 'Rotten Eyes',    clearRadius: 18, hazeRadius: 46,  hazeStrength: 0.82, movingDetectRadius: 0,  defenseRadius: 0,  reinforcementRadius: 0 },
    { name: 'Predator Sight', clearRadius: 28, hazeRadius: 64,  hazeStrength: 0.62, movingDetectRadius: 40, defenseRadius: 0,  reinforcementRadius: 0 },
    { name: 'Hunter Vision',  clearRadius: 42, hazeRadius: 84,  hazeStrength: 0.42, movingDetectRadius: 56, defenseRadius: 70, reinforcementRadius: 0 },
    { name: 'Apex Vision',    clearRadius: 60, hazeRadius: 110, hazeStrength: 0.22, movingDetectRadius: 75, defenseRadius: 95, reinforcementRadius: 140 } ],
  tierCosts: [0, 20, 60, 120], alwaysRadius: 6, engagedMemory: 3, movingSpeed: 0.5, eyeHeight: 1.6, updateHz: 5,
  maxLosChecksPerUpdate: 48, reinforcementFuzzFactor: 0.35, tierBlendTime: 1.2, hazeColor: 0x9fb3a8 }
senses: { maxCues: 8, aggregateRadius: 25, crowdScanHz: 1, crowdCellSize: 30, crowdMinHumans: 6,
  kinds: { gunshot: { range: 140, ttl: 2.5, fuzzFrac: 0.18, fuzzMin: 6, fuzzMax: 30 },
           scream:  { range: 70,  ttl: 3,   fuzzFrac: 0.22, fuzzMin: 6, fuzzMax: 25 },
           siren:   { range: 200, ttl: 5,   fuzzFrac: 0.25, fuzzMin: 10, fuzzMax: 45 },
           crowd:   { range: 90,  ttl: 4,   fuzzFrac: 0.3,  fuzzMin: 10, fuzzMax: 35 } } }
save.version: 3
```

### Save v3 migration (T006)
v2 → v3: `player.visionTier = 1`; `districts`/`strongholds` records gain the 12 new ids with defaults (unknown / not
captured); `discoveryBits` is decoded with the v2 grid (20 × 16, origin −200/−160) and copied into the v3 grid
(42 × 34, origin −420/−500) at offset col +11, row +17. v1 chains through v2. Missing/garbage `visionTier` ⇒ 1.

## EW-4. Art & 3D technical contract

- Style: same flat-shaded low-poly Lambert, shared materials/geometries, `InstancedMesh` per prop type, merged static
  geometry per chunk. Palette additions: bay/ocean water `#2f8fa3`→`#1d5f78`, seawall concrete `#b8b2a4`, mangrove
  `#3f6b3a`/`#2e5230`, container colours (orange `#e0782a`, navy `#2c3e66`, teal `#2e8b84`, rust `#9a4a2a`), military
  olive `#5b6340`, quarantine yellow `#e8c547`, razor wire = thin dark `#3a3f45` zigzag silhouettes. No gore, no text decals.
- Boundary band dressing is **derived from `layout.boundaries`** (kind + polyline + scenerySeed), never from literal
  coordinates. Seeded variation per segment (panel height, gaps filled by wrecks/containers, lean, colour) so long runs
  don't repeat. Dressing must visibly cover each segment's colliders (no invisible strips ahead of walls).
- Backdrop beyond bounds: render-only, low-detail instanced boxes (skyline), cones/spheres (mangroves), large flat planes
  (ocean/bay with the existing animated ocean material), never pickable, never in `occluders`, `fog: true`.
- Draw-call budget for all new world dressing: ≤ 30 extra draw calls in view. No shadows on backdrop; band props may
  receive but not cast shadows.
- Vision haze: one shared `{ uVisionCenter: vec2, uClearRadius, uHazeRadius, uHazeStrength, uHazeColor, uDesaturate }`
  object injected into every scene material once (WeakSet guard, stable `customProgramCacheKey`). UI/HUD are DOM, never
  hazed. Muzzle flashes, tracers, command markers and the Alpha are excluded (`fog: false` or `userData.noVisionHaze`).

## EW-5. Invariants added (tests must cover)

1. `buildDistrictLayout()`: 16 districts tile `bounds` with no gaps/overlaps; `DISTRICT_IDS` order = grid order; one
   StrongholdDef per STRONGHOLDS entry; each tier ≥ 4 district shares an edge with a tier ≤ 2 district.
2. Nav connectivity: every walkable cell inside `playArea` is reachable from `playerStart` (sealed stronghold interiors
   excepted, opened when their doors/gates are destroyed); ≥ 3 crossings on every shared district edge.
3. Boundaries: every point on the playArea perimeter is covered by a `'boundary'` collider whose segment has
   `isWorldEdge: true, destructible: false`; corners overlap; no nav cell outside `playArea` is walkable; no StructureDef or
   objective references a boundary collider; a 2 000-step scripted push of leader + followers + a human into each edge and
   corner never leaves `playArea`.
4. Vision: identification uses only `leader.pos` (camera/zoom never read); identified set grows with tier; a human behind a
   building within clearRadius is not identified; within `alwaysRadius` it is; `seen` humans are not targetable; LOS checks
   per update ≤ `maxLosChecksPerUpdate` with 300 humans in range.
5. Cues: a shot beyond clearRadius makes one gunshot cue whose pos ≠ shooter pos and is within fuzzMax; 50 shots in one
   area aggregate into ≤ 1 cue per kind there; cues expire after ttl; cues never add to identified.
6. Progression: fresh state tier 1; buyVision denied away from nest / without biomass / at tier 4; success spends exactly
   the cost once; tier persists through save round-trip; v2 save loads with tier 1 and its fog bits at the shifted cells.
7. Sim gate: an open-world attack order on an unidentified human becomes a move order; on an identified one it attacks.

---

# Architecture & Interface Contracts — Todos milestone (TD: docs/todos.md items 7–9)

# IN — Opening cinematic (docs/4_intro_scene.md)

- **Flow:** `GameFlowState = LOADING | INTRO_CINEMATIC | PLAYING | PAUSED` lives in `Game.flow` (`src/core/gameFlow.ts`, pure).
  `cinematicInputLock(flow)` (LOADING/INTRO) is the single gate passed to `InputController.inputLocked`: keys, mouse, wheel,
  touch, queue* calls and buildSimInput edges are dropped (never buffered); `Game.handleKeyAction`/`openPause`/`canLock` check
  the flow too. PAUSED is entered/left by open/closePause only from/to PLAYING.
- **When it plays:** boot without a save, Reset Save, or pause-menu Replay Intro. Never on district entry. Autosave is ignored
  while locked; the first save happens at handoff (so a reload mid-intro replays it).
- **Replay:** `createSave(state)` snapshot in memory -> `restart()` -> intro on a fresh world (autosave suppressed) -> at the end
  `sim.reset(seed, snapshot)` with a 0.9 s fade from black. The stored save is never touched.
- **Script clock:** authored in script seconds (`src/content/intro.ts`). Narration second `a` = script `0.4 + a/scale`,
  `scale = narrationTimeScale(39.9, audio.duration)`; while narration plays the clock follows it (`advanceScriptClock`), otherwise
  dt-accumulates (timed-subtitle fallback). Sim runs during INTRO, frozen during LOADING.
- **Camera:** `CinematicController` samples Catmull-Rom keys (pos + look target + fov, per-segment easing, holds don't overshoot)
  into the existing camera; final key = the real `ThirdPersonCamera.reset` pose, so the handoff is cut-free. Skip = rise over the
  rooftops into the same pose. Portrait screens widen FOV (faded out before handoff). While active, chunk streaming uses the fixed
  `streamFocus`, sun/culling follow the look target, and non-follower zombies are hidden until `revealAmbientAt`.
- **Render-only dressing:** `TropicalScenery` (beach/ocean past z=maxZ, palms on sidewalks + promenade, umbrellas, traffic that
  brakes for people and yields at intersections; retired after the intro, each car removed once off-camera). No gameplay effect.
- **Audio:** `IntroAudio` (narration via HTMLAudioElement; theme -> crescendo -> cut + record scratch + crickets -> gameplay loop,
  scheduled from the frame loop through `AudioSystem.output`). Every audio call is try/catch-guarded.

---

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

- Player start ≈ (−150, 156) on the suburbs start beach (sand strip z 150–160), beside the start nest, **alone** (base cap 0):
  the first objective is walking into the walk-in nest by the bus (`nest_start`, `claim: true`), which raises 10 free followers
  (`hordeUnlocked`); +10 cap per active claim/stronghold nest. (Was (−150, 115) with 5 followers.)
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
| **RMB** on human / gate / structure | horde attack order; **hold E + RMB** adds/removes a split target (existing squads) | `hordeCommand: {type:'attack', target, additive}` |
| **RMB** on ground | horde move order (marker, expires `horde.moveOrderTime` → follow) | `hordeCommand: {type:'move', point}` |
| **Space** / Shift+RMB | Rally / regroup (existing rally: pull + recruit) | `hordeCommand: {type:'regroup'}` |
| **G** | recall: everyone follows | `hordeCommand: {type:'follow'}` |
| **Q T R F** | activate equipped ability slot 0–3 | `abilitySlot: 0..3 \| null` |
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
