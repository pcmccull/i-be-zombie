import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { StorageLike } from '../src/core/contracts';
import type { DistrictLayout, WorldSave } from '../src/core/types';
import { SaveStore } from '../src/persistence/SaveStore';
import {
  applySave,
  createSave,
  decodeBits,
  encodeBits,
  MIGRATIONS,
  parseSave,
  SAVE_VERSION,
} from '../src/persistence/saveSchema';
import { Simulation } from '../src/sim/Simulation';
import { buildLegacyDistrictLayout } from '../src/world/legacyDistrictLayout';

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(_key: string): string | null {
    throw new Error('SecurityError: storage disabled');
  }
  setItem(_key: string, _value: string): void {
    throw new Error('QuotaExceededError');
  }
  removeItem(_key: string): void {
    throw new Error('SecurityError: storage disabled');
  }
}

function buildFixtureLayout(): DistrictLayout {
  const base = buildLegacyDistrictLayout();
  // Structure 4 is the police penGate; Checkpoint gate is 'gate'.
  base.strongholds = [
    {
      id: 'suburb_checkpoint',
      districtId: 'suburbs',
      name: 'Suburb Police Checkpoint',
      bounds: { minX: 4, minZ: 24, maxX: 28, maxZ: 40 },
      center: { x: 16, z: 32 },
      defenseTier: 1,
      unlock: null,
      biomassReward: 15,
      objectives: [
        { id: 'break_pen', label: 'Break the holding pen', kind: 'destroyStructure', structureId: 4 },
        { id: 'defenders', label: 'Overrun the checkpoint police', kind: 'killDefenders' },
      ],
      nestId: 'nest_suburb',
      reinforcementPoints: [{ x: 2, z: 30 }],
    },
    {
      id: 'police_station',
      districtId: 'police',
      name: 'Police Station',
      bounds: { minX: 62, minZ: -84, maxX: 104, maxZ: -52 },
      center: { x: 83, z: -68 },
      defenseTier: 2,
      unlock: 'alpha_claws',
      biomassReward: 30,
      objectives: [
        { id: 'breach', label: 'Breach the station doors', kind: 'destroyStructure', structureId: 2 },
        { id: 'disable_command', label: 'Hold the command room', kind: 'holdPoint', point: { x: 83, z: -65 }, radius: 6, holdTime: 5, minZombies: 3 },
      ],
      nestId: 'nest_police',
      reinforcementPoints: [{ x: 55, z: -60 }],
    },
  ];
  base.nests = [
    { id: 'start', districtId: 'suburbs', pos: { ...base.playerStart }, strongholdId: null },
    { id: 'nest_suburb', districtId: 'suburbs', pos: { x: 18, z: 30 }, strongholdId: 'suburb_checkpoint' },
    { id: 'nest_police', districtId: 'police', pos: { x: 60, z: -30 }, strongholdId: 'police_station' },
  ];
  // Tag barricade soldiers with strongholdId 'suburb_checkpoint' and checkpoint soldiers with 'police_station'
  for (const g of base.guards) {
    if (g.post === 'barricade') {
      g.strongholdId = 'suburb_checkpoint';
    } else if (g.post === 'checkpoint') {
      g.strongholdId = 'police_station';
    }
  }
  return base;
}

describe('T006 Persistence — encodeBits / decodeBits', () => {
  it('round-trips arbitrary lengths without Buffer/btoa', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 7, 16, 63, 64, 65, 320]) {
      const src = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        src[i] = (i * 73 + 19) & 0xff;
      }
      const encoded = encodeBits(src);
      expect(encoded.length % 4).toBe(0);
      const decoded = decodeBits(encoded, len);
      expect(Array.from(decoded)).toEqual(Array.from(src));
    }
  });

  it('handles malformed base64 and mismatched lengths gracefully', () => {
    expect(Array.from(decodeBits('!!!not-base64!!!', 8))).toEqual(new Array(8).fill(0));
    expect(Array.from(decodeBits('abc', 4))).toEqual([0, 0, 0, 0]);
    const short = encodeBits(new Uint8Array([1, 0, 1]));
    const padded = decodeBits(short, 6);
    expect(Array.from(padded)).toEqual([1, 0, 1, 0, 0, 0]);
  });
});

describe('T006 Persistence — createSave / SaveStore / applySave round-trip', () => {
  it('round-trips progression, districts, strongholds, destroyed structures/gate, and discovery bits', () => {
    const layout = buildFixtureLayout();
    const sim1 = new Simulation(layout, 4242);
    const s1 = sim1.state;

    // Mutate progression
    s1.progression.biomass = 65;
    s1.progression.unlocked.push('alpha_claws', 'horde_frenzy');
    s1.progression.equipped = ['alpha_claws', 'horde_frenzy', null, null];
    s1.activeNestId = 'nest_suburb';

    // Mutate districts (including discovery != conquest)
    s1.districts.suburbs = {
      id: 'suburbs',
      status: 'infected',
      discovered: true,
      infection: 1,
      humanStrength: 0,
      alertLevel: 0.1,
      strongholdCaptured: true,
    };
    s1.districts.police = {
      id: 'police',
      status: 'human',
      discovered: true,
      infection: 0.25,
      humanStrength: 0.8,
      alertLevel: 0.4,
      strongholdCaptured: false,
    };
    s1.districts.shopping = {
      id: 'shopping',
      status: 'contested',
      discovered: true,
      infection: 0.5,
      humanStrength: 0.5,
      alertLevel: 0.75,
      strongholdCaptured: false,
    };

    // Mutate strongholds
    const shSuburb = s1.strongholds.find(sh => sh.id === 'suburb_checkpoint')!;
    shSuburb.captured = true;
    shSuburb.objectivesDone = ['break_pen', 'defenders'];
    shSuburb.reinforcementsSpent = 2;

    const shPolice = s1.strongholds.find(sh => sh.id === 'police_station')!;
    shPolice.captured = false;
    shPolice.objectivesDone = ['breach'];
    shPolice.reinforcementsSpent = 1;

    // Destroy structure 1 (bus door) and structure 4 (pen gate) + main gate
    for (const st of s1.structures) {
      if (st.id === 1 || st.id === 4) {
        st.destroyed = true;
        st.hp = 0;
      }
    }
    s1.gate.destroyed = true;
    s1.gate.hp = 0;

    // Reveal specific discovery cells
    s1.discovery.bits[0] = 1;
    s1.discovery.bits[5] = 1;
    s1.discovery.bits[17] = 1;
    s1.discovery.bits[s1.discovery.bits.length - 1] = 1;
    s1.discovery.revealed = 4;

    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    const saved = createSave(s1, 4242, 1700000000000);

    expect(saved.version).toBe(SAVE_VERSION);
    expect(saved.acquiredUpgrades).toEqual(['alpha_claws', 'horde_frenzy']);
    expect(store.save(saved)).toBe(true);

    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(saved);

    // Apply onto a fresh Simulation
    const sim2 = new Simulation(layout, loaded!.seed);
    sim2.drainEvents(); // clear any init events
    applySave(sim2.ctx, loaded!);

    // Silent restoration: no events emitted
    expect(sim2.drainEvents()).toEqual([]);

    const s2 = sim2.state;
    expect(s2.progression.biomass).toBe(65);
    expect(s2.progression.unlocked).toEqual(['bite', 'infect', 'alpha_claws', 'horde_frenzy']);
    expect(s2.progression.equipped).toEqual(['alpha_claws', 'horde_frenzy', null, null]);
    expect(s2.activeNestId).toBe('nest_suburb');

    // Districts restored, including discovered 'police' keeping status 'human' (discovery != conquest)
    expect(s2.districts.suburbs).toEqual(s1.districts.suburbs);
    expect(s2.districts.police).toEqual(s1.districts.police);
    expect(s2.districts.police.discovered).toBe(true);
    expect(s2.districts.police.status).toBe('human');
    expect(s2.districts.shopping).toEqual({ ...s1.districts.shopping, status: 'human' }); // 'contested' is transient: normalised on load

    // Strongholds restored
    const restoredSuburb = s2.strongholds.find(sh => sh.id === 'suburb_checkpoint')!;
    expect(restoredSuburb.captured).toBe(true);
    expect(restoredSuburb.objectivesDone).toEqual(['break_pen', 'defenders']);
    expect(restoredSuburb.reinforcementsSpent).toBe(2);

    const restoredPolice = s2.strongholds.find(sh => sh.id === 'police_station')!;
    expect(restoredPolice.captured).toBe(false);
    expect(restoredPolice.objectivesDone).toEqual(['breach']);
    expect(restoredPolice.reinforcementsSpent).toBe(1);

    // Structures 1 and 4 destroyed silently, colliders disabled, held zombies released (heldBy = 0)
    for (const id of [1, 4]) {
      const st = s2.structures.find(s => s.id === id)!;
      expect(st.destroyed).toBe(true);
      expect(st.hp).toBe(0);
      expect(st.destroyedAt).toBe(0);
      expect(sim2.ctx.collision.colliders[st.colliderId].enabled).toBe(false);
      expect(s2.zombies.some(z => z.heldBy === id)).toBe(false);
    }
    // Structure 2 and 3 remain intact
    for (const id of [2, 3]) {
      const st = s2.structures.find(s => s.id === id)!;
      expect(st.destroyed).toBe(false);
      expect(sim2.ctx.collision.colliders[st.colliderId].enabled).toBe(true);
    }

    // Gate destroyed and collider disabled
    expect(s2.gate.destroyed).toBe(true);
    expect(s2.gate.hp).toBe(0);
    expect(sim2.ctx.collision.colliders[s2.gate.colliderId].enabled).toBe(false);

    // Captured stronghold ('suburb_checkpoint') defenders removed; uncaptured ('police_station') defenders kept
    expect(s2.guards.some(g => g.strongholdId === 'suburb_checkpoint')).toBe(false);
    expect(s2.guards.some(g => g.strongholdId === 'police_station')).toBe(true);

    // Discovery bits and revealed count restored
    expect(s2.discovery.revealed).toBe(4);
    expect(Array.from(s2.discovery.bits)).toEqual(Array.from(s1.discovery.bits));

    // Leader and live followers moved to active nest ('nest_suburb' at 18, 30) on walkable points
    const nestPos = layout.nests.find(n => n.id === 'nest_suburb')!.pos;
    expect(Math.hypot(s2.leader.pos.x - nestPos.x, s2.leader.pos.z - nestPos.z)).toBeLessThan(3);
    expect(sim2.ctx.navGrid.isWalkable(s2.leader.pos)).toBe(true);
    const followers = s2.zombies.filter(z => z.state === 'follower');
    expect(followers.length).toBe(BALANCE.horde.startFollowers);
    for (const f of followers) {
      expect(sim2.ctx.navGrid.isWalkable(f.pos)).toBe(true);
      expect(sim2.ctx.collision.isBlocked(f.pos, f.radius)).toBe(false);
      expect(Math.hypot(f.pos.x - s2.leader.pos.x, f.pos.z - s2.leader.pos.z)).toBeLessThan(10);
    }
  });

  it('applying a save twice is idempotent and does not rebuild nav grids a second time', () => {
    const layout = buildFixtureLayout();
    const sim = new Simulation(layout, 99);
    sim.state.progression.biomass = 40;
    sim.state.progression.unlocked.push('alpha_claws');
    sim.state.progression.equipped = ['alpha_claws', null, null, null];
    sim.state.structures[0].destroyed = true;
    sim.state.gate.destroyed = true;
    sim.state.discovery.bits[3] = 1;
    sim.state.strongholds[0].captured = true;
    sim.state.strongholds[0].objectivesDone = ['break_pen', 'defenders'];

    const save = createSave(sim.state, 99, 100);

    const targetSim = new Simulation(layout, 99);
    applySave(targetSim.ctx, save);

    const navVerAfterFirst = targetSim.ctx.navGrid.version;
    const crawlVerAfterFirst = targetSim.ctx.crawlNavGrid.version;
    const snapshotAfterFirst = JSON.stringify({
      progression: targetSim.state.progression,
      districts: targetSim.state.districts,
      strongholds: targetSim.state.strongholds,
      structures: targetSim.state.structures,
      gate: targetSim.state.gate,
      guards: targetSim.state.guards.map(g => g.id),
      leaderPos: targetSim.state.leader.pos,
      followerPos: targetSim.state.zombies.filter(z => z.state === 'follower').map(z => z.pos),
      revealed: targetSim.state.discovery.revealed,
    });

    applySave(targetSim.ctx, save);

    expect(targetSim.ctx.navGrid.version).toBe(navVerAfterFirst);
    expect(targetSim.ctx.crawlNavGrid.version).toBe(crawlVerAfterFirst);
    const snapshotAfterSecond = JSON.stringify({
      progression: targetSim.state.progression,
      districts: targetSim.state.districts,
      strongholds: targetSim.state.strongholds,
      structures: targetSim.state.structures,
      gate: targetSim.state.gate,
      guards: targetSim.state.guards.map(g => g.id),
      leaderPos: targetSim.state.leader.pos,
      followerPos: targetSim.state.zombies.filter(z => z.state === 'follower').map(z => z.pos),
      revealed: targetSim.state.discovery.revealed,
    });
    expect(snapshotAfterSecond).toBe(snapshotAfterFirst);
  });

  it('sanitizes equipped abilities, clamps negative biomass, falls back to start nest, and filters unknown strongholds/objectives', () => {
    const layout = buildFixtureLayout();
    const sim = new Simulation(layout, 123);
    const save = createSave(sim.state, 123, 500);

    // Mutate save with edge cases for applySave:
    // - negative biomass
    // - innate ability ('bite'), locked ability ('brute_evolution'), and duplicate ('alpha_claws') in equipped
    // - unknown selectedNestId
    // - unknown stronghold id + unknown objective id
    save.player.biomass = -50;
    save.player.unlockedAbilities = ['alpha_claws']; // missing innate in raw array
    save.player.equippedAbilities = ['bite', 'alpha_claws', 'alpha_claws', 'brute_evolution'];
    save.player.slotsOwned = 4;
    save.player.selectedNestId = 'non_existent_nest';
    save.strongholds.suburb_checkpoint.objectivesDone = ['break_pen', 'bogus_objective', 'break_pen'];
    (save.strongholds as Record<string, unknown>)['unknown_stronghold'] = {
      id: 'unknown_stronghold',
      captured: true,
      objectivesDone: ['anything'],
      reinforcementsSpent: 5,
    };

    applySave(sim.ctx, save);

    expect(sim.state.progression.biomass).toBe(0);
    expect(sim.state.progression.unlocked).toEqual(['bite', 'infect', 'alpha_claws']);
    expect(sim.state.progression.equipped).toEqual([null, 'alpha_claws', null, null]);
    expect(sim.state.activeNestId).toBe('start');
    const sh = sim.state.strongholds.find(s => s.id === 'suburb_checkpoint')!;
    expect(sh.objectivesDone).toEqual(['break_pen']);
  });
});

describe('T006 Persistence — parseSave validation, migrations, and SaveStore resilience', () => {
  it('rejects corrupt JSON, wrong types, negative biomass, invalid abilities/statuses, and future versions', () => {
    const sim = new Simulation(buildFixtureLayout(), 7);
    const valid = createSave(sim.state, 7, 1000);

    expect(parseSave(null)).toBeNull();
    expect(parseSave(undefined)).toBeNull();
    expect(parseSave('string')).toBeNull();
    expect(parseSave(123)).toBeNull();
    expect(parseSave([])).toBeNull();

    // Future version -> null
    expect(parseSave({ ...valid, version: SAVE_VERSION + 1 })).toBeNull();
    // Version < 1 without migration -> null
    expect(parseSave({ ...valid, version: 0 })).toBeNull();
    expect(parseSave({ ...valid, version: -1 })).toBeNull();

    // Non-finite numbers -> null
    expect(parseSave({ ...valid, seed: Number.NaN })).toBeNull();
    expect(parseSave({ ...valid, savedAt: Number.POSITIVE_INFINITY })).toBeNull();

    // Negative biomass -> null in parseSave
    expect(parseSave({ ...valid, player: { ...valid.player, biomass: -1 } })).toBeNull();

    // Wrong equipped length or unknown ability id -> null
    expect(parseSave({ ...valid, player: { ...valid.player, equippedAbilities: [null, null] } })).toBeNull();
    expect(
      parseSave({
        ...valid,
        player: { ...valid.player, unlockedAbilities: ['not_a_real_ability' as never] },
      }),
    ).toBeNull();
    expect(
      parseSave({
        ...valid,
        player: { ...valid.player, equippedAbilities: ['not_a_real_ability' as never, null, null, null] },
      }),
    ).toBeNull();

    // Invalid territory status -> null
    expect(
      parseSave({
        ...valid,
        districts: {
          ...valid.districts,
          suburbs: { ...valid.districts.suburbs, status: 'conquered' as never },
        },
      }),
    ).toBeNull();

    // Invalid base64 in discoveryBits -> null
    expect(parseSave({ ...valid, discoveryBits: 'not valid base64!' })).toBeNull();

    // Clamps 0..1 fields on districts and sanitizes equipped slots in parseSave
    const clamped = parseSave({
      ...valid,
      player: {
        ...valid.player,
        unlockedAbilities: ['bite', 'infect', 'alpha_claws'],
        equippedAbilities: ['bite', 'alpha_claws', 'alpha_claws', 'horde_frenzy'],
        slotsOwned: 4,
      },
      districts: {
        ...valid.districts,
        suburbs: {
          ...valid.districts.suburbs,
          infection: 2.5,
          humanStrength: -0.4,
          alertLevel: 99,
        },
      },
    });
    expect(clamped).not.toBeNull();
    expect(clamped!.districts.suburbs.infection).toBe(1);
    expect(clamped!.districts.suburbs.humanStrength).toBe(0);
    expect(clamped!.districts.suburbs.alertLevel).toBe(1);
    expect(clamped!.player.equippedAbilities).toEqual([null, 'alpha_claws', null, null]);
  });

  it('runs MIGRATIONS chain when version < SAVE_VERSION', () => {
    const sim = new Simulation(buildFixtureLayout(), 7);
    const valid = createSave(sim.state, 7, 1000);
    MIGRATIONS[0] = (old: unknown) => ({
      ...(old as Record<string, unknown>),
      version: SAVE_VERSION,
      savedAt: 9999,
    });
    try {
      const migrated = parseSave({ ...valid, version: 0 });
      expect(migrated).not.toBeNull();
      expect(migrated!.version).toBe(SAVE_VERSION);
      expect(migrated!.savedAt).toBe(9999);
    } finally {
      delete MIGRATIONS[0];
    }
  });

  it('SaveStore never throws on null storage, throwing storage, or corrupt JSON', () => {
    const sim = new Simulation(buildFixtureLayout(), 1);
    const valid = createSave(sim.state, 1, 100);

    // Null storage
    const nullStore = new SaveStore(null);
    expect(nullStore.load()).toBeNull();
    expect(nullStore.save(valid)).toBe(false);
    expect(() => nullStore.clear()).not.toThrow();

    // Throwing storage (QuotaExceeded / SecurityError)
    const throwingStore = new SaveStore(new ThrowingStorage());
    expect(throwingStore.load()).toBeNull();
    expect(throwingStore.save(valid)).toBe(false);
    expect(() => throwingStore.clear()).not.toThrow();

    // Corrupt JSON in storage
    const mem = new MemoryStorage();
    const store = new SaveStore(mem, 'custom.key');
    mem.setItem('custom.key', '{corrupt json');
    expect(store.load()).toBeNull();

    // Valid save, load, and clear
    expect(store.save(valid)).toBe(true);
    expect(store.load()).toEqual(valid);
    store.clear();
    expect(store.load()).toBeNull();

    // Refuses to save malformed WorldSave
    expect(store.save({ ...valid, version: 999 } as WorldSave)).toBe(false);
  });
});
