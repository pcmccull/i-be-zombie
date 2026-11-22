# EW-F1 — Fixes for EW-V1 / EW-V2 findings (orchestrator)

- **Task ID & Agent:** EW-F1 · Claude orchestrator
- **Status:** COMPLETED

## Completed Work
| Finding | Fix | Files |
|---|---|---|
| V2 P2-1 haze colour in wrong colour space (hazed geometry darker than sky) | `uHazeColor` stores raw sRGB components (`setHex(hex, LinearSRGBColorSpace)`), since the mix runs after `<colorspace_fragment>`. Already present in the working tree when F1 started (a concurrent session made the identical change); verified in browser: region past the limit is uniform haze matching the sky. | `src/visuals/VisionFog.ts` |
| V2 P2-2 dead target's successor could be an unidentified human | `nearestReachableGuard(ctx, origin, radius, allow?)` and `structureSuccessor(ctx, target, allow)` take a predicate; HordeSystem passes `targetable = !openWorld \|\| canTarget`. New test in `tests/hordeCommands.test.ts`. | `src/systems/HordeSystem.ts`, `src/systems/NavigationSystem.ts`, `tests/hordeCommands.test.ts` |
| V2 P2-3 order markers past the vision limit / on unidentified humans | `Game.markerFor` refuses unidentified-human targets (open world) and anything past `visionFog.hiddenBeyond`; Effects gained `setMarkerCull(x, z, limit)` used by the move-order marker. Browser: move marker visible at 10/30 m, hidden at 100 m (limit 51.5 m at tier 1). | `src/core/Game.ts`, `src/visuals/Effects.ts` |
| V2 P2-4 VisionFog retained every patched material | Records are a `Map` keyed by material and removed on the material's `dispose` event. | `src/visuals/VisionFog.ts` |
| V2 P2-5 sense arrows/audio used movement yaw (wrong while holding look-back) | `SenseIndicators.update` and `audio.consume` get `cameraRig.viewYaw`. | `src/core/Game.ts` |
| V1 P3 waypoint beacon not culled | Kept deliberately (the player's own navigation beacon, not world info); documented in AGENTS.md together with the marker culling rule. | `AGENTS.md` |
| V1 P3 README "all four strongholds" | No longer present in README (only the historical "Earlier: the open world" section mentions four districts). | — |
| V1 P2 §9 final change report | Delivered by EW-V3 (`reports/FINAL-VERIFICATION.md`). | — |
| V1 P2 no automated tests for client EW modules | Pure parts are tested (visionMath incl. vision limit, uiHelpers warning cues, senses, order gate). 3D/DOM parts verified by browser playtest (EW-T011 report + this report). | — |

## Remaining Work
None for EW. Note: a concurrent session ("Implement the docs/todos.md items") is editing many of the same files (HordeSystem, NavigationSystem, Effects, Game, EntityRenderer, Simulation, types, balance) in this same checkout; its work is not part of EW and is uncommitted.

## Public Interfaces/Exports Added
- `nearestReachableGuard(ctx, origin, radius, allow?)` (optional predicate)
- `Effects.setMarkerCull(x, z, limit)`

## Verification Run
- `npx tsc --noEmit` → 0 errors.
- `npx vitest run tests/hordeCommands.test.ts` → 25/25.
- Browser: haze/sky match past the limit; move-marker cull at 100 m.
- Full suite + build: EW-V3.

## Memory Notes
- Uniform colours mixed after `<colorspace_fragment>` must be in output space: `new Color().setHex(hex, LinearSRGBColorSpace)`.
- The game suspends on window blur (`game.suspended`); click the canvas before timing-dependent browser checks.
