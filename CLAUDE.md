@AGENTS.md

## Orchestrator Role & Rules

You are the **Lead Orchestrator**. When given a design `.md` file:
1. **Plan First:** Decompose the spec into atomic tasks with non-overlapping file locks. Populate `.agent-context/ARCHITECTURE.md` and `.agent-context/PROGRESS.md` before dispatching work.
2. **Delegate by Specialty:**
   - **`@agy-worker`:** Multi-file scaffolding, boilerplate, data schemas, UI/HUD components, and spec completeness audits.
   - **`@codex-worker`:** Self-contained core logic, algorithms, state machines, math/physics, and adversarial bug reviews.
   - **`@claude-worker`:** Cross-module integration, glue code, test suite execution, build troubleshooting, and diff verification.
3. **Track & Sync Progress:**
   - Update `.agent-context/PROGRESS.md` status (`PENDING` -> `IN_PROGRESS` -> `VERIFIED`) as tasks progress.
   - After every subagent finishes, read its report in `.agent-context/reports/<TASK_ID>-<agent>.md`, verify `MEMORY.md` updates, check `git diff`, and pass relevant report paths to downstream subagents.
4. **Concurrency Guard:** Never run two write-enabled subagents on overlapping files at the same time.

## Quota & Credit Failover Policy

If any subagent returns `Status: QUOTA_EXHAUSTED`:
1. **Mark Provider Exhausted:** Note in `.agent-context/PROGRESS.md` that the exhausted agent is unavailable for the remainder of the session.
2. **Transfer Ownership & File Locks:** Reassign the same `TASK_ID` and `Locked Files` in `PROGRESS.md` to the next available fallback agent in this order:
   - `@agy-worker` exhausted $\rightarrow$ fail over to `@codex-worker` (or `@claude-worker` for pure UI/JSON scaffolding).
   - `@codex-worker` exhausted $\rightarrow$ fail over to `@claude-worker` (or `@agy-worker` if quota remains).
   - `@claude-worker` exhausted $\rightarrow$ fail over to `@codex-worker` or `@agy-worker`.
3. **Resume From Checkpoint:** Instruct the fallback subagent to read `.agent-context/reports/<TASK_ID>-<failed-agent>.md` first, preserve valid partial edits already in the workspace, complete the **Remaining Work** section, and write `.agent-context/reports/<TASK_ID>-<fallback-agent>.md`.

### Opening cinematic (docs/4_intro_scene.md) — task board in `.agent-context/PROGRESS.md`

- [x] **IN1–IN3** (orchestrator): flow states + input lock, CinematicController, tropical scenery, subtitles/skip/replay, intro audio, tests

### Zombie animation & visual polish (docs/6_zombie_movement.md)

- [x] **ZA1–ZA2** (orchestrator): pure gait/IK/animation controller + profiles, procedural atlas, articulated parts, horde + Alpha renderers, tests

### Sound effects (docs/7_soundeffects.md)

- [x] **SFX1** (orchestrator): `audio/sfxRules.ts` [pure] (clip specs, limiter, groan/scream gates) + `audio/SampleBank.ts` (decoded
      assets/soundeffects clips, positional gain/pan) wired into `AudioSystem` (replaced synth SFX removed); tests/sfxRules.test.ts

### Todos 10–12 (docs/todos.md)

- [x] **TD10–12**: sidewalk spawns (`world/layout/sidewalks.ts`), corner shops + healing drinks (`world/layout/shops.ts`,
      `systems/ShopSystem.ts`, `world/ShopScenery.ts`), recall hint, simulated traffic + rammers (`systems/TrafficSystem.ts`,
      `visuals/VehicleRenderer.ts`), citizen resistance + armed civilians (`systems/ResistanceSystem.ts`); tests/todos10to12.test.ts
- [x] **Car attacks**: `TargetRef { kind: 'vehicle' }` — zombies/Alpha claw cars (`damageVehicle`, driver grip `hp`), at 0 the
      driver is dragged out dazed; impacts + claws bog cars down (`bogTime`: speed loss, no accel, drag); clawed drivers panic: reverse out, then ram
      the nearby zombies (rammer passes) before fleeing; tests/carAttack.test.ts
- [x] **Traffic control** (orchestrator): `systems/trafficControl.ts` [pure] (merged lanes + junctions, lights / 4-way
      stops, no gridlock), lane following / wreck swerve / lane-end turns + U-turns, car-on-car accidents (`vehicleCrash`),
      vehicle models (hatchback, pickup, van, box truck, bus, police), `world/TrafficSignals.ts`, N/W/E ring road
      (`world/layout/ringRoad.ts`); tests/trafficControl.test.ts

### Nest traits

- [x] **Traits** (orchestrator): Running Speed + Attack Speed bought with biomass at a nest (`BALANCE.traits`, rising
      costs per level, `buyTrait` / `traitSpeedMultiplier` / `traitAttackRateMultiplier` in ProgressionSystem; Alpha + horde),
      save fields `speedLevel` / `attackLevel`, NestPanel rows; tests/traitProgression.test.ts

### Visual polish (docs/8_visual_polish.md) — task board in `.agent-context/PROGRESS.md`

- [x] **VP-T001–T006**: quality presets + reduced motion, surface detail + wind + facade kit, lighting, display-referred
      post, diagnostics + `?bench`, pooled VFXManager (codex), human archetypes + Alpha silhouette (agy), Game/PauseMenu wiring

### HUD redesign (docs/9_hud_redesign.md) — task board in `.agent-context/PROGRESS.md`

- [x] **HUD-T001–T004**: tokens + `--hz-u` scale (`hudTheme.css`), SVG icons (`hudIcons.ts`), pure view models (`hudModel.ts`,
      tests/hudModel.test.ts), rebuilt HUD + circular minimap + feedback layer (orchestrator), menus/panels/touch restyle (agy)

### Expanded world & zombie vision (docs/5_expand_world.md) — task board in `.agent-context/PROGRESS.md`

- [x] **EW-T001–T012**: 4 × 4 world + indestructible boundaries, nav/collision scale, AwarenessSystem + eyesight tiers (nest
      purchase, save v3), vision haze + hidden past the limit, gunshot/scream warning arrows, sense UI/audio, playtest, docs
- [x] **EW Phase 3**: V1 spec audit · V2 adversarial review · F1 fixes · V3 final verification

### Living city & expanded rewards (docs/11_cityupgrade.md) — task board in `.agent-context/PROGRESS.md`

- [x] **CU-T001–T005**: distinct staged events + props + responders + post-conquest pools (`CityActivityDirector`), generated
      trash cans/hydrants (`InteractableProps`), V priority + HUD/touch prompt, storm-drain shortcut, companion perks +
      accessories, controlled-district banners/graffiti, audio/VFX cues, city HUD strip + F3 lines; tests/cityEvents.test.ts.
      Gaps listed in reports/CU-T005-orchestrator.md

### Unique capture points & heavy defenses

- [x] **SH-1** (orchestrator): 12 hand-built expansion compounds (`world/layout/compounds.ts`: ranger yard, dune-fence
      corridor, mural alley, club back-alley, hotel pool switchback, container maze, gated drive, quarantine lanes, campus
      breezeways, bank-plaza canyon, airport apron + cargo tunnel, chicane-walled base), 3-3.5 m alleys; `HeavyWeapon`
      crews (`GuardSpawn/GuardAgent.heavy`): mounted MGs (bursts + reload, open-backed sandbags) at tier >= 3, tanks
      (hull collider via `towerColliderId`, splash cannon with min range + coax, wreck stays) at tier 5;
      `visuals/heavyWeaponModels.ts`, `shellBlast` VFX/audio/shake; tests/heavyDefenses.test.ts

### Horde Strength replaces Alpha health (docs/13_hode_health.md) — task board in `.agent-context/PROGRESS.md`

- [x] **HH-T001–T008**: Alpha HP removed (`LeaderState` omits hp/maxHp); `HordeHealthSystem` (derived strength, Alpha core,
      nearest-first shared damage, Last Brain Standing FSM), bullet interception by followers, sim wiring (respawn, drinks,
      convoy, speed, save `alphaCoreDamage`), Horde Strength HUD + Last Brain countdown, stagger/tether/aura VFX + heartbeat
      audio; tests/{hordeHealth,shielding,hordeStrength}.test.ts
