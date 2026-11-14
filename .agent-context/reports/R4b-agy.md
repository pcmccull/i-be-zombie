# R4b — Spec & Cross-File Consistency Audit

## 1. Section 9 Acceptance Checklist & Spec Audit (§1–§7, §9, §10)

| Ref | Requirement | Status | Evidence (`file:line`) |
| :--- | :--- | :--- | :--- |
| **§1 / §9.1** | **Immediate Horde Identity (0–10 s):** Player spawns with 4–6 active followers already in formation. | **Met** | `BALANCE.horde.startFollowers = 5` ([balance.ts:71](file:///C:/projects/i-be-zombie/src/config/balance.ts#L71)); spawned inside `startFollowerArea: rect(-90, 57, -80, 67)` around `playerStart: { x: -85, z: 62 }` with `state: 'follower'`, `recruitGen: 0`, `pulseAt: -1` ([districtLayout.ts:704-706](file:///C:/projects/i-be-zombie/src/world/districtLayout.ts#L704-L706), [createInitialState.ts:28-39](file:///C:/projects/i-be-zombie/src/sim/createInitialState.ts#L28-L39)). |
| **§1 / §9.2** | **First Action Within 5 Seconds:** At least 2 wandering civilians within immediate sight of spawn (< 4 s walk). | **Met** | Two `'civilian'` / `post: 'street'` spawns at `{ x: -74, z: 47 }` and `{ x: -70, z: 52 }` (~18.0–18.6 m from `{ x: -85, z: 62 }`, ~3.6 s walk at 5 m/s; [districtLayout.ts:808-809](file:///C:/projects/i-be-zombie/src/world/districtLayout.ts#L808-L809), verified by [opening.test.ts:15-22](file:///C:/projects/i-be-zombie/tests/opening.test.ts#L15-L22)). |
| **§1 / §9.13** | **Opening Pacing Curve:** ~20 zombies by 10–25 s (first cascade), 25–40 by 25–45 s (environmental opportunity), 30–50 by 60 s. | **Met** | Player spawns facing the abandoned bus door (`playerStartFacing`: [districtLayout.ts:705](file:///C:/projects/i-be-zombie/src/world/districtLayout.ts#L705)); `park-edge` (6 ambient) + `bus` (15 held) + `parking-lot` (12 ambient) + `police-pen` (10 held) + 2 barricade soldiers yield 30–50 followers by 60 s in the scripted opening run ([opening.test.ts:25-63](file:///C:/projects/i-be-zombie/tests/opening.test.ts#L25-L63)). |
| **§2 / §9.3** | **Proximity Recruitment Preserved:** Walking near ambient zombies automatically recruits them within `~8–10 m`. | **Met** | `BALANCE.horde.recruitRadius = 9` ([balance.ts:73](file:///C:/projects/i-be-zombie/src/config/balance.ts#L73)), scaled by `recruitRadiusMultiplier(ctx.state.momentum)` and checked against move-access segment occlusion in [HordeSystem.ts:430-439](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L430-L439). |
| **§2 / §9.4** | **Cascading Recruitment Pulses:** Each newly recruited zombie emits exactly one pulse (`~10 m`, `0.1–0.3 s` stagger, max `3` generations). | **Met** | `BALANCE.recruitPulse` (`radius: 10`, `delayMin: 0.1`, `delayMax: 0.3`, `maxGeneration: 3`, `maxRecruitsPerPulse: 8` at [balance.ts:112-120](file:///C:/projects/i-be-zombie/src/config/balance.ts#L112-L120)); scheduled in `scheduleRecruitPulse` ([HordeSystem.ts:71-77](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L71-L77)) and fired once in [HordeSystem.ts:440-462](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L440-L462). |
| **§2 / §9.5** | **Cascade Safety & Cap:** Pulses cannot re-trigger on already recruited zombies, cannot recruit through solid barriers, and respect `maxFollowers`. | **Met** | `pulseAt` resets to `-1` before firing ([HordeSystem.ts:442](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L442)); `recruitZombie` rejects `z.state !== 'ambient' || z.heldBy > 0` and checks `followers + rising >= BALANCE.horde.maxFollowers` ([HordeSystem.ts:54-60](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L54-L60)); segment move-block check in [HordeSystem.ts:454](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L454). |
| **§2 / §9.9** | **Recruitment Visual Feedback:** Newly recruited zombies flash/tint, ground pulse ring, upward burst, catch-up speed boost, and HUD counter pop (`+N`). | **Met** | `recruitFlash` tint by generation in [HordeRenderer.ts:219-233](file:///C:/projects/i-be-zombie/src/visuals/HordeRenderer.ts#L219-L233); ground ring + upward burst in [Effects.ts:392-423](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L392-L423); `recruitBoostMultiplier: 1.35` in [HordeSystem.ts:474](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L474); HUD `.is-pop` + aggregated `+N` badge in [HUD.ts:531-560](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L531-L560). |
| **§3 / §9.6–9.8** | **Four Destructible Environmental Landmarks:** Bus (15 zombies), Locked Alley (20 zombies), Convenience Store (4 civilians inside), Police Barricade (2 soldiers + 10 zombies). | **Met** | All 4 structures authored in [districtLayout.ts:404-432](file:///C:/projects/i-be-zombie/src/world/districtLayout.ts#L404-L432), held counts in [districtLayout.ts:708-717](file:///C:/projects/i-be-zombie/src/world/districtLayout.ts#L708-L717), store civilians (`shelter: 3`) and barricade soldiers (`post: 'barricade'`) in [districtLayout.ts:810-817](file:///C:/projects/i-be-zombie/src/world/districtLayout.ts#L810-L817), order redirect on sheltered civilians in [NavigationSystem.ts:132-135](file:///C:/projects/i-be-zombie/src/systems/NavigationSystem.ts#L132-L135). |
| **§3 Design Reqs** | **Visible from street, no long destruction sequence, released zombies can exit cleanly:** Outward fall < 0.5 s; collider disabled and nav grids rebuilt once. | **Met** | Bus/pen/alley rock or rattle while occupied ([Landmarks.ts:342-389](file:///C:/projects/i-be-zombie/src/world/Landmarks.ts#L342-L389)); outward fall tween is `0.48 s` ([Landmarks.ts:435](file:///C:/projects/i-be-zombie/src/world/Landmarks.ts#L435)); destruction disables breakable collider, rebuilds `navGrid` & `crawlNavGrid` once, sets `heldBy = 0`, and steers released zombies toward `releaseTarget` ([StructureSystem.ts:27-68](file:///C:/projects/i-be-zombie/src/systems/StructureSystem.ts#L27-L68)). |
| **§4** | **Zombie Distribution Across the Map:** Clustered pockets matching the §4 distribution table. | **Met** | Exact match on all spec pockets + 28 street/lot ambient zombies (`initialAmbient: 85` total; see table below). |
| **§5 / §9.10–9.11** | **Outbreak Momentum System & HUD:** 0–100 scale; gains (+1 recruit, +3 convert, +5 armed kill, +10 structure/gate); +50% radius & +20% speed at 100; 5 s grace, 3/s decay; 3 named tiers in HUD. | **Met** | Tuning in [balance.ts:143-163](file:///C:/projects/i-be-zombie/src/config/balance.ts#L143-L163); pure logic in [MomentumSystem.ts:1-67](file:///C:/projects/i-be-zombie/src/systems/MomentumSystem.ts#L1-L67); HUD meter, tier label (`Dormant`, `Growing Outbreak`, `Full Outbreak`), and live bonus readout (`+X% R · +Y% SPD`) in [HUD.ts:26-30, 562-611](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L562-L611). |
| **§6 / §9.12** | **Horde Responsiveness:** Followers turn quickly toward commands, tighten formation during attacks, and break off promptly on Recall. | **Met** | Attack orders boost separation/target weights (`attackSeparationDrop: 0.55`, `attackTargetWeight: 2.3`, `orderSpeedBoost: 1.15` in [HordeSystem.ts:475-476, 559-586](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L559-L586)); Recall clears `target` & `squads` and sets `recallGrace = 2.5` s ([HordeSystem.ts:218-227](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L218-L227)). |
| **§7 / §9.14** | **Performance:** Instanced rendering, spatial hash queries, and zero per-frame allocations in hot loops. | **Met** | `HordeRenderer` uses 1 `InstancedMesh` per body part + blob shadow ([HordeRenderer.ts:83-135](file:///C:/projects/i-be-zombie/src/visuals/HordeRenderer.ts#L83-L135)); `SpatialHash` reused for neighbor/pulse queries ([HordeSystem.ts:421-462](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L421-L462)); `Landmarks` pools dust/shards ([Landmarks.ts:116-143](file:///C:/projects/i-be-zombie/src/world/Landmarks.ts#L116-L143)). |
| **§9.15** | **Checkpoint Finale Intact:** Checkpoint assault remains the climax; victory requires gate destroyed AND all checkpoint guards dead. | **Met** | `checkVictory` checks `state.gate.destroyed && g.post === 'checkpoint' => g.state === 'DEAD'` ([VictorySystem.ts:4-12](file:///C:/projects/i-be-zombie/src/systems/VictorySystem.ts#L4-L12)). |
| **§10** | **Technical Constraints:** No new dependencies, no remote assets, no `Math.random` in `[pure]` code, balance values centralized in `src/config/balance.ts`. | **Partially** | Zero new deps ([package.json:11-19](file:///C:/projects/i-be-zombie/package.json#L11-L19)), zero remote assets, zero `Math.random` in `[pure]` modules (`Math.random` is only in `[3D]` [ThirdPersonCamera.ts:132-134](file:///C:/projects/i-be-zombie/src/core/ThirdPersonCamera.ts#L132-L134)). Several magic gameplay numbers exist in `[pure]` systems outside `balance.ts` (listed below). |

### §4 Zombie Distribution Table vs `layout.spawnZones` ([districtLayout.ts:704-718](file:///C:/projects/i-be-zombie/src/world/districtLayout.ts#L704-L718))

| Location (Spec §4) | Spec Count | Actual Count | Actual `id` / Coordinates in `districtLayout.ts` |
| :--- | :--- | :--- | :--- |
| Starting intersection (active followers) | 5 | **5** | `startFollowerArea`: `rect(-90, 57, -80, 67)` around `{ x: -85, z: 62 }` (`BALANCE.horde.startFollowers = 5`) |
| Nearby street / parking lot (free ambient) | 12 | **12** (+6 `park-edge`) | `parking-lot`: `rect(-16, 56, 6, 72)`, `count: 12` (plus `park-edge`: `rect(-75, 42, -58, 54)`, `count: 6`) |
| Abandoned bus (trapped) | 15 | **15** | `bus`: `rect(-70.95, 30.05, -61.05, 31.95)`, `count: 15`, `heldBy: 1` (`busDoor`) |
| Locked alley (trapped) | 20 | **20** | `alley`: `rect(69.05, 1.25, 70.95, 16.55)`, `count: 20`, `heldBy: 2` (`alleyGate`) |
| Police barricade pen (trapped) | 10 | **10** | `police-pen`: `rect(9.05, 34.05, 14.95, 35.95)`, `count: 10`, `heldBy: 4` (`penGate`) |
| Additional district clusters (free ambient) | — | **22** | `commercial` (`count: 8`), `residential-west` (`count: 6`), `east-lot` (`count: 8`) — total ambient = `85` |

### §10 Magic Gameplay Numbers Outside `src/config/balance.ts`

- [src/sim/createInitialState.ts:22](file:///C:/projects/i-be-zombie/src/sim/createInitialState.ts#L22): Hardcoded radius `0.45` in `collision.isBlocked(p, 0.45)` (whereas line 35 uses `BALANCE.world.navAgentRadius`).
- [src/entities/HumanGuard.ts:17](file:///C:/projects/i-be-zombie/src/entities/HumanGuard.ts#L17) & [src/sim/createInitialState.ts:42](file:///C:/projects/i-be-zombie/src/sim/createInitialState.ts#L42): Hardcoded tower platform elevation `4` m.
- [src/systems/HordeSystem.ts:57](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L57): `capReachedFlash = 1.5` s.
- [src/systems/HordeSystem.ts:226, 367](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L226): `recallGrace = 2.5` s and recall reduced engagement radius `1.8` m.
- [src/systems/HordeSystem.ts:267](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L267): `25` m radius for automatic guard target succession (`nearestReachableGuard`).
- [src/systems/HordeSystem.ts:315-316](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L315-L316) & [src/entities/Zombie.ts:20](file:///C:/projects/i-be-zombie/src/entities/Zombie.ts#L20): `15` s wander timeout and `1 + rng.next() * 3` s ambient idle pause.
- [src/systems/HordeSystem.ts:366](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L366): `20 * 20` (`20` m max distance from leader for follower auto-engagement).
- [src/systems/HordeSystem.ts:544, 596, 605, 610](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L544): `25` m direct clear-walk distance threshold, `12 * dt` velocity/facing smoothing rate, and `4 * dt` obstacle climb rate.
- [src/systems/HumanAISystem.ts:71, 166-178, 300, 304-314](file:///C:/projects/i-be-zombie/src/systems/HumanAISystem.ts#L71): `8` m ambient zombie sight distance, `6` m / `3` followers / `8` m / `3` s retreat parameters, and `2.5` m / `0.6x` combat backpedal.
- [src/systems/NavigationSystem.ts:94, 126](file:///C:/projects/i-be-zombie/src/systems/NavigationSystem.ts#L94): `4` (`2` m squared) leader replan threshold and `1.5 * 1.5` target move replan threshold.

---

## 2. Contract Conformance

1. **Module Existence & Exports (`AGENTS.md` & `src/core/contracts.ts`):**
   - Every module listed in the `AGENTS.md` directory table exists and exports the exact classes/functions required by [src/core/contracts.ts](file:///C:/projects/i-be-zombie/src/core/contracts.ts#L1-L165) (`Simulation`, `CollisionWorld` + `isCrawlable`, `NavigationGrid`, `SpatialHash`, `MomentumSystem` (`addMomentum`, `updateMomentum`, `momentumTier`, `recruitRadiusMultiplier`, `speedMultiplier`), `StructureSystem` (`findStructure`, `damageStructure`, `updateStructures`), `Landmarks`, etc.).
   - One extra helper module exists that is not listed in the `AGENTS.md` directory table: [src/core/cameraMath.ts](file:///C:/projects/i-be-zombie/src/core/cameraMath.ts#L1-L54) (`[pure]` camera math helpers extracted for unit testing).
2. **`[pure]` Module Isolation (No `three` imports):**
   - Verified across all `[pure]` directories (`src/config/`, `src/core/{types,contracts,cameraMath}.ts`, `src/sim/`, `src/world/{districtLayout,CollisionWorld,NavigationGrid}.ts`, `src/entities/`, `src/systems/`, `src/utils/`) and `tests/`: **zero `three` imports** exist in any `[pure]` module or test file.
3. **Contract File Ownership:**
   - `git status` and `git diff --cached` confirm that `src/core/types.ts`, `src/core/contracts.ts`, `src/config/balance.ts`, and `package.json` have **no unstaged worker modifications** (`M  ` staged in baseline only by the orchestrator in R0).

---

## 3. Sim–Visual Seams

### A. `GameEvent` Producer → Consumer Matrix (all 24 variants in [src/core/types.ts:397-423](file:///C:/projects/i-be-zombie/src/core/types.ts#L397-L423))

| `GameEvent['type']` | Sim Producer (`file:line`) | Visual / Audio / HUD Consumer (`file:line`) |
| :--- | :--- | :--- |
| `recruited` | [HordeSystem.ts:62](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L62) | `Effects` ([Effects.ts:392](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L392)), `AudioSystem` ([AudioSystem.ts:95](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L95)), `HUD` ([HUD.ts:627](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L627)) |
| `recruitPulse` | [HordeSystem.ts:460](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L460) | `Effects` ([Effects.ts:400](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L400)), `AudioSystem` ([AudioSystem.ts:102](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L102)) |
| `rally` | [HordeSystem.ts:241](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L241) | `Effects` ([Effects.ts:403](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L403)), `AudioSystem` ([AudioSystem.ts:105](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L105)), `HUD` ([HUD.ts:635](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L635)) |
| `orderAttack` | [HordeSystem.ts:207, 269](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L207) | `Effects` ([Effects.ts:406](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L406)), `AudioSystem` ([AudioSystem.ts:108](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L108)) |
| `orderRecall` | [HordeSystem.ts:227](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L227) | `Effects` ([Effects.ts:409](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L409)), `AudioSystem` ([AudioSystem.ts:111](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L111)) |
| `rushStart` | [HordeSystem.ts:253](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L253) | `Effects` ([Effects.ts:412](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L412)), `AudioSystem` ([AudioSystem.ts:114](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L114)), `HUD` ([HUD.ts:638](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L638)) |
| `rushEnd` | [HordeSystem.ts:192](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L192) | `Effects` ([Effects.ts:417](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L417)) |
| `shot` | [HumanAISystem.ts:278](file:///C:/projects/i-be-zombie/src/systems/HumanAISystem.ts#L278) | `Effects` ([Effects.ts:382](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L382)), `AudioSystem` ([AudioSystem.ts:117](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L117)), `EntityRenderer` ([EntityRenderer.ts:266](file:///C:/projects/i-be-zombie/src/visuals/EntityRenderer.ts#L266)) |
| `meleeHit` | [CombatSystem.ts:144, 152, 165, 211](file:///C:/projects/i-be-zombie/src/systems/CombatSystem.ts#L144) | `Effects` ([Effects.ts:390](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L390)), `AudioSystem` ([AudioSystem.ts:122](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L122)) |
| `damage` | [CombatSystem.ts:42, 66, 97, 114](file:///C:/projects/i-be-zombie/src/systems/CombatSystem.ts#L42), [StructureSystem.ts:23](file:///C:/projects/i-be-zombie/src/systems/StructureSystem.ts#L23) | `Effects` ([Effects.ts:385](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L385)), `AudioSystem` ([AudioSystem.ts:127](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L127)) |
| `zombieDied` | [CombatSystem.ts:74](file:///C:/projects/i-be-zombie/src/systems/CombatSystem.ts#L74) | `Effects` ([Effects.ts:419](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L419)), `AudioSystem` ([AudioSystem.ts:147](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L147)) |
| `guardDied` | [CombatSystem.ts:103](file:///C:/projects/i-be-zombie/src/systems/CombatSystem.ts#L103) | `Effects` ([Effects.ts:421](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L421)), `AudioSystem` ([AudioSystem.ts:152](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L152)), `HUD` ([HUD.ts:641](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L641)) |
| `conversionQueued` | [CombatSystem.ts:107](file:///C:/projects/i-be-zombie/src/systems/CombatSystem.ts#L107) | `Effects` ([Effects.ts:440](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L440)) |
| `converted` | [ConversionSystem.ts:32](file:///C:/projects/i-be-zombie/src/systems/ConversionSystem.ts#L32) | `Effects` ([Effects.ts:443](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L443)), `AudioSystem` ([AudioSystem.ts:156](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L156)), `HUD` ([HUD.ts:649](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L649)) |
| `gateDamaged` | [CombatSystem.ts:115](file:///C:/projects/i-be-zombie/src/systems/CombatSystem.ts#L115) | `Effects` ([Effects.ts:449](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L449)), `AudioSystem` ([AudioSystem.ts:159](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L159)), `HUD` ([HUD.ts:654](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L654)) |
| `gateDestroyed` | [CombatSystem.ts:121](file:///C:/projects/i-be-zombie/src/systems/CombatSystem.ts#L121) | `Effects` ([Effects.ts:452](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L452)), `AudioSystem` ([AudioSystem.ts:164](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L164)), `HUD` ([HUD.ts:657](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L657)), `Game` ([Game.ts:199](file:///C:/projects/i-be-zombie/src/core/Game.ts#L199)) |
| `structureDamaged` | [StructureSystem.ts:24](file:///C:/projects/i-be-zombie/src/systems/StructureSystem.ts#L24) | `Effects` ([Effects.ts:424](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L424)), `AudioSystem` ([AudioSystem.ts:171](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L171)), `HUD` ([HUD.ts:661](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L661)) |
| `structureDestroyed` | [StructureSystem.ts:39](file:///C:/projects/i-be-zombie/src/systems/StructureSystem.ts#L39) | `Effects` ([Effects.ts:427](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L427)), `AudioSystem` ([AudioSystem.ts:176](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L176)), `HUD` ([HUD.ts:666](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L666)), `Game` ([Game.ts:199](file:///C:/projects/i-be-zombie/src/core/Game.ts#L199)) |
| `released` | [StructureSystem.ts:41](file:///C:/projects/i-be-zombie/src/systems/StructureSystem.ts#L41) | `Effects` ([Effects.ts:436](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L436)), `AudioSystem` ([AudioSystem.ts:183](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L183)), `HUD` ([HUD.ts:670](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L670)) |
| `momentumGain` | [MomentumSystem.ts:46](file:///C:/projects/i-be-zombie/src/systems/MomentumSystem.ts#L46) | `HUD` ([HUD.ts:674](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L674)) |
| `momentumTier` | [MomentumSystem.ts:51, 64](file:///C:/projects/i-be-zombie/src/systems/MomentumSystem.ts#L51) | `AudioSystem` ([AudioSystem.ts:186](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L186)), `HUD` ([HUD.ts:677](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L677)) |
| `guardAlert` | [HumanAISystem.ts:196, 203](file:///C:/projects/i-be-zombie/src/systems/HumanAISystem.ts#L196) | `Effects` ([Effects.ts:456](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L456)), `AudioSystem` ([AudioSystem.ts:191](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L191)), `HUD` ([HUD.ts:681](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L681)) |
| `capReached` | [HordeSystem.ts:58](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L58), [ConversionSystem.ts:18](file:///C:/projects/i-be-zombie/src/systems/ConversionSystem.ts#L18) | `Effects` ([Effects.ts:458](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L458)), `AudioSystem` ([AudioSystem.ts:194](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L194)), `HUD` ([HUD.ts:690](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L690)) |
| `victory` / `defeat` | [VictorySystem.ts:10](file:///C:/projects/i-be-zombie/src/systems/VictorySystem.ts#L10), [CombatSystem.ts:51](file:///C:/projects/i-be-zombie/src/systems/CombatSystem.ts#L51) | `Effects` ([Effects.ts:460](file:///C:/projects/i-be-zombie/src/visuals/Effects.ts#L460)), `AudioSystem` ([AudioSystem.ts:197-200](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L197-L200)), `HUD` ([HUD.ts:693](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L693)) |

- **100% of the 24 `GameEvent` variants** have both a sim emitter and at least one consumer.

### B. Enum Coverage Across HUD, Audio, and Landmarks

- **`StructureKind` (`'busDoor' | 'alleyGate' | 'storeDoor' | 'penGate'`):**
  - Handled exhaustively in `HUD.structureHudLabel` & `HUD.structureBarTitle` ([HUD.ts:32-53](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L32-L53)), `AudioSystem.playStructureDamaged` & `playStructureDestroyed` ([AudioSystem.ts:392-446](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L392-L446)), and `Landmarks` (`buildBusDoor`, `buildAlleyGate`, `buildStoreFront`, `buildPenGate` in [Landmarks.ts:515-522](file:///C:/projects/i-be-zombie/src/world/Landmarks.ts#L515-L522)).
  - *Gap:* `HUD.chooseObjectiveText` ([HUD.ts:765-787](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L765-L787)) checks `busDoor`, `penGate`, and `storeDoor`, but omits `alleyGate` (see Finding #5).
- **`LandmarkKind` (`'bus' | 'alley' | 'store' | 'barricade'`):**
  - All 4 handled in [Landmarks.ts:189-243, 515-522](file:///C:/projects/i-be-zombie/src/world/Landmarks.ts#L189-L243).
- **`HumanRole` (`'soldier' | 'civilian'`):**
  - Handled in `HUD` (`guardAlert` / `guardDied` branches in [HUD.ts:641-647, 681-688](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L641-L647) and guard counter filter `g.post === 'checkpoint'` at [HUD.ts:512](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L512)), `AudioSystem` (`playGuardAlert(ev.role)` and `playGuardDied(ev.role)` at [AudioSystem.ts:152, 191, 314-322, 463-482](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L152)), and `EntityRenderer` (`selectGuardLook` civilian outfits & unarmed pose at [EntityRenderer.ts:182-183, 211-225, 290-291](file:///C:/projects/i-be-zombie/src/visuals/EntityRenderer.ts#L211-L225)).
- **`MomentumTier` (`0 | 1 | 2`):**
  - Handled in `MomentumSystem` ([MomentumSystem.ts:16-20](file:///C:/projects/i-be-zombie/src/systems/MomentumSystem.ts#L16-L20)), `HUD` (`MOMENTUM_TIER_LABELS` and `.tier-0`/`.tier-1`/`.tier-2` classes at [HUD.ts:26-30, 562-611](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L26-L30)), and `AudioSystem.playMomentumTier` ([AudioSystem.ts:448-461](file:///C:/projects/i-be-zombie/src/audio/AudioSystem.ts#L448-L461)).

### C. `Landmarks` Geometry Derivation & Cleanup (`dispose()` / `restart()`)

- **Layout derivation:** `Landmarks` derives all positions and dimensions from `layout.structures`, `layout.colliders`, `layout.buildings`, and `layout.props` without literal world coordinates or hardcoded structure IDs ([Landmarks.ts:144-273, 513-577](file:///C:/projects/i-be-zombie/src/world/Landmarks.ts#L144-L273)). However, `Game.ts` and `Landmarks.ts` couple on hardcoded collider tag prefixes (`'pen-fence-'`, `'alley-wall-n'`, `'bus-shell-'`, `'store-wall-'`) to prevent `CheckpointVisual` from rendering compound walls over the police pen and locked alley (see Finding #2).
- **`Game.dispose()` & `restart()` cleanup:**
  - `Game.dispose()` ([Game.ts:150-166](file:///C:/projects/i-be-zombie/src/core/Game.ts#L150-L166)) disposes `input`, `hud`, `audio`, `city`, `checkpoint`, `landmarks`, `hordeRenderer`, `entityRenderer`, `effects`, and `renderer`, and removes the `resize` listener.
  - `Game.restart()` ([Game.ts:168-188](file:///C:/projects/i-be-zombie/src/core/Game.ts#L168-L188)) resets `effects`, `hud`, `checkpoint`, `landmarks` highlight/occluders, and re-runs `syncVisuals(0, 0)`. One edge defect exists in `Landmarks.update` across restarts/rebuilds and in `Effects.reset()` (see Findings #1 and #4).

---

## 4. Docs Drift (`AGENTS.md` & `README.md` vs Code & HUD)

### A. `AGENTS.md` Drift
1. **Directory table ([AGENTS.md:61-65](file:///C:/projects/i-be-zombie/AGENTS.md#L61-L65)):**
   - Missing `src/core/cameraMath.ts [pure]`.
   - Line 64 still states `createInitialState.ts` creates `(leader, 60 ambient, 8 guards, gate)` — actual state is `5` starting followers, `85` ambient zombies (45 held + 40 free), `16` humans (8 checkpoint soldiers, 2 barricade soldiers, 2 street civilians, 4 store civilians), `gate`, `4` breakable structures, and `momentum`.
2. **Tower defeat mechanic ([AGENTS.md:78-81](file:///C:/projects/i-be-zombie/AGENTS.md#L78-L81)):**
   - `AGENTS.md` states zombies defeat tower guards from the ground via an attack proxy (`attackRange + guard.radius + towerMeleeReachBonus`) clawing the tower legs. In code, [HordeSystem.ts:518-526](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L518-L526) and [CombatSystem.ts:133](file:///C:/projects/i-be-zombie/src/systems/CombatSystem.ts#L133) require zombies to physically **climb** the tower (`towerClimbSpeed`, `towerMaxClimbers`, `attackerElevation >= g.elevation - 0.25`) before dealing melee damage.
3. **Instanced body part names ([AGENTS.md:88](file:///C:/projects/i-be-zombie/AGENTS.md#L88)):**
   - `AGENTS.md` lists `upperArmL/R`; [LowPolyCharacters.ts:47-56](file:///C:/projects/i-be-zombie/src/visuals/LowPolyCharacters.ts#L47-L56) uses `armL` and `armR`.
4. **`Simulation.step` order ([AGENTS.md:116-129](file:///C:/projects/i-be-zombie/AGENTS.md#L116-L129)):**
   - Matches [src/sim/Simulation.ts:39-84](file:///C:/projects/i-be-zombie/src/sim/Simulation.ts#L39-L84) (steps 1 through 11, including 9b `updateStructures` then `updateMomentum`).

### B. `README.md` Drift ([README.md:1-179](file:///C:/projects/i-be-zombie/README.md#L1-L179))
1. **Missing Recruitment Overhaul Features:** `README.md` does not mention the **5 starting followers**, **cascading recruitment pulses** (generations 1–3), **Outbreak Momentum** (0–100 meter, tiers, up to +50% recruit radius / +20% speed), **4 destructible landmarks** (Abandoned Bus, Locked Alley, Convenience Store, Police Barricade), or **civilians vs barricade soldiers**.
2. **Controls Table vs HUD Help Text ([README.md:36-49](file:///C:/projects/i-be-zombie/README.md#L36-L49) vs [HUD.ts:357-368](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L357-L368) & [InputController.ts:94-112](file:///C:/projects/i-be-zombie/src/core/InputController.ts#L94-L112)):**
   - `README.md` omits `Z / X` (Rotate Camera), `Hold V` (Look Back), `Left-Drag` (Orbit Camera), and right-click on destructible structures (Bus, Alley Gate, Storefront, Police Pen).
   - Conversely, `HUD.ts` help overlay ([HUD.ts:357-368](file:///C:/projects/i-be-zombie/src/ui/HUD.ts#L357-L368)) omits `Z / X` and `Hold V` even though `InputController.ts` implements them.
3. **Contradictory Design Claims in `README.md`:**
   - [README.md:166](file:///C:/projects/i-be-zombie/README.md#L166) claims *"No horde splitting: all followers share one order."* In code, [HordeSystem.ts:83-214](file:///C:/projects/i-be-zombie/src/systems/HordeSystem.ts#L83-L214) splits followers across `state.squads` when multiple attack orders are issued, and `Effects` renders `extraOrderMarkers` ([Game.ts:352](file:///C:/projects/i-be-zombie/src/core/Game.ts#L352)).
   - [README.md:28, 95, 167](file:///C:/projects/i-be-zombie/README.md#L28) claims walkers *"do not climb"* towers and attack from ground level; in code they climb (`'climb'` anim, `z.elevation`).
4. **Outdated Architecture & Balance Numbers in `README.md`:**
   - [README.md:58-86](file:///C:/projects/i-be-zombie/README.md#L58-L86) omits step `9b` (`updateStructures`, `updateMomentum`) and omits `StructureSystem.ts`, `MomentumSystem.ts`, `Landmarks.ts`, and `cameraMath.ts`.
   - [README.md:108, 146](file:///C:/projects/i-be-zombie/README.md#L108) states `60` ambient zombies across `6` spawn zones (actual is `85` across `8` spawn zones + `5` start followers).

---

## 5. Ranked Findings

```text
[P2] src/world/Landmarks.ts:442-484 — Landmarks.update() does not restore breakable door/gate rotations or intact glass materials when Game.restart() resets structures to intact
  Scenario: Player damages the Convenience Store door (cracking/hiding glass panes) or destroys any landmark door (rotating pivot by ±1.42 rad and hiding glass), then presses R (or clicks Play Again) to call Game.restart().
  Evidence: Verified at src/world/Landmarks.ts:442-490 and src/core/Game.ts:168-188. When s.destroyed is true, Landmarks.update() mutates entry.doorPivot.rotation.x/y (lines 442-450) and sets g.visible = false on glass panes (line 451), and when damaged sets g.material = this.glassCrackedMat (line 482). When Game.restart() creates a fresh GameState where s.destroyed === false and s.hp === s.maxHp, the else branch at lines 473-490 resets entry.fallProgress = 0 and entry.burstTriggered = false, and only resets doorPivot.position.x / rotation.z in resetBreakableOffsets (lines 422-427), never restoring doorPivot.rotation.x = 0, doorPivot.rotation.y = 0, g.visible = true, or g.material = this.glassIntactMat.
  Suggested fix: In Landmarks.resetBreakableOffsets (src/world/Landmarks.ts:422-427) or the intact branch (lines 473-489), reset entry.doorPivot.rotation.set(0, 0, 0) and restore each pane in entry.glassPanes to visible = true and material = this.glassIntactMat when ratio >= 0.999.
```

```text
[P2] src/core/Game.ts:80-84 — CheckpointVisual and Landmarks rely on hardcoded collider tag strings ('pen-fence-', 'alley-wall-n') to avoid duplicate wall geometry
  Scenario: If a landmark collider tag in districtLayout.ts is renamed or a new walled landmark is added with kind: 'wall' and height >= 2.0, CheckpointVisual automatically renders beige compound walls and concertina wire on top of it unless Game.ts manually filters its tag out.
  Evidence: Verified at src/world/Checkpoint.ts:297 (which treats every layout collider with c.kind === 'wall' && c.height >= 2.0 as a checkpoint perimeter wall) and src/core/Game.ts:80-84 (which passes colliders: layout.colliders.filter(c => !(c.tag?.startsWith('pen-fence-') || c.tag === 'alley-wall-n')) to CheckpointVisual).
  Suggested fix: In src/world/Checkpoint.ts:297, restrict perimeter wall generation to colliders within the checkpoint compound bounds (or tags starting with 'compound-wall'), and remove the hardcoded tag filter in src/core/Game.ts:82.
```

```text
[P2] README.md:21-169 — README.md is out of sync with the R0–R3 recruitment overhaul, controls, and horde mechanics
  Scenario: A user or evaluator reading README.md gets outdated instructions and architecture descriptions (no mention of landmarks, momentum, cascades, or starting horde; false claims that followers cannot split or climb towers; missing camera keys).
  Evidence: Verified across README.md:24-28 (opening/towers), 36-49 (controls table), 58-86 (step order and directory table), 108 & 146 (60 ambient across 6 zones vs 85 across 8 zones), and 166-167 ("No horde splitting" and "do not climb").
  Suggested fix: Update README.md in R4d to document the 5 starting followers, cascading recruitment, 4 destructible landmarks, Outbreak Momentum, Z/X/V/Left-drag camera controls, multi-squad targeting, tower climbing, and new modules.
```

```text
[P3] src/visuals/Effects.ts:729-754 — Effects.reset() does not hide extraOrderMarkers
  Scenario: When multiple squad attack orders are active and Effects.reset() is called, extraOrderMarkers remain visible unless overwritten by a subsequent setExtraOrderMarkers([]) call.
  Evidence: Verified at src/visuals/Effects.ts:729-754 (reset() sets this.orderMarkerGroup.visible = false at line 752, but never loops over this.extraOrderMarkers to set visible = false).
  Suggested fix: Add `for (const m of this.extraOrderMarkers) m.visible = false;` inside `Effects.reset()` at src/visuals/Effects.ts:753.
```

```text
[P3] src/ui/HUD.ts:765-787 — HUD.chooseObjectiveText omits the 'alleyGate' structure kind from contextual objective prompts
  Scenario: If the player breaks the bus door, police pen gate, and storefront door while leaving the Locked Alley (20 trapped zombies) intact, the HUD objective skips straight to "BREACH THE CHECKPOINT GATE" without ever hinting about the locked alley.
  Evidence: Verified at src/ui/HUD.ts:765-787 (`chooseObjectiveText` checks `busDoor`, `penGate`, and `storeDoor`, but never checks `s.kind === 'alleyGate'`).
  Suggested fix: Add an `alleyGate` check in `HUD.chooseObjectiveText` (e.g., `'SMASH THE LOCKED ALLEY GATE TO FREE THE HORDE'`) before falling through to the checkpoint gate prompt.
```

```text
[P3] src/systems/StructureSystem.ts:23-24 — damageStructure emits both a generic 'damage' event and 'structureDamaged' for the same hit
  Scenario: Every melee hit on a structure emits two damage events, forcing AudioSystem and Effects to scan the entire frame's event array (`!events.some(e => e.type === 'structureDamaged')`) on every structure damage event to suppress duplicate audio/sparks.
  Evidence: Verified at src/systems/StructureSystem.ts:23-24, src/audio/AudioSystem.ts:141-143, and src/visuals/Effects.ts:388.
  Suggested fix: Either remove the redundant `type: 'damage'` emission for structures in `StructureSystem.ts:23` (mirroring gate damage, which only emits `gateDamaged` at `CombatSystem.ts:115`) or keep the filter documented if tests assert on `damage`.
```

---

## 6. Looked At, Found Nothing

- **Pure/3D boundary & imports:** Checked all files under `src/sim/`, `src/systems/`, `src/entities/`, `src/world/{districtLayout,CollisionWorld,NavigationGrid}.ts`, `src/utils/`, and `tests/` — zero `three` imports, zero DOM access, and zero `Math.random()` calls in `[pure]` modules.
- **Contract immutability:** Checked `git status` and `git diff` on `src/core/types.ts`, `src/core/contracts.ts`, `src/config/balance.ts`, and `package.json` — untouched by R1/R2/R3 workers.
- **Sim-to-Visual event exhaustiveness:** Cross-checked all 24 `GameEvent` union members in `src/core/types.ts` against every `ctx.emit(...)` call in `src/systems/` and every `switch (ev.type)` in `Effects.ts`, `AudioSystem.ts`, `HUD.ts`, `EntityRenderer.ts`, and `Game.ts` — every variant is both emitted and consumed.
- **Pick proxy raycasting & target resolution:** Checked `Landmarks.getPickProxies()` -> `Game.refreshPickables()` -> `InputController` raycast -> `TargetRef { kind: 'structure', id }` -> `CombatSystem.resolveTarget` / `NavigationSystem.resolveEffectiveTarget` — intact structures are pickable, destroyed structures set `proxy.visible = false` (`Landmarks.ts:439`), and `InputController.raycastTarget` skips invisible proxies (`InputController.ts:269`).
- **NavGrid & occluder sync on structure/gate destruction:** Verified `StructureSystem.damageStructure` and `CombatSystem.damageGate` both disable the collider and rebuild `navGrid` + `crawlNavGrid` exactly once on transition to `destroyed = true`, and `Game.stepFixed` triggers `updateGateOccluder()` on `gateDestroyed` and `structureDestroyed`.
