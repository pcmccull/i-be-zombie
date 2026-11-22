# VP-T002 implementation report

**Task ID & Agent:** VP-T002 — codex

**Status:** COMPLETED

## Completed Work

- Created `src/graphics/vfx/vfxRules.ts`: pure emitter configuration table, sprite tile enum, complete event mapping, batch strike deduplication, source-stronghold unlock proximity check, cached 16 m surface buckets, particle admission/count helpers, visibility checks, and reusable budgeted footstep sampler.
- Created `src/graphics/vfx/EmitterPool.ts`: a dense, preallocated typed-array particle pool with swap removal; one normal-alpha and one additive instanced billboard mesh; a procedural 256 x 256 / 4 x 4 atlas; dynamic live-range instance uploads; size/color/opacity curves, spiral motion, drag/gravity, and bouncing debris. Materials and meshes opt out of vision haze, depth writes, fog and frustum culling. Node safely omits the atlas when there is no document/canvas.
- Created `src/graphics/vfx/VFXManager.ts`: exact VP-3 public API, surface-aware footsteps, event consumption, moving-follower charge trails, ambient leaves/insects/mist, per-preset caps and rates, reduced-motion counts/streaks/flash suppression, interpolated-leader visibility checks and cleanup.
- Updated `src/visuals/Effects.ts`: removed duplicate bursts for shots, hits, swings, recruitment/conversion, destruction/release, frenzy/rush, vehicle impacts, death and capture. Preserved tracers, muzzles, rings, arcs, swirls, alerts, pillars, markers, aura, shake requests, public API and pre-existing unrelated changes. Preserved CRLF: 0 bare LF characters.
- Created `tests/vfx.test.ts`: 50 pure tests covering the event table, companion-event deduplication in different orders, authoritative damage position, unlock proximity, budget admission, quality/reduced-motion scaling, surface lookup, interpolation, footstep eligibility/rate/cooldown/fairness and reusable scratch state. Tests import only the VFX rules and GraphicsQuality modules besides Vitest.

## Remaining Work

None within this task's locked scope. Game wiring belongs to VP-T006; browser/GPU visual verification belongs to the integration/playtest tasks. No Game, contract, balance, content, world, material, performance, character, MEMORY or PROGRESS files were edited by this task.

## Public Interfaces/Exports Added

`vfxRules.ts` and the `VFXManager.ts` type re-exports expose these exact names/shapes:

```ts
export type VfxName = 'zombie.footstep' | 'combat.swing' | 'combat.hit' | 'zombie.recruited'
  | 'horde.rally' | 'horde.charge' | 'defender.muzzle' | 'bullet.impact'
  | 'barricade.destroyed' | 'vehicle.explosion' | 'ability.unlock' | 'ambient.mote';
export type VfxSurface = 'asphalt' | 'sidewalk' | 'grass' | 'sand' | 'concrete' | 'wood' | 'metal' | 'cloth';
export interface VfxPayload {
  x: number; y?: number; z: number; dirX?: number; dirZ?: number;
  radius?: number; intensity?: number; surface?: VfxSurface;
  faction?: 'zombie' | 'human' | 'alpha' | 'structure'; color?: number;
}
export class VFXManager {
  constructor(scene: THREE.Scene, profile: QualityProfile, settings: GraphicsSettings);
  setWorld(layout: DistrictLayout): void;
  setQuality(profile: QualityProfile, settings: GraphicsSettings): void;
  emit(name: VfxName, p: VfxPayload): void;
  consume(events: readonly GameEvent[], state: GameState): void;
  update(dt: number, state: GameState, alpha: number, camera: THREE.Camera,
    focusX: number, focusZ: number, hiddenBeyond: number): void;
  reset(): void;
  dispose(): void;
  stats(): { live: number; capacity: number; drawCalls: number };
}
```

Additional pure exports: `EmitterConfig`, `EMITTERS: Record<VfxName, EmitterConfig>`, `VfxTile`, `MappedVfx`, `mapEvent`, `mapEvents`, `isUnlockNearby`, `surfaceAt`, `scaledCount`, `canSpawn`, `withinVision`, `footstepColor`, `FootstepCandidate`, `FootstepOptions`, `FootstepAccumulator`, `createFootstepAccumulator`, `pickFootsteps`, `PARTICLE_CAPACITY`, `UNLOCK_RADIUS`, `MAX_CHARGE_EMITTERS`. The renderer-side module exports `EmitterPool`.

- Physical simulation storage: **1280 particles total**, shared by both blend batches. Each blend mesh has room for any distribution of those particles.
- Live preset ceilings: **low 384 / medium 768 / high 1280**; over-budget bursts are dropped immediately, with no retry queue.
- Particle draw calls: **at most 2 total**; `stats().drawCalls` reports 0–2 populated batches. Existing Effects meshes are separate from these particle batches.
- Footstep particle ceilings: **10 / 22 / 40 per second**, radii **18 / 26 / 34 m**, individual stride cooldown at least **0.35 s**. Reduced motion halves the aggregate footstep rate as well as emitter counts. The reusable stride table has a fixed 2048 slots; hash collisions conservatively suppress a step.
- Ambient targets: **0 / 24 / 48**, halved for reduced motion. Charge: **at most 24 emitters per update interval**, including event-triggered emissions; continuous trails are also rate-limited.
- Explosion particle lifetime: **at most 2.5 seconds**. Reduced motion omits white flash tiles, applies `flashScale(settings)` to remaining flash-type sprites and slows/shortens streaks.

## Verification Run

- `npx tsc --noEmit` — **PASS**, exit 0, no diagnostics on the final implementation. An earlier concurrent integration snapshot briefly reported `src/core/Game.ts(340,7): getGraphics does not exist in PauseCallbacks`; this cleared without any out-of-scope edits by this task.
- `npm test` — **PASS**, final run: **61 files, 683 tests passed**, no skipped tests, exit 0; duration 138.56 s. Includes **50/50 VFX tests**. An earlier full run also passed 681/681 before the final two regression cases were added.
- `npm run build` — **PASS**, exit 0; TypeScript passed and Vite transformed 142 modules, built in 5.10 s. Vite emitted the existing advisory that the main minified chunk exceeds 500 kB.
- Inline Node smoke checks (TypeScript transpiled in memory, no files created, no canvas/WebGL) — **PASS**: shared cap/burst dropping, two batches, dynamic attribute upload ranges, expiration, quality recap, reset, idempotent disposal, remote standalone unlock suppression, single capture/unlock celebration, single melee/damage impact, 24-emitter charge cap, no reduced-motion flash tiles, and visibility culling before render submission.
- `git diff --check -- src/visuals/Effects.ts` — **PASS**. Byte-level line-ending check: **0 bare LF** in Effects. Pure-rule runtime-import check: **0 runtime imports**.

## Memory Notes

- Call `setWorld(layout)` on world setup, then `consume` for the frame's already vision-culled events and `update` before rendering. Always run `update` before rendering even if dt is 0: it refreshes billboard attributes and rechecks every live particle origin/current center against the current interpolated leader and vision limit. Event emissions use the latest known view limits; the update performs the final visibility check before upload.
- `setWorld` clears the pool and warms the immutable-layout surface cache. Surface lookup matches last-patch-wins ground ordering; the south sand strip follows `tropicalLayout`'s bounds-derived beach. Sidewalk/concrete footsteps are suppressed; grass emits small green leaf flecks.
- Damage events carry the actual impact position, while melee/bat events can carry attacker positions. Batch deduplication prefers damage, preserves repeated strikes, and independently pairs structure detail notifications to avoid triple bursts.
- Stronghold captures and standalone ability unlocks recover their source center from `layout.strongholds`; celebration requires it to be within 32 m of the leader. A capture plus its unlock produces one celebration.
- Switching reduced motion clears existing particles so a previously spawned white flash cannot survive the settings change. Pool reset/disposal are safe to repeat and leave 0 live particles.
- No GPU screenshot or shader-rendering claim is made here; those checks need the orchestrator's Game integration. The Node smoke checks exercise storage/lifecycle and uploaded attributes only.
