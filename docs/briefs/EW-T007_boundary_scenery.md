# EW-T007 — Boundary scenery, backdrop, new props (agy-worker)

Read first: `AGENTS.md`, `.agent-context/ARCHITECTURE.md` (§EW-0…EW-5, esp. §EW-4 art contract), `.agent-context/MEMORY.md`,
`.agent-context/PROGRESS.md`, `docs/5_expand_world.md` §3, upstream reports `.agent-context/reports/EW-T002-codex.md`,
`EW-T003-codex.md`, `EW-T004-agy-worker.md`. Data sources: `layout.boundaries`, `layout.backdrop`, `layout.props`,
`layout.districts[].archetype` (see `src/world/boundaryLayout.ts`, `src/world/layout/archetypes.ts`).

## Locked files (edit ONLY these)
- NEW `src/world/BoundaryScenery.ts`
- `src/world/CityDistrict.ts`, `src/world/TropicalScenery.ts`, `src/world/tropicalLayout.ts`
- `tests/intro.test.ts` (only if a world-geometry assumption moved); NEW `tests/tropicalLayout.test.ts` optional

Never edit types/contracts/balance/content, layout files, `Game.ts` (EW-T010 wires your class), or any file owned by
EW-T008 (`src/visuals/**`, `src/core/visionMath.ts`) or EW-T009 (`src/ui/**`, `src/audio/**`). Those run in parallel.
CityDistrict.ts is CRLF — preserve line endings.

## Implement
1. `BoundaryScenery` ([3D]): `export class BoundaryScenery { constructor(scene: THREE.Scene, layout: DistrictLayout);
   update(time: number): void; dispose(): void; readonly root: THREE.Group }`. Render-only, never pickable, not in
   occluders, `fog: true`.
   - Band dressing per `BoundaryKind` from each segment's polyline + `scenerySeed`:
     - deep_water: seawall + water
     - urban_fence: chain-link panels + posts
     - vehicle_blockade: wrecks/buses
     - concrete_debris: slabs + rebar
     - shipping_containers: stacked containers in palette colours
     - military_perimeter: walls + razor-wire zigzag + watchtowers
     - mangrove_barrier: cone/sphere trees
     - collapsed_bridge: tilted deck slabs

     Seeded variation so long runs don't repeat. Dressing must visibly cover every boundary collider (`layout.colliders`
     with `kind === 'boundary'`), height ≈ collider height.
   - Backdrop rects: ocean/bay large planes (reuse the TropicalScenery ocean look/material if practical), skyline instanced
     low-detail boxes, mangrove cones, highway deck + broken spans, airfield flat + a few hangars.
   - InstancedMesh per prop type; ≤ 30 draw calls total for band + backdrop; no shadows cast (may receive in the band).
2. `CityDistrict.ts`:
   - Render the new PropKinds (`container, jerseyBarrier, chainFence, watchtower, tent, palm, wreck`) instanced like the
     existing props.
   - Archetype building looks: tall glassy offices for downtown, hotel towers for resort, hangars for airport, etc.
     Tint/roof variation only; stay low-poly.
   - Remove the dark skirt under the old world edge.
   - Ground colours for all 16 districts.
   - Chunk streaming over the 99 chunks (11 × 9 of 80 m) must still work.
3. `TropicalScenery.ts` / `tropicalLayout.ts`:
   - Beach + ocean along the whole south edge (x −420..420), bay water along the east edge.
   - Palms/umbrellas over the new southern districts (boardwalk, hotels).
   - Ambient traffic lanes stay on real roads.
   - Keep `tests/intro.test.ts` green (camera path / cue assumptions).

## Verify
`npx tsc --noEmit`, `npm test`, `npm run build`. A browser check is optional: BoundaryScenery isn't wired until EW-T010,
and you must NOT commit a Game.ts change. Report the draw-call count per part (estimate from mesh count).

## Done when
tsc + full tests + build pass. Write `.agent-context/reports/EW-T007-agy-worker.md` (AGENTS.md format, include the exact
public API for T010 wiring) and append Memory Notes to `.agent-context/MEMORY.md`.
