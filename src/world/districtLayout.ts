// [pure] The open world (docs/3_open_world.md): four contiguous districts. OWNER: T002.
// T001 placeholder: returns the legacy district until T002 lands the real world builder.
import type { DistrictLayout } from '../core/types';
import { buildLegacyDistrictLayout } from './legacyDistrictLayout';

export function buildDistrictLayout(_seed?: number): DistrictLayout {
  return buildLegacyDistrictLayout();
}
