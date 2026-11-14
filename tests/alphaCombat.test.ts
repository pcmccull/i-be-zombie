import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { updateLeader } from '../src/entities/ZombieLeader';
import { Simulation } from '../src/sim/Simulation';
import { damageGuard, damageLeader, resolveLeaderAttack, updateCombat } from '../src/systems/CombatSystem';
import { updateConversion } from '../src/systems/ConversionSystem';
import { CollisionWorld } from '../src/world/CollisionWorld';

const b = BALANCE.alpha, input = emptyInput();
function fixture(claws = false) {
  const sim = new Simulation(), l = sim.state.leader, g = sim.state.guards[5];
  sim.state.zombies = []; sim.state.followerCount = 0; sim.state.guards = [g];
  l.pos = { x: -85, z: 62 }; l.facing = 0;
  g.pos = { x: -85, z: 63.5 }; g.role = 'police'; g.hp = g.maxHp = BALANCE.police.maxHp;
  if (claws) {
    sim.state.progression.unlocked.push('alpha_claws');
    sim.state.progression.equipped[0] = 'alpha_claws';
  }
  return { sim, l, g };
}
function press(sim: Simulation): void { updateLeader(sim.ctx, 0, { ...input, attack: true }); }
function hit(sim: Simulation): void { updateLeader(sim.ctx, sim.state.leader.attackTimer, input); }
function recover(sim: Simulation): void { updateLeader(sim.ctx, sim.state.leader.attackTimer, input); }

describe('Alpha direct combat', () => {
  it('does not auto-melee nearby humans or ordered gates', () => {
    const { sim, l, g } = fixture();
    for (let i = 0; i < 120; i++) { updateLeader(sim.ctx, 1 / 60, input); updateCombat(sim.ctx, 1 / 60, input); }
    expect(g.hp).toBe(g.maxHp);
    sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    l.pos = { x: 83, z: -50.5 };
    updateCombat(sim.ctx, 5, input);
    expect(sim.state.gate.hp).toBe(sim.state.gate.maxHp);
    expect(sim.drainEvents().filter(e => e.type === 'attackSwing' || e.type === 'melee')).toEqual([]);
  });

  it('bites a police officer to death in the configured number of presses', () => {
    const { sim, g } = fixture();
    const presses = Math.ceil(BALANCE.police.maxHp / b.biteDamage);
    for (let i = 0; i < presses; i++) {
      press(sim); hit(sim);
      expect(g.hp).toBe(Math.max(0, BALANCE.police.maxHp - b.biteDamage * (i + 1)));
      recover(sim);
    }
    expect(g.state).toBe('DEAD');
    expect(sim.drainEvents().filter(e => e.type === 'attackSwing')).toHaveLength(presses);
  });

  it('waits for windup, resolves once, and ignores presses throughout recovery', () => {
    const { sim, l, g } = fixture();
    press(sim); expect(l.attackPhase).toBe('windup'); expect(l.attackTimer).toBe(b.biteWindup);
    updateLeader(sim.ctx, b.biteWindup - 0.001, input);
    expect(g.hp).toBe(g.maxHp);
    updateLeader(sim.ctx, 0.001, input);
    expect(g.hp).toBe(g.maxHp - b.biteDamage); expect(l.attackPhase).toBe('recovery');
    expect(l.attackTimer).toBeCloseTo(b.biteRecovery);
    resolveLeaderAttack(sim.ctx); expect(g.hp).toBe(g.maxHp - b.biteDamage);
    updateLeader(sim.ctx, b.biteRecovery - 0.001, { ...input, attack: true });
    expect(l.attackPhase).toBe('recovery');
    updateLeader(sim.ctx, 0.001, { ...input, attack: true });
    expect(l.attackPhase).toBe('ready');
    updateLeader(sim.ctx, 1, input); expect(g.hp).toBe(g.maxHp - b.biteDamage);
    expect(sim.drainEvents().filter(e => e.type === 'attackSwing')).toHaveLength(1);
  });

  it('carries elapsed time across attack phases without losing recovery time', () => {
    const { sim, l, g } = fixture();
    press(sim); updateLeader(sim.ctx, b.biteWindup + b.biteRecovery + 0.1, input);
    expect(l.attackPhase).toBe('ready'); expect(l.attackTimer).toBe(0);
    expect(g.hp).toBe(g.maxHp - b.biteDamage);
  });

  it('chains three claws, staggers on the finisher, then restarts the combo', () => {
    const { sim, l, g } = fixture(true); g.hp = g.maxHp = 500;
    for (let step = 1; step <= 3; step++) {
      press(sim); expect(l.comboStep).toBe(step); expect(l.attackTimer).toBe(b.clawWindup);
      hit(sim); expect(l.attackTimer).toBe(b.clawRecovery[step - 1]);
      expect(g.hp).toBe(500 - b.clawDamage.slice(0, step).reduce((a, d) => a + d, 0));
      expect(g.staggerTime).toBe(step === 3 ? b.staggerTime : 0);
      recover(sim); expect(l.comboWindow).toBe(b.comboWindow);
      updateLeader(sim.ctx, b.comboWindow / 2, input);
    }
    expect(sim.drainEvents().filter(e => e.type === 'attackSwing')).toMatchObject([
      { combo: 1, hit: true }, { combo: 2, hit: true }, { combo: 3, hit: true },
    ]);
    press(sim); expect(l.comboStep).toBe(1);
  });

  it('expires the combo window after recovery and requires claws to be equipped', () => {
    const { sim, l } = fixture(true);
    press(sim); hit(sim); recover(sim);
    updateLeader(sim.ctx, b.comboWindow + 0.001, input);
    press(sim); expect(l.comboStep).toBe(1);
    hit(sim); recover(sim); sim.state.progression.equipped[0] = null;
    press(sim); expect(l.comboStep).toBe(0); expect(l.attackTimer).toBe(b.biteWindup);
  });

  it('uses aim hints, picks the nearest living human in the cone, and rejects targets behind it', () => {
    const { sim, l, g } = fixture();
    const far = { ...g, id: sim.ctx.newId(), pos: { x: -83, z: 62.5 } };
    const dead = { ...g, id: sim.ctx.newId(), hp: 0, state: 'DEAD' as const, pos: { x: -85, z: 62.2 } };
    sim.state.guards.push(far, dead); g.pos = { x: -86, z: 63 };
    press(sim); expect(l.facing).toBeCloseTo(-Math.PI / 4);
    hit(sim); expect(g.hp).toBe(g.maxHp - b.biteDamage); expect(far.hp).toBe(far.maxHp);
    recover(sim); l.facing = Math.PI;
    press(sim); hit(sim);
    expect(sim.drainEvents().filter(e => e.type === 'attackSwing')).toMatchObject([{ hit: true }, { hit: false }]);
    recover(sim);
    updateLeader(sim.ctx, 0, { ...input, attack: true, aimPoint: far.pos });
    expect(l.facing).toBeCloseTo(Math.atan2(2, 0.5));
    hit(sim); expect(far.hp).toBe(far.maxHp - b.biteDamage);
  });

  it('rechecks reach and cover at impact and never damages through walls', () => {
    const { sim, g } = fixture();
    press(sim); g.pos.z += 5; hit(sim); expect(g.hp).toBe(g.maxHp);
    recover(sim); g.pos.z = 63.5;
    sim.ctx.collision = new CollisionWorld(sim.ctx.layout.bounds, [{
      minX: -86, maxX: -84, minZ: 62.6, maxZ: 62.8,
      kind: 'building', height: 6, blocksMove: true, blocksSight: true,
    }]);
    press(sim); hit(sim); expect(g.hp).toBe(g.maxHp);
    expect(sim.drainEvents().filter(e => e.type === 'attackSwing')).toMatchObject([{ hit: false }, { hit: false }]);
  });

  it('uses the longer claw reach while bites miss a target outside bite range', () => {
    const { sim, g } = fixture(); g.pos.z = sim.state.leader.pos.z + b.biteRange + g.radius + 0.1;
    press(sim); hit(sim); expect(g.hp).toBe(g.maxHp);
    recover(sim);
    sim.state.progression.unlocked.push('alpha_claws'); sim.state.progression.equipped[0] = 'alpha_claws';
    press(sim); hit(sim); expect(g.hp).toBe(g.maxHp - b.clawDamage[0]);
  });

  it('emits a forward miss and cannot hit tower occupants from the ground', () => {
    const sim = new Simulation(), tower = sim.state.guards[0], l = sim.state.leader;
    sim.state.zombies = []; sim.state.followerCount = 0; sim.state.guards = [tower];
    l.pos = { x: tower.pos.x + 0.5, z: tower.pos.z }; l.facing = -Math.PI / 2;
    press(sim); hit(sim);
    expect(tower.hp).toBe(tower.maxHp);
    expect(sim.drainEvents().filter(e => e.type === 'attackSwing')).toEqual([
      { type: 'attackSwing', pos: { ...l.pos }, facing: l.facing, combo: 0, hit: false },
    ]);
  });

  it('prioritizes humans over structures, then hits the nearest obstruction face', () => {
    const { sim, l, g } = fixture();
    l.pos = { x: 83, z: -50.5 }; l.facing = Math.PI;
    g.pos = { x: 84, z: -51.7 };
    press(sim); hit(sim); expect(g.hp).toBe(g.maxHp - b.biteDamage);
    expect(sim.state.gate.hp).toBe(sim.state.gate.maxHp);
    recover(sim); sim.state.guards = []; l.facing = Math.PI;
    press(sim); hit(sim);
    expect(sim.state.gate.hp).toBe(sim.state.gate.maxHp - b.biteDamage * b.structureDamageMultiplier);
  });

  it('always infects Alpha kills even when the normal conversion roll fails', () => {
    const { sim, g } = fixture(); sim.ctx.rng = { next: () => 0.99 }; g.hp = b.biteDamage;
    press(sim); hit(sim);
    expect(g.killedByAlpha).toBe(true);
    expect(sim.state.pendingConversions).toMatchObject([{ guardId: g.id, willConvert: true }]);
    sim.state.time = BALANCE.conversion.delay; updateConversion(sim.ctx, 0, input);
    expect(sim.state.zombies[0].state).toBe('rising');
    updateConversion(sim.ctx, BALANCE.conversion.riseDuration, input);
    expect(sim.state.zombies[0].state).toBe('follower'); expect(sim.state.followerCount).toBe(1);
    expect(sim.state.progression.biomass).toBe(BALANCE.progression.biomassKill + BALANCE.progression.biomassConvert);
    updateConversion(sim.ctx, 5, input);
    expect(sim.drainEvents().filter(e => e.type === 'biomassGain')).toMatchObject([{ reason: 'kill' }, { reason: 'convert' }]);
  });

  it.each(['civilian', 'police', 'soldier'] as const)('awards biomass once for an Alpha %s kill', role => {
    const { sim, g } = fixture(); g.role = role; g.hp = b.biteDamage;
    press(sim); hit(sim); damageGuard(sim.ctx, g, 100, 'zombie', true);
    expect(sim.state.progression.biomass).toBe(role === 'civilian' ? BALANCE.progression.biomassInfect : BALANCE.progression.biomassKill);
    expect(sim.drainEvents().filter(e => e.type === 'biomassGain')).toHaveLength(1);
  });

  it('does not mark an earlier Alpha hit as an Alpha kill when a follower finishes it', () => {
    const { sim, g } = fixture(); sim.ctx.rng = { next: () => 0.99 };
    press(sim); hit(sim); damageGuard(sim.ctx, g, g.hp, 'zombie');
    expect(g.killedByAlpha).toBe(false); expect(sim.state.pendingConversions[0].willConvert).toBe(false);
    expect(sim.state.progression.biomass).toBe(BALANCE.progression.biomassKill);
  });

  it('stuns on a large single hit, cancels windup, blocks movement/attacks, then recovers', () => {
    const { sim, l, g } = fixture();
    damageLeader(sim.ctx, b.hitStunDamage - 1); expect(l.hitStun).toBe(0);
    press(sim); l.vel.z = 5; damageLeader(sim.ctx, b.hitStunDamage);
    expect(l.hitStun).toBe(b.hitStunTime); expect(l.vel).toEqual({ x: 0, z: 0 });
    const pos = { ...l.pos };
    const movingAttack = { ...input, attack: true, moveForward: 1, sprint: true };
    updateLeader(sim.ctx, b.hitStunTime / 2, movingAttack);
    expect(l.pos).toEqual(pos); expect(l.attackPhase).toBe('ready'); expect(l.sprinting).toBe(false);
    updateLeader(sim.ctx, b.hitStunTime / 2, movingAttack);
    expect(l.hitStun).toBe(0); expect(l.pos).toEqual(pos); expect(g.hp).toBe(g.maxHp);
    updateLeader(sim.ctx, 0.01, movingAttack);
    expect(l.attackPhase).toBe('windup'); expect(l.pos.z).toBeGreaterThan(pos.z);
  });
});

describe('horde combat modifiers', () => {
  it.each([false, true])('combines Frenzy with legacy Rush attack rate (rush=%s)', rush => {
    const { sim, g } = fixture();
    const z = createZombie(sim.ctx.newId(), { ...g.pos }, { state: 'follower', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
    z.engageTarget = { kind: 'guard', id: g.id }; sim.state.zombies.push(z); sim.state.followerCount = 1;
    sim.state.progression.frenzyTimeLeft = 5; sim.state.abilities.rushTimeLeft = rush ? 5 : 0;
    updateCombat(sim.ctx, 0, input);
    expect(z.attackCooldown).toBeCloseTo(BALANCE.walker.attackCooldown /
      (BALANCE.frenzy.attackRateMultiplier * (rush ? BALANCE.rush.attackRateMultiplier : 1)));
    updateCombat(sim.ctx, z.attackCooldown - 0.001, input); expect(g.hp).toBe(g.maxHp - BALANCE.walker.attackDamage);
    updateCombat(sim.ctx, 0.001, input); expect(g.hp).toBe(g.maxHp - 2 * BALANCE.walker.attackDamage);
  });

  it.each(['guard', 'gate', 'structure'] as const)('uses brute damage against a %s', kind => {
    const { sim, g } = fixture(), structure = sim.state.structures[0];
    const pos = kind === 'guard' ? g.pos : kind === 'gate' ? { x: 83, z: -50.5 } : { x: -65.75, z: 34.2 };
    const z = createZombie(sim.ctx.newId(), pos, { state: 'follower', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
    z.brute = true; z.engageTarget = kind === 'guard' ? { kind, id: g.id } : kind === 'gate' ? { kind } : { kind, id: structure.id };
    sim.state.zombies.push(z); sim.state.followerCount = 1;
    const target = kind === 'guard' ? g : kind === 'gate' ? sim.state.gate : structure;
    const before = target.hp; updateCombat(sim.ctx, 0, input);
    expect(target.hp).toBe(before - BALANCE.brute.attackDamage * (kind === 'guard' ? 1 : BALANCE.brute.structureDamageMultiplier));
  });

  it('skips dormant combatants and continues follower combat while the Alpha respawns', () => {
    const { sim, g } = fixture();
    const z = createZombie(sim.ctx.newId(), g.pos, { state: 'follower', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
    z.engageTarget = { kind: 'guard', id: g.id }; sim.state.zombies.push(z); sim.state.followerCount = 1;
    g.dormant = true; updateCombat(sim.ctx, 0, input); expect(g.hp).toBe(g.maxHp);
    g.dormant = false; z.dormant = true; updateCombat(sim.ctx, 1, input); expect(g.hp).toBe(g.maxHp);
    z.dormant = false; sim.state.phase = 'respawning'; sim.state.leader.alive = false;
    updateCombat(sim.ctx, 0, input); expect(g.hp).toBe(g.maxHp - BALANCE.walker.attackDamage);
  });
});
