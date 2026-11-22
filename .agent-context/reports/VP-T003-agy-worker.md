# VP-T003 Report

- **Task ID & Agent:** `VP-T003` — `agy-worker` (Gemini 4 Hydrogen)
- **Status:** `COMPLETED` (with external `tsc` error noted in concurrent `src/graphics/vfx/vfxRules.ts`, untouched per file-lock rules)

## Completed Work
1. **`src/visuals/humanProfiles.ts`** (new, `[pure]`):
   - Implemented deterministic `humanProfile(id, role, post, weapon)` using `mulberry32` + integer hashing (no `three` import, no `Math.random()`).
   - Archetype mapping: `soldier` → `'defender'` (`#e0782a` vest + `#2c3e66` navy); `police` or `post === 'barricade'` → `'security'` (navy + light blue); `civilian` → `'tourist' | 'resident' | 'worker'` (~45% / 35% / 20%).
   - Civilians never combine `#e0782a` and `#2c3e66` (workers wear yellow-green hi-vis tabards).
   - Provides 8 skin tones (+ optional `sunburned` flag for tourists), 5 hair styles (`bald`, `short`, `bun`, `afro`, `long`), 7 hair colours, 4 body builds (`slim`, `average`, `stocky`, `tall`), seeded `phaseOffset` and `cadenceScale`, and archetype-specific props (`sunHat`, `camera`, `backpack`, `sunglasses`, `tote`, `phone`, `hardHat`, `cap`, `toolBelt`, `policeCap`, `radio`, `helmet`).
2. **`src/visuals/LowPolyCharacters.ts`**:
   - Switched rig material to `MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0.0 })` (one material per rig).
   - Upgraded silhouettes with low-seg sphere heads, noses, ears, hair geometry, tapered 6-sided cylinder limbs, hands, and archetype-specific footwear (sandals, sneakers, work/combat boots).
   - Implemented distinct visual details for `tourist` (floral vertex-colour blotches, shorts, sandals, sun hat/camera/backpack/sunglasses, sunburn option), `resident` (tee/tank, jeans/shorts/skirt, sneakers, tote/phone, armed-civilian weapons), `worker` (yellow-green hi-vis tabard with silver stripes, hard hat/cap, tool belt, work boots), `security` (cap + badge, tie, epaulets, chest badge, radio, pistol), and `defender` (orange vest + pouches + chest pocket, helmet + orange stripe + dark visor, knee pads, rifle).
   - Extended `PoseParams` and `computePose` with optional `panic`, `alert`, `hitRecoil`, and `cadenceScale` reactions.
3. **`src/visuals/zombieTextures.ts`**:
   - Repainted `TILE.alphaJacket` as a distressed colourful Hawaiian tourist shirt (teal base, coral/gold hibiscus flowers, tropical leaves, button placket seams/stitching, dirt/tears, no blood gore).
4. **`src/visuals/zombieModel.ts`**:
   - Rebuilt the Alpha hero rig (`createZombieHeroRig`) to be friendly/humorous and unmistakable without hats or glasses: removed shoulder pads, back spikes, exposed ribs, and bloody gash; added asymmetric right-raised hunched shoulder, 1.8× oversized right hand with chunky fingers, large mismatched glowing yellow-green eyes (`glow` preserved), slack grin with goofy teeth, Band-Aid cheek patch, short-sleeved Hawaiian tourist shirt, cargo shorts with thigh pockets, and one coral/teal rubber sandal (left) + one canvas sneaker (right).
   - Added `ZombieHeroRig.slots: Record<'hat' | 'glasses' | 'back' | 'hand', THREE.Object3D>` empty anchors synced to bone matrices inside `apply(pose)`.
5. **`src/visuals/EntityRenderer.ts`**:
   - Wired `humanProfile` into `createGuardEntry` / `createGuardRig`.
   - Fed `phaseOffset`, `cadenceScale`, `panic`, `alert`, and `hitRecoil` (0.2 s decay on `hitFlash` rising edge) in `updateGuards` using existing `scratchParams` with zero per-frame allocation.
   - Kept `humanVisual` vision gating unchanged.
6. **`tests/humanProfiles.test.ts`** (new, `[pure]`):
   - Added tests for determinism, `soldier` → `defender`, `police`/`barricade` → `security`, civilian archetype distribution over ids `1..500`, no `#e0782a` + `#2c3e66` in civilian palettes, ≥ 6 skin tones, and ≥ 5 hair styles.

## Remaining Work
- None for `VP-T003`.

## Public Interfaces / Exports Added
- `src/visuals/humanProfiles.ts`: `HumanArchetype`, `HUMAN_ARCHETYPES`, `HairStyle`, `HAIR_STYLES`, `BodyBuild`, `HumanProp`, `ShirtPattern`, `HumanOutfitPalette`, `HumanProfile`, `HUMAN_SKIN_TONES`, `humanProfile`
- `src/visuals/LowPolyCharacters.ts`: `PoseParams` optional fields (`panic`, `alert`, `hitRecoil`, `cadenceScale`); `createGuardRig(profileOrIndex, role, post, weapon)`
- `src/visuals/zombieModel.ts`: `HeroCosmeticSlot`, `ZombieHeroRig.slots`

## Triangle Counts (measured via esbuild + Three.js geometry inspection)
- `tourist`: **626** triangles (≤ 1,500)
- `resident`: **580** triangles (≤ 1,500)
- `worker`: **602** triangles (≤ 1,500)
- `security`: **660** triangles (≤ 1,500)
- `defender`: **686** triangles (≤ 1,500)
- `hero` (Alpha): **1,212** triangles (≤ 8,000), `slots`: `hat, glasses, back, hand`

## Verification Run
- `npx vitest run tests/humanProfiles.test.ts`: **PASS** (1 file, 4 tests passed).
- `npm test` (`vitest run`): **PASS** (59 files, 629 tests passed).
- `npx tsc --noEmit` & `npm run build`: **0 errors** in any `VP-T003` file. One pre-existing/concurrent error in `src/graphics/vfx/vfxRules.ts(90,149)` (`TS2339: Property 'id' does not exist on type 'TargetRef'`), which is owned by `VP-T002` and was not touched per strict file-lock rules.

## Memory Notes
- Appended `[VP-T003 Characters]` summary to `.agent-context/MEMORY.md`.
