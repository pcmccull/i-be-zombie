import { describe, expect, it } from 'vitest';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { buildTropicalLayout } from '../src/world/tropicalLayout';

describe('tropicalLayout (expanded world)', () => {
  const layout = buildDistrictLayout();
  const tropical = buildTropicalLayout(layout);

  it('covers the entire south edge with beach and ocean and the east edge with bay water', () => {
    expect(tropical.beach.minX).toBeLessThanOrEqual(layout.bounds.minX);
    expect(tropical.beach.maxX).toBeGreaterThanOrEqual(layout.bounds.maxX);
    expect(tropical.beach.minZ).toBeGreaterThanOrEqual(layout.bounds.maxZ);

    expect(tropical.ocean.minX).toBeLessThanOrEqual(layout.bounds.minX);
    expect(tropical.ocean.maxX).toBeGreaterThanOrEqual(layout.bounds.maxX);
    expect(tropical.ocean.minZ).toBeGreaterThan(layout.bounds.maxZ);

    expect(tropical.bay.minX).toBeGreaterThanOrEqual(layout.bounds.maxX);
    expect(tropical.bay.minZ).toBeLessThanOrEqual(layout.bounds.minZ);
    expect(tropical.bay.maxZ).toBeGreaterThanOrEqual(layout.bounds.maxZ);
  });

  it('places promenade palms across the southern districts (boardwalk through hotels)', () => {
    const southPalms = tropical.palms.filter((p) => p.pos.z >= layout.bounds.maxZ);
    expect(southPalms.some((p) => p.pos.x < -200)).toBe(true);
    expect(southPalms.some((p) => p.pos.x > 200)).toBe(true);
  });
});
