# VP2-T009b — claude-worker

**Status:** COMPLETED (browser check NOT done: no browser/preview tool in this worker's toolset)

## Completed Work
- `src/graphics/characters/CharacterFactory.ts`: `createAlphaCharacter(look)` (21 bones, Skeleton + bindInverses, SkinnedMesh over `bodyGeometry('alpha',0)`, SkeletonHelper hidden, AnimationMixer on a hidden clone skeleton, clips built lazily from `CLIPS` at 30 Hz via the shared FK, cosmetic slots hat/glasses (head), back (chest), hand (handR), no cosmetics by default, `noVisionHaze` on root). bodyGeometry/disposeCharacterCaches unchanged.
- `src/visuals/zombieModel.ts`: `createAlphaBodyMaterial(look)` + `AlphaBodyUniforms`; `createZombieBodyMaterial` refactored onto a shared internal `buildBodyMaterial(bones|null, uniforms|null)` (horde output unchanged apart from an unused `vZBx` varying). Eyes: mismatched glow (left pale yellow, right ember red) over `LEADER_GLOW` baseline.
- `src/visuals/EntityRenderer.ts` (CRLF kept): Alpha path only. `USE_SKINNED_ALPHA = true` (false restores the hero rig), `LeaderRig` adapter, tourist look override (short sleeves, khaki shorts, Hawaiian jacket tile), celebrate on `strongholdCaptured` + public `celebrate()`, `setSkeletonHelperVisible(on)`, dispose/reset handling. HH-T006 structure preserved (leaderAnchor > leaderRig.root stagger/panic after animateZombie, setReducedMotion). Human/guard code untouched. Game.ts untouched, public API only gained methods.
- `tests/alphaCharacter.test.ts` (5 tests): bones/tri budget, bone world matrices == shared FK, pose write, celebrate layering + fade-out to rest, dispose.

## Remaining Work
- Browser pass (T014): confirm shader compiles, no joint gaps while walking/attacking/celebrating, cosmetics slot offsets look right on the new head/back/hand; wire F3 helper toggle (`entities.setSkeletonHelperVisible`) in T013; optionally call `entities.celebrate()` for other events.

## Public Interfaces/Exports Added
- `AlphaCharacter`, `AlphaCosmeticSlot`, `createAlphaCharacter` in CharacterFactory; `createAlphaBodyMaterial`, `AlphaBodyUniforms` in zombieModel; `USE_SKINNED_ALPHA`, `EntityRenderer.celebrate()`, `EntityRenderer.setSkeletonHelperVisible()`.

## Verification Run
- `npx tsc --noEmit` pass; `npm run build` pass.
- `npx vitest run tests/zombieAnimation tests/characterClips tests/humanoidRig tests/bodyMesh tests/instancedSkinning`: 76/76 pass. tests/alphaCharacter 5/5.
- Alpha: 1 skinned draw call (+ cosmetics), LOD0 body 4.4k tris (<= 7k budget; asserted). Full-suite result: see below.

## Memory Notes
Appended "[VP2-T009b]" entries to MEMORY.md.
- Full `npx vitest run`: 1061/1062 pass; only failure tests/ai.test.ts 'stronghold defenders keep retreat routes inside the stronghold bounds' (layout/AI, a file this task did not touch; other workers are editing world layout concurrently).
