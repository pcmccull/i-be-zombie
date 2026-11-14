// F1 regressions: cap, dead-Alpha abilities, contested save round trip, patrol stand-down, tower guards, SaveStore, nest auto-move.
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { StorageLike } from '../src/core/contracts';
import { createZombie } from '../src/entities/Zombie';
import { SaveStore } from '../src/persistence/SaveStore';
import { createSave, parseSave, SAVE_VERSION } from '../src/persistence/saveSchema';
import { Simulation } from '../src/sim/Simulation';
import { activateAbility, canActivate, equipAbility, unlockAbility } from '../src/systems/ProgressionSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';

const dt = BALANCE.sim.fixedDt;
const layout = buildDistrictLayout();
const make = (): Simulation => new Simulation(layout, 7);

describe('F1 regressions', () => {
  it('conversion respects the open-world cap (40 followers + pending conversions never exceed 40)', () => {
    const sim = make(), s = sim.state;
    s.zombies = []; s.followerCount = 0;
    for (let i = 0; i < BALANCE.openWorld.maxFollowers; i++) {
      s.zombies.push(createZombie(sim.ctx.newId(), { x: s.leader.pos.x + 2 + (i % 8) * 0.5, z: s.leader.pos.z + 2 + Math.floor(i / 8) * 0.5 },
        { state: 'follower', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng }));
      s.followerCount++;
    }
    for (let i = 0; i < 20; i++) {
      s.pendingConversions.push({ guardId: 90000 + i, pos: { x: s.leader.pos.x - 3, z: s.leader.pos.z - 3 - i * 0.3 }, facing: 0, resolveAt: 0, willConvert: true });
    }
    for (let i = 0; i < 400; i++) {
      sim.step(dt, emptyInput());
      const live = s.zombies.filter(z => z.state === 'follower' || z.state === 'rising').length;
      expect(live).toBeLessThanOrEqual(BALANCE.openWorld.maxFollowers);
      expect(s.followerCount).toBeLessThanOrEqual(BALANCE.openWorld.maxFollowers);
    }
  });

  it('a dead Alpha / non-playing phase cannot activate or equip abilities', () => {
    const sim = make(), s = sim.state;
    unlockAbility(sim.ctx, 'horde_frenzy');
    s.progression.biomass = 500;
    expect(canActivate(s, 'horde_frenzy')).toBeNull();
    s.leader.alive = false; s.leader.hp = 0; s.phase = 'respawning';
    expect(canActivate(s, 'horde_frenzy')).toBe('locked');
    expect(activateAbility(sim.ctx, 'horde_frenzy')).toBe(false);
    expect(s.progression.biomass).toBe(500);
    expect(s.progression.cooldowns.horde_frenzy ?? 0).toBe(0);
    expect(equipAbility(sim.ctx, 1, 'horde_frenzy')).toBe(false);
    s.leader.alive = true; s.leader.hp = s.leader.maxHp;
    expect(canActivate(s, 'horde_frenzy')).toBe('locked'); // phase still respawning
  });

  it("a saved 'contested' district status loads as 'human' (transient state is not persisted)", () => {
    const sim = make();
    sim.state.districts.police.status = 'contested';
    const save = parseSave(JSON.parse(JSON.stringify(createSave(sim.state, 7))))!;
    expect(save.districts.police.status).toBe('contested');
    const loaded = new Simulation(layout, 7, save);
    expect(loaded.state.districts.police.status).toBe('human');
    for (let i = 0; i < 60; i++) loaded.step(dt, emptyInput());
    expect(loaded.state.districts.police.status).not.toBe('contested');
  });

  it('infected districts stand down far-away patrols (never near the Alpha)', () => {
    const sim = make(), s = sim.state;
    const patrols = s.guards.filter(g => g.post === 'patrol');
    expect(patrols.length).toBeGreaterThan(0);
    const target = patrols[0];
    // Infect whichever district hosts the first patrol.
    const def = layout.districts.find(d => target.pos.x >= d.rect.minX && target.pos.x <= d.rect.maxX &&
      target.pos.z >= d.rect.minZ && target.pos.z <= d.rect.maxZ)!;
    s.districts[def.id].status = 'infected';
    const inDistrict = (g: typeof target): boolean => g.pos.x >= def.rect.minX && g.pos.x <= def.rect.maxX &&
      g.pos.z >= def.rect.minZ && g.pos.z <= def.rect.maxZ;
    const before = s.guards.filter(g => g.post === 'patrol' && inDistrict(g)).length;
    for (let i = 0; i < 90; i++) sim.step(dt, emptyInput());
    const dormantStillThere = s.guards.filter(g => g.post === 'patrol' && g.dormant && g.hp > 0 && inDistrict(g));
    expect(dormantStillThere).toHaveLength(0);
    if (s.guards.includes(target)) expect(target.dormant).toBe(false);
    expect(before).toBeGreaterThan(0);
  });

  it('captured tower guards come down to the ground', () => {
    const sim = make(), s = sim.state;
    const towerGuards = s.guards.filter(g => g.strongholdId === 'industrial_yard' && g.tower !== null);
    expect(towerGuards.length).toBeGreaterThan(0);
    const sh = s.strongholds.find(x => x.id === 'industrial_yard')!;
    sh.objectivesDone = layout.strongholds.find(d => d.id === 'industrial_yard')!.objectives.map(o => o.id);
    sim.step(dt, emptyInput());
    expect(sh.captured).toBe(true);
    for (const g of towerGuards) { expect(g.tower).toBeNull(); expect(g.towerColliderId).toBeNull(); expect(g.elevation).toBe(0); expect(g.role).toBe('civilian'); }
  });

  it('after a reload, a later capture still auto-moves the active respawn nest', () => {
    const a = make();
    a.step(dt, emptyInput());
    const police = layout.strongholds.find(d => d.id === 'police_station')!;
    const mall = layout.strongholds.find(d => d.id === 'mall_security')!;
    a.state.strongholds.find(x => x.id === 'police_station')!.objectivesDone = police.objectives.map(o => o.id);
    a.step(dt, emptyInput());
    expect(a.state.activeNestId).toBe(police.nestId);
    const save = parseSave(JSON.parse(JSON.stringify(createSave(a.state, 7))))!;
    const b = new Simulation(layout, 7, save);
    b.step(dt, emptyInput());
    b.state.strongholds.find(x => x.id === 'mall_security')!.objectivesDone = mall.objectives.map(o => o.id);
    b.step(dt, emptyInput());
    expect(b.state.activeNestId).toBe(mall.nestId);
  });

  it('SaveStore refuses to overwrite a save written by a newer version', () => {
    const data = new Map<string, string>();
    const storage: StorageLike = {
      getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); },
    };
    const store = new SaveStore(storage, 'k');
    const sim = make();
    const save = createSave(sim.state, 7);
    expect(store.save(save)).toBe(true);
    const newer = JSON.stringify({ version: SAVE_VERSION + 1, future: true });
    data.set('k', newer);
    expect(store.load()).toBeNull();
    expect(store.save(save)).toBe(false);
    expect(data.get('k')).toBe(newer);
    store.clear();
    expect(store.save(save)).toBe(true);
  });
});
