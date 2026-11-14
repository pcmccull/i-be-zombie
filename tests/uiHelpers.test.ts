import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { Simulation } from '../src/sim/Simulation';
import { buildDistrictLayout } from '../src/world/districtLayout';
import {
  abilitySlotView,
  buildDebugLines,
  equippableAbilities,
  followerCap,
  makeProjection,
  mapToWorld,
  nearbyEquipNest,
  selectObjectiveStronghold,
  staticLayerKey,
  toastForEvent,
  worldToMap,
} from '../src/ui/uiHelpers';

function world() {
  const layout = buildDistrictLayout();
  const sim = new Simulation(layout);
  return { layout, sim, state: sim.state };
}

describe('map projection', () => {
  it('round-trips world points and keeps north (-Z) at the top', () => {
    const { layout } = world();
    const proj = makeProjection(layout.bounds, 180, 144);
    const out = { x: 0, z: 0 };
    worldToMap(proj, layout.bounds.minX, layout.bounds.minZ, out);
    expect(out.x).toBeCloseTo(proj.offX);
    expect(out.z).toBeCloseTo(proj.offY); // north-west corner = top-left
    worldToMap(proj, 40, -25, out);
    const back = mapToWorld(proj, out.x, out.z, { x: 0, z: 0 });
    expect(back).not.toBeNull();
    expect(back!.x).toBeCloseTo(40);
    expect(back!.z).toBeCloseTo(-25);
    // north point is above a south point
    const north = worldToMap(proj, 0, -100, { x: 0, z: 0 });
    const south = worldToMap(proj, 0, 100, { x: 0, z: 0 });
    expect(north.z).toBeLessThan(south.z);
  });

  it('letterboxes and rejects pixels outside the world rectangle', () => {
    const proj = makeProjection({ minX: -100, minZ: -50, maxX: 100, maxZ: 50 }, 400, 400);
    expect(proj.width).toBeCloseTo(400);
    expect(proj.height).toBeCloseTo(200);
    expect(mapToWorld(proj, 200, 5, { x: 0, z: 0 })).toBeNull();
    expect(mapToWorld(proj, 200, 200, { x: 0, z: 0 })).not.toBeNull();
  });
});

describe('objective selection', () => {
  it('prefers a discovered uncaptured stronghold, then contested, and returns null when all captured', () => {
    const { layout, state } = world();
    const far = { x: layout.playerStart.x, z: layout.playerStart.z };
    for (const d of Object.values(state.districts)) d.discovered = false;
    // Nothing discovered: nearest overall (still non-null so the HUD can say "explore")
    expect(selectObjectiveStronghold(layout, state, far)).not.toBeNull();
    for (const d of Object.values(state.districts)) d.discovered = true;
    const nearest = selectObjectiveStronghold(layout, state, far)!;
    // Contested beats nearest.
    const other = layout.strongholds.find((s) => s.id !== nearest.id)!;
    state.strongholds.find((s) => s.id === other.id)!.contested = true;
    expect(selectObjectiveStronghold(layout, state, far)!.id).toBe(other.id);
    for (const s of state.strongholds) s.captured = true;
    expect(selectObjectiveStronghold(layout, state, far)).toBeNull();
  });
});

describe('ability slot view', () => {
  it('reports empty, passive, ready, cooldown, active and no-biomass states', () => {
    const { state } = world();
    const p = state.progression;
    p.equipped = [null, null, null, null];
    expect(abilitySlotView(state, 0).kind).toBe('empty');
    expect(abilitySlotView(state, 0).key).toBe('Q');

    p.unlocked.push('alpha_claws', 'horde_frenzy', 'brute_evolution');
    p.equipped = ['alpha_claws', 'horde_frenzy', 'brute_evolution', null];
    expect(abilitySlotView(state, 0).kind).toBe('passive');
    expect(abilitySlotView(state, 1).kind).toBe('ready');
    p.cooldowns.horde_frenzy = 5;
    const cd = abilitySlotView(state, 1);
    expect(cd.kind).toBe('cooldown');
    expect(cd.remainingFrac).toBeGreaterThan(0);
    expect(cd.remainingFrac).toBeLessThanOrEqual(1);
    p.frenzyTimeLeft = 4;
    expect(abilitySlotView(state, 1).kind).toBe('active');
    p.biomass = 0;
    expect(abilitySlotView(state, 2).kind).toBe('nobiomass');
    p.biomass = BALANCE.brute.costPerBrute;
    expect(abilitySlotView(state, 2).kind).toBe('ready');
    expect(equippableAbilities(state)).toEqual(expect.arrayContaining(['alpha_claws', 'horde_frenzy', 'brute_evolution']));
    expect(equippableAbilities(state)).not.toContain('bite');
  });
});

describe('nest proximity, caps, toasts, debug lines', () => {
  it('finds the start nest only within the equip radius', () => {
    const { layout, state } = world();
    const nest = layout.nests.find((n) => n.strongholdId === null)!;
    state.leader.pos.x = nest.pos.x + BALANCE.nest.equipRadius - 1;
    state.leader.pos.z = nest.pos.z;
    expect(nearbyEquipNest(state, layout)?.id).toBe(nest.id);
    state.leader.pos.x = nest.pos.x + BALANCE.nest.equipRadius + 5;
    expect(nearbyEquipNest(state, layout)).toBeNull();
    // inactive capture nest is ignored
    const locked = layout.nests.find((n) => n.strongholdId !== null)!;
    state.leader.pos.x = locked.pos.x;
    state.leader.pos.z = locked.pos.z;
    expect(nearbyEquipNest(state, layout)).toBeNull();
  });

  it('uses the open-world follower cap for the real layout', () => {
    const { layout } = world();
    expect(followerCap(layout)).toBe(BALANCE.openWorld.maxFollowers);
    expect(followerCap(null)).toBe(BALANCE.horde.maxFollowers);
  });

  it('builds toast text for open-world events', () => {
    expect(toastForEvent({ type: 'abilityUnlocked', abilityId: 'alpha_claws', slot: 0 })?.text).toBe(
      'New mutation: Alpha Claws - equipped in slot Q',
    );
    expect(toastForEvent({ type: 'abilityUnlocked', abilityId: 'horde_frenzy', slot: null })?.text).toContain('equip it at a nest');
    expect(
      toastForEvent({ type: 'strongholdCaptured', strongholdId: 'police_station', districtId: 'police', unlock: 'alpha_claws', biomass: 30 })?.text,
    ).toContain('Alpha Claws');
    expect(toastForEvent({ type: 'abilityDenied', abilityId: 'horde_frenzy', reason: 'cooldown' })).toBeNull();
    expect(toastForEvent({ type: 'abilityDenied', abilityId: 'brute_evolution', reason: 'biomass' })?.text).toContain('biomass');
    expect(toastForEvent({ type: 'autosave', reason: 'capture' })).toBeNull();
  });

  it('static layer key changes with discovery and capture, debug lines include phase and dormant counts', () => {
    const { layout, state } = world();
    const k0 = staticLayerKey(state, layout);
    state.discovery.revealed += 1;
    expect(staticLayerKey(state, layout)).not.toBe(k0);
    const k1 = staticLayerKey(state, layout);
    state.strongholds[0].captured = true;
    expect(staticLayerKey(state, layout)).not.toBe(k1);
    const lines = buildDebugLines(state, { fps: 60, drawCalls: 10, frameMs: 16.7, loadedChunks: 6 }).join('\n');
    expect(lines).toContain('phase playing');
    expect(lines).toContain('dormant');
    expect(lines).toContain('chunks 6');
  });
});
