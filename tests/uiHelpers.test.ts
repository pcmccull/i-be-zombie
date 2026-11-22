import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { Simulation } from '../src/sim/Simulation';
import { buildDistrictLayout } from '../src/world/districtLayout';
import {
  abilitySlotView,
  toastDedupe,
  buildDebugLines,
  cueOpacity,
  cueScreenAngle,
  equippableAbilities,
  eyesightPanelView,
  followerCap,
  makeProjection,
  mapHumanVisibility,
  mapToWorld,
  nearbyEquipNest,
  nextSlotPrice,
  visibleSlotCount,
  selectObjectiveStronghold,
  staticLayerKey,
  threatPipCount,
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
    state.leader.pos.x = nest.pos.x;
    state.leader.pos.z = nest.pos.z;
    expect(nearbyEquipNest(state, layout)).toBeNull(); // the walk-in nest is dormant until claimed
    state.claimedNests.push(nest.id);
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

  it('adds followersPerNest to the horde cap for every unlocked nest', () => {
    const { layout, state } = world();
    const base = BALANCE.openWorld.maxFollowers, per = BALANCE.openWorld.followersPerNest;
    expect(per).toBe(10);
    expect(followerCap(layout, state)).toBe(base); // start nest does not count
    const nested = layout.nests.filter((n) => n.strongholdId !== null);
    expect(nested.length).toBeGreaterThanOrEqual(2);
    state.strongholds.find((s) => s.id === nested[0].strongholdId)!.captured = true;
    expect(followerCap(layout, state)).toBe(base + per);
    state.strongholds.find((s) => s.id === nested[1].strongholdId)!.captured = true;
    expect(followerCap(layout, state)).toBe(base + 2 * per);
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
    expect(toastForEvent({ type: 'abilityDenied', abilityId: 'brute_evolution', reason: 'biomass' })?.text).toContain('brains');
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

describe('TD-T004 slot visibility and toasts', () => {
  const mk = (n: number) => {
    const st = new Simulation(buildDistrictLayout()).state;
    st.progression.slotsOwned = n;
    return st;
  };
  it('visibleSlotCount clamps', () => {
    expect(visibleSlotCount(mk(0))).toBe(0);
    expect(visibleSlotCount(mk(1))).toBe(1);
    expect(visibleSlotCount(mk(4))).toBe(4);
    expect(visibleSlotCount(mk(9))).toBe(BALANCE.progression.slots);
    expect(visibleSlotCount(mk(-3))).toBe(0);
  });
  it('nextSlotPrice', () => {
    expect(nextSlotPrice(mk(0))).toBeNull();
    expect(nextSlotPrice(mk(1))).toBe(BALANCE.progression.slotCosts[1]);
    expect(nextSlotPrice(mk(3))).toBe(BALANCE.progression.slotCosts[3]);
    expect(nextSlotPrice(mk(4))).toBeNull();
  });
  it('toast text', () => {
    expect(toastForEvent({ type: 'slotPurchased', slot: 1, cost: 40 })?.text).toBe('Ability slot T unlocked');
    expect(toastForEvent({ type: 'abilityDenied', abilityId: null, reason: 'maxSlots' })?.text).toBe('All ability slots owned');
    const st = mk(1);
    st.progression.equipped[0] = 'rush';
    expect(toastForEvent({ type: 'abilityUnlocked', abilityId: 'horde_frenzy', slot: null }, st)?.text).toContain('buy or free a slot');
    expect(toastForEvent({ type: 'abilityUnlocked', abilityId: 'horde_frenzy', slot: null })?.text).toContain('equip it at a nest');
  });
  it('toastDedupe refreshes an identical visible toast, else adds', () => {
    expect(toastDedupe([], 'HORDE FULL')).toBe('add');
    expect(toastDedupe(['a', 'HORDE FULL', 'b'], 'HORDE FULL')).toBe(1);
    expect(toastDedupe(['a', null], 'b')).toBe('add');
  });
  it('abilitySlotView still works', () => {
    const st = mk(1);
    st.progression.equipped[0] = null;
    expect(abilitySlotView(st, 0).kind).toBe('empty');
    st.progression.equipped[0] = 'rush';
    expect(abilitySlotView(st, 0).abilityId).toBe('rush');
  });
});

describe('EW-T009 senses, vision panel, map gating, threat pips', () => {
  it('computes cue screen angle for front, right, left, behind relative to cameraYaw', () => {
    const leader = { x: 10, z: 20 };
    // cameraYaw = 0 looks toward +Z; screen-right is -X
    expect(cueScreenAngle(leader, { x: 10, z: 40 }, 0)).toBeCloseTo(0);
    expect(cueScreenAngle(leader, { x: 0, z: 20 }, 0)).toBeCloseTo(Math.PI / 2);
    expect(cueScreenAngle(leader, { x: 20, z: 20 }, 0)).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(cueScreenAngle(leader, { x: 10, z: 0 }, 0))).toBeCloseTo(Math.PI);

    // cameraYaw = PI/2 looks toward +X; screen-right is +Z
    expect(cueScreenAngle(leader, { x: 30, z: 20 }, Math.PI / 2)).toBeCloseTo(0);
    expect(cueScreenAngle(leader, { x: 10, z: 40 }, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(cueScreenAngle(leader, { x: 10, z: 0 }, Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(cueScreenAngle(leader, { x: -10, z: 20 }, Math.PI / 2))).toBeCloseTo(Math.PI);
  });

  it('scales cue opacity by intensity and remaining lifetime', () => {
    expect(cueOpacity(1, 0, 2.5)).toBeCloseTo(1);
    expect(cueOpacity(0.8, 0, 2)).toBeCloseTo(0.8);
    expect(cueOpacity(0.8, 1, 2)).toBeCloseTo(0.4);
    expect(cueOpacity(0.8, 2, 2)).toBe(0);
    expect(cueOpacity(0.8, 3, 2)).toBe(0);
    expect(cueOpacity(0, 0, 2)).toBe(0);
    expect(cueOpacity(0.5, 0, 0)).toBe(0);
  });

  it('gates map human visibility to identified, seen, or none', () => {
    const { state } = world();
    const g0 = state.guards[0];
    const g1 = state.guards[1];
    const g2 = state.guards[2];
    state.vision.identified = [g0.id].sort((a, b) => a - b);
    state.vision.seen = [g1.id].sort((a, b) => a - b);

    expect(mapHumanVisibility(state, g0)).toBe('identified');
    expect(mapHumanVisibility(state, g1)).toBe('seen');
    expect(mapHumanVisibility(state, g2)).toBe('none');

    g0.hp = 0;
    g0.state = 'DEAD';
    expect(mapHumanVisibility(state, g0)).toBe('none');
  });

  it('clamps threat pip count to 1..5', () => {
    expect(threatPipCount(1)).toBe(1);
    expect(threatPipCount(3)).toBe(3);
    expect(threatPipCount(5)).toBe(5);
  });

  it('builds eyesight panel view model with cost, affordable, and MAX', () => {
    const { state } = world();
    state.progression.visionTier = 1;
    state.progression.biomass = 10;
    const t1 = eyesightPanelView(state);
    expect(t1.tier).toBe(1);
    expect(t1.name).toBe('Rotten Eyes');
    expect(t1.clearRadius).toBe(BALANCE.vision.tiers[0].clearRadius);
    expect(t1.nextCost).toBe(BALANCE.vision.tierCosts[1]);
    expect(t1.nextTierName).toBe('Predator Sight');
    expect(t1.affordable).toBe(false);

    state.progression.biomass = BALANCE.vision.tierCosts[1];
    expect(eyesightPanelView(state).affordable).toBe(true);

    state.progression.visionTier = 4;
    const t4 = eyesightPanelView(state);
    expect(t4.name).toBe('Apex Vision');
    expect(t4.nextCost).toBeNull();
    expect(t4.nextTierName).toBeNull();
    expect(t4.affordable).toBe(false);
    expect(t4.detects.length).toBeGreaterThanOrEqual(4);
  });

  it('formats visionUpgraded and maxVision toasts', () => {
    expect(toastForEvent({ type: 'visionUpgraded', tier: 2, cost: 20 })).toEqual({
      text: 'Eyes adjust \u2014 Predator Sight',
      kind: 'good',
    });
    expect(toastForEvent({ type: 'abilityDenied', abilityId: null, reason: 'maxVision' })).toEqual({
      text: 'Eyesight already at max',
      kind: 'warn',
    });
  });
});

describe('warning cues (gunshot / scream)', () => {
  it('are always clearly visible while alive and fade only with age', async () => {
    const { cueOpacity, isWarningCue, WARNING_CUE_MIN_OPACITY } = await import('../src/ui/uiHelpers');
    expect(isWarningCue('gunshot')).toBe(true);
    expect(isWarningCue('scream')).toBe(true);
    expect(isWarningCue('siren')).toBe(false);
    expect(isWarningCue('crowd')).toBe(false);
    expect(cueOpacity(0, 0, 2.5, WARNING_CUE_MIN_OPACITY)).toBeCloseTo(WARNING_CUE_MIN_OPACITY);
    expect(cueOpacity(0.1, 0, 2.5, WARNING_CUE_MIN_OPACITY)).toBeCloseTo(WARNING_CUE_MIN_OPACITY);
    expect(cueOpacity(1, 0, 2.5, WARNING_CUE_MIN_OPACITY)).toBeCloseTo(1);
    expect(cueOpacity(0, 2.5, 2.5, WARNING_CUE_MIN_OPACITY)).toBe(0);
    expect(cueOpacity(0, 0, 2.5)).toBe(0);
  });
});
