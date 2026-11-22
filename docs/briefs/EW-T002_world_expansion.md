# EW-T002 — 12 new districts as real content (codex)

Read first: `AGENTS.md`, `.agent-context/ARCHITECTURE.md` (§EW-0…EW-5 at the top), `.agent-context/MEMORY.md`,
`.agent-context/PROGRESS.md`, `docs/5_expand_world.md` §1–2, upstream report `.agent-context/reports/EW-T001-orchestrator.md`.

## Locked files (edit ONLY these)
- `src/world/districtLayout.ts`
- `src/world/layout/**` — `roads.ts`; NEW `grid.ts`, `archetypes.ts`, `expansion.ts`. The four original builders
  (`suburbs/police/shopping/industrial.ts`) and `common.ts` only for small additive changes (e.g. opening a seam crossing,
  a new helper in common.ts). Do NOT move or delete existing content of the original 4 districts.
- `tests/world.test.ts`, `tests/layout.test.ts`, NEW `tests/expansion.test.ts`

Never edit `src/core/types.ts`, `contracts.ts`, `config/balance.ts`, `src/content/**`, `src/world/boundaryLayout.ts`
(EW-T003 owns it; keep the existing `buildWorldBoundaries(world, seed)` call as the LAST step of `buildDistrictLayout`).
Other workers are editing `src/world/boundaryLayout.ts`, `tests/boundaries.test.ts`, `src/systems/AwarenessSystem.ts`,
`tests/{vision,senses}.test.ts` at the same time: if a failure comes from those, report it, don't fix it.

## Goal
Replace `buildExpansionPlaceholders` (districtLayout.ts) with real content for the 12 new districts in `content/districts.ts`
(grid cells, tiers, archetypes) and their strongholds in `content/strongholds.ts` (objective ids/kinds/labels in order).

1. **Determinism / no drift:** the original 4 districts must stay byte-identical except for intentional seam openings.
   Use a SEPARATE rng per new district (e.g. `mulberry32((seed ^ hash(districtId)) >>> 0)`) so the shared `rng` stream
   used by the original builders is unchanged. `tests/intro.test.ts` and all legacy tests must stay green untouched.
2. **Roads (`roads.ts`, `grid.ts`):** extend the road network over the 4 × 4 grid (playArea x[-400,400], z[-480,160]).
   New roads must never overlap existing colliders/buildings (original world spans x[-200,200], z[-160,160]; its N–S roads
   are x = −100, 0, 100 and E–W roads z = −80, 0, 80). Suggested: extend x = −100/0/100 north to z = −480; new N–S roads at
   x ≈ ±210 and ±310; new E–W roads at z ≈ −170, −240, −330, −400 and extend z = −80/0/80 west/east to x = ±400.
   Roads stop at the playArea edge (the band beyond belongs to EW-T003). Sidewalks + lane dashes + crosswalks like today.
   **≥ 3 walkable crossings on every shared district edge**, including the old world edges x = ±200 (z∈[-160,160]) and
   z = −160 (x∈[-200,200]) — open the original builders only where a wall/building actually blocks a crossing.
3. **Archetype generator (`archetypes.ts`):** seeded blocks between roads per archetype using the existing BuildingStyle set
   (`apartment, storefront, warehouse, office, garage, house, mall, civic`), GroundKinds (`road, sidewalk, park, plaza, lot,
   compound`) and PropKinds incl. the new `container, jerseyBarrier, chainFence, watchtower, tent, palm, wreck`.
   Flavour: airport = big lots (runway/apron) + warehouses (hangars) + civic terminal; estates = big houses + park fairways;
   campus = civic/office around a plaza quad; marina = lots + containers/props by the east edge; park = park + palms + ponds
   (lot); downtown = tall offices (20–40 m); nightlife = storefronts + signs; medical = civic + tents + jersey barriers;
   military = compound walls, watchtowers, sandbags, trucks; arts = storefront/apartment + debris; boardwalk = palms,
   benches, small storefronts near the south edge; resort = tall apartments (hotels) near the south/east edges.
   Use `building()`, `prop()`, `vehicle()`, `enclosure()`, `human()`, `streetPopulation()`, `district()` from common.ts.
4. **Strongholds (`expansion.ts`):** one per new district, objectives realized exactly in content order:
   `breach` = destroyStructure on a hollow `enclosure()` with a breakable door (**structure ids start at 100**, unique);
   `defenders` = killDefenders (humans with `strongholdId`, post 'stronghold'); `take_control` (tier ≥ 3) = holdPoint inside
   the enclosure, `requires: ['breach']`, walkable `point/radius`. Defenders by tier: t1 3 police, t2 5 police,
   t3 4 police + 2 soldiers, t4 8 soldiers, t5 10–12 soldiers (+ sandbags/watchtower props). No new tower mechanics
   (towers stay a checkpoint-only feature). `reinforcementPoints` ≥ 2: walkable, on a road patch, outside bounds, and
   sight-blocked from `playerStart`. Nest (via `stronghold()`) walkable and outside the enclosure.
5. **Population:** civilian/ambient budgets + free spawn zones per new district (lower civilians in tier 4–5, more soldiers);
   ≥ 4 walkable spawnPoints; a few street civilians and police patrols. Totals: living humans in `layout.guards` ≤
   `BALANCE.population.maxHumans` (420), ambient (free + held spawn-zone counts) ≤ `BALANCE.population.maxAmbient` (400).
6. **Danger cues:** at borders where a tier ≥ 4 district meets a tier ≤ 2 one, dress the high-tier side with
   jerseyBarrier/warningSign/floodlight/watchtower props (non-blocking or leaving every road crossing open).
7. **Tests:**
   - `tests/world.test.ts`: remove the `ORIGINAL_STRONGHOLDS` skip so the reinforcement road/sight checks hold for all 16;
     update geometry budgets (buildings/colliders/markings) to sensible new caps; budgets test covers all districts.
   - NEW `tests/expansion.test.ts`: ARCHITECTURE §EW-5 #1 (16 districts tile bounds, grid order, one StrongholdDef per
     STRONGHOLDS entry, every tier ≥ 4 district shares an edge with a tier ≤ 2 one, ids ≥ 100 unique, human/ambient caps)
     and #2 (nav connectivity: every walkable cell inside playArea reachable from playerStart except sealed stronghold
     interiors, which open after destroying all doors + the gate; ≥ 3 crossings per shared edge); determinism; original
     4 districts' content identical to a snapshot of `buildDistrictLayout()` filtered to the old world rect
     (compare against `git show HEAD:src/world/districtLayout.ts`-era expectations already in world/layout tests).
   - Whole-world nav tests are ~4.5× bigger than before: give heavy tests explicit timeouts (≥ 60 s) and yield
     (`await new Promise(r => setTimeout(r, 0))`) in long loops (MEMORY [T012 Tests]).

## Done when
`npx tsc --noEmit` and `npm test` pass (all files). Write `.agent-context/reports/EW-T002-codex.md` (AGENTS.md report format,
include geometry counts: buildings, colliders, humans, ambient, structures) and append Memory Notes to `.agent-context/MEMORY.md`.
