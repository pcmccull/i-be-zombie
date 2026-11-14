# T010 Report (claude, failover resume from agy)

**Task ID & Agent:** T010 / claude-worker
**Status:** COMPLETED (manual render check not done: no browser run; no render tests exist)

## Completed Work
- Decision: KEPT agy's partial edits in CityDistrict.ts, Landmarks.ts, Checkpoint.ts. Review showed they implement the brief (chunked build, house/civic/mall/warehouse looks, district ground tints, stationDoor/securityShutter visuals, stronghold beacons, generalized Checkpoint). The only defect was a corrupted identifier: `interfaceChunkGeomBuckets` (missing space) in Landmarks.ts, fixed with sed. No restore from HEAD needed.
- Created src/world/NestMarkers.ts (mound + pulsing glow, dim until active; start nest (strongholdId null) always active, others when matching state.strongholds[].captured; equip-radius ring when leader within BALANCE.nest.equipRadius of an active nest; chunk-hidden).
- Chunk hiding is automatic: Landmarks, CheckpointVisual and NestMarkers subscribe via `onLayoutChunksChanged(layout, cb)` (exported from CityDistrict.ts), which fires on each load/unload from `updateStreaming`. Manual `setChunkVisible/syncVisibleChunks` also exist.

## Remaining Work
- T014 wiring in Game.ts; manual visual check (see below).

## Public Interfaces/Exports Added (for T014)
- `new CityDistrict(scene: THREE.Object3D, layout)` (also `new CityDistrict(layout)`; adds `.group` to scene). Calls updateStreaming(layout.playerStart) in ctor.
  - `updateStreaming(focus: Vec2): { loaded; drawCalls }` per frame with leader pos (call FIRST, before the others' update, so visibility is synced; listeners fire inside it)
  - `loadedChunkIds`, `setOccluderFade(hits, dt)`, `update(dt, time)`, `occluders`, `dispose()`
  - exports `getLoadedChunksForLayout(layout)`, `onLayoutChunksChanged(layout, cb)`
- `new Landmarks(layout)`: `.group` (add to scene yourself), `.pickMeshes`, `.shellOccluders`, `update(state, dt, time)` (reads state.strongholds for beacons), `syncOccluders`, `setOccluderFade`, `setHighlight`, `getPickMesh(id)`, `pickMeshFor(kind)`, `reset()`, `dispose()`, `setChunkVisible/syncVisibleChunks`.
- `new CheckpointVisual(layout)`: `update(gate, dt, time)`, `setGateHighlight(on)`, `dispose()`, chunk sync as above. Uses layout.checkpoint wherever it is.
- `new NestMarkers(scene: THREE.Object3D | null, layout)`: `.group`, `update(state, layout, dt)`, `dispose()`, `syncVisibleChunks`.
- Suggested per-frame order: `city.updateStreaming(leader.pos)` -> `city.update` -> `landmarks.update` -> `checkpoint.update` -> `nests.update`.

## Verification Run
- `npx tsc --noEmit`: pass.
- `npm run build`: pass.
- `npx vitest run`: 371/371 tests pass; only failure is `tests/_scratch.test.ts` (another worker's scratch file, load error, not in scope). One earlier run showed 11 failures (timeouts under concurrent load); not reproduced.
- Manual check to do: run dev server, walk from suburbs start toward other districts; confirm chunks load/unload (loaded <= 12), landmarks/nests vanish with their chunks, mall shutter/station door damage stages, beacon turns green on capture, nest ring appears within 8 m of an active nest.

## Memory Notes
- agy output can contain missing-space corruption in identifiers (`interfaceX`); grep for `interface[A-Z]` after failover.
- Visual modules get chunk visibility through `onLayoutChunksChanged(layout, cb)` keyed by layout in CityDistrict.ts, so Game only needs to call `city.updateStreaming`.
