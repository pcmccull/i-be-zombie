# OUTBREAK CITY — AI Orchestrator Implementation Plan

**Role:** You are the lead AI engineering orchestrator. Delegate independent work packages to coding subagents, integrate their changes, and deliver a **playable, polished Three.js browser prototype** of a GTA-style, continuous-world zombie horde conquest game. This is an execution specification, not a request for another design document.

## 0. Mission and non-negotiable outcome

Create a **single seamless, explorable low-poly 3D city** in which the player controls an Alpha zombie, infects civilians, gathers a following horde, assaults human outposts, captures territories, discovers the map incrementally, and unlocks permanent Alpha or horde mutations. No mission/level loading between districts. Exploration and territory conquest are separate systems. The player chooses which area to attack, and tough enemies—not invisible gates—discourage premature assaults.

**Definition of playable vertical slice:** Start in a suburban district; move continuously through four connected districts; encounter civilians and police; infect civilians and recruit followers; attack at least two defended strongholds; claim a district; unlock and use a mutation; see the territory/fog map update; die/respawn without losing permanent progress; save/reload to recover territory and unlocks. The game must feel immediate and fun: **the player starts with a small horde or rapidly recruits one in under 30 seconds**.

**Prototype target:** Modern desktop browser, keyboard + mouse, performant on a midrange laptop. No multiplayer, interiors, network services, or vehicles in this milestone. Do not use copyrighted GTA art or names in the shipped game. Use original procedural/primitive low-poly assets.

## 1. Orchestration rules

1. **Inspect repository before editing.** Identify existing framework, package manager, project conventions, tests, assets, and working game features. Retain functional systems; adapt this plan to the repository instead of replacing it wholesale.
2. **First create a compiling contract skeleton** (types, interfaces, event names, directories) and commit it. Only then dispatch parallel subagents. No agent may independently redefine shared types or public APIs.
3. Assign each worker a **separate Git worktree/branch** and file ownership. Parallel agents must not edit the same files. Prefer Git worktrees, merge or cherry-pick through the orchestrator, and resolve conflicts centrally.
4. Integrate **small vertical slices** continuously; do not wait until every agent finishes. An agent must keep its implementation compiling against shared contracts and provide tests or a deterministic manual verification route.
5. **Avoid hidden coupling:** World state and gameplay systems live outside Three.js scene objects; gameplay writes state through named APIs and events. Rendering observes state. UI never directly mutates NPC internals.
6. Use fixed-step simulation for combat/AI; render with requestAnimationFrame. Use seeded randomness for deterministic content and reproducible tests where feasible.
7. All constants (spawn caps, cooldowns, attack values, chunk size, difficulty) are data-driven configuration with sensible defaults. Avoid overengineering ECS or networking.
8. A module is not done until the orchestrator can run its acceptance test. Report blockers with concrete interface questions, not guesses.
9. Subagents may use placeholder visuals but must not leave placeholder gameplay; the integrated build should be attractive, legible, and responsive.
10. Do not begin Phase 2 until the shared contract compiles and a basic player can enter the world. Do not begin final polish while blockers remain in the core gameplay loop.

## 2. Technology and project structure

Preferred stack **if the repo does not already dictate another**:
- TypeScript + Vite + Three.js
- Lightweight React for HUD/map **only if the existing app already uses React**; otherwise plain DOM UI is acceptable
- Vitest for unit/system tests; Playwright optional for smoke tests
- LocalStorage for initial persistent saves with versioned JSON
- WebGL low-poly materials, instanced meshes for repeated props, simple animation rigs

Suggested module layout (modify only to fit existing conventions):

```text
src/
  app/              bootstrap, main loop, dependency wiring
  core/             shared contracts, event bus, clock, config, seeded RNG
  world/            chunks, districts, procedural city, navigation, discovery
  render/           Three.js environment, characters, effects, camera, optimization
  player/           movement, controls, health, Alpha combat
  agents/           civilians, police, military, horde follower AI
  combat/           damage, targeting, infection, death, threat
  conquest/         strongholds, territory influence, human response, objectives
  progression/      mutations, ability loadout, unlock conditions, biomass
  ui/               HUD, minimap, full map, objective markers, upgrade interface
  persistence/      save schema, serialization, migrations, storage
  content/          district configs, strongholds, encounters, balance data
  tests/
```

**World units:** 1 unit ≈ 1 meter. **Chunks:** start at 128 × 128 units; tune after profiling. Four contiguous districts; aim for believable streets and landmarks, not a giant empty map. Keep rendering, simulation, and persistent state decoupled.

## 3. Shared contract: orchestrator owns these definitions

Create a `src/core/contracts.ts` and `src/core/events.ts` (or match repo conventions). The following are representative minimum APIs; the orchestrator may refine signatures once, before delegating, and must publish the final contracts to all workers.

```ts
type EntityId = string;
type DistrictId = 'suburbs' | 'shopping' | 'police' | 'industrial';
type TerritoryStatus = 'unknown' | 'human' | 'contested' | 'infected';
type Faction = 'alpha' | 'infected' | 'human';
type ActorKind = 'alpha' | 'civilian' | 'police' | 'soldier' | 'zombie' | 'brute';
type AbilityId = 'bite' | 'infect' | 'alpha_claws' | 'horde_frenzy' | 'pounce' | 'brute_evolution';
interface Vec3 { x: number; y: number; z: number }
interface EntitySnapshot {
  id: EntityId;
  kind: ActorKind;
  faction: Faction;
  position: Vec3;
  heading: number;
  health: number;
  maxHealth: number;
  state: string;
}
interface DistrictState {
  id: DistrictId;
  status: TerritoryStatus;
  discovered: boolean;
  infection: number; // 0..1
  humanStrength: number; // 0..1
  alertLevel: number; // 0..1
  strongholdCaptured: boolean;
}
interface PlayerState {
  position: Vec3;
  health: number;
  maxHealth: number;
  biomass: number;
  unlockedAbilities: AbilityId[];
  equippedAbilities: AbilityId[]; // 4 active slots max
  selectedNestId?: string;
}
interface StrongholdDefinition {
  id: string;
  districtId: DistrictId;
  position: Vec3;
  defenseTier: number;
  unlock?: AbilityId;
  objectives: string[];
}
interface StrongholdState { id: string; captured: boolean; defenderStrength: number; objectivesDone: string[] }
interface WorldSave {
  version: number;
  seed: number;
  player: PlayerState;
  districts: Record<DistrictId, DistrictState>;
  strongholds: Record<string, StrongholdState>;
  acquiredUpgrades: string[];
}
interface GameEventMap {
  'actor:damaged': { actorId: EntityId; amount: number; sourceId?: EntityId };
  'actor:died': { actorId: EntityId; killerId?: EntityId };
  'human:infected': { humanId: EntityId; zombieId: EntityId; districtId: DistrictId };
  'horde:recruited': { zombieId: EntityId };
  'district:discovered': { districtId: DistrictId };
  'district:statusChanged': { districtId: DistrictId; status: TerritoryStatus };
  'stronghold:captured': { strongholdId: string; districtId: DistrictId };
  'ability:unlocked': { abilityId: AbilityId };
  'player:respawned': { nestId: string };
}
```

**Important:** The event bus needs typed `emit/on/off`. The world system exposes pure coordinate lookup `getDistrictAt(position)`, seeded chunk generation, and discovery updates. The simulation maintains authoritative actor state. Use one authoritative damage/infection pathway; don't build separate combat implementations in player and NPC agents.

**System boundaries:**
- World provides geometry, nav waypoints, district/stronghold positions and discovery; it never decides combat damage.
- Actor simulation owns movement and AI intentions; combat resolves hits/infection; progression handles mutation effects.
- Conquest owns stronghold/territory state transitions and unlock triggers; progression records unlocked abilities.
- UI renders world snapshots and sends high-level commands (`equipAbility`, `setHordeTarget`, `activateAbility`, `placeWaypoint`), not low-level state mutations.
- Persistence saves canonical data; never serialize Three.js meshes, references, timers or transient pathfinding objects.

## 4. Parallel work packages

### Agent A — Continuous City & Streaming (world owner)
**Owns:** `src/world/**`, procedural district content related to roads/buildings, nav map/waypoints; may edit `src/content/world*.ts` only.

Deliver:
- Single seamless map with four **contiguous** districts: residential suburbs, shopping center, police station/civic area, industrial warehouses. Streets and intersections connect all districts.
- Distinct silhouettes and recognizable landmarks: homes/park, mall/parking lot, fortified station, warehouse/loading yard.
- Deterministic seeded layout; walkable sidewalks/roads; collision proxies for buildings/obstacles; no open gaps or teleportation between districts.
- Chunk-based generation/loading around the player and cleanup outside radius. Maintain persistent chunk IDs even when unloaded.
- World-to-district mapping, points of interest, spawn zones, nav waypoints, exploration/discovery reveal API.
- Expose terrain/obstacle queries and navigation graphs to AI and combat. Avoid implementing character pathfinding here.

**Acceptance:** Walk from suburban spawn through all four districts without loading screens; no impassable unintended seams; generated layout stable across reload; chunk count bounded while roaming.

### Agent B — Player Controls, Camera & Direct Combat (player owner)
**Owns:** `src/player/**` and player controller portion of input. Coordinate controls mapping with Agent F, but do not edit `src/ui/**`.

Deliver:
- Responsive third-person/top-down-oblique chase camera suitable for viewing the horde, smoothly following player with zoom; optional rotate if simple.
- WASD movement relative to camera, sprint, wall collision, camera obstruction handling; clearly readable player model and hit feedback.
- Basic bite/infect attack, **Alpha Claws** melee combo unlock, **Pounce** leap as next milestone (only implement if within scope/time).
- Attack windup/recovery, ranges, cooldowns, telegraphs; damage events routed through central combat service.
- Player health, hit stun, death and respawn request; player can fight directly even with zero followers.

**Acceptance:** Controls feel responsive; movement respects collisions; direct attacks can defeat police; unlock makes Alpha Claws available and useable; no direct player edits to territory state.

### Agent C — NPCs, Infection & Horde AI (agents/combat owner)
**Owns:** `src/agents/**`, `src/combat/**`; all NPC brains, shared hit/infection resolution and spawn population simulation.

Deliver:
- Civilians wander/flee from threats; police pursue/fire and defend assigned locations; zombies seek nearby enemies and follow the Alpha.
- Infection conversion pipeline (human defeated/infected → short animation → friendly zombie) and horde recruitment with visible feedback.
- Start with **5 nearby followers** or infectable civilians within immediate reach. Target initial useful horde of 10–15 within 30 seconds.
- Basic follower behavior: flocking/separation, obstacles, target preference, follow radius, regroup if stranded, attack cooldowns, attack and death states.
- Horde cap initially 40 active followers (configurable). Distant actors simulated cheaply or despawned with district population aggregate updated; no unbounded entity growth.
- Police firing, aim delays, line-of-sight approximation, cover positions if feasible. Distinct human behavior between civilians and police.
- Commands: `follow`, `attack target/location`, `regroup`; high-level command API for UI/controls. All attacks use shared damage service.

**Acceptance:** 30–40 zombies can follow and engage a police barricade with credible motion and acceptable frame rate; infection/recruiting works; civilians react visibly; AI never spawns unlimited actors.

### Agent D — Strongholds, Territory & Dynamic Human Response (conquest owner)
**Owns:** `src/conquest/**`, `src/content/strongholds*.ts`.

Deliver:
- At least three distinct defendable targets: mall security center, police station, industrial security yard. **Police station** is the required first major mutation unlock; mall and industrial are optional order.
- Stronghold completion logic driven by explicit objective triggers (e.g., destroy barricade/defender group/control point); show objectives before and after capture. Avoid requiring all ambient NPCs to die.
- Territories track discovered/human/contested/infected independently from fog reveal. On stronghold capture, status changes persist and surrounding hostile patrol frequency decreases.
- District alert responds to attacks: police reinforcements and patrols scale sensibly with local aggression. Do **not** automatically overwhelm the player with endless spawns.
- Infected nest activation upon capture: a safe respawn point, fast horde replenishment, biomass/upgrades access.
- Reserve human recapture as a data/API hook only; no aggressive constant recapture system in the slice.

**Acceptance:** Different strongholds may be approached in any order; capturing a stronghold changes visible district behavior, grants its defined unlock exactly once, and persists after leaving/returning/reload.

### Agent E — Mutations, Biomass & Progression (progression owner)
**Owns:** `src/progression/**`, `src/content/abilities*.ts`.

Deliver:
- Data-driven ability registry: type `alpha`/`horde`/`passive`, source stronghold, cooldown, cost, effects, slot behavior.
- Starting actions: bite, infect, follow/command. Required unlocks: **Alpha Claws** (police station), **Horde Frenzy** (mall), **Brute Evolution** (industrial warehouse).
- Alpha Claws: stronger three-hit melee combo and staggers; implement via Player/Combat integration hooks.
- Horde Frenzy: nearby followers +40% move speed and +50% attack speed for 8 s, with clearly visible effect and a cooldown.
- Brute Evolution: consume biomass to upgrade selected follower(s) to durable siege Brutes (at least one model variant and heavier barricade damage).
- Biomass earned through infection/stronghold completion; balanced costs and UI-readable totals. No grind gate on critical story ability unlocks.
- Equip up to four active mutations; define pure eligibility/cooldown/cost checks. Preserve all unlocks through save/load.

**Acceptance:** Three major capture rewards unlock once, persist across save/reload, can be equipped/activated, and each provides a combat advantage visible in play. Ability activation cannot double-spend biomass or bypass cooldowns.

### Agent F — HUD, Map, Fog of War & UX (UI owner)
**Owns:** `src/ui/**`, HUD/overlay styling and art; use contracts, events and command adapters only. No edits to world/gameplay modules.

Deliver:
- Clean game-style HUD showing Alpha health, follower count, biomass, four ability slots/cooldowns, active objective and capture feedback.
- Minimap and full-screen world map toggled by `M`: visible roads/landmarks in explored areas, unknown areas masked, territory states distinct, strongholds annotated by ownership/threat/unlock.
- Separate **discovery mask** from **territory-control shading**; discovering an area must not imply conquering it.
- Waypoint selection and world marker; an unobtrusive objective tracker; accessible key prompts.
- Mutation acquired toast and equip interface at infected nests; no mission-complete loading screen.
- Pause/menu with Save, Continue, Reset Save (confirmation). Include a minimal onboarding overlay, not a lengthy tutorial.

**Acceptance:** All important state updates in near real-time, the map changes as exploration and conquest occur, and ability unlocks can be equipped without editing gameplay internals. HUD remains readable at 1280×720.

### Agent G — Art Direction, Animation & Performance (render owner)
**Owns:** `src/render/**`, procedural visual assets/materials/FX, model factories and post-processing. No edits to world generation or gameplay logic.

Deliver:
- Consistent stylized low-poly 3D: readable zombies vs humans vs Alpha, clear color/shape language; distinct suburb/mall/police/industrial props.
- Procedural/primitive models and simple rigs or animation states (idle, walk, sprint, bite, shoot, hit, death, infection). Avoid external licensed art.
- Efficient repeated geometry/material reuse, instancing where practical, LOD/culling, pooled particles and decals.
- Visual infection effects, muzzle flashes, selection rings, hit indicators, capture effects, mutation effects, Brute silhouette.
- Environment atmosphere: daylight lighting, shadows tuned for performance, restrained fog, visible landmarks. Avoid expensive post-processing by default.

**Acceptance:** A visually coherent scene, clear gameplay readability at camera distance, stable fps with ~40 followers + ~20 humans and representative props; no rising draw-call or object count after roaming.

### Agent H — Persistence, Testing & Developer Tools (infrastructure owner)
**Owns:** `src/persistence/**`, `src/tests/**`, test helpers, README run instructions and CI scripts (coordinate package.json ownership with orchestrator).

Deliver:
- Versioned save data (LocalStorage) for world seed, discovered districts, territory ownership, strongholds, player spawn/nest, unlocked/equipped abilities and biomass.
- Autosave on major milestones, explicit Save UI action, safe defaults for corrupt/incompatible saves, migration strategy for schema version increments.
- Unit tests: infection→recruitment, capture→unlock once, discovery != conquest, ability cost/cooldown, save round-trip, deterministic world seed.
- Lightweight debug overlay/toggles for player position, actor counts, chunk counts, district state, fps and mission flags. Enable only for dev/debug.
- Smoke test script or checklist covering opening, travel, infection, stronghold victory, mutation, death/respawn, save/reload.

**Acceptance:** Reloading restores all permanent changes and the player can continue play; clean start works; build/tests pass consistently; no save causes an unrecoverable launch error.

## 5. Ownership and dependencies: launch parallel agents safely

**Orchestrator owns only:** `src/app/**`, `src/core/**`, `package.json`, `vite.config.*`, `tsconfig*`, final wiring/integration. Share a read-only contract snapshot with all agents.

| Work package | Depends on | Safe to start |
|---|---|---|
| A World | Core contracts | After skeleton |
| B Player | Core + Combat command contracts | After skeleton |
| C NPC/Horde/Combat | Core + World nav interface | After skeleton with mock nav |
| D Conquest | Core + World district interface + events | After skeleton with mock world |
| E Progression | Core + combat effect hooks | After skeleton with stub hooks |
| F HUD/Map | Core read model + game command interface | After skeleton with mocked snapshots |
| G Render | Core render adapter + actor snapshots | After skeleton with fake actor data |
| H Persistence/Tests | Core save contract + state selectors | After skeleton |

**Avoid dependency deadlocks:** Each agent creates local test doubles for dependencies not ready, imports shared contract types, and does **not** implement another agent's module. If an API is missing, submit a short change request to orchestrator. Orchestrator modifies contract and broadcasts the revision.

## 6. Integration and milestone gates

### Gate 0 — Repo reconnaissance + compiling skeleton (orchestrator)
- Run existing build/tests and record baseline.
- Decide existing architecture vs preferred stack; preserve working assets/features.
- Add typed contracts, event bus, simulation clock, seeded RNG and mock adapters.
- Create separate worktrees with ownership constraints, assign all agents.
- **Pass:** app starts in browser, renders placeholder city/player, no TypeScript errors.

### Gate 1 — Walkable world + living NPCs (integrate A, B, C, G)
- Wire world collision/navigation, Alpha movement, spawn systems, camera, render adapters and combat.
- **Pass:** freely traverse all four districts, see and infect humans, recruit and control followers, fight police.

### Gate 2 — Territory + progress (integrate D, E, F)
- Wire objectives, capture, mutation registry, HUD, fog and map.
- **Pass:** take police station, unlock and equip Alpha Claws; tackle mall/industrial; map shows correct discovery and control.

### Gate 3 — Persistent open world (integrate H)
- Wire save/load, nest respawn, district ambient state and chunk streaming persistence.
- **Pass:** leaving and returning to districts preserves completed objectives; browser reload restores permanent progress; no duplicated rewards.

### Gate 4 — Polish + performance (all agents, owner-only edits)
- Tune first 2 minutes to be engaging; revise civilian density, infection timing, police escalation, horde responsiveness, audio cues if existing assets permit.
- Profile CPU/GPU hotspots and memory; clean NPC/chunk lifecycle; improve visual landmarks and combat feedback.
- **Pass:** 10-minute uninterrupted playthrough on target browser; no softlocks; average ≥ 50 fps on representative midrange hardware where measurable (record test environment); no sustained memory growth.

## 7. Playable encounter and progression specifications

**Starting area / pacing**
- Spawn beside a small cluster of 5 friendly zombies (or a scripted instant infection of nearby civilians).
- First meaningful decision/interactable within 10 seconds; first human encounter within 15 seconds; target 10–15 followers within 30 seconds under normal play.
- Small police checkpoints provide early danger, not instant death. Fast recovery after losing the horde.

**Strongholds, suggested location/unlock mapping**
1. **Police station (residential/civic edge)** — guarded doors, patrols, firing line; capture grants **Alpha Claws**.
2. **Shopping mall security center** — population-rich environment with bottlenecks; capture grants **Horde Frenzy**.
3. **Industrial security yard** — barricades and rooftop guards; capture grants **Brute Evolution**.

The suburban residential zone is the initial exploration/recruitment area, not a mandatory separate level. Each stronghold can be attacked in any order. Difficulty comes from enemy composition, defense placement, and horde sizes, not invisible walls.

**Conquest logic**
- Discover terrain when the player enters a radius or captures an intel point. Store discovered chunks/regions.
- Stronghold enters contested state upon coordinated attack or objective damage.
- Capture by objective completion, not complete extermination; turn into nest/ally stronghold where defined.
- Award unlock only once, persist immediately. Captured districts reduce police patrols and enable zombie reinforcement.
- Threat escalates locally with aggression; avoid endless waves and avoid making unvisited districts impossible through global scaling.

**Horde interaction**
- Default follow the Alpha; right-click enemy/ground = attack/move target; Shift+right-click = rally/regroup when unlocked or use an accessible alternate binding.
- Avoid mutually conflicting commands. Commands should have visual confirmation and expiration/fallback to follow.
- Critical: keep horde moving through street corners without repeated stuck followers; teleport or fast catch-up only for followers far offscreen and out of combat.

**Controls (desktop baseline)**
- WASD move; Shift sprint; mouse aim / camera orientation; LMB bite/basic attack; RMB horde target/attack; `M` world map; `Q/E/R/F` equipped abilities; `Esc` pause; mouse wheel camera zoom.
- If camera style conflicts with mouse aim, orchestrator selects one input model and publishes it before integration. Prefer forgiving controls to strict shooter accuracy.

## 8. Data-driven content contract

Define district and stronghold content as immutable config, not hardcoded into UI, combat or procedural geometry. Example:

```ts
const strongholds = [
  { id: 'police_station', districtId: 'police', defenseTier: 2,
    unlock: 'alpha_claws', objectives: ['breach', 'disable_command'] },
  { id: 'mall_security', districtId: 'shopping', defenseTier: 1,
    unlock: 'horde_frenzy', objectives: ['disable_security', 'take_control'] },
  { id: 'industrial_yard', districtId: 'industrial', defenseTier: 3,
    unlock: 'brute_evolution', objectives: ['break_gate', 'take_control'] }
];
```

Avoid assuming district conquered just because player entered its bounds. The world may reveal strongly defended districts before the player is ready. Consider biome-like district visuals and landmark descriptions for navigational readability.

## 9. Specific performance safeguards

- Full AI only within active simulation radius; distant NPCs represented by district counters and scripted respawn seeds.
- Pool zombies, bullets, particles, hit effects; cap active followers at 40 initially; cap civilians/police by district budget.
- Instanced meshes for repeated street furniture, vegetation, and building parts when practical; stable draw calls during travel.
- Detach listeners, free GPU resources on chunk unload, and avoid new allocations per actor per frame.
- Actor update frequency may be lower at distance. Avoid per-NPC all-to-all collision checks; use spatial hash/grid.
- Debug stats for draw calls, object counts, NPC counts, chunk load/unload and frame time.

## 10. Integration tests (orchestrator must run)

1. **Seamless city:** Spawn suburbs, reach mall, police station, industrial district via walking without loading/new scene.
2. **Fog:** Walk into undiscovered area, see local map reveal; map must still mark it human-controlled until captured.
3. **Infection/horde:** Attack civilian, convert and recruit; follower follows and participates in fighting.
4. **Direct fight:** Kill a police officer personally; receive damage; show attack feedback.
5. **Order attack:** Right-click guarded area, followers advance, acquire and attack nearby enemies.
6. **Stronghold:** Complete police station objectives; capture once; Alpha Claws unlock once.
7. **Mutation:** Equip/use Alpha Claws; mall Horde Frenzy buffs active followers; Brute Evolution consumes biomass and creates siege unit.
8. **Free order:** Player can take mall before police station and rewards/flags remain coherent.
9. **Persistence:** Save and reload; discovered map, captured base, mutation, biomass and nest remain correct.
10. **Death:** Player dies, respawns at available infected nest, keeps progression and can rebuild horde quickly.
11. **Streaming:** Walk across map repeatedly; active chunks/NPCs stay bounded, captured bases do not reset.
12. **Regression:** No duplicate rewards, negative biomass, permanently stuck objectives, spawn explosions or blank world after load.

## 11. Required reporting format for every subagent

Each agent returns:

```text
WORK PACKAGE: <A–H>
BRANCH/WORKTREE: <branch/path>
IMPLEMENTED: <specific features>
FILES CHANGED: <file paths>
CONTRACTS USED / CHANGES REQUESTED: <details>
TESTS RUN: <commands and results>
MANUAL VERIFICATION: <exact steps>
KNOWN LIMITATIONS: <honest blockers>
INTEGRATION NOTES: <required calls/init order>
```

The orchestrator must keep a short integration ledger with package status (`not started`, `in progress`, `ready`, `integrated`, `verified`) and blocking dependencies. Merge only after reviewing diff, verifying ownership, running typecheck/test/build, and smoke-testing the affected game loop. If a package is blocked, implement a temporary mock through orchestrator-owned adapters; do not redirect an unrelated agent into overlapping files.

## 12. Orchestrator's first instructions to subagents

Send every subagent the same project goal, contract files, conventions, control scheme and the ownership restrictions above. Then use this assignment pattern:

> Implement work package [LETTER] in your own Git worktree. You exclusively own [PATHS]. Read `src/core/contracts.ts` and `src/core/events.ts` first. Do not edit core, app, package configs, or another agent's files. Keep the branch building with mock dependencies where needed. Deliver playable systems, not a design proposal. Add tests or deterministic verification steps. Report changed files, integration APIs, known blockers, and exact commands run. Do not silently change shared interfaces; request approval from the orchestrator.

Orchestrator owns final wiring and decisions. **Do not declare success until the entire vertical slice is playable in the browser.**

## 13. Future scope — explicitly NOT in the first slice

- Full city with dozens of neighborhoods; 12+ strongholds and endgame fortress
- Advanced military phases, helicopters, tanks, evacuation flights, world recapture campaign
- More Alpha abilities (Ground Slam, Tendril Strike, Overdrive) and horde abilities (Exploders, Siege Roar, Necromancer)
- Building interiors, driving, multiplayer, backend accounts, co-op, complex economy
- Large-scale background citizen life simulation or a fully destructible city

Build interfaces that can accommodate these later, but do not implement them now. Prioritize a cohesive, fun, reliable 10-minute sandbox over a broad, unfinished feature list.

---

**Final deliverables:** Running source code, readable architecture, typecheck/build/tests, play instructions and controls, a reproducible 10-minute demonstration path, and a short list of remaining defects. The player must experience a continuous city that reveals itself through exploration and changes persistently through conquest.
