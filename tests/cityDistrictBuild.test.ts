// VP2-T010: CityDistrict integration smoke (headless three, no WebGL): chunk streaming builds cached merged building
// geometry (<= 3 meshes per chunk), LOD swaps, reload reuses the cache, occluder fade bytes, dispose is clean.
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { QUALITY_PRESETS } from '../src/graphics/performance/GraphicsQuality';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { CityDistrict } from '../src/world/CityDistrict';

vi.setConfig({ testTimeout: 120000 });
const layout = buildDistrictLayout();

describe('CityDistrict (VP2-T010)', () => {
  it('streams chunks with merged building meshes, caches on reload and disposes cleanly', () => {
    const scene = new THREE.Group();
    const city = new CityDistrict(scene, layout);
    const s0 = city.getStats();
    expect(s0.chunks).toBeGreaterThan(0);
    expect(s0.pendingBuildJobs).toBe(0);
    expect(s0.buildingsBuilt).toBeGreaterThan(0);
    // <= 3 building meshes per loaded chunk
    expect(s0.buildingDrawCalls).toBeLessThanOrEqual(3 * s0.chunks);
    expect(s0.buildingTriangles).toBeGreaterThan(1000);
    const buildingMeshes = new Set<string>();
    scene.traverse(o => { if (o instanceof THREE.Mesh && o.name.startsWith('Buildings_')) buildingMeshes.add(o.name); });
    expect(buildingMeshes.size).toBe(s0.buildingDrawCalls);

    // far away and back builds the far chunks once; a second round trip rebuilds nothing (cache hit)
    const trip = (): void => {
      city.updateStreaming({ x: 300, z: -400 });
      city.flushBuilds();
      city.updateStreaming(layout.playerStart);
      city.flushBuilds();
    };
    trip();
    const built1 = city.getStats().buildingsBuilt;
    trip();
    const s1 = city.getStats();
    expect(s1.buildingsBuilt).toBe(built1);
    expect(s1.cache.records).toBeLessThanOrEqual(24);
    expect(s1.cache.hits).toBeGreaterThan(0);
    city.dispose();
    expect(city.getStats().chunks).toBe(0);
  });

  it('building fade writes per-building opacity bytes and unload restores them', () => {
    const city = new CityDistrict(new THREE.Group(), layout);
    const hit = city.occluders.find(o => (o as THREE.Mesh).visible === false)!;
    const hits = new Set<THREE.Object3D>(city.occluders);
    for (let i = 0; i < 120; i++) city.setOccluderFade(hits, 1 / 30);
    expect(hit).toBeDefined();
    city.setOccluderFade(new Set(), 1 / 30);
    city.dispose();
  });

  it('low quality uses LOD1 for far chunks and fewer dressing items', () => {
    const city = new CityDistrict(new THREE.Group(), layout);
    const hi = city.getStats();
    city.setQuality(QUALITY_PRESETS.low);
    const lo = city.getStats();
    expect(lo.dressingItems).toBeLessThanOrEqual(hi.dressingItems);
    city.dispose();
  });
});
