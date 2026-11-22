import { describe, expect, it } from 'vitest';
import { canSpawn, createFootstepAccumulator, EMITTERS, footstepColor, isUnlockNearby, mapEvent, mapEvents,
  MAX_CHARGE_EMITTERS, PARTICLE_CAPACITY, pickFootsteps, scaledCount, surfaceAt, VfxTile, withinVision } from '../src/graphics/vfx/vfxRules';
import type { FootstepCandidate, FootstepOptions, VfxName } from '../src/graphics/vfx/vfxRules';
import { flashScale, QUALITY_PRESETS } from '../src/graphics/performance/GraphicsQuality';

type Event = Parameters<typeof mapEvent>[0];
type State = NonNullable<Parameters<typeof mapEvent>[1]>;
const pos = { x: 2, z: 3 };
const state = { leader: { pos, prevPos: pos }, guards: [{ id: 7, elevation: 4 }] } as State;
const damage = (target: Extract<Event, { type: 'damage' }>['target']): Event => ({ type: 'damage', target, amount: 5, pos });
const melee: Event = { type: 'melee', attacker: 'leader', attackerId: 1, target: { kind: 'guard', id: 7 }, pos };
const shot = (hit: boolean): Event => ({ type: 'shot', guardId: 7, from: { ...pos, y: 1.5 }, to: { x: 4, y: 0.8, z: 5 }, hit });
const capture: Event = { type: 'strongholdCaptured', strongholdId: 'suburb_checkpoint', districtId: 'suburbs', unlock: 'rush', biomass: 15 };
const unlock: Event = { type: 'abilityUnlocked', abilityId: 'rush', slot: 0 };

describe('event adapters', () => {
  const table: [string, Event, VfxName[]][] = [
    ['swing', { type: 'attackSwing', pos, facing: Math.PI / 2, combo: 1, hit: true }, ['combat.swing']],
    ['melee', melee, ['combat.hit']],
    ['guard damage', damage({ kind: 'guard', id: 7 }), ['combat.hit']],
    ['structure damage', damage({ kind: 'structure', id: 2 }), ['combat.hit']],
    ['gate damage', damage({ kind: 'gate' }), ['combat.hit']],
    ['leader damage', damage({ kind: 'leader' }), ['combat.hit']],
    ['zombie damage', damage({ kind: 'zombie', id: 8 }), ['combat.hit']],
    ['structure detail', { type: 'structureDamaged', id: 2, kind: 'penGate', hp: 5, maxHp: 10, pos }, ['combat.hit']],
    ['bat hit', { type: 'humanMelee', guardId: 7, pos, hit: true }, ['combat.hit']],
    ['shot hit', shot(true), ['defender.muzzle', 'combat.hit']],
    ['shot miss', shot(false), ['defender.muzzle', 'bullet.impact']],
    ['recruit', { type: 'recruited', zombieId: 8, pos, viaRally: false, generation: 0 }, ['zombie.recruited']],
    ['convert', { type: 'converted', guardId: 7, zombieId: 8, pos }, ['zombie.recruited']],
    ['cascade', { type: 'recruitPulse', zombieId: 8, pos, radius: 5, generation: 1, recruits: 2 }, ['zombie.recruited']],
    ['rally', { type: 'rally', pos, radius: 10 }, ['horde.rally']],
    ['frenzy', { type: 'frenzyStart', pos, radius: 10 }, ['horde.charge']],
    ['rush', { type: 'rushStart' }, ['horde.charge']],
    ['barricade', { type: 'structureDestroyed', id: 2, kind: 'penGate', landmark: 'barricade', pos }, ['barricade.destroyed']],
    ['gate', { type: 'gateDestroyed', pos }, ['barricade.destroyed']],
    ['bus', { type: 'structureDestroyed', id: 1, kind: 'busDoor', landmark: 'bus', pos }, ['vehicle.explosion']],
    ['lethal vehicle', { type: 'vehicleHit', vehicleId: 9, pos, target: 'zombie', speed: 12, killed: true }, ['vehicle.impact']],
    ['nonlethal vehicle', { type: 'vehicleHit', vehicleId: 9, pos, target: 'leader', speed: 6, killed: false }, ['vehicle.impact']],
    ['zombie death', { type: 'zombieDied', zombieId: 8, pos }, ['body.fall']],
    ['human death', { type: 'guardDied', guardId: 7, pos, source: 'zombie', role: 'civilian' }, ['body.fall']],
    ['driver pulled', { type: 'driverBailed', vehicleId: 9, guardId: 7, pos, pulled: true }, ['vehicle.glass', 'body.fall', 'human.dazed']],
    ['unlock', unlock, ['ability.unlock']],
    ['capture', capture, ['ability.unlock']],
  ];
  it.each(table)('%s maps to its specified effects', (_, ev, names) => {
    expect(mapEvent(ev, state).map(e => e.name)).toEqual(names);
  });
  it('keeps all twenty-nine emitter names, including the per-frame, Living City, and Horde Strength effects', () => {
    expect(Object.keys(EMITTERS)).toHaveLength(29);
    for (const name of ['zombie.footstep', 'horde.charge', 'ambient.mote', 'horde.lastBrainAura'] as const) expect(EMITTERS[name].count).toBeGreaterThan(0);
    expect(MAX_CHARGE_EMITTERS).toBe(24);
  });
  it('does not fabricate impacts for misses, empty pulses, or calm drivers getting out', () => {
    expect(mapEvent({ type: 'humanMelee', guardId: 7, pos, hit: false })).toEqual([]);
    expect(mapEvent({ type: 'recruitPulse', zombieId: 8, pos, radius: 5, generation: 1, recruits: 0 })).toEqual([]);
    expect(mapEvent({ type: 'driverBailed', vehicleId: 9, guardId: 7, pos })).toEqual([]);
    expect(mapEvent({ type: 'rushEnd' })).toEqual([]);
    expect(mapEvent(unlock)).toEqual([]);
  });
  it('retains swing direction, elevated hit height, muzzle and impact positions, and faction colors', () => {
    const swing = mapEvent(table[0][1])[0].payload;
    expect(swing.dirX).toBeCloseTo(1); expect(swing.dirZ).toBeCloseTo(0);
    expect(mapEvent(melee, state)[0].payload.y).toBe(5);
    const s = mapEvent(shot(true));
    expect(s[0].payload).toMatchObject({ x: 2, y: 1.5, z: 3 });
    expect(s[1].payload).toMatchObject({ x: 4, y: 0.8, z: 5, faction: 'zombie', color: 0x98c77d });
    expect(mapEvent(damage({ kind: 'guard', id: 7 }))[0].payload.color).toBe(0xe0782a);
  });
  it('deduplicates melee/damage companions independently of event order, retaining repeated strikes', () => {
    const d = damage({ kind: 'guard', id: 7 });
    expect(mapEvents([melee, d], state)).toHaveLength(1);
    expect(mapEvents([d, melee], state)).toHaveLength(1);
    expect(mapEvents([melee, d, melee, d], state)).toHaveLength(2);
    expect(mapEvents([d, damage({ kind: 'guard', id: 9 })], state)).toHaveLength(2);
  });
  it('deduplicates firearm and bat damage, structure detail, and capture unlock companions', () => {
    const s = shot(true), p = { x: 4, z: 5 };
    expect(mapEvents([s, { type: 'damage', target: { kind: 'zombie', id: 8 }, amount: 5, pos: p }], state).map(e => e.name)).toEqual(['defender.muzzle', 'combat.hit']);
    expect(mapEvents([{ type: 'humanMelee', guardId: 7, pos, hit: true }, damage({ kind: 'leader' })], state)).toHaveLength(1);
    expect(mapEvents([damage({ kind: 'structure', id: 2 }), { type: 'structureDamaged', id: 2, kind: 'penGate', hp: 5, maxHp: 10, pos }], state)).toHaveLength(1);
    expect(mapEvents([capture, unlock], state)).toHaveLength(1);
  });
  it('collapses all three structure-hit representations in every batch order', () => {
    const m: Event = { type: 'melee', attacker: 'leader', attackerId: 1, target: { kind: 'structure', id: 2 }, pos };
    const d = damage({ kind: 'structure', id: 2 });
    const s: Event = { type: 'structureDamaged', id: 2, kind: 'penGate', hp: 5, maxHp: 10, pos };
    for (const batch of [[m, d, s], [m, s, d], [s, m, d], [s, d, m], [d, s, m], [d, m, s]]) expect(mapEvents(batch, state)).toHaveLength(1);
  });
  it('keeps the actual damage point rather than the attacker’s position for paired strikes', () => {
    const impact = { x: 3.5, z: 3 };
    const result = mapEvents([melee, { type: 'damage', target: { kind: 'guard', id: 7 }, amount: 5, pos: impact }], state);
    expect(result).toHaveLength(1); expect(result[0].payload).toMatchObject(impact);
  });
  it('requires a nearby layout stronghold for capture and its matching standalone unlock', () => {
    const layout = { strongholds: [{ id: 'suburb_checkpoint', unlock: 'rush', center: { x: 200, z: 200 } }] } as Parameters<typeof surfaceAt>[0];
    expect(isUnlockNearby(capture, state, layout)).toBe(false);
    expect(isUnlockNearby(unlock, state, layout)).toBe(false);
    layout.strongholds[0].center = pos;
    expect(isUnlockNearby(capture, state, layout)).toBe(true);
    expect(isUnlockNearby(unlock, state, layout)).toBe(true);
    expect(isUnlockNearby(capture, state)).toBe(false);
    expect(isUnlockNearby(unlock, state)).toBe(true);
  });
});

describe('bounded particle admission and accessibility', () => {
  it.each(['low', 'medium', 'high'] as const)('%s drops over-budget bursts without banking them', preset => {
    const profile = QUALITY_PRESETS[preset];
    let live = 0;
    for (let frame = 0; frame < 500; frame++) {
      const count = scaledCount(EMITTERS['vehicle.explosion'].count, profile, false);
      if (canSpawn(live, count, profile.maxParticles)) live += count;
      expect(live).toBeLessThanOrEqual(profile.maxParticles);
    }
    expect(canSpawn(live, profile.maxParticles, profile.maxParticles)).toBe(false);
    // Once particles expire, only this new request enters the pool.
    live = 0;
    const count = scaledCount(10, profile, false);
    if (canSpawn(live, count, profile.maxParticles)) live += count;
    expect(live).toBe(count);
    expect(profile.maxParticles).toBeLessThanOrEqual(PARTICLE_CAPACITY);
  });
  it('handles exact boundaries, invalid requests, low quality and reduced counts', () => {
    expect(canSpawn(380, 4, 384)).toBe(true);
    expect(canSpawn(380, 5, 384)).toBe(false);
    expect(canSpawn(0, 0, 384)).toBe(false);
    expect(canSpawn(-1, 1, 384)).toBe(false);
    expect(canSpawn(0, NaN, 384)).toBe(false);
    expect(scaledCount(12, QUALITY_PRESETS.low, false)).toBe(6);
    expect(scaledCount(12, QUALITY_PRESETS.low, true)).toBe(3);
    expect(scaledCount(12, QUALITY_PRESETS.high, true)).toBe(6);
    expect(scaledCount(-1, QUALITY_PRESETS.high, false)).toBe(0);
    expect(flashScale({ quality: 'high', reducedMotion: true })).toBeLessThan(1);
  });
  it('keeps emitters brief and bounded, with distinctive sprite shapes and bouncing debris', () => {
    for (const c of Object.values(EMITTERS)) {
      expect(c.lifetime[0]).toBeGreaterThan(0); expect(c.lifetime[1]).toBeGreaterThanOrEqual(c.lifetime[0]);
      expect(c.tiles.every(t => t >= 0 && t < 16)).toBe(true);
    }
    expect(EMITTERS['vehicle.explosion'].lifetime[1]).toBeLessThanOrEqual(2.5);
    expect(EMITTERS['zombie.recruited'].tiles).toContain(VfxTile.Wisp);
    expect(EMITTERS['horde.rally'].tiles).toContain(VfxTile.ArrowUp);
    expect(EMITTERS['combat.hit'].tiles).toContain(VfxTile.Star);
    expect(EMITTERS['barricade.destroyed'].bounce).toBeGreaterThan(0);
  });
});

const zombie = (id: number, x = 1, z = 1, moving = true, kind: FootstepCandidate['state'] = 'follower'): FootstepCandidate => ({
  id, state: kind, pos: { x, z }, prevPos: { x: x - (moving ? 0.03 : 0), z }, dormant: false, elevation: 0,
});
const options = (time = 1): FootstepOptions => ({ dt: 0.1, time, rate: 10, radius: 18, focusX: 0, focusZ: 0,
  leaderX: 0, leaderZ: 0, hiddenBeyond: 12 });
describe('footstep sampler', () => {
  it('selects moving followers and ambient walkers within both radii, excluding dormant and elevated units', () => {
    const units = [zombie(1, 19), zombie(2, 13), zombie(3, 1, 1, false), zombie(4, 1, 1, true, 'dead'),
      { ...zombie(5), dormant: true }, { ...zombie(6), elevation: 4 }, zombie(7, 2, 2, true, 'ambient')];
    const a = createFootstepAccumulator();
    expect(pickFootsteps(units, a, options())).toEqual([7]);
  });
  it('uses fixed-step displacement for speed, and interpolated locations for culling', () => {
    const unit = zombie(7, 1, 0); unit.prevPos.x = 0;
    expect(pickFootsteps([unit], createFootstepAccumulator(), { ...options(), alpha: 0, hiddenBeyond: 0 })).toEqual([7]);
    expect(pickFootsteps([unit], createFootstepAccumulator(), { ...options(), alpha: 1, hiddenBeyond: 0 })).toEqual([]);
    unit.prevPos.x = 0.995;
    expect(pickFootsteps([unit], createFootstepAccumulator(), options())).toEqual([]);
  });
  it('enforces total rate over small frames and at least 0.35 seconds between a zombie’s steps', () => {
    const units = Array.from({ length: 30 }, (_, i) => zombie(i + 1));
    const a = createFootstepAccumulator(), last = new Map<number, number>();
    let total = 0;
    for (let frame = 1; frame <= 600; frame++) {
      const time = frame / 60;
      const ids = pickFootsteps(units, a, { ...options(time), dt: 1 / 60 });
      total += ids.length;
      for (const id of ids) { expect(time - (last.get(id) ?? -Infinity)).toBeGreaterThanOrEqual(0.35); last.set(id, time); }
    }
    expect(total).toBe(100);
    expect(a.credit).toBeLessThan(1);
  });
  it('does not bank idle tokens or emit when paused, and reuses caller output', () => {
    const a = createFootstepAccumulator(), out: number[] = [];
    pickFootsteps([], a, { ...options(), dt: 10 }, out);
    expect(a.credit).toBe(0);
    expect(pickFootsteps([zombie(1)], a, { ...options(), dt: 0 }, out)).toBe(out);
    expect(out).toEqual([]);
    expect(pickFootsteps([zombie(1)], a, options(), out)).toEqual([1]);
    expect(pickFootsteps([zombie(1)], a, options(1.1), out)).toEqual([]);
    expect(pickFootsteps([zombie(1)], a, options(1.36), out)).toEqual([1]);
  });
  it('is fair to later candidates across successive frames and bounds its stride side-table', () => {
    const a = createFootstepAccumulator(), units = Array.from({ length: 50 }, (_, i) => zombie(i));
    const ids = new Set<number>();
    for (let frame = 0; frame < 50; frame++) for (const id of pickFootsteps(units, a, options(1 + frame * 0.1))) ids.add(id);
    expect(ids.size).toBe(50); expect(a.times.length).toBe(2048);
  });
});

describe('surfaces and vision', () => {
  const layout = {
    bounds: { minX: -32, maxX: 32, minZ: -32, maxZ: 32 },
    ground: ['road', 'sidewalk', 'plaza', 'park', 'lot', 'compound'].map((kind, i) => ({ kind,
      rect: { minX: -30 + i * 10, maxX: -21 + i * 10, minZ: -10, maxZ: 10 } })),
  } as Parameters<typeof surfaceAt>[0];
  it.each([[-25, 'asphalt'], [-15, 'sidewalk'], [-5, 'sidewalk'], [5, 'grass'], [15, 'concrete'], [25, 'concrete']] as const)('maps x=%s to %s', (x, expected) => {
    expect(surfaceAt(layout, x, 0)).toBe(expected);
    expect(surfaceAt(layout, x, 0)).toBe(expected); // cached bucket lookup
  });
  it('derives beach sand from layout bounds, defaults to grass, and suppresses clean-surface footsteps', () => {
    expect(surfaceAt(layout, 0, 40)).toBe('sand'); expect(surfaceAt(layout, 0, -30)).toBe('grass');
    expect(surfaceAt(layout, 400, 40)).toBe('grass');
    expect(footstepColor('sidewalk')).toBeUndefined(); expect(footstepColor('concrete')).toBeUndefined();
    expect(footstepColor('sand')).toBe(0xe8d6a8); expect(footstepColor('asphalt')).toBe(0x969b9f); expect(footstepColor('grass')).toBe(0x7d9a6a);
  });
  it('honors layered ground priority and independent layouts in the cache', () => {
    const layered = { ...layout, ground: [...layout.ground, { kind: 'park' as const, rect: { minX: -26, maxX: -24, minZ: -1, maxZ: 1 } }] };
    expect(surfaceAt(layered, -25, 0)).toBe('grass'); expect(surfaceAt(layout, -25, 0)).toBe('asphalt');
  });
  it('uses the interpolated leader circle, including its boundary', () => {
    expect(withinVision(3, 4, 0, 0, 5)).toBe(true); expect(withinVision(3, 4.01, 0, 0, 5)).toBe(false);
    expect(withinVision(100, 100, 100, 100, 0)).toBe(true); expect(withinVision(1, 0, 0, 0, -1)).toBe(false);
  });
});

describe('Living City mappings (docs/11_cityupgrade.md §6)', () => {
  const cityPos = { x: 3, z: 4 };
  const interact = (kind: 'trashCan' | 'constructionBarrier' | 'fireHydrant' | 'shopWindow' | 'carAlarm' | 'sirenPost'): Event =>
    ({ type: 'worldInteractable', id: 1, kind, pos: cityPos, label: kind });
  const table: [string, Event, VfxName[]][] = [
    ['trash can', interact('trashCan'), ['interact.dust']],
    ['construction barrier', interact('constructionBarrier'), ['interact.dust']],
    ['fire hydrant', interact('fireHydrant'), ['interact.spray']],
    ['shop window', interact('shopWindow'), ['interact.glass']],
    ['car alarm', interact('carAlarm'), ['interact.alarm']],
    ['siren post', interact('sirenPost'), ['interact.alarm']],
    ['companion perk', { type: 'companionPerk', companionId: 'larry_lifeguard', pos: cityPos, label: 'Whistle' }, ['companion.perk']],
    ['supplies looted', { type: 'suppliesLooted', pos: cityPos, heal: 20 }, ['interact.dust']],
    ['shortcut used', { type: 'shortcutUsed', secretId: 'secret_sewer_shortcut', from: { x: 1, z: 1 }, to: { x: 5, z: 5 } }, ['interact.dust', 'interact.dust']],
    ['reward granted', { type: 'rewardGranted', rewardId: 'cos_boombox', rewardType: 'cosmetic', displayName: 'Retro Boombox' }, ['ability.unlock']],
    ['secret discovered', { type: 'secretDiscovered', secretId: 'secret_zombie_radio', title: 'Radio', pos: cityPos }, ['ability.unlock']],
    ['companion recruited', { type: 'companionRecruited', companionId: 'chef_brainsley', name: 'Chef', pos: cityPos }, ['ability.unlock']],
    ['hideout unlocked', { type: 'hideoutUnlocked', hideoutId: 'suburb_depot', name: 'Depot', pos: cityPos }, ['ability.unlock']],
  ];
  it.each(table)('%s maps to its specified effects', (_, ev, names) => {
    expect(mapEvent(ev, state).map(e => e.name)).toEqual(names);
  });
  it('places the shortcut dust at both ends and the sparkle at the Alpha, not at the discovery point', () => {
    const ends = mapEvent({ type: 'shortcutUsed', secretId: 's', from: { x: 1, z: 1 }, to: { x: 5, z: 5 } }, state).map(e => [e.payload.x, e.payload.z]);
    expect(ends).toEqual([[1, 1], [5, 5]]);
    expect(mapEvent({ type: 'secretDiscovered', secretId: 's', title: 'T', pos: { x: 90, z: 90 } }, state)[0].payload).toMatchObject({ x: 2, z: 3, faction: 'alpha' });
  });
  it('tints the hydrant spray blue and the companion ring by companion', () => {
    expect(mapEvent(interact('fireHydrant'), state)[0].payload.color).toBe(0x7fd6ff);
    expect(mapEvent({ type: 'companionPerk', companionId: 'grandma_rot', pos: cityPos, label: 'Bag' }, state)[0].payload.color).toBe(0xb983ff);
  });
  it('gives rewards without a state no sparkle, and collapses several reward sparkles in one batch', () => {
    expect(mapEvent({ type: 'rewardGranted', rewardId: 'x', rewardType: 'cosmetic', displayName: 'X' })).toEqual([]);
    expect(mapEvents([
      { type: 'rewardGranted', rewardId: 'x', rewardType: 'cosmetic', displayName: 'X' },
      { type: 'secretDiscovered', secretId: 's', title: 'T', pos },
    ], state)).toHaveLength(1);
  });
  it('keeps purely audio city events out of the particle table', () => {
    expect(mapEvent({ type: 'cityEventStarted', eventId: 'e', kind: 'tourist_bus', districtId: 'suburbs', pos: cityPos, label: 'Bus' })).toEqual([]);
    expect(mapEvent({ type: 'districtAlertChanged', districtId: 'suburbs', alert: 'panic', prev: 'normal' })).toEqual([]);
  });
});

describe('Horde Strength mappings (docs/13_hode_health.md)', () => {
  const withZombies = {
    ...state,
    zombies: [
      { id: 10, pos: { x: 10, z: 11 }, elevation: 0 },
      { id: 11, pos: { x: 12, z: 13 }, elevation: 0.5 },
      { id: 12, pos: { x: 14, z: 15 }, elevation: 0 },
      { id: 13, pos: { x: 16, z: 17 }, elevation: 0 },
      { id: 14, pos: { x: 18, z: 19 }, elevation: 0 },
    ],
  } as unknown as State;

  it('maps sharedDamage to one tether at Alpha plus recipient glints using zombie positions with fallback to ev.pos', () => {
    const ev: Event = { type: 'sharedDamage', pos, incoming: 20, shared: 50, recipients: [10, 11, 999], core: 0 };
    const mapped = mapEvent(ev, withZombies);
    expect(mapped.map(e => e.name)).toEqual(['horde.tether', 'horde.tetherGlint', 'horde.tetherGlint', 'horde.tetherGlint']);
    expect(mapped[0].payload).toMatchObject({ x: pos.x, z: pos.z });
    expect(mapped[1].payload).toMatchObject({ x: 10, y: 0.9, z: 11 });
    expect(mapped[2].payload).toMatchObject({ x: 12, y: 1.4, z: 13 });
    expect(mapped[3].payload).toMatchObject({ x: pos.x, z: pos.z });
  });

  it('caps a 50-recipient wipe or multiple sharedDamage events in one batch to at most 1 tether and 4 glints', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => i + 10);
    const wipe: Event = { type: 'sharedDamage', pos, incoming: 100, shared: 250, recipients: fifty, core: 0 };
    const wipeMapped = mapEvents([wipe], withZombies);
    expect(wipeMapped.filter(e => e.name === 'horde.tether')).toHaveLength(1);
    expect(wipeMapped.filter(e => e.name === 'horde.tetherGlint')).toHaveLength(4);

    const multiMapped = mapEvents([
      { type: 'sharedDamage', pos, incoming: 10, shared: 25, recipients: [10, 11], core: 0 },
      { type: 'sharedDamage', pos, incoming: 15, shared: 37.5, recipients: [12, 13, 14], core: 0 },
    ], withZombies);
    expect(multiMapped.filter(e => e.name === 'horde.tether')).toHaveLength(1);
    expect(multiMapped.filter(e => e.name === 'horde.tetherGlint')).toHaveLength(4);
  });

  it('maps lastBrainEnd recovered to horde.recovery and emits nothing on expired or finished', () => {
    expect(mapEvent({ type: 'lastBrainEnd', pos, outcome: 'recovered' }).map(e => e.name)).toEqual(['horde.recovery']);
    expect(mapEvent({ type: 'lastBrainEnd', pos, outcome: 'expired' })).toEqual([]);
    expect(mapEvent({ type: 'lastBrainEnd', pos, outcome: 'finished' })).toEqual([]);
  });
});
