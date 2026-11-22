# EW-T002 — World expansion

- **Task ID & Agent:** EW-T002, codex
- **Status:** COMPLETED

## Completed Work

- `src/world/districtLayout.ts`: replaced `buildExpansionPlaceholders` with the real expansion builders. Original road/builders run first with their unchanged shared RNG; expansion runs afterward. `buildWorldBoundaries(world, seed)` remains the last build step.
- `src/world/layout/grid.ts` (new): district/play-area cell math, stable per-district seed hashing, expansion road descriptors, shared-edge crossing locations and rectangle overlap helper. `districtCellRect` remains re-exported from `districtLayout.ts`.
- `src/world/layout/roads.ts`: appended north/west/east streets over the full play area, sidewalks, lane dashes, crosswalks and street furniture. New horizontal road surfaces abut the vertical surfaces at junctions instead of overlapping them; this also preserves the original nine overlapping traffic-intersection patches expected by the unchanged intro test. New markings never intrude into the original world rectangle.
- `src/world/layout/archetypes.ts` (new): separately seeded blocks for all 12 expansion archetypes, with appropriate building styles/heights, grounds, props, parked vehicles, free ambient zones, street civilians, police patrols and additional soldier patrols in high-tier districts. Generated blocks have road setbacks and open seam corridors; a road-free block is reserved for each stronghold.
- `src/world/layout/expansion.ts` (new): 12 hollow, breachable strongholds; objective metadata/order preserved from STRONGHOLDS; structure ids 100–111; tiered defenders (3/5 police, 4 police + 2 soldiers, 8 soldiers, 11 soldiers); prerequisite hold points for tier 3+; exterior nests; two separated, walkable, concealed road reinforcement points each. High/low shared borders have nonblocking warning signs, jersey barriers, floodlights and watchtower props on the high-tier side. New watchtowers are dressing only; the original checkpoint retains the only tower guards.
- `tests/world.test.ts`: reinforcement road/LOS assertions restored for all 16 strongholds; population-budget assertions cover every district; marking/collider budgets updated; heavy checks have 60-second timeouts. Replaced its approximate flood-fill test with the stronger navigation test in the new file.
- `tests/expansion.test.ts` (new): grid tiling/order, mixed-tier adjacency, metadata/objective realization, unique doors, defender composition, archetype content, danger cues, population caps, seed determinism and original-world fingerprints at seeds default/42/1234. Checks three clear crossings on all 24 shared edges. At seeds 1337 and 42, actual navigation flow-field distances verify every walkable play-area cell is reachable except sealed interiors; all interiors become reachable after disabling all doors and the gate. Long scans yield periodically.
- Original four builders, `common.ts`, legacy layout/tests, intro tests, contracts/config/content and other workers' files were not edited.
- Appended EW-T002 memory notes to `.agent-context/MEMORY.md`.

Default-seed geometry/population counts with EW-T003 boundary output present:

| Item | Count |
| --- | ---: |
| Buildings | 77 |
| Colliders | 307 (64 boundary colliders) |
| Humans | 287 / 420 cap |
| Ambient zombies | 325 / 400 cap (280 free + 45 held) |
| Structures | 18 (6 original + 12 expansion) |
| Strongholds / nests | 16 / 17 |
| Road patches / markings / props | 63 / 1013 / 799 |

## Remaining Work

None within EW-T002. Rendering of new PropKinds and boundary scenery remains the later EW visual task's scope.

## Public Interfaces/Exports Added

- `grid.ts`: `ORIGINAL_DISTRICTS` (ReadonlySet), `districtCellRect`, `cellPlayRect`, `districtSeed`, `RoadSegment`, `expansionRoads`, `seamCrossings`, `overlaps`.
- `roads.ts`: `buildExpansionRoads(world)`; original `buildRoads(world)` preserved.
- `archetypes.ts`: `expansionCenter(meta)`, `buildArchetype(world, meta, rng)`.
- `expansion.ts`: `buildExpansion(world, seed)`.
- No contract, dependency or gameplay-system interface changes.

## Verification Run

- `npx tsc --noEmit`: PASS, exit 0, no errors.
- `npm test`: PASS, exit 0; **48 files / 516 tests**, no failures/skips (136.02 s).
- Targeted world/expansion/intro run during implementation verified all new expansion checks and all 14 unchanged intro tests. Early failures (marking budget, intro road intersections, patrol-count assertion) were fixed before the successful full run.
- Original-content fingerprints matched the captured baseline at all three seeds: 1860041459 / 3175108591 / 1155541627.
- Full-suite open-world roam: 10 simulated minutes, 47.96 s wall; maximum 287 humans, 348 zombies and 34 followers; 8 route legs, 1 death.
- `git diff --check`: PASS. Other workers' changes were left intact.

## Memory Notes

- Keep expansion roads/content after the original four builders. Even inserting nonblocking props before them changes the original `prop-N` collider tags; independent RNG alone is insufficient to preserve original content.
- New north/east/west junction crosswalks must not extend back into the original rectangle. New horizontal carriageways abut vertical carriageways to avoid duplicate surfaces and preserve the unchanged intro's nine overlapping road-intersection patches.
- New structures are 100–111 in expansion STRONGHOLDS order. The generator selects concealed reinforcement candidates against completed city geometry; it does not rely on the first road point being hidden.
- Whole-world connectivity tests use actual flow-field distances and check only playArea, keeping the boundary worker's band independent. Tests yield during cell scans and have 60-second timeouts.

## Follow-up

- **Task ID & Agent:** EW-T002 follow-up, codex
- **Status:** COMPLETED

### Completed Work

- Modified `src/world/layout/archetypes.ts`, `tests/world.test.ts`, `tests/expansion.test.ts`, this report and the explicitly requested MEMORY append during this follow-up.
- Replaced one-building-per-block generation with per-archetype seeded lots distributed across street blocks. A block touching the compound no longer loses all its usable lots. Footprints have at least 4 m separation; roads/sidewalks, compound/nest approaches, spawn rectangles and patrol routes stay clear. Service strips reserve space for existing parked vehicles.
- Added distinct style/height/palette profiles: 26 downtown buildings (24 offices at 20-45 m plus 2 civic), 22 nightlife storefront/apartments, 14 coastal-prioritized apartment hotels at 18-30 m, 16 campus civic/offices around an empty quad, 12 hospital/garage buildings, 18 arts storefront/lofts, 14 small boardwalk shacks, 10 marina boathouses/offices, 14 estate houses and fairways, 8 airport terminal/hangars at 10-14 m with open apron space, 10 military HQ/barracks and 4 small park pavilions. Empty quad/apron/pond/fairway lots preserve neighbourhood identity.
- Expansion humans total 12/16/20/24/30 by tier; civilians 9/9/8/4/3, patrols 0/2/6/12/16. Tier 5 has two eight-soldier street squads. Compound defenders in `expansion.ts` remain 3/5/6/8/11 with the prescribed police/soldier mix. Original districts retain their original populations.
- Retained separate RNG streams, roads, structure ids 100-111, reinforcement rules and original-world fingerprints (1860041459 / 3175108591 / 1155541627).
- Added minimum-density and tier-population tests at seeds 1337/42/1234/0/4294967295; footprint/street/band clearance and >=3 m neighbour gaps at three seeds; archetype height/style checks. Geometry caps are now 600 buildings / 4000 colliders. Existing closed/open navigation and boundary tests pass.

Default-seed counts (all districts included):

| District | Tier | Buildings | Props | Humans |
| --- | ---: | ---: | ---: | ---: |
| airport | 5 | 8 | 64 | 30 |
| golf_estates | 3 | 14 | 44 | 20 |
| university | 4 | 16 | 69 | 24 |
| luxury_marina | 2 | 10 | 44 | 16 |
| palm_park | 1 | 4 | 43 | 12 |
| financial_core | 5 | 26 | 86 | 30 |
| neon_nights | 2 | 22 | 39 | 16 |
| medical_center | 4 | 12 | 86 | 24 |
| military_base | 5 | 10 | 82 | 30 |
| police | 2 | 10 | 31 | 20 |
| industrial | 3 | 10 | 33 | 18 |
| arts_district | 1 | 18 | 38 | 12 |
| sunny_boardwalk | 1 | 14 | 41 | 12 |
| suburbs | 1 | 15 | 63 | 19 |
| shopping | 1 | 9 | 34 | 29 |
| oceanfront_hotels | 2 | 14 | 42 | 16 |
| **Total** | | **212** | **839** | **328** |

Whole-world totals: **434 colliders** (including 64 boundaries), **325 ambient** (280 free + 45 held), **18 structures**. Human means including the original districts: **16.8 / 17 / 19 / 24 / 30** at tiers 1-5; expansion-only means: **12 / 16 / 20 / 24 / 30**.

### Remaining Work

None. Concurrent animation failures were resolved by their owning worker before the successful final full-suite run. No animation, boundary, awareness, contract or other worker files were edited by this task.

### Public Interfaces/Exports Added

None; existing layout exports/contracts unchanged.

### Verification Run

- `npx tsc --noEmit`: PASS (exit 0).
- `npx vitest run tests/expansion.test.ts tests/world.test.ts tests/boundaries.test.ts`: PASS, 3 files / 45 tests, 0 failures/skips; includes the unchanged 2400-step boundary push and both full-navigation connectivity seeds.
- `git diff --check`: PASS.
- `npm test`: PASS, exit 0, **49 files / 539 tests**, **0 failures / 0 skips** (108.70 s). Includes unchanged intro and boundary tests, closed/open world connectivity, original fingerprints and all new density/tier/clearance checks.
- Full-suite 10-minute roam: 28.12 s wall, maximum 328 humans / 363 zombies / 40 followers, 9 route legs, 1 death.

### Memory Notes

- Density depends on subdividing usable blocks: rejecting a whole block on compound overlap discards most lots. Filter lots against reserved rectangles instead, preserving compound/nest approaches.
- Reserve a 10 m south service strip for vehicles; 2 m minimum per-lot building insets guarantee >=4 m between neighbours after seeded size variation. Road/sidewalk cuts remain unchanged.
- Population totals include compound defenders plus civilians and patrols. Tier 5: 11 compound soldiers + two eight-person patrol squads + 3 civilians = 30.
- New baseline: 212 buildings, 434 colliders, 328 humans, 325 ambient, 839 props; original fingerprints and stronghold identifiers unchanged.
