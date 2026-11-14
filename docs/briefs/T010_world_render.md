# T010 — World rendering: chunk streaming, districts, strongholds, nests (agy)

Read first: `AGENTS.md` (Visual conventions), `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md`, report `T002-codex.md`,
`docs/3_open_world.md` §4A, §4G, §9, `src/core/types.ts` (DistrictLayout incl. `districts`, `strongholds`, `nests`; BuildingStyle `house`,
`mall`, `civic`; StructureKind `stationDoor`, `securityShutter`; LandmarkKind `station`, `mall`), `src/world/worldQueries.ts`
(`ChunkStreamer`, `chunkRect`, `chunkIdAt`), `src/world/districtLayout.ts`, and the current `src/world/{CityDistrict,Landmarks,Checkpoint}.ts`.

## Locked files
`src/world/CityDistrict.ts`, `src/world/Landmarks.ts`, `src/world/Checkpoint.ts`, `src/world/NestMarkers.ts` (new). Nothing else —
`src/core/Game.ts` is wired by T014 (another session is editing it right now): expose APIs, do not call them from Game.

## Deliver
1. **Chunked city:** `CityDistrict` builds static geometry (ground, markings, buildings, props) **per chunk** (assign each item to the chunk of
   its center; big items like the mall go to the chunk containing their center), merged per chunk per material, created lazily and disposed on
   unload. API: `constructor(scene, layout)`, `updateStreaming(focus: Vec2): { loaded: number; drawCalls: number }` (uses `ChunkStreamer`),
   `dispose()`, `get loadedChunkIds()`. Geometry/material disposal on unload so GPU memory stays bounded while roaming. Instanced meshes for
   repeated props (trees, streetlights, cars) per chunk. Keep occluder fading working for buildings in loaded chunks (camera occlusion uses
   `cameraMath.ts` — read only).
2. **District looks:** `house` (pitched roof, porch, yard fence colors), `civic` (columns/flat roof, flag pole), `mall` (big box, glass band,
   signage block with an original name), `warehouse`/loading docks; ground tints per district (suburbs greener, industrial darker concrete).
   No external assets, flat-shaded, palette from AGENTS.md.
3. **Strongholds:** `Landmarks` derives visuals from `layout.structures` / tagged colliders / `layout.strongholds` (never literal coordinates
   or ids — MEMORY rule): station doors, mall security shutter, existing bus/alley/store/pen; damage stages + destroy/release visuals for the two
   new kinds; a tall readable beacon/flag per stronghold that switches from human colors (orange/navy) to infected green when
   `state.strongholds[i].captured`. `Checkpoint` generalizes to "the gate compound" wherever `layout.checkpoint` is. Landmark meshes for
   unloaded chunks are hidden (`setChunkVisible(id, visible)` or equivalent driven by `CityDistrict.loadedChunkIds`).
4. **Nests:** `NestMarkers` (new): organic green mound + pulsing glow per `layout.nests`; dim/inactive look until active (start nest always
   active; others when their stronghold is captured — read `state.strongholds`), plus an equip-radius ring when the leader is within
   `nest.equipRadius`. API `update(state, layout, dt)`, `dispose()`.
5. Pick proxies for the new structures keep the existing pointer picking path working.
6. Self-check with `npx tsc --noEmit` and `npm run build`; there are no render tests — describe a manual check in the report.

## Done when
`npx tsc --noEmit`, `npm test` and `npm run build` pass. Report `.agent-context/reports/T010-agy.md` (AGENTS.md format), MEMORY notes.
