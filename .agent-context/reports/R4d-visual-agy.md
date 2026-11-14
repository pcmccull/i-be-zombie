# R4d-visual — Visual, Checkpoint, Effects & HUD Fixes

- **Task ID & Agent:** `R4d-visual` (`@agy-worker`)
- **Status:** `COMPLETED`

## Completed Work

1. **[P2] Landmarks Restart & Intact State Restoration (`src/world/Landmarks.ts`, `src/core/Game.ts`)**
   - Added `doorPivot: THREE.Group` and `glassPanes: THREE.Mesh[]` (backed by `glassIntactMat` and `glassCrackedMat`) to `BreakableVisual`.
   - Added `Landmarks.reset()` (called from `Game.restart()`) and `Landmarks.resetBreakableOffsets(b)` (called automatically in `Landmarks.update()` whenever `!destroyed && hpFrac >= 0.999`) to fully restore intact state:
     - `doorPivot` and `intactGroup` rotations reset to `(0, 0, 0)` and positions reset to origin/`(b.cx, 0, b.cz)`.
     - `glassPanes` set `visible = true` with `glassIntactMat` (switching to `glassCrackedMat` when damaged and hidden when destroyed).
     - `crackMesh` hidden (`visible = false`, `scale` reset to `(1, 1, 1)`) when intact or destroyed.
     - `rubbleGroup` hidden and `intactGroup` shown.
     - `pickMesh` visibility, position, and `userData.target = { kind: 'structure', id }` restored.
     - `localDestroyedAt` cleared.
   - Preserved and ensured continuous bus sway (`busBodyGroup`) and locked alley gate rattle (`shake` + `doorPivot.rotation.z`) whenever held zombies remain inside.

2. **[P2] Checkpoint Compound Wall Bounds Filtering (`src/world/Checkpoint.ts`, `src/core/Game.ts`)**
   - Updated `CheckpointVisual.buildStaticCompound()` in `src/world/Checkpoint.ts` so `kind: 'wall'` colliders (both perimeter walls `height >= 2.0` and sandbag walls `height < 2.0`) are only rendered when they overlap `layout.checkpoint.bounds` expanded by `1.0 m`.
   - Removed the hardcoded `pen-fence-*` / `alley-wall-n` collider filter from `src/core/Game.ts`, passing `layout` directly to `new CheckpointVisual(layout)`.
   - Compound perimeter walls and interior sandbag walls continue to render in `CheckpointVisual`, while `Landmarks` exclusively renders the police pen fence and locked alley wall.

3. **[P3] Effects Reset Cleanup (`src/visuals/Effects.ts`)**
   - Updated `Effects.reset()` to hide all `extraOrderMarkers`, reset `time` and all ring/particle/tracer/muzzle/swirl/alert pool cursors (`nextRingIdx`, `nextParticleIdx`, etc.), and mark `instanceColor.needsUpdate = true` on `particleMesh` and `ringMesh`.

4. **[P3] HUD Locked Alley Objective Step (`src/ui/HUD.ts`)**
   - Updated `HUD.chooseObjectiveText()` to include `'Open the locked alley'` when `alleyGate` is intact (`!alleyGate.destroyed && state.followerCount < 45`) in natural route order: `bus -> barricade -> store -> alley -> checkpoint`.

## Remaining Work

- None.

## Public Interfaces/Exports Added

- `Landmarks.reset(): void` in `src/world/Landmarks.ts`

## Verification Run

- `npx tsc --noEmit`: **0 errors** (exit code 0)
- `npm test` (`vitest run`): **22 test files passed (22/22), 205 tests passed (205/205), 0 failed**
- `npm run build` (`tsc --noEmit && vite build`): **Succeeded** (`dist/index.html`, `dist/assets/index-CvVPeOwM.css`, `dist/assets/index-ClGRMsX8.js` built in 2.76s)

## Memory Notes

- `CheckpointVisual` now filters `kind: 'wall'` colliders spatially by overlap with `layout.checkpoint.bounds` (+1 m margin) instead of relying on `Game.ts` stripping landmark collider tags.
- `Landmarks.update()` self-heals intact state whenever `!s.destroyed && hp / maxHp >= 0.999` in addition to `Landmarks.reset()`, so both `Game.restart()` and direct state resets restore doors, glass panes, cracks, rubble, and pick proxies cleanly.
