# EW-V2 — Codex read-only adversarial review (expanded world, boundaries, zombie vision)

**Task ID & Agent:** EW-V2 / codex (read-only review via `codex exec --sandbox read-only`; report written by the orchestrator wrapper because the read-only sandbox cannot write files)

**Status:** COMPLETED (review finished, no quota error; 0 P1, 5 P2, 0 P3 verified)

## Completed Work

Read-only adversarial review of the staged EW milestone diff plus the unstaged `src/core/Game.ts` vision edits (audio/tourist-voice edits ignored). No source, test, or doc files were modified. Codex's own run was read-only.

### Findings

**P1:** none verified.

**P2-1. Fully hazed geometry stays distinguishable from the sky.**
- `src/visuals/VisionFog.ts:57,229`: `uHazeColor` is a linear-RGB `THREE.Color`, but the haze is mixed after `<colorspace_fragment>`, so the colour is not converted to the output colour space.
- Failure: with sRGB output, fully hidden geometry renders about `#587364` while the background is `#9fb3a8`, so distant building outlines remain visible inside the haze.
- Fix: convert the haze colour to the output colour space before the mix (match Three.js fog/background handling), or mix before the colour-space chunk.

**P2-2. Automatic target succession bypasses the vision gate.**
- `src/systems/HordeSystem.ts:350-357`: when an ordered human dies, `nearestReachableGuard(ctx, origin, 25)` picks the next guard without a `canTarget` check.
- Failure (reproduced by Codex): Alpha at (0,0), identified target A at (16,0), unidentified B at (30,0). After A dies, the order switches to B and a follower reduces B's HP 30 to 22 while `canTarget(B)` is false.
- Fix: apply the same identification/targeting gate in `nearestReachableGuard` (or at the successor site) and in any other internally generated attack order.

**P2-3. Persistent markers bypass the vision limit and identification gate.**
- `src/core/Game.ts:865,877` and `src/visuals/Effects.ts:1048-1061`: filtering of consumed events via `effectEventsInSight` does not cover markers rebuilt directly from state.
- Failure: a move destination about 110 m away still shows a marker at tier 1 (limit about 51.52 m).
- `src/core/Game.ts:933-934`: attack markers are placed on unidentified humans' live positions without `canTarget`.
- Fix: distance-cull persistent markers every frame against the current vision radius, and only draw human attack markers for identified humans.

**P2-4. Streaming retains disposed materials indefinitely.**
- `src/visuals/VisionFog.ts:163`: `records` strongly holds every patched material until Game disposal. `CityDistrict.unloadChunk` disposes materials but never removes their records.
- Failure: repeated exploration/chunk reload grows `records` without bound (probe: 1,001 records retained after disposing replacement materials).
- Fix: remove the record on the material's `dispose` event (or use a `WeakMap`/`WeakRef`).

**P2-5. Warning arrows reverse during look-back.**
- `src/core/Game.ts:809`: `this.senseIndicators.update(state, this.cameraRig.yaw, dt)` passes movement yaw, but the camera renders with `viewYaw`.
- Failure: holding V gives yaw 0 and viewYaw pi. A sound behind the rendered camera still gets a top/front arrow.
- Fix: pass `this.cameraRig.viewYaw`.

### Checked and clean (per Codex)

- Boundary probes: 4,800 outward movement checks across edges and corners, including crawl passability and destroyed gates/structures. Both nav grids block exterior cell centres.
- `CollisionWorld.segmentBlocked` DDA matched a brute-force reference over 12,000 random segments (move and sight modes, height rule, ignoreIds).
- Incremental `NavigationGrid` raster and adjacency matched fresh grids after each of 19 destructible-collider removals, for both the normal and crawl grids.
- AwarenessSystem: 420 stable LOS candidates all identified within 9 updates; checks stayed at or below 48 per update; unchanged sets preserved `revision`.
- Save v3 fog remap matched every destination cell; default districts/strongholds and invalid `visionTier` sanitisation passed.
- ProgressionSystem: vision purchases spent exactly 200 biomass across tiers 2-4 and refused further upgrades.
- Repeated shader patching preserved `customProgramCacheKey`.
- By inspection only: cue angle convention, bounded SenseIndicators pooling, warning eviction order, NestPanel visibility conditions, district-banner CSS.

## Remaining Work

- Fix P2-1 to P2-5 above (all in the milestone's files: VisionFog.ts, HordeSystem.ts, Game.ts, Effects.ts). Not applied in this review; no edits made.
- Codex's findings on P2-2 and P2-5 were reproduced by probe; P2-1 was checked from the assembled shader text and Three.js colour-conversion code, not on a GPU. P2-3 and P2-4 were reproduced in memory. The orchestrator should confirm P2-1 visually in a browser.
- Vitest could not run in the Codex sandbox (EPERM writing temporary config/module files), so the full test suite was NOT verified by this review.

## Public Interfaces/Exports Added

None (read-only review).

## Verification Run

- `codex exec --sandbox read-only` with stdin from `/dev/null`: completed, exit 0, no quota/rate-limit errors. Transcript at `C:\Users\phil\AppData\Local\Temp\claude\124f360845b1ecd4\dc9e8d5e-a41c-43a6-b428-e73b4617edf2\scratchpad\ev2_out.txt`.
- `npx tsc --noEmit` (run by Codex): PASS.
- `npm test` (vitest): NOT RUN, environment-blocked (EPERM) inside the Codex sandbox.
- Orchestrator spot-check of cited lines: `src/systems/HordeSystem.ts:350-357` (successor selection with no targeting gate), `src/core/Game.ts:809` (`cameraRig.yaw` passed to SenseIndicators), `src/visuals/VisionFog.ts:57,163,229` (haze colour uniform, records array, patch site). All match the findings.
- Codex probes (esbuild bundled in memory, `write:false`): DDA differential 12,000 pass; incremental nav 19 + 19 pass; boundary 4,800 pass.

## Memory Notes

- Read-only Codex cannot write report files; the orchestrator writes them from Codex's output.
- Vision haze colour: uniform is linear RGB and must be converted to output colour space before the post-`colorspace_fragment` mix.
- Any system that picks an attack target internally (succession, auto-engage, markers) must go through the same identification gate as explicit orders.
- Camera-relative UI (SenseIndicators) must use `viewYaw` when the look-back key is held; `yaw` is movement yaw.
- Streaming materials: patched material records need removal on dispose to avoid unbounded growth.
