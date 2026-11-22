// [3D] Generic string-keyed geometry/asset cache with disposal.
import type * as THREE from 'three';

export interface GeometryCacheOptions<K, V> {
  keyOf?: (key: K) => string;
  dispose?: (value: V) => void;
}

/**
 * Caches built geometries (or composite parts) by string key.
 * Callers must clone/transform returned values and never mutate them in place.
 */
export class GeometryCache<K, V = THREE.BufferGeometry> {
  private readonly map = new Map<string, V>();
  private readonly keyOf: (key: K) => string;
  private readonly disposeValue: ((value: V) => void) | undefined;

  constructor(options?: GeometryCacheOptions<K, V>) {
    this.keyOf = options?.keyOf ?? ((k: K) => String(k));
    this.disposeValue = options?.dispose;
  }

  get(key: K, build: () => V): V {
    const k = this.keyOf(key);
    const existing = this.map.get(k);
    if (existing !== undefined) {
      return existing;
    }
    const created = build();
    this.map.set(k, created);
    return created;
  }

  get size(): number {
    return this.map.size;
  }

  dispose(): void {
    for (const value of this.map.values()) {
      if (this.disposeValue) {
        this.disposeValue(value);
      } else if (
        value !== null &&
        typeof value === 'object' &&
        'dispose' in value &&
        typeof (value as { dispose?: unknown }).dispose === 'function'
      ) {
        (value as { dispose: () => void }).dispose();
      }
    }
    this.map.clear();
  }
}
