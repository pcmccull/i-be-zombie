# EW-T003 — Indestructible world boundaries (codex)

Read first: `AGENTS.md`, `.agent-context/ARCHITECTURE.md` (§EW-0…EW-5 at the top), `.agent-context/MEMORY.md`,
`.agent-context/PROGRESS.md`, `docs/5_expand_world.md` §3, upstream report `.agent-context/reports/EW-T001-orchestrator.md`.

## Locked files (edit ONLY these)
- `src/world/boundaryLayout.ts` (currently a stub)
- NEW `tests/boundaries.test.ts`

Never edit types/contracts/balance/content, `districtLayout.ts` or `src/world/layout/**` (EW-T002 is rebuilding them right
now in parallel: roads and districts may change under you — derive everything from the `world` argument, never from
literal coordinates of roads). Other workers also edit `src/systems/AwarenessSystem.ts` and tests vision/senses/world/
layout/expansion: failures there are not yours; report them.

## Contract (contracts.ts EW block)
`buildWorldBoundaries(world, seed): void` — called last in `buildDistrictLayout`. It must:
1. Split the playArea perimeter (`world.playArea`, inside `world.bounds`; band = `BALANCE.openWorld.boundaryBand` = 20 m)
   into `WorldBoundarySegment`s. Kind by side and by the adjacent district's `archetype` (`world.districts`, `cell`):
   - south (z = playArea.maxZ, ocean): `deep_water` (seawall + beach + ocean are drawn by EW-T007);
   - east (x = playArea.maxX, bay): `deep_water`, `shipping_containers` next to marina/industrial archetypes;
   - west (x = playArea.minX): `mangrove_barrier` (canals/storm debris), `military_perimeter` next to military/airport;
   - north (z = playArea.minZ): `concrete_debris`/`urban_fence` (highway collapse / quarantine), `military_perimeter` next
     to airport/military, `urban_fence` next to estates/campus/marina;
   - wherever a road ground patch (`world.ground`, kind 'road') touches the playArea edge: a short `collapsed_bridge`
     (north/west) or `vehicle_blockade` segment across the road end (derived from the ground patches at call time).
   Segment ids stable and unique (e.g. `south-0`), `points` = polyline along the band, `scenerySeed` from `seed` + index,
   `isWorldEdge: true, destructible: false, blocksPlayer/blocksNPCs/blocksVehicles: true`.
2. Push `kind: 'boundary'` colliders into `world.colliders` that **fill the band's full thickness** (playArea edge →
   bounds edge) along each segment, with overlap at segment joins and corners (no gaps at any point — corners covered
   twice is fine). Tag `boundary-<segmentId>-<n>`, listed in the segment's `colliderTags`. `blocksMove: true`; `height`
   and `blocksSight` by kind: deep_water 1.0/false (seawall: you can see the sea), urban_fence 3.0/false (chain-link),
   vehicle_blockade 1.8/true, concrete_debris 3.5/true, shipping_containers 5.2/true, military_perimeter 4.0/true,
   mangrove_barrier 5.0/true, collapsed_bridge 4.0/true. Keep the collider count modest (merge along straight runs;
   aim ≤ 120 boundary colliders).
3. Never add colliders inside `world.playArea`, never use `kind: 'breakable'`, never touch existing colliders/structures.
4. Fill `world.backdrop` with render-only rects outside `world.bounds`: south `ocean` (≥ 300 m deep), east `bay`,
   west `mangroves`, north `skyline` + `highway`, `airfield` beyond the airport's north/west corner. Rects must not
   intersect `bounds`.
5. Pure, deterministic for a seed, no `Math.random`.

## Tests (`tests/boundaries.test.ts`) — ARCHITECTURE §EW-5 #3
- Every perimeter sample (every 0.5 m along all four playArea edges, pushed 0.3 m outward) is inside a 'boundary'
  collider; corners covered; every 'boundary' collider is in some segment's `colliderTags`; all segments world-edge,
  non-destructible; colliders lie entirely outside playArea and inside bounds.
- No `StructureDef` rect / objective / guard / spawn zone / nest overlaps a boundary collider; no collider of kind
  'breakable' or 'gate' in the band.
- NavigationGrid built from the real layout (`new CollisionWorld(layout.bounds, layout.colliders)`): no walkable cell
  centre outside playArea.
- Pure-sim push test: `new Simulation(buildDistrictLayout(), seed)`; for each of the 4 edges and 4 corners, teleport the
  leader near it (≥ 5 m inside, walkable), script input toward the edge (sprint, camera-relative: cameraYaw 0 ⇒
  moveForward = dz, moveRight = −dx, see MEMORY [T012 Tests]) for ≥ 250 steps each (≥ 2000 total); leader, followers and
  one human placed next to the edge never leave playArea (pos within playArea ± radius). Yield with
  `await new Promise(r => setTimeout(r, 0))` periodically; timeout ≥ 60 s.
- Hand-made small fixture world (a few districts with archetypes, one road touching the north edge) to check kind
  selection and the road-end segment.
- Determinism (same seed ⇒ deep-equal), legacy layout untouched (`buildLegacyDistrictLayout().boundaries` is []).

## Done when
`npx tsc --noEmit` and `npm test` pass. Write `.agent-context/reports/EW-T003-codex.md` (AGENTS.md format; list segment
kinds per side and collider count) and append Memory Notes to `.agent-context/MEMORY.md`.
