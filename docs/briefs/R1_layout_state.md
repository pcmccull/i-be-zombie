# Brief R1 — Layout & state scaffolding (agent: agy, mode accept-edits)

Read first: `AGENTS.md` (conventions + "Recruitment, structures & momentum"), `docs/2_intial_recruitment_design.md`
(§1 opening, §3 landmarks, §4 distribution), `src/core/types.ts`, `src/config/balance.ts`, `src/core/contracts.ts`.
The contract files are already updated — **do not edit** `src/core/types.ts`, `src/core/contracts.ts`,
`src/config/balance.ts`, `package.json`, `AGENTS.md`.

## Files you may edit

- `src/world/districtLayout.ts` (main work)
- `src/entities/Zombie.ts`, `src/entities/HumanGuard.ts`, `src/entities/Structure.ts`
- `src/sim/createInitialState.ts`
- Compile shims ONLY (smallest change that type-checks, marked `// R2:` comment) in
  `src/systems/CombatSystem.ts`, `src/systems/HordeSystem.ts`, `src/systems/HumanAISystem.ts`,
  `src/systems/NavigationSystem.ts`, `src/systems/VictorySystem.ts`, and any `src/visuals|ui|core|world|audio` file that
  stops compiling because of the new union members (e.g. `TargetRef` `'structure'`, `ColliderKind` `'breakable'`,
  new `GameEvent` variants). Shims must be behaviour-neutral (e.g. `case 'structure': return false;`). Real logic is R2/R3.
- Tests: `tests/layout.test.ts` and any existing test broken by the new initial state.

## 1. districtLayout.ts — the authored opening (coordinates are targets; adjust ≤ 2 m if needed for clearance)

Keep `playerStart` (-85, 62). Set `playerStartFacing` so the leader faces the bus (≈ 2.6 rad).
`startFollowerArea = rect(-90, 57, -80, 67)` (must be walkable / free of blocking colliders).

### Landmarks → `structures: StructureDef[]` (ids 1..4) + their colliders

Every structure: exactly one `ColliderDef { kind:'breakable', blocksMove:true, blocksSight:true, tag, height }` whose AABB
equals `StructureDef.rect`. `approachOutside` ≥ 3 walkable points ~1.2 m outside the outer face; `approachInside` ≥ 2
walkable points ~1 m inside. `enclosure` = the interior free area. Shell walls are ordinary colliders (not breakable).
Do **not** add `BuildingDef`s for the hollow shells (CityDistrict would draw solid blocks); R3 draws them in `world/Landmarks.ts`
from `structures` (+ you may add non-blocking `PropDef`s for dressing).

1. **Abandoned bus** (id 1, kind `busDoor`, landmark `bus`, defensive false), on the south street, visible from start.
   Shell footprint x -72..-60, z 29..33; side/end walls 0.4 m thick, `kind:'vehicle'`, height 3.2 (NOT crawlable:
   > `crawlMaxHeight`), blocksSight true, tags `bus-shell-*`. Door = breakable on the +Z side (faces the park): x -67..-64.5,
   z 32.6..33, height 2.6, facing 0, tag `bus-door`. Enclosure ≈ x -71.6..-60.4, z 29.4..32.6.
2. **Locked alley** (id 2, kind `alleyGate`, landmark `alley`, defensive false): the 4 m gap between `ec-bldg-3`
   (48..68, 0..17) and `ec-bldg-4` (72..94). Change `ec-bldg-4` minZ to 0 so the alley sides are sealed; add a wall
   (kind 'wall', height 3, tag `alley-wall-n`) across the north end at z -0.5..0.5, x 68..72. Gate = breakable on the south end
   x 68..72, z 17.4..18, height 2.8, facing 0 (+Z toward the south street), tag `alley-gate`. Enclosure ≈ x 68.4..71.6, z 0.6..17.2.
3. **Convenience store** (id 3, kind `storeDoor`, landmark `store`, defensive true): split `se-bldg-1` (48..70, 42..58) into a
   solid building x 58..70 (keep tag `se-bldg-1`) and a hollow store x 48..57, z 42..52 with 0.5 m walls, `kind:'building'`,
   height 5, blocksSight true, tags `store-wall-*`. Door = breakable in the north (-Z, street-facing) wall x 51..54, z 42..42.5,
   height 2.6, facing π, tag `store-door`. Enclosure ≈ x 48.5..56.5, z 42.5..51.5.
4. **Police barricade + holding pen** (id 4, kind `penGate`, landmark `barricade`, defensive true) on the south street near x 8..24.
   Roadblock: 3–4 `barrier` props across the road around x 20 with gaps ≥ 2 m (crawlable, horde can also path around).
   Pen: chain-link fence colliders (`kind:'wall'`, height 2.2, blocksSight **false**, tags `pen-fence-*`) around x 8..16, z 33..37,
   pen gate = breakable on the west side x 8..8.4, z 34..36.4, height 2.2, facing -π/2, tag `pen-gate` (set `blocksSight:false`
   is NOT allowed — breakables block sight; keep it true, it's a solid riot door). Enclosure ≈ x 8.4..15.6, z 33.4..36.6.
   A police car / truck prop or two for storytelling is welcome (keep lanes ≥ 3 m).

### Spawn zones (sum must equal `BALANCE.horde.initialAmbient` = 85; layout clusters per recruitment spec §4)

| name | rect (approx) | count | heldBy |
|---|---|---:|---|
| `park-edge` | -75..-58, 42..54 (keep) | 6 | – |
| `bus` | bus enclosure inset 0.4 | 15 | 1 |
| `parking-lot` | SC courtyard -16..6, 56..72 (rename `residential-south`; add 4–6 parked cars + parkingBay markings around its edges, not inside the zone rect) | 12 | – |
| `police-pen` | pen enclosure inset 0.4 | 10 | 4 |
| `alley` | alley enclosure inset 0.4 (replaces the old north service-alley zone) | 20 | 2 |
| `commercial` | keep | 8 | – |
| `residential-west` | keep | 6 | – |
| `east-lot` | keep | 8 | – |

Spawn sampling uses `collision.isBlocked(p, 0.45)`; make sure held zones are wide enough (interior minus 0.45 m margin > 0).

### Humans (`guards`)

Keep the 8 checkpoint guards exactly as they are (`post:'checkpoint'`, role soldier; 2 tower). Add:
- 2 **street civilians** (`role:'civilian'`, `post:'street'`) ~18–25 m from start, e.g. patrol (-74,47)↔(-64,49) and
  (-70,52)↔(-62,44); `homeArea` ≈ rect(-82, 41, -56, 58). Must be visible from start (first encounter within 10 s).
- 2 **barricade soldiers** (`role:'soldier'`, `post:'barricade'`) behind the roadblock near (23, 27) and (23, 33), facing west
  (-π/2), stationary waypoints `[pos]`.
- 4 **store civilians** (`role:'civilian'`, `post:'store'`, `shelter: 3`, `homeArea` = store enclosure) inside the store.

## 2. Entities / initial state

- `createZombie`: new fields `heldBy` (opt, default 0), `recruitGen` (-1 ambient/rising; 0 for start followers),
  `pulseAt: -1`, `recruitFlash: 0`. Allow `state: 'follower'` in opts for start followers.
- `createGuard(id, spawn, collision)`: `role` (default soldier), `post` (default checkpoint), `homeArea ?? null`,
  `shelter ?? 0`. Civilians use `BALANCE.civilian.maxHp`/`radius`.
- `createStructures(layout, collision): StructureState[]` in `Structure.ts` (collider via `findByTag(def.tag)`; hp from
  `BALANCE.structures[def.kind].maxHp`; throw if the collider is missing).
- `createInitialState`: spawn `BALANCE.horde.startFollowers` followers at distinct non-blocked points in
  `layout.startFollowerArea` (state follower, recruitGen 0, pulseAt -1, spawnZone -1, anim idle); held zones set `heldBy`;
  `followerCount = startFollowers`; `stats.recruited` stays 0; `cascadeRecruits: 0, structuresDestroyed: 0`;
  `structures`; `momentum = { value:0, idleTime:0, tier:'dormant', gainFlash:0 }`. Keep RNG call order deterministic.
  The ambient-count check stays (`=== initialAmbient`, ambient only, not start followers).

## 3. Tests

- `tests/layout.test.ts`: update for the new layout and ADD checks: zone counts sum to 85; held zone ids reference existing
  structures; each structure has exactly one matching breakable collider; all approach points + startFollowerArea centre walkable
  on a `NavigationGrid`; with **all** structures disabled + nav rebuilt, every enclosure centre is reachable from `playerStart`;
  with structures **enabled**, bus/alley/pen enclosure centres are NOT reachable; checkpoint post count === `BALANCE.guard.count`
  with exactly 2 tower; bus door within 45 m of start; street civilians within 30 m of start; existing reachability tests
  (start → staging area / gate approach) still pass.
- Fix any other existing test broken by: 5 start followers, 85 ambient, new humans. **Do not weaken assertions**: adapt
  fixtures (e.g. compute expectations from BALANCE, or explicitly remove start followers in a test's setup and fix
  `followerCount`) and keep each test's intent. No `.skip`.

## Done when

`npx tsc --noEmit` and `npm test` both pass. Report: files changed, any coordinate deviations, any contract gaps you hit
(do NOT edit contract files — report instead).
