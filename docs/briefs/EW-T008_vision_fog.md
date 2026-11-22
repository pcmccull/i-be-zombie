# EW-T008 — Vision haze rendering + gated human visuals (agy-worker)

Read first: `AGENTS.md`, `.agent-context/ARCHITECTURE.md` (§EW-3 vision types, §EW-4 last bullet "Vision haze"),
`.agent-context/MEMORY.md`, `.agent-context/PROGRESS.md`, `docs/5_expand_world.md` §4 "Rendering and visibility",
`src/systems/AwarenessSystem.ts` (`isIdentified`, `isSeen`, `awarenessOf`, `visionProfile`), upstream reports
`.agent-context/reports/EW-T005-codex.md`, `EW-T006-claude-worker.md`. `BALANCE.vision` has the tier radii.

## Locked files (edit ONLY these)
- NEW `src/core/visionMath.ts` ([pure], no three), NEW `tests/visionMath.test.ts`
- NEW `src/visuals/VisionFog.ts`
- `src/visuals/HealthBars.ts`, `src/visuals/EntityRenderer.ts`

Never edit types/contracts/balance/content, `Game.ts` (EW-T010 wires your classes), `HordeRenderer.ts`, any `src/world/**`
(EW-T007) or `src/ui/**` / `src/audio/**` (EW-T009). Those run in parallel. EntityRenderer was just reworked by the zombie
animation milestone (commit 6cf6e38: Alpha hero rig); keep that working.

## Implement
1. `visionMath.ts` (pure):
   - `hazeFactor(dist, clearRadius, hazeRadius, hazeStrength): number`: 0 inside clear, a smooth monotonic ramp to
     hazeStrength at hazeRadius, and hazeStrength beyond.
   - `lerpProfile(a, b, t, out)` for the numeric radii/strength.
   - `tierBlend(elapsedSinceChange, BALANCE.vision.tierBlendTime)`: 0..1, eased.
   - `humanVisual(awareness, dist, profile)` → `'full' | 'silhouette' | 'hidden'`, per spec §4:
     - identified ⇒ full;
     - seen ⇒ hazed silhouette;
     - neither ⇒ hidden beyond the haze radius.

     Document the exact rule in the file.
2. `VisionFog.ts` ([3D]):
   - One shared uniforms object: `{ uVisionCenter: vec2, uClearRadius, uHazeRadius, uHazeStrength, uHazeColor, uDesaturate }`.
   - `export class VisionFog`:
     - `readonly uniforms`
     - `constructor(quality: 'low' | 'high')`
     - `patchScene(root: THREE.Object3D): void`: traverse; inject via `onBeforeCompile` once per material (WeakSet guard),
       with a stable `customProgramCacheKey`; skip `userData.noVisionHaze` objects and materials with `fog === false`.
       Calling it again later patches only new materials.
     - `update(state: GameState, alpha: number, dt: number): void`: center = interpolated leader pos; on tier change, blend
       the profile over `tierBlendTime`; leader dead/respawning ⇒ tier-1 radii.
     - `setQuality(q): void`: low = haze only; high = haze + desaturate.
     - `dispose(): void`
   - Must work alongside the existing scene fog. The Alpha mesh in EntityRenderer must set `userData.noVisionHaze`.
3. `EntityRenderer.ts` / `HealthBars.ts`:
   - Humans render by `humanVisual(...)`: full = normal; silhouette = a shared dark flat material with no bar, marker or
     hit-flash UI; hidden = not visible.
   - Only identified humans get health bars, markers and hit flashes.
   - Legacy layout must look unchanged: treat everyone as identified there. Add an explicit setter (e.g.
     `setVisionGating(enabled: boolean)`, default off) and document it for T010.

## Tests
`tests/visionMath.test.ts`:
- hazeFactor bounds, monotonic, and continuous at the radii;
- tier blend goes 0→1 over tierBlendTime and is eased;
- lerpProfile endpoints;
- humanVisual table for every awareness × distance band;
- a higher tier never hides more than a lower one.

## Done when
`npx tsc --noEmit`, `npm test`, `npm run build` pass. Write `.agent-context/reports/EW-T008-agy-worker.md` (AGENTS.md
format, exact public API + required Game wiring for T010) and append Memory Notes to `.agent-context/MEMORY.md`.
