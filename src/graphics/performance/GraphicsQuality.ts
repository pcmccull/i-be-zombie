// [pure] Graphics quality presets + player graphics settings (docs/8_visual_polish.md §5, §6, §7).
// Render-only: nothing here may influence the simulation. Storage access never throws.
import type { StorageLike } from '../../core/contracts';

export type GraphicsQualityPreset = 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  quality: GraphicsQualityPreset;
  /** Less camera shake, no screen flashes, calmer particles (accessibility). */
  reducedMotion: boolean;
}

export interface QualityProfile {
  /** Renderer device-pixel-ratio cap. */
  pixelRatioCap: number;
  /** Sun shadow map size (px, square). 0 = shadows off. */
  shadowMapSize: number;
  /**
   * Display-referred post pass on/off (grade + optional bloom over the MSAA canvas image). Antialiasing is the
   * canvas MSAA on every preset.
   */
  postfx: boolean;
  /** Selective bloom on bright emissive effects only (high luminance threshold). */
  bloom: boolean;
  /** Color grading pass (warm Miami grade, contrast, vignette). */
  grading: boolean;
  /** World-space surface detail (asphalt cracks, sidewalk joints, stucco) on city materials. */
  surfaceDetail: boolean;
  /** Foliage wind sway (vertex shader). */
  foliageWind: boolean;
  /** Max live particles across all VFX pools. */
  maxParticles: number;
  /** Max footstep puffs spawned per second (whole horde). */
  footstepsPerSecond: number;
  /** Footsteps only for zombies within this distance (m) of the camera focus. */
  footstepRadius: number;
  /** Ambient tropical motes (leaves, insects, mist) alive at once. */
  ambientMotes: number;
  /** Multiplier on burst particle counts. */
  burstScale: number;
  // ---- VP2 (docs/12_visual_polish2.md §10) ----
  /** Characters use body LOD0 within this distance (m) of the camera focus, LOD1 beyond. */
  characterLod0Distance: number;
  /** Bone update tiers: [d0, d1] (m). < d0 every frame, d0..d1 every 2nd frame, beyond every 4th. */
  boneUpdateTiers: readonly [number, number];
  /** Chunks whose nearest edge is farther than this (m) from the focus draw buildings at LOD1. */
  buildingLod1Distance: number;
  /** Highest render-only dressing tier drawn (DressingInstance.tier <= dressingTier). */
  dressingTier: 0 | 1 | 2;
  /** Hard cap on render-only dressing instances per chunk. */
  maxDressingPerChunk: number;
}

export const QUALITY_PRESETS: Readonly<Record<GraphicsQualityPreset, Readonly<QualityProfile>>> = {
  low: {
    pixelRatioCap: 1,
    shadowMapSize: 1024,
    postfx: false,
    bloom: false,
    grading: false,
    surfaceDetail: false,
    foliageWind: false,
    maxParticles: 384,
    footstepsPerSecond: 10,
    footstepRadius: 18,
    ambientMotes: 0,
    burstScale: 0.5,
    characterLod0Distance: 22,
    boneUpdateTiers: [18, 40],
    buildingLod1Distance: 60,
    dressingTier: 0,
    maxDressingPerChunk: 260,
  },
  medium: {
    pixelRatioCap: 1.25,
    shadowMapSize: 2048,
    postfx: true,
    bloom: false,
    grading: true,
    surfaceDetail: true,
    foliageWind: true,
    maxParticles: 768,
    footstepsPerSecond: 22,
    footstepRadius: 26,
    ambientMotes: 24,
    burstScale: 0.8,
    characterLod0Distance: 28,
    boneUpdateTiers: [22, 46],
    buildingLod1Distance: 90,
    dressingTier: 1,
    maxDressingPerChunk: 520,
  },
  high: {
    pixelRatioCap: 1.5,
    shadowMapSize: 2048,
    postfx: true,
    bloom: true,
    grading: true,
    surfaceDetail: true,
    foliageWind: true,
    maxParticles: 1280,
    footstepsPerSecond: 40,
    footstepRadius: 34,
    ambientMotes: 48,
    burstScale: 1,
    characterLod0Distance: 32,
    boneUpdateTiers: [25, 50],
    buildingLod1Distance: 120,
    dressingTier: 2,
    maxDressingPerChunk: 900,
  },
};

export const GRAPHICS_STORAGE_KEY = 'ibz.graphics.v1';

const PRESETS: readonly GraphicsQualityPreset[] = ['low', 'medium', 'high'];

export function isQualityPreset(v: unknown): v is GraphicsQualityPreset {
  return typeof v === 'string' && (PRESETS as readonly string[]).includes(v);
}

/** Default preset from device hints: touch / DPR ≤ 1 ⇒ low-ish, otherwise high. */
export function defaultQuality(touch: boolean, devicePixelRatio: number): GraphicsQualityPreset {
  if (touch) return 'low';
  return devicePixelRatio <= 1 ? 'medium' : 'high';
}

export function defaultGraphicsSettings(touch: boolean, devicePixelRatio: number, prefersReducedMotion = false): GraphicsSettings {
  return { quality: defaultQuality(touch, devicePixelRatio), reducedMotion: prefersReducedMotion };
}

/** Parses a stored blob; anything malformed falls back field-by-field to `fallback`. */
export function parseGraphicsSettings(raw: string | null, fallback: GraphicsSettings): GraphicsSettings {
  if (!raw) return { ...fallback };
  try {
    const v = JSON.parse(raw) as Partial<GraphicsSettings> | null;
    if (!v || typeof v !== 'object') return { ...fallback };
    return {
      quality: isQualityPreset(v.quality) ? v.quality : fallback.quality,
      reducedMotion: typeof v.reducedMotion === 'boolean' ? v.reducedMotion : fallback.reducedMotion,
    };
  } catch {
    return { ...fallback };
  }
}

export function loadGraphicsSettings(storage: StorageLike | null, fallback: GraphicsSettings): GraphicsSettings {
  if (!storage) return { ...fallback };
  try {
    return parseGraphicsSettings(storage.getItem(GRAPHICS_STORAGE_KEY), fallback);
  } catch {
    return { ...fallback };
  }
}

export function saveGraphicsSettings(storage: StorageLike | null, s: GraphicsSettings): boolean {
  if (!storage) return false;
  try {
    storage.setItem(GRAPHICS_STORAGE_KEY, JSON.stringify({ quality: s.quality, reducedMotion: s.reducedMotion }));
    return true;
  } catch {
    return false;
  }
}

export function nextQuality(q: GraphicsQualityPreset): GraphicsQualityPreset {
  return PRESETS[(PRESETS.indexOf(q) + 1) % PRESETS.length];
}

/** Camera-shake scale: reduced motion keeps a hint of feedback but no jolts. */
export function shakeScale(s: GraphicsSettings): number {
  return s.reducedMotion ? 0.15 : 1;
}

/** Brightness/opacity scale for full-screen-ish flashes (muzzle strobe, explosion flash, unlock burst). */
export function flashScale(s: GraphicsSettings): number {
  return s.reducedMotion ? 0.35 : 1;
}
