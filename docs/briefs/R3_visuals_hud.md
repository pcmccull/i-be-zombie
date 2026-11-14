# Brief R3 — Visuals, HUD, audio, input wiring (agent: agy, mode accept-edits)

Read first: `AGENTS.md` (visual conventions + "Recruitment, structures & momentum"), `docs/2_intial_recruitment_design.md`
§2 "Visual feedback", §3, §5 "HUD", §7, `src/core/types.ts` (StructureState, MomentumState, new GameEvents, ZombieAgent
`recruitFlash`/`heldBy`, GuardAgent `role`/`post`). R1 (layout/state) and R2 (sim systems) are done: the simulation already
emits `recruited{generation}`, `recruitPulse`, `structureDamaged`, `structureDestroyed`, `released`, `momentumGain`,
`momentumTier`, and `guardDied{role}`; `state.structures`/`state.momentum` are live. Your job is to make it visible, audible,
clickable. Pure sim files are off-limits.

**Do not edit** contract files (`src/core/types.ts`, `src/core/contracts.ts`, `src/config/balance.ts`, `package.json`,
`AGENTS.md`), anything in `src/sim`, `src/systems`, `src/entities`, `src/world/districtLayout.ts`,
`src/world/CollisionWorld.ts`, `src/world/NavigationGrid.ts`, `src/utils`, or existing tests' assertions.
No new dependencies, no remote assets, low-poly flat-shaded primitives only, palette per AGENTS.md, no gore.

## Files you own

**new** `src/world/Landmarks.ts`; `src/visuals/Effects.ts`, `src/visuals/HordeRenderer.ts`, `src/visuals/EntityRenderer.ts`,
`src/visuals/LowPolyCharacters.ts`, `src/ui/HUD.ts`, `src/ui/hud.css`, `src/audio/AudioSystem.ts`, `src/core/Game.ts`,
`src/core/InputController.ts` (only if picking needs it), `src/world/CityDistrict.ts` (only to skip/dress around landmarks).

## 1. world/Landmarks.ts (new) — one class, built from `layout.structures` + their shell colliders

- **Bus**: long low-poly school/city bus (yellow-orange body, dark windows, wheels, flat roof) over the bus shell footprint;
  visible zombie silhouettes are fine to leave to HordeRenderer (roof may be omitted or semi-hidden so held zombies read as
  "inside" — e.g. windows open/low roof edge). Door panel mesh = the breakable: shakes on hit, dents/tilts as hp falls,
  on destroy it flies/falls outward (short ≤ 0.6 s tween, then debris on the ground). Thumping/rocking idle while held zombies
  remain inside (bus body sways slightly) to draw attention.
- **Locked alley**: chain-link/plank gate between the two buildings with hazard paint, padlock, a hand-painted "DON'T OPEN"
  style sign (just planks + a red X/stripes — no text rendering needed). Gate bends then collapses on destroy.
- **Convenience store**: hollow box with storefront glass (bluish transparent), awning, sign board, shelves inside, door panel
  breakable (glass cracks → shatters into a few shards). Must render interior visibly (camera sees civilians through glass).
  Wall meshes must line up with the `store-wall-*` colliders.
- **Police barricade + pen**: police car(s), striped barriers, chain-link pen fence (thin posts + semi-transparent mesh),
  riot-door pen gate (breakable), flashing red/blue light *materials* (emissive toggle, NOT real lights).
- Every breakable gets an invisible **pick proxy** (`userData.target = { kind:'structure', id }`), slightly enlarged like the
  gate's, cleared to `null` when destroyed. Expose `pickMeshes: THREE.Object3D[]`, `update(state, dt, time)`,
  `setHighlight(id|null)`, `dispose()`. Shared geometries/materials, merge static parts, ≤ ~25 draw calls total.
- Add shell meshes as camera-occlusion sources the same way Game.ts treats buildings/gate (see `gateOccluder`).

## 2. Recruitment feedback (§2 visual feedback)

- `recruited`: brief bright green-yellow flash on that zombie (HordeRenderer: use `z.recruitFlash` → instanceColor lerp)
  + small sparkle burst (pooled, existing Effects style). Generation ≥ 1 uses a slightly different hue so cascades read.
- `recruitPulse`: a flat expanding ring on the ground from `pos` to `radius` over ~0.45 s, fading; pooled (≥ 24 rings, reuse
  oldest); a ring with `recruits > 0` is brighter/thicker. No dynamic lights.
- `released`: dust puff at the structure + short camera shake request (light).
- `structureDamaged`: small sparks/splinters at pos (reuse the gate hit effect).
- Horde counter: number "pops" (scale bump + colour flash) on each increase, with a "+N" floater that aggregates recruits
  over ~0.5 s windows (so a cascade shows "+7" not seven separate pops).

## 3. Momentum HUD (§5)

Compact meter directly beside/under the horde counter: thin bar 0–100 with smooth CSS width transition, tier label
**DORMANT / GROWING OUTBREAK / FULL OUTBREAK** with tier colours (muted grey-green → zombie green → warning amber
`#ffb347` with subtle pulse at full), brief glow when `gainFlash > 0` or on `momentumGain`, tier-up toast-free (just the label
animating). Must not obscure the centre of the screen. Update help panel text with momentum + landmarks ("break the bus door
/ alley gate / store door / pen gate to free or reach whoever is inside"). Objective line: guide early play
("Free the bus horde" → "Break the police barricade" → "Raid the store" → existing checkpoint objectives), chosen from state
(followerCount, structures destroyed), never forcing anything.
Guard counter shows checkpoint guards only: `GUARDS alive/BALANCE.guard.count` counting `post === 'checkpoint'`.
Hover label: 'GUARD' for soldiers, 'CIVILIAN' for civilians, 'BUS DOOR' / 'ALLEY GATE' / 'STORE DOOR' / 'PEN GATE' for
structures. Structure HP bar: reuse the gate HP bar pattern (show when damaged or targeted; label by structure).

## 4. Characters

Civilians (`role 'civilian'`) look distinct from soldiers: no helmet/vest/rifle, casual clothes (varied shirt colours from a
small palette, no faction orange/navy), arms-up flee/cower pose when `state === 'RETREAT'`. Barricade soldiers = police look
(navy + light-blue, cap instead of helmet) with a pistol-size weapon. Reuse LowPolyCharacters builders; keep instancing/draw
calls reasonable.

## 5. Audio (synth, Web Audio, mute-safe)

`recruitPulse` (soft rising groan/whoosh, throttled ≥ 70 ms, pitch up with generation), `structureDestroyed` (crash/clang
variant per kind), `released` (crowd moan swell), `momentumTier` up (low drum hit), civilian scream on `guardAlert` for
civilians (short, throttled). Respect existing master gain / mute / unlock.

## 6. Game.ts wiring

Construct Landmarks, add to scene, include `landmarks.pickMeshes` in `pickables`, call `update` each frame, drive highlight
from hover/selection like the gate, markers for selected structures (reuse `markerFor` pattern), dispose properly. Forward new
events to Effects/Audio/HUD. Make sure `Game.dispose()` removes everything and restart (`R`) rebuilds landmark state cleanly.

## Done when

`npx tsc --noEmit`, `npm test`, `npm run build` pass. Then run the dev server headless-safe check is not required — the
orchestrator will play-test in a browser. Report files changed, draw-call estimate for Landmarks, and anything not done.

## 7. Audit fixes (must do)

- **Occluders vs picking:** `Game.ts` builds invisible `extraOccluders` for every `blocksSight` collider whose kind is not in
  `['building','wall','tower','gate']` — that wrongly catches `kind:'breakable'` (blocks picks on intact structures and keeps
  occluding after destruction). Exclude `'breakable'` there; landmark breakables are handled by Landmarks pick proxies, and a
  destroyed structure must stop occluding/picking. Also exclude the store's glass front/door from pointer-pick occlusion so
  sheltered civilians inside the store stay clickable (clicking one redirects the horde to the door in the sim).
- **HUD end screens:** `buildStatsHtml` (victory/defeat) also shows `stats.cascadeRecruits` ("Outbreak spread") and
  `stats.structuresDestroyed` ("Barriers broken").
- **Audio:** add a short impact/thud for `structureDamaged` (per-kind timbre: metal bus door, wood/chain alley gate, glass store
  door, steel pen gate), throttled like gate hits. `released` effects (moan swell, dust, shake) only fire when `count > 0`
  (the sim only emits it then, but guard anyway). The tier-up drum: `momentumTier` fires both directions with no previous tier —
  track the previous tier in AudioSystem/HUD, play only on increase, and reset that memory on restart.
- **Civilian scream:** `guardAlert` has optional `role` (absent = soldier). Scream only when `role === 'civilian'`.
