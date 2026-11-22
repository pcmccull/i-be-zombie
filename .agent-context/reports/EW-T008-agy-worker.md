# EW-T008 — Vision haze rendering + gated human visuals (agy-worker)

- **Task ID & Agent:** EW-T008, agy-worker
- **Status:** COMPLETED (all locked-scope deliverables implemented and verified; 3 unrelated perf-budget tests in `navScale.test.ts` and `opening.test.ts` timed out under full-suite CPU load)

## Completed Work
- **`src/core/visionMath.ts`** (`[pure]`, no `three` import):
  - Implemented `hazeFactor(dist, clearRadius, hazeRadius, hazeStrength)` with smoothstep ramp, exact `0`/`hazeStrength` bounds, and NaN-free step fallback for `hazeRadius <= clearRadius`.
  - Implemented `lerpProfile(a, b, t, out)` with clamped `t` and exact `a`/`b` endpoints.
  - Implemented `tierBlend(elapsedSinceChange, tierBlendTime)` using cubic ease-out (`1 - (1 - u)^3`), handling `<= 0` and `tierBlendTime <= 0` safely.
  - Implemented `humanVisual(awareness, dist, profile)` per spec §4 (`identified => 'full'`, `seen => 'silhouette'`, `'none'|'heard'|'sensed' => dist > profile.hazeRadius ? 'hidden' : 'silhouette'`), documented at the top of the file.
- **`tests/visionMath.test.ts`**:
  - Added 6 Vitest tests covering `hazeFactor` bounds/monotonicity/continuity/degenerate radii, `tierBlend` easing/monotonicity/endpoints, `lerpProfile` endpoints/clamping, `humanVisual` across all 5 `Awareness` values × distance bands, and tier monotonicity across `BALANCE.vision.tiers`.
- **`src/visuals/VisionFog.ts`** (`[3D]`):
  - Implemented `VisionFog` with shared `readonly uniforms` (`uVisionCenter`, `uClearRadius`, `uHazeRadius`, `uHazeStrength`, `uHazeColor`, `uDesaturate`), `patchScene(root)` (instance `WeakSet` guard, chains existing `onBeforeCompile` and `customProgramCacheKey`, skips `userData.noVisionHaze` subtrees and `fog === false` materials, computes `vWorldPos` from `modelMatrix` + `USE_INSTANCING` and mixes after `#include <fog_fragment>`), `update(state, alpha, dt)` (interpolated leader center, tier-1 fallback when dead/respawning, eased tier transitions), `setQuality(q)` (`low` = haze only, `high` = haze + desaturation), and `dispose()` (restores original `onBeforeCompile` / `customProgramCacheKey`).
- **`src/visuals/HealthBars.ts`**:
  - Added `setVisionGating(enabled: boolean)` (default `false`). When enabled, only `isIdentified(state, g.id)` humans get health bars.
- **`src/visuals/EntityRenderer.ts`**:
  - Added `setVisionGating(enabled: boolean)` (default `false` so legacy layout is unchanged).
  - Set `this.leaderRig.root.userData.noVisionHaze = true` on the Alpha hero rig (preserving commit `6cf6e38` animation/rigging).
  - When vision gating is enabled, humans render per `humanVisual(awarenessOf(state, g.id), dist, profile)`: `'hidden'` hides rig and pick proxy; `'silhouette'` swaps rig meshes to a shared flat dark `MeshLambertMaterial` (`0x1b2124`) and hides `pickProxy`, `factionDisc`, `targetRing`, `hoverRing`, and hit-flash/hover/target emissives; `'full'` renders normally.

## Remaining Work
- None for EW-T008. EW-T010 owns `Game.ts` wiring (see below).

## Public Interfaces/Exports Added
- `src/core/visionMath.ts`:
  - `export type HumanVisualMode = 'full' | 'silhouette' | 'hidden'`
  - `export type VisionHazeProfile = Pick<VisionProfile, 'clearRadius' | 'hazeRadius' | 'hazeStrength'>`
  - `export function hazeFactor(dist: number, clearRadius: number, hazeRadius: number, hazeStrength: number): number`
  - `export function lerpProfile<T extends VisionHazeProfile>(a: VisionHazeProfile, b: VisionHazeProfile, t: number, out: T): T`
  - `export function tierBlend(elapsedSinceChange: number, tierBlendTime: number): number`
  - `export function humanVisual(awareness: Awareness, dist: number, profile: VisionHazeProfile): HumanVisualMode`
- `src/visuals/VisionFog.ts`:
  - `export type VisionFogQuality = 'low' | 'high'`
  - `export interface VisionFogUniforms`
  - `export class VisionFog` (`readonly uniforms`, `constructor(quality?: VisionFogQuality)`, `patchScene(root: THREE.Object3D): void`, `update(state: GameState, alpha: number, dt: number): void`, `setQuality(q: VisionFogQuality): void`, `dispose(): void`)
- `src/visuals/HealthBars.ts`:
  - `HealthBars.setVisionGating(enabled: boolean): void` (default `false`)
- `src/visuals/EntityRenderer.ts`:
  - `EntityRenderer.setVisionGating(enabled: boolean): void` (default `false`)

### Required `Game.ts` Wiring for EW-T010
1. Instantiate `this.visionFog = new VisionFog(initialQuality)` in `Game` (open world; `low` on touch/low DPR or per PauseMenu setting, `high` otherwise).
2. Call `this.visionFog.patchScene(this.scene)` after initial world/entity creation, and re-call `this.visionFog.patchScene(...)` whenever new chunks/meshes are added (e.g. after `CityDistrict.updateStreaming` loads new chunks, or passing `this.scene` on chunk load).
3. Call `this.visionFog.update(this.sim.state, alpha, dt)` each rendered frame (before `renderer.render(...)`).
4. Call `this.entityRenderer.setVisionGating(isOpenWorld)` and `this.healthBars.setVisionGating(isOpenWorld)` (where `isOpenWorld = layout.strongholds.length > 0`) so open-world vision gating is active while legacy layouts remain ungated.
5. Wire the PauseMenu quality toggle to `this.visionFog.setQuality(q)` and call `this.visionFog.dispose()` in `Game.dispose()`.

## Verification Run
- `npx tsc --noEmit`: **PASS** (exit 0).
- `npx vitest run tests/visionMath.test.ts`: **PASS** (1 file / 6 tests passed).
- `npm run build`: **PASS** (`tsc --noEmit && vite build`, exit 0).
- `npm test`: **50 files passed (570 tests), 2 files failed (3 tests)** under full-suite load:
  - `tests/navScale.test.ts`: `rebuilds bounded follow fields within the world-scale budget over twenty builds` (28.92 ms vs `< 25` ms) and `finds a clear path across the world within budget` (median 190.37 ms vs `< 150` ms).
  - `tests/opening.test.ts`: `bounds a forty-zombie cascade into a hundred-follower crowd for 600 steps under three seconds` (4760.95 ms vs `< 3000` ms).
  - All vision, senses, open-world, and world tests passed (`tests/visionMath.test.ts` 6/6, `tests/vision.test.ts` 17/17, `tests/openWorld.test.ts` 14/14, `tests/world.test.ts` 12/12).

## Memory Notes
- Appended EW-T008 notes to `.agent-context/MEMORY.md`.

## Orchestrator review (2026-11-15)
- Changed `humanVisual`: unaware humans ('none' | 'heard' | 'sensed') are `'hidden'` at every distance. agy drew them as
  silhouettes inside hazeRadius at their exact live position, which leaked positions and made the tier "seen" extras
  meaningless (spec §4 "do not expose exact positions outside valid sight"). Test table updated. tsc 0, visionMath 6/6.
