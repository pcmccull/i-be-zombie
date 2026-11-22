# EW-T009 — Sense indicators, eyesight panel, map gating, cue audio

- **Task ID & Agent:** EW-T009, agy-worker
- **Status:** COMPLETED (locked-file scope; full-suite `tsc --noEmit` and `npm test` have failures in other owners' files — see Verification Run)

## Completed Work
- **NEW `src/ui/SenseIndicators.ts`:** Pooled DOM screen-edge directional arc layer (`BALANCE.senses.maxCues` nodes). Positions each active `state.vision.cues` entry on a viewport-edge ring using `cueScreenAngle(state.leader.pos, cue.pos, cameraYaw)` and `cueOpacity(cue.intensity, cue.age, cue.ttl)`, styled per kind (`gunshot`, `scream`, `siren`, `crowd` = scent). Never draws map dots or exact positions.
- **`src/ui/uiHelpers.ts`:** Added pure helpers `cueScreenAngle`, `cueOpacity`, `mapHumanVisibility` (uses `isIdentified`/`isSeen` from `AwarenessSystem`), `threatPipCount`, and `eyesightPanelView` (uses `visionCost` from `ProgressionSystem`). Added `visionUpgraded` toast (`"Eyes adjust — <Tier Name>"`) and `maxVision` deny text (`"Eyesight already at max"`).
- **`src/ui/NestPanel.ts`:** Added `onBuyVision(cb)` and an "EYESIGHT" section showing current tier name, clear radius, detected capabilities, next tier cost (disabled/greyed when unaffordable), or `"MAX"` at tier 4. Opens at active nests when a vision upgrade is in progress or `biomass > 0`, even before any ability slot is owned.
- **`src/ui/HUD.ts`:** Additive changes only (preserved existing uncommitted mouse-capture hint removal): added `onBuyVision(cb)` forwarding to `NestPanel`, `get senseRoot()` mount point for `SenseIndicators`, district-entered banner with 5 threat-tier pips + `threat` text from `content/districts.ts`, and one-time session-scoped humorous tips for `Rotten Eyes` and first affordable eyesight upgrade.
- **`src/ui/mapRender.ts` & `src/ui/WorldMap.ts`:** `drawDynamicLayer` now renders `state.vision.cues` as soft radial-gradient blurs (never precise dots) and gates `state.guards` via `mapHumanVisibility` (identified = full dot, seen = grey dot, unidentified/stronghold defenders/reinforcements = hidden). Added legend line in `WorldMap.ts`.
- **`src/ui/hudOpenWorld.css`:** Added styles for `.ibz-sense-layer`/`.ibz-sense-arc`, `.ibz-district-banner`/`.ibz-threat-pip`, and `.ibz-nest-vision`/`.ibz-nest-vision-max`.
- **`src/audio/AudioSystem.ts`:** Added `playSenseCue(kind, pan, gain)` with per-kind cooldowns, `StereoPannerNode` panning, distance-attenuated gain, and synthesized cue audio per `SenseKind`. Extended `consume(events, state?, cameraYaw = 0)` to play fresh `senseCue` events and `visionUpgraded` chimes.
- **`tests/uiHelpers.test.ts`:** Added 6 unit tests covering `cueScreenAngle` (front/right/left/behind at yaw 0 and PI/2), `cueOpacity`, `mapHumanVisibility`, `threatPipCount`, `eyesightPanelView`, and `visionUpgraded`/`maxVision` toasts.

## Remaining Work
- None within EW-T009's locked file scope. Wiring into `Game.ts` belongs to EW-T010.

## Public Interfaces/Exports Added
- `src/ui/SenseIndicators.ts`:
  - `export class SenseIndicators { readonly element: HTMLDivElement; constructor(root: HTMLElement); update(state: GameState, cameraYaw: number, dt: number): void; dispose(): void }`
- `src/ui/uiHelpers.ts`:
  - `export function cueScreenAngle(leaderPos: Vec2, cuePos: Vec2, cameraYaw: number): number`
  - `export function cueOpacity(intensity: number, age: number, ttl: number): number`
  - `export type MapHumanVisibility = 'identified' | 'seen' | 'none'`
  - `export function mapHumanVisibility(state: GameState, guard: GuardAgent): MapHumanVisibility`
  - `export function threatPipCount(tier: ThreatTier): number`
  - `export interface EyesightPanelView { tier: VisionTier; name: string; clearRadius: number; detects: string[]; nextTierName: string | null; nextCost: number | null; affordable: boolean }`
  - `export function eyesightPanelView(state: GameState): EyesightPanelView`
- `src/ui/NestPanel.ts`:
  - `onBuyVision(cb: () => void): void`
- `src/ui/HUD.ts`:
  - `onBuyVision(cb: () => void): void`
  - `get senseRoot(): HTMLElement`
- `src/audio/AudioSystem.ts`:
  - `consume(events: readonly GameEvent[], state?: GameState, cameraYaw?: number): void`
  - `playSenseCue(kind: SenseKind, pan: number, gain: number): void`

## Required Game / EW-T010 Wiring
1. **Eyesight purchase:** Wire `this.hud.onBuyVision(() => { this.pendingBuyVision = true; })` and pass `buyVision` into `SimInput` for a single step (mirroring `onBuySlot` / `pendingBuySlot`).
2. **SenseIndicators:** Instantiate `this.senseIndicators = new SenseIndicators(this.hud.senseRoot)` (or `#hud` root), call `this.senseIndicators.update(this.sim.state, this.camera.yaw, dt)` each frame (or hide during cinematic), and call `this.senseIndicators.dispose()` in `Game.dispose()`.
3. **Cue Audio:** Pass camera yaw into `this.audio.consume(events, this.sim.state, this.camera.yaw)` (or call `this.audio.playSenseCue(kind, pan, gain)` directly).

## Verification Run
- `npx vitest run tests/uiHelpers.test.ts`: **PASS**, 1 file / 19 tests (13 existing + 6 new).
- `npx vite build`: **PASS**, production bundle built (`dist/`).
- `npx tsc --noEmit`: **FAIL (exit 1)** — 0 errors in EW-T009 files; 3 errors in parallel EW-T008's `src/visuals/VisionFog.ts`:
  - `src/visuals/VisionFog.ts(96,7): error TS2322: Type '0' is not assignable to type '1.2'.`
  - `src/visuals/VisionFog.ts(100,5): error TS2322: Type 'number' is not assignable to type '1.2'.`
  - `src/visuals/VisionFog.ts(143,14): error TS2339: Property 'fog' does not exist on type 'Material'.`
- `npm test`: **FAIL (exit 1)** — 47 files passed / 6 failed; 568 passed / 8 failed (576 total), plus 1 Vitest RPC timeout (`Timeout calling "onTaskUpdate"`). No failures in `tests/uiHelpers.test.ts`. Failures in other owners' files / concurrent load timeouts:
  - `tests/horde.test.ts`: 600-step perf `< 3000 ms`
  - `tests/navigation.test.ts`: incremental navigation rebuild test
  - `tests/navScale.test.ts` (2): bounded flow average `40.65 ms` vs `< 25`, `findPath` median `159.94 ms` vs `< 150`
  - `tests/opening.test.ts` (2): 30s timeout and R2 stress `4088 ms` vs `< 3000`
  - `tests/rush.test.ts`: 5s timeout
  - `tests/touristChatter.test.ts`: `TypeError: rand is not a function` at `src/audio/touristChatter.ts:50`

## Memory Notes
- **[EW-T009 UI/Senses/Audio]** `cueScreenAngle(leaderPos, cuePos, cameraYaw)` follows `forward=(sin y, cos y)`, `right=(-cos y, sin y)` so `0` = front/top, `+PI/2` = right, `-PI/2` = left, `+-PI` = behind, and `Math.sin(angle)` gives stereo pan `[-1, 1]`. `NestPanel` opens when `hasLoadout || (vision.nextCost !== null && (biomass > 0 || vision.tier > 1))` so tier 2+ eyesight can be bought at the start nest before any ability slot is owned, without covering the t=0 intro/tracker at 0 biomass. `HUD` exposes `onBuyVision(cb)` and `get senseRoot()` for `SenseIndicators`. `AudioSystem.consume(events, state?, cameraYaw = 0)` keeps backward compatibility and plays panned/attenuated fresh `senseCue` sounds via `playSenseCue(kind, pan, gain)`.
