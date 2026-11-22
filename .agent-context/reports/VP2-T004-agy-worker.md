# VP2-T004 Report

- **Task ID & Agent:** VP2-T004, agy-worker (Gemini 4 Hydrogen)
- **Status:** COMPLETED

## Completed Work
- Created `src/graphics/geometry/meshUtils.ts` (`[3D]`): watertight `bevelBox` (hard face normals on flat faces, smooth normals on bevel strips and spherical corner octants, metric UVs), `roundedBox`, `lathe` (smooth normals, optional end caps, metric UVs), `extrudeProfile` (CW/CCW winding normalization, concave shapes, optional bevel), `arch`, `taperedBox`, `paint` (linear `THREE.Color` hex conversion), `tagSurface` (`aSurface` Float32 attribute), `transform` (scale -> rotY -> translate via `applyMatrix4`), `mergeTagged` (non-indexed output with exact `{ position, normal, color, uv, aSurface }` attributes, default fills, never disposes inputs), and `countTriangles`.
- Created `src/graphics/geometry/GeometryCache.ts` (`[3D]`): generic `GeometryCache<K, V = THREE.BufferGeometry>` with `keyOf`, `get`, `size`, and `dispose`.
- Created `src/graphics/buildings/BuildingComponents.ts` (`[3D]`): exhaustive `componentParts(c, palette, lod)` and `componentGeometry(c, palette, lod)` covering all 47 `ComponentKind`s, routing `opaque`, `glass`, and `emissive` buckets, applying `SURFACE.building` (4) / `SURFACE.concrete` (5) / `SURFACE.none` (0), delegating `'landmarkPart'` to `landmarkPartGeometry`, and simplifying geometry at LOD1.
- Created `src/graphics/buildings/BuildingFactory.ts` (`[3D]`): `buildBuildingGeometry(plan, lod)`, `planTriangleCount(plan, lod)`, and `disposeBuildingCaches()` using a module-level `GeometryCache` keyed with 5 cm dimension quantization (geometry built from first instance's exact dimensions).
- Created `tests/meshUtils.test.ts`: unit tests for all `meshUtils` primitives, `GeometryCache`, every `ComponentKind` at LOD0/LOD1, bucket routing, determinism, and 7 showcase building plans checked against VP2-4 triangle budgets.

## Remaining Work
None.

## Public Interfaces/Exports Added
- `src/graphics/geometry/meshUtils.ts`:
  - `export interface Vec2 { x: number; y: number }`
  - `export function bevelBox(w: number, h: number, d: number, bevel: number, segments?: number): THREE.BufferGeometry`
  - `export function roundedBox(w: number, h: number, d: number, radius: number, segments?: number): THREE.BufferGeometry`
  - `export function lathe(profile: readonly Vec2[], segs: number, closed?: boolean): THREE.BufferGeometry`
  - `export function extrudeProfile(profile: readonly Vec2[], depth: number, bevel?: number): THREE.BufferGeometry`
  - `export function arch(w: number, h: number, d: number, segs?: number, rise?: number): THREE.BufferGeometry`
  - `export function taperedBox(wBottom: number, dBottom: number, wTop: number, dTop: number, h: number): THREE.BufferGeometry`
  - `export function paint(geom: THREE.BufferGeometry, color: number): THREE.BufferGeometry`
  - `export function tagSurface(geom: THREE.BufferGeometry, surfaceId: number): THREE.BufferGeometry`
  - `export function transform(geom: THREE.BufferGeometry, x: number, y: number, z: number, rotY: number, sx?: number, sy?: number, sz?: number): THREE.BufferGeometry`
  - `export function countTriangles(geom: THREE.BufferGeometry): number`
  - `export function mergeTagged(geoms: readonly THREE.BufferGeometry[]): THREE.BufferGeometry`
- `src/graphics/geometry/GeometryCache.ts`:
  - `export interface GeometryCacheOptions<K, V>`
  - `export class GeometryCache<K, V = THREE.BufferGeometry>` (`get`, `size`, `dispose`)
- `src/graphics/buildings/BuildingComponents.ts`:
  - `export interface ComponentParts { opaque: THREE.BufferGeometry; glass: THREE.BufferGeometry; emissive: THREE.BufferGeometry }`
  - `export function componentParts(c: ComponentInstance, palette: BuildingPalette, lod: 0 | 1): ComponentParts`
  - `export function componentGeometry(c: ComponentInstance, palette: BuildingPalette, lod: 0 | 1): THREE.BufferGeometry`
- `src/graphics/buildings/BuildingFactory.ts`:
  - `export function buildBuildingGeometry(plan: BuildingPlan, lod: 0 | 1): { opaque: THREE.BufferGeometry; glass: THREE.BufferGeometry; emissive: THREE.BufferGeometry }`
  - `export function planTriangleCount(plan: BuildingPlan, lod: 0 | 1): number`
  - `export function disposeBuildingCaches(): void`

## Verification Run
- `npx tsc --noEmit` -> PASS (0 errors)
- `npx vitest run tests/meshUtils.test.ts` -> PASS (8/8 tests)
- `npx vitest run` -> PASS (79/79 test files, 885/885 tests)

### Showcase Triangle Counts
| Showcase Plan | Class | LOD0 Tris (Budget) | LOD1 Tris (Budget) | Result |
|---|---|---|---|---|
| bungalow | small | 600 (<= 3000) | 120 (<= 400) | PASS |
| convenienceStore | small | 610 (<= 3000) | 110 (<= 400) | PASS |
| artDecoHotel | large | 4600 (<= 12000) | 128 (<= 1500) | PASS |
| parkingGarage | large | 1812 (<= 12000) | 512 (<= 1500) | PASS |
| officeTower | large | 2034 (<= 12000) | 86 (<= 1500) | PASS |
| gasStation | small | 472 (<= 3000) | 152 (<= 400) | PASS |
| warehouse | large | 416 (<= 12000) | 176 (<= 1500) | PASS |

## Memory Notes
- `src/core/types.ts` `Vec2` is `{ x, z }` (ground plane), whereas `meshUtils.ts` `lathe`/`extrudeProfile` use 2D `{ x, y }` profiles (`Vec2` exported from `meshUtils.ts`).
- `BuildingFactory` rounds component dimensions to 5 cm in the cache key only (tolerance <= 2.5 cm) and builds geometry from the first matching instance's exact dimensions.
- `BuildingComponents` splits geometry into `{ opaque, glass, emissive }` (`glass`/`glassDark` panes and solar cells -> `glass`; `neonSign`, `wallLamp` bulb, and `material === 'neon'` windows/storefronts/landmarks -> `emissive`; everything else -> `opaque`).
- `aSurface` tagging: `SURFACE.building` (4) for walls/roofs/parapets/columns/chimneys/fins/decoPanels; `SURFACE.concrete` (5) for foundations/slabs/balconies/terraces/stairs/ramps/gardenWalls/curbs; `SURFACE.none` (0) for trim/metal/wood/glass/neon/signs/awnings/water/equipment.
- For T010 (`CityDistrict` integration): call `buildBuildingGeometry(plan, lod)` to get building-local `{ opaque, glass, emissive }`, apply the frontage `rotY` and footprint centre translation to all three buckets, and merge per chunk per LOD; call `disposeBuildingCaches()` on teardown.
