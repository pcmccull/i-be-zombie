# VP2-T012 Report — Landmark Plans & Components

- **Task ID & Agent:** VP2-T012, `agy-worker` (Gemini 4 Hydrogen)
- **Status:** `COMPLETED`

## Completed Work

1. **`src/graphics/buildings/landmarkPlans.ts`** (`[pure]`):
   - Exported `LANDMARK_PART` sequential numeric enum (0–32, 33 parts) and `LandmarkPartId` type covering all 12 `CityLandmarkKind` landmarks.
   - Implemented `planLandmark(cfg)` (with `undefined` defaulting to `'glassTower'`), scaling every landmark proportionally to `(cfg.width, cfg.depth, cfg.height)` and using `mulberry32(cfg.seed)` for deterministic variation.
   - Enforced ground-level footprint containment (`bottom < 2.4 m` inside footprint, excluding flat `terrace` slabs), upper-level overhang limits (`<= 2.5 m`), height accuracy (`max lod1 top === cfg.height` within `+/- 0.5 m`), and LOD0/LOD1 component flagging.

2. **`src/graphics/buildings/LandmarkComponents.ts`** (`[3D]`):
   - Implemented `landmarkPartGeometry(c, palette, lod)` for all 33 `LANDMARK_PART` variants using `meshUtils` (`lathe`, `taperedBox`, `bevelBox`, `arch`, `extrudeProfile`, `paint`, `tagSurface`, `transform`, `mergeTagged`) and `THREE.TorusGeometry` for `WHEEL_RIM`.
   - Enforced component-box containment (`[-w/2, w/2] x [-h/2, h/2] x [-d/2, d/2]`), palette/fixed color rules (glass as `0x5e8fa8` / `0x263542` on opaque geometry, `neon` material routed to emissive), LOD1 simplification, and intermediate geometry disposal.

3. **`tests/landmarkPlans.test.ts`**:
   - Added 14 tests covering all 12 `CityLandmarkKind`s at `0.7x`, `1.0x`, and `1.3x` scales (determinism, `planBuilding` delegation, ground footprint, overhang, height, non-indexed attribute validity, and triangle budgets `<= 12000` LOD0 / `<= 1500` LOD1), `undefined` fallback to `glassTower`, and box-containment/validity for all 33 `LANDMARK_PART`s at LOD0 and LOD1.

## Remaining Work

- None.

## Public Interfaces/Exports Added

- `src/graphics/buildings/landmarkPlans.ts`: `LANDMARK_PART`, `LandmarkPartId`, `planLandmark(cfg: BuildingConfig): BuildingPlan`
- `src/graphics/buildings/LandmarkComponents.ts`: `landmarkPartGeometry(c: ComponentInstance, palette: BuildingPalette, lod: 0 | 1): THREE.BufferGeometry`

## Verification Run

| Landmark | Reference Size (W×D×H) | LOD0 Tris | LOD1 Tris |
|---|---:|---:|---:|
| `lighthouse` | 6×6×18 | 784 | 224 |
| `waterTower` | 8×8×16 | 492 | 128 |
| `clockTower` | 7×7×20 | 868 | 24 |
| `controlTower` | 10×10×24 | 552 | 232 |
| `radioMast` | 5×5×28 | 416 | 192 |
| `fountainPlaza` | 12×12×3 | 360 | 192 |
| `bandshell` | 16×12×8 | 560 | 136 |
| `ferrisWheel` | 18×6×22 | 1200 | 240 |
| `domeObservatory` | 14×14×12 | 652 | 120 |
| `glassTower` | 16×16×40 | 252 | 72 |
| `neonArch` | 4×14×9 | 240 | 144 |
| `hangar` | 30×24×12 | 560 | 104 |

- `npx vitest run tests/landmarkPlans.test.ts`: **PASS** (14/14 tests passed).
- `npx tsc --noEmit`: 0 errors in VP2-T012 files; pre-existing/parallel-session errors in `src/visuals/HordeRenderer.ts` (VP2-T009 in progress).
- `npx vitest run tests/landmarkPlans.test.ts tests/buildingPlan.test.ts tests/meshUtils.test.ts`: `landmarkPlans.test.ts` (14/14 pass) and `meshUtils.test.ts` (8/8 pass); `buildingPlan.test.ts` had 1 unrelated failure on `villa seed=17297786` balcony ground footprint.
- `npx vitest run`: Executed full suite (see final check output for unrelated pre-existing/parallel-session failures).

## Memory Notes

- Appended `[VP2-T012]` summary bullet to `.agent-context/MEMORY.md`.
