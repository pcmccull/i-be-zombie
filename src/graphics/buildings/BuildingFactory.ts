// [3D] Plan -> merged building-local { opaque, glass, emissive } BufferGeometry factory.
import * as THREE from 'three';
import { GeometryCache } from '../geometry/GeometryCache';
import { countTriangles, mergeTagged, transform } from '../geometry/meshUtils';
import { componentParts, type ComponentParts } from './BuildingComponents';
import type { BuildingPalette, BuildingPlan, ComponentInstance } from './buildingTypes';

function disposeParts(p: ComponentParts): void {
  p.opaque.dispose();
  p.glass.dispose();
  p.emissive.dispose();
}

const componentCache = new GeometryCache<string, ComponentParts>({
  dispose: disposeParts,
});

function round5cm(v: number): number {
  return Math.round(v * 20);
}

function paletteKey(p: BuildingPalette): string {
  return `${p.wall},${p.wallAccent},${p.trim},${p.roof},${p.awningA},${p.awningB},${p.sign},${p.neon}`;
}

/**
 * Cache key uses dimensions rounded to 5 cm (tolerance <= 2.5 cm);
 * the cached geometry is built from the first instance's exact dimensions.
 */
function componentKey(c: ComponentInstance, pKey: string, lod: 0 | 1): string {
  return `${c.kind}|${round5cm(c.w)}x${round5cm(c.h)}x${round5cm(c.d)}|v${c.variant}|l${lod}|${c.material}|${pKey}`;
}

function getCachedParts(c: ComponentInstance, palette: BuildingPalette, pKey: string, lod: 0 | 1): ComponentParts {
  const key = componentKey(c, pKey, lod);
  return componentCache.get(key, () => componentParts(c, palette, lod));
}

/**
 * Builds building-local { opaque, glass, emissive } geometries for `plan` at `lod`.
 * LOD0 includes all components; LOD1 includes only components with `c.lod === 1`.
 */
export function buildBuildingGeometry(
  plan: BuildingPlan,
  lod: 0 | 1,
): { opaque: THREE.BufferGeometry; glass: THREE.BufferGeometry; emissive: THREE.BufferGeometry } {
  const palette = plan.config.palette;
  const pKey = paletteKey(palette);
  const opaqueList: THREE.BufferGeometry[] = [];
  const glassList: THREE.BufferGeometry[] = [];
  const emissiveList: THREE.BufferGeometry[] = [];

  const components = plan.components;
  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    if (lod === 1 && c.lod !== 1) continue;
    const parts = getCachedParts(c, palette, pKey, lod);
    if (countTriangles(parts.opaque) > 0) {
      opaqueList.push(transform(parts.opaque, c.x, c.y, c.z, c.rotY));
    }
    if (countTriangles(parts.glass) > 0) {
      glassList.push(transform(parts.glass, c.x, c.y, c.z, c.rotY));
    }
    if (countTriangles(parts.emissive) > 0) {
      emissiveList.push(transform(parts.emissive, c.x, c.y, c.z, c.rotY));
    }
  }

  const opaque = mergeTagged(opaqueList);
  const glass = mergeTagged(glassList);
  const emissive = mergeTagged(emissiveList);

  for (let i = 0; i < opaqueList.length; i++) opaqueList[i].dispose();
  for (let i = 0; i < glassList.length; i++) glassList[i].dispose();
  for (let i = 0; i < emissiveList.length; i++) emissiveList[i].dispose();

  return { opaque, glass, emissive };
}

/**
 * Total triangles across opaque, glass, and emissive buckets that `buildBuildingGeometry` would produce.
 */
export function planTriangleCount(plan: BuildingPlan, lod: 0 | 1): number {
  const palette = plan.config.palette;
  const pKey = paletteKey(palette);
  let tris = 0;
  const components = plan.components;
  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    if (lod === 1 && c.lod !== 1) continue;
    const parts = getCachedParts(c, palette, pKey, lod);
    tris += countTriangles(parts.opaque) + countTriangles(parts.glass) + countTriangles(parts.emissive);
  }
  return tris;
}

/**
 * Disposes and clears the module-level component geometry cache.
 */
export function disposeBuildingCaches(): void {
  componentCache.dispose();
}
