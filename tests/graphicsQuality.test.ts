import { describe, expect, it } from 'vitest';
import {
  GRAPHICS_STORAGE_KEY,
  QUALITY_PRESETS,
  defaultGraphicsSettings,
  defaultQuality,
  flashScale,
  loadGraphicsSettings,
  nextQuality,
  parseGraphicsSettings,
  saveGraphicsSettings,
  shakeScale,
} from '../src/graphics/performance/GraphicsQuality';
import type { StorageLike } from '../src/core/contracts';

function memStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  } as StorageLike & { data: Map<string, string> };
}

const throwing: StorageLike = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceeded'); },
  removeItem: () => { throw new Error('nope'); },
} as StorageLike;

describe('GraphicsQuality (VP-4 #1)', () => {
  const fb = { quality: 'medium' as const, reducedMotion: false };

  it('presets scale monotonically low -> high', () => {
    expect(QUALITY_PRESETS.low.maxParticles).toBeLessThan(QUALITY_PRESETS.medium.maxParticles);
    expect(QUALITY_PRESETS.medium.maxParticles).toBeLessThan(QUALITY_PRESETS.high.maxParticles);
    expect(QUALITY_PRESETS.low.postfx).toBe(false);
    expect(QUALITY_PRESETS.high.bloom).toBe(true);
    expect(QUALITY_PRESETS.high.pixelRatioCap).toBeLessThanOrEqual(1.5);
  });

  it('VP2 LOD/dressing knobs scale monotonically low -> high', () => {
    const [l, m, h] = [QUALITY_PRESETS.low, QUALITY_PRESETS.medium, QUALITY_PRESETS.high];
    for (const k of ['characterLod0Distance', 'buildingLod1Distance', 'maxDressingPerChunk', 'dressingTier'] as const) {
      expect(l[k]).toBeLessThanOrEqual(m[k]);
      expect(m[k]).toBeLessThanOrEqual(h[k]);
    }
    for (const p of [l, m, h]) expect(p.boneUpdateTiers[0]).toBeLessThan(p.boneUpdateTiers[1]);
  });

  it('defaults from device hints', () => {
    expect(defaultQuality(true, 3)).toBe('low');
    expect(defaultQuality(false, 1)).toBe('medium');
    expect(defaultQuality(false, 2)).toBe('high');
    expect(defaultGraphicsSettings(false, 2, true)).toEqual({ quality: 'high', reducedMotion: true });
  });

  it('parse never throws and falls back per field', () => {
    expect(parseGraphicsSettings(null, fb)).toEqual(fb);
    expect(parseGraphicsSettings('{not json', fb)).toEqual(fb);
    expect(parseGraphicsSettings('null', fb)).toEqual(fb);
    expect(parseGraphicsSettings('42', fb)).toEqual(fb);
    expect(parseGraphicsSettings('{"quality":"ultra","reducedMotion":true}', fb)).toEqual({ quality: 'medium', reducedMotion: true });
    expect(parseGraphicsSettings('{"quality":"low","reducedMotion":"yes"}', fb)).toEqual({ quality: 'low', reducedMotion: false });
  });

  it('save/load round-trips; storage errors give defaults', () => {
    const s = memStorage();
    expect(saveGraphicsSettings(s, { quality: 'low', reducedMotion: true })).toBe(true);
    expect(s.data.has(GRAPHICS_STORAGE_KEY)).toBe(true);
    expect(loadGraphicsSettings(s, fb)).toEqual({ quality: 'low', reducedMotion: true });
    expect(loadGraphicsSettings(throwing, fb)).toEqual(fb);
    expect(saveGraphicsSettings(throwing, fb)).toBe(false);
    expect(loadGraphicsSettings(null, fb)).toEqual(fb);
    expect(saveGraphicsSettings(null, fb)).toBe(false);
  });

  it('cycles presets and scales shake/flash for reduced motion', () => {
    expect(nextQuality('low')).toBe('medium');
    expect(nextQuality('high')).toBe('low');
    expect(shakeScale({ quality: 'high', reducedMotion: true })).toBeLessThan(0.5);
    expect(shakeScale({ quality: 'high', reducedMotion: false })).toBe(1);
    expect(flashScale({ quality: 'high', reducedMotion: true })).toBeLessThan(1);
  });
});
