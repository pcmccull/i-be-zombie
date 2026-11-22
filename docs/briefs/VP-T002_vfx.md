# VP-T002 — Pooled VFXManager + combat/ambient effects (docs/8_visual_polish.md §5)

Read first: `AGENTS.md`, `.agent-context/ARCHITECTURE.md` (§VP-0…VP-4 at the top), `.agent-context/MEMORY.md`,
`.agent-context/PROGRESS.md`, `docs/8_visual_polish.md` §5, `src/graphics/performance/GraphicsQuality.ts`,
`src/visuals/Effects.ts` (existing pooled tracers/muzzles/rings/arcs/markers — keep those), `src/core/types.ts` (`GameEvent`).

## Locked files (create/edit only these)
- `src/graphics/vfx/vfxRules.ts` (new, **[pure]**, no three import)
- `src/graphics/vfx/EmitterPool.ts` (new, [3D])
- `src/graphics/vfx/VFXManager.ts` (new, [3D])
- `src/visuals/Effects.ts` (de-duplicate: remove/reduce its plain cube `spawnBurst` calls for events the VFXManager now owns; keep
  tracers, muzzle flash, rings, arcs, swirls, alerts, pillars, order markers, aura, shake requests)
- `tests/vfx.test.ts` (new, imports only `vfxRules.ts` + `GraphicsQuality.ts`)

Do NOT edit `src/core/Game.ts` (orchestrator wires it in VP-T006), contract files, balance, or anything else.

## What to build
1. **`EmitterPool`**: one `THREE.InstancedMesh` of camera-facing quads per blend mode (`additive` for sparks/stars/wisps/glints,
   `normal` alpha for dust/smoke/debris/motes) — 2 draw calls total for all particles. A small **procedural sprite atlas**
   (canvas 256×256, 4×4 tiles: soft dot, 5-point star, wisp/swirl, smoke puff, chunk/shard, streak, arrow-up, leaf, ring) built
   once (Node: no canvas ⇒ skip texture, tests never construct the pool). Per-instance attributes: tile, colour, opacity,
   size, rotation (InstancedBufferAttribute, `DynamicDrawUsage`, update only `[0, liveCount)` ranges). Billboarding in the vertex
   shader (camera right/up), soft fade near the ground plane to avoid hard intersections (`y < 0.15` fade). `depthWrite:false`,
   `fog:false`, `userData.noVisionHaze = true`, `frustumCulled = false` on the mesh. Swap-remove dead particles (dense array),
   **never allocate per particle**.
2. **`vfxRules.ts`** [pure]: `VfxName`, `VfxSurface`, `VfxPayload` exactly as ARCHITECTURE §VP-3; `EMITTERS: Record<VfxName, EmitterConfig>`
   (count, lifetime range, speed/spread, gravity, drag, size over life start/end, opacity curve, colour(s), tile, blend, spin,
   ground bounce y=0 with damping for debris); `mapEvent(ev, state?) => { name, payload }[]` (table-driven, see mapping below);
   `surfaceAt(layout, x, z): VfxSurface` (layout ground rects: road⇒asphalt, sidewalk/plaza⇒sidewalk, park⇒grass, lot/compound⇒
   concrete; beach strip south of the city ⇒ sand if you can derive it from layout, else grass default) with a cheap bucket grid;
   budget helpers `scaledCount(base, profile, reduced)`, `canSpawn(live, n, max)`, footstep sampler
   `pickFootsteps(...)` (pure: given candidate list + budget accumulator, returns which ids step this frame).
3. **`VFXManager`** implementing ARCHITECTURE §VP-3 exactly. Event → effect mapping (Game passes events already culled past the
   vision limit; also cull any particle whose origin is > `hiddenBeyond` from the interpolated leader at spawn time):

| GameEvent | VfxName | Look |
|---|---|---|
| (per frame) moving zombies near focus | `zombie.footstep` | 2–4 tiny puffs, colour by surface (sand beige, asphalt grey, grass none/green flecks) |
| `attackSwing` | `combat.swing` | short translucent arc of streak sprites along `facing` (the existing Effects claw arc stays) |
| `melee`, `damage` (guard/structure/gate), `humanMelee` hit, `shot` hit | `combat.hit` | star burst + white pop, orange for human hits, green-tinted for hits on zombies/leader |
| `recruited`, `converted`, `recruitPulse` (recruits>0) | `zombie.recruited` | green/teal wisps spiralling up + quick sparkle |
| `rally` | `horde.rally` | rising arrow sprites + wisps around the ring radius (ring itself stays in Effects) |
| `frenzyStart`, `rushStart` + per-frame while frenzy/rush active | `horde.charge` | trailing tan dust behind fast followers + white speed streaks; strict cap |
| `shot` | `defender.muzzle` | small smoke puff + 1 shell glint (additive, tiny, gravity) at `from` |
| `shot` miss | `bullet.impact` | dust + chips + 1–2 sparks at `to`, by surface |
| `structureDestroyed` (non-bus), `gateDestroyed` | `barricade.destroyed` | wood/concrete chunk debris (gravity + ground bounce), dust cloud |
| `structureDestroyed` landmark `'bus'`, `vehicleHit` killed | `vehicle.explosion` | flash (scaled by `flashScale`), smoke column (≤ 2.5 s), embers |
| `abilityUnlocked`, `strongholdCaptured` (near leader) | `ability.unlock` | celebratory confetti/stars ring around the Alpha, brief |
| (per frame) | `ambient.mote` | `profile.ambientMotes` leaves/insects/mist drifting around the focus, respawned when far |

   Quality: `setQuality` re-caps (`maxParticles`, `burstScale`, footstep budget, ambient count). Reduced motion: halve counts,
   no flash, slower/shorter streaks. `reset()` kills everything (district transition / respawn / restart), `dispose()` frees GPU.
   Footsteps: only `state==='follower'` (and ambient within radius) zombies whose (pos − prevPos) speed > 0.6 m/s, within
   `footstepRadius` of focus, budgeted by `footstepsPerSecond` (accumulator), each zombie at most once per ~0.35 s (side-table
   keyed by id, pooled — or derive stride from `state.time` + id hash). Charge trails: ≤ 24 emitters per frame.
4. **Effects.ts**: drop the cube bursts that duplicate the new effects (`melee`, `damage`, `recruited` burst, `shot` hit burst,
   `structureDestroyed` debris, etc.) — keep rings/arcs/tracers/muzzle/markers/shake. Keep its public API unchanged.

## Tests (`tests/vfx.test.ts`)
ARCHITECTURE §VP-4 #2–4 via the pure module: `mapEvent` table for every row above; budgets never exceed max; footstep picker
respects radius, rate, moving-only, hiddenBeyond; `scaledCount` with reduced motion/low preset; `surfaceAt` on a tiny fixture.

## Done
`npx tsc --noEmit` 0 errors, `npm test` all green, `npm run build` OK. Report at `.agent-context/reports/VP-T002-<agent>.md`
per AGENTS.md (include the exact public API and draw-call/particle caps), MEMORY notes appended to `.agent-context/MEMORY.md`.
