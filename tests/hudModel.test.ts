import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { ABILITIES } from '../src/content/abilities';
import { emptyInput, type AbilityId, type GameEvent } from '../src/core/types';
import { grantReward } from '../src/systems/RewardSystem';
import { Simulation } from '../src/sim/Simulation';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { ICONS, abilityIcon, icon } from '../src/ui/hudIcons';
import {
  LOW_STRENGTH_FRAC,
  MAX_CONTEXT_ACTIONS,
  bannerForEvent,
  centeredProjection,
  clampToCircle,
  contextActions,
  interactPrompt,
  countRecruitable,
  damageSourceFor,
  drinkNearby,
  hordeBanner,
  hordeMilestone,
  hordeStrengthView,
  hordeView,
  hudContext,
  objectiveView,
  pickQuip,
  primaryAttackView,
  recruitPopup,
  statusChips,
} from '../src/ui/hudModel';
import { worldToMap } from '../src/ui/uiHelpers';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

function world() {
  const layout = buildDistrictLayout();
  const sim = new Simulation(layout);
  return { layout, sim, state: sim.state };
}

const noCtx = { hoverLabel: null, drinkNearby: false };

describe('hud icons', () => {
  it('renders every icon as decorative inline svg', () => {
    for (const name of Object.keys(ICONS) as (keyof typeof ICONS)[]) {
      const svg = icon(name, 's');
      expect(svg.startsWith('<svg class="hz-ico hz-ico-s"')).toBe(true);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg.endsWith('</svg>')).toBe(true);
    }
  });

  it('maps every ability to an icon, slot abilities to distinct ones', () => {
    const slotIcons = new Set<string>();
    for (const id of Object.keys(ABILITIES) as AbilityId[]) {
      expect(ICONS[abilityIcon(id)]).toBeTruthy();
      if (ABILITIES[id].slotBehavior === 'slot' && id !== 'pounce') slotIcons.add(abilityIcon(id));
    }
    expect(slotIcons.size).toBe(4);
    expect(abilityIcon(null)).toBe('lock');
  });
});

describe('character card', () => {
  it('computes HordeStrengthView text, frac clamping, NaN safety, and coreFrac', () => {
    const { state } = world();
    // Fresh createInitialState horde (core full) gives coreFrac 1 when strength == maxStrength.
    const init = hordeStrengthView(state);
    expect(init.coreFrac).toBeCloseTo(1);
    expect(init.frac).toBeCloseTo(1);

    state.horde.maxStrength = 50;
    state.horde.strength = 23.4;
    state.horde.coreDamage = 1.5;
    const v = hordeStrengthView(state);
    expect(v.text).toBe('23 / 50');
    expect(v.frac).toBeCloseTo(23.4 / 50);
    expect(v.coreFrac).toBeCloseTo((BALANCE.hordeHealth.alphaCore - 1.5) / 50);

    // Clamps strength > max and guards 0-max and NaN
    state.horde.strength = 70;
    expect(hordeStrengthView(state).frac).toBe(1);
    expect(hordeStrengthView(state).text).toBe('50 / 50');

    state.horde.maxStrength = 0;
    state.horde.strength = Number.NaN;
    state.horde.coreDamage = Number.POSITIVE_INFINITY;
    const safe = hordeStrengthView(state);
    expect(safe.max).toBe(1);
    expect(safe.frac).toBe(0);
    expect(safe.coreFrac).toBe(1);
    expect(safe.text).toBe('0 / 1');
  });

  it('classifies strength levels and Last Brain Standing countdown', () => {
    const { state } = world();
    state.horde.maxStrength = 100;
    state.horde.strength = 41;
    expect(hordeStrengthView(state).level).toBe('ok');

    state.horde.strength = 100 * LOW_STRENGTH_FRAC;
    expect(hordeStrengthView(state).level).toBe('low');

    state.horde.strength = 100 * BALANCE.hordeHealth.criticalFrac + 0.5;
    expect(hordeStrengthView(state).level).toBe('low');

    state.horde.strength = 100 * BALANCE.hordeHealth.criticalFrac;
    expect(hordeStrengthView(state).level).toBe('critical');

    state.horde.strength = 0;
    expect(hordeStrengthView(state).level).toBe('critical');
    expect(hordeStrengthView(state).countdown).toBe(0);
    expect(hordeStrengthView(state).countdownText).toBe('');

    // lastBrain overrides regardless of frac
    state.horde.strength = 80;
    state.horde.lastBrain = { active: true, timeLeft: 5.2 };
    const lb = hordeStrengthView(state);
    expect(lb.level).toBe('lastBrain');
    expect(lb.countdown).toBe(6);
    expect(lb.countdownText).toBe('LAST BRAIN STANDING! 6... FIND A BRAIN!');
  });

  it('shows only real timed effects with remaining fractions', () => {
    const { state } = world();
    expect(statusChips(state).map((c) => c.id)).toEqual([]);
    state.abilities.rushTimeLeft = BALANCE.rush.duration / 2;
    state.progression.frenzyTimeLeft = BALANCE.frenzy.duration;
    state.leader.exhausted = true;
    const chips = statusChips(state);
    expect(chips.map((c) => c.id)).toEqual(['rush', 'frenzy', 'exhausted']);
    expect(chips[0].frac).toBeCloseTo(0.5);
    expect(chips[1].frac).toBeCloseTo(1);
  });
});

describe('horde card', () => {
  it('derives the order mode from the real horde order', () => {
    const { state } = world();
    expect(hordeView(state, 40).mode).toBe('following');
    state.order = { type: 'move', point: { x: 1, z: 2 } } as typeof state.order;
    expect(hordeView(state, 40).mode).toBe('moving');
    state.order = { type: 'attack', target: { kind: 'gate' } } as typeof state.order;
    expect(hordeView(state, 40, 'Gate').label).toBe('Attacking Gate');
    state.followerCount = 0;
    expect(hordeView(state, 40).mode).toBe('none');
    state.followerCount = 40;
    expect(hordeView(state, 40).full).toBe(true);
  });

  it('fires each milestone once, highest first, and the cap', () => {
    expect(hordeMilestone(5, 9, 40)).toBeNull();
    expect(hordeMilestone(9, 10, 40)).toBe(10);
    expect(hordeMilestone(9, 23, 40)).toBe(20);
    expect(hordeMilestone(23, 23, 40)).toBeNull();
    expect(hordeMilestone(31, 40, 40)).toBe(40);
    expect(hordeBanner(40, 40, 0).title).toBe('MAXIMUM HORDE!');
    expect(hordeBanner(20, 40, 0).title).toBe('HORDE GROWING!');
  });
});

describe('objective', () => {
  it('asks to explore until the target district is discovered, then shows real progress', () => {
    const { layout, state } = world();
    for (const id of Object.keys(state.districts)) state.districts[id as keyof typeof state.districts].discovered = false;
    const explore = objectiveView(layout, state);
    expect(explore.kind).toBe('explore');
    expect(explore.target).toBeNull();
    for (const id of Object.keys(state.districts)) state.districts[id as keyof typeof state.districts].discovered = true;
    const v = objectiveView(layout, state);
    expect(v.kind).toBe('stronghold');
    expect(v.total).toBeGreaterThan(0);
    expect(v.done).toBe(0);
    expect(v.target).not.toBeNull();
    expect(v.title.startsWith('Take over ')).toBe(true);
    // completing an objective changes both signatures
    const sh = state.strongholds.find((s) => s.id === v.strongholdId)!;
    const def = layout.strongholds.find((d) => d.id === v.strongholdId)!;
    sh.objectivesDone.push(def.objectives[0].id);
    const v2 = objectiveView(layout, state);
    expect(v2.done).toBe(1);
    expect(v2.sig).not.toBe(v.sig);
    expect(v2.stepSig).not.toBe(v.stepSig);
  });

  it('reports completion and nothing for the legacy layout', () => {
    const { layout, state } = world();
    for (const s of state.strongholds) s.captured = true;
    expect(objectiveView(layout, state).kind).toBe('complete');
    expect(objectiveView(null, state).kind).toBe('none');
  });
});

describe('ability bar', () => {
  it('primary attack follows the claws loadout and the attack phase', () => {
    const { state } = world();
    expect(primaryAttackView(state)).toMatchObject({ name: 'Bite', busy: false, combo: 0 });
    state.progression.equipped[0] = 'alpha_claws';
    state.leader.attackPhase = 'recovery';
    state.leader.attackTimer = 0.2;
    state.leader.comboStep = 2;
    state.leader.comboWindow = 0.3;
    const v = primaryAttackView(state);
    expect(v).toMatchObject({ name: 'Claws', icon: 'claws', busy: true, combo: 2 });
    expect(v.frac).toBeGreaterThan(0);
  });
});

describe('context actions', () => {
  it('is empty when nothing is relevant and capped otherwise', () => {
    const { state } = world();
    expect(contextActions(state, noCtx)).toEqual([]);
    state.order = { type: 'move', point: { x: 0, z: 0 } } as typeof state.order;
    const all = contextActions(state, { hoverLabel: 'SOLDIER', drinkNearby: true });
    expect(all.length).toBe(MAX_CONTEXT_ACTIONS);
    expect(all.map((a) => a.id)).toEqual(['attackTarget', 'recall', 'drink']);
    expect(all[1].keys).toEqual(['Space']);
    expect(all[0].label).toContain('Soldier');
  });

  it('offers V only where V does something, mirroring the sim priority (cart > drain > prop)', () => {
    const { sim, state } = world();
    state.leader.pos = { x: 0, z: 0 };
    expect(interactPrompt(state)).toBeNull();
    const can = state.interactables.find((i) => i.kind === 'trashCan')!;
    state.leader.pos = { x: can.pos.x + 1, z: can.pos.z };
    expect(interactPrompt(state)).toBe('Kick the trash can');
    expect(contextActions(state, noCtx)[0]).toMatchObject({ id: 'interact', keys: ['V'] });
    can.lastTriggeredAt = state.time; // on cooldown: nothing to do here
    expect(interactPrompt(state)).toBeNull();
    grantReward(sim.ctx, 'veh_golf_cart');
    sim.step(BALANCE.sim.fixedDt, emptyInput());
    state.playerVehicle!.pos = { x: state.leader.pos.x + 1, z: state.leader.pos.z };
    expect(interactPrompt(state)).toBe('Hop in the Golf Cart');
    state.playerVehicle!.mounted = true;
    expect(interactPrompt(state)).toBe('Hop out of the Golf Cart');
  });

  it('never offers a rally (removed) and shows nothing while respawning', () => {
    const { state } = world();
    expect(contextActions(state, noCtx).some((a) => (a.id as string) === 'rally')).toBe(false);
    state.phase = 'respawning';
    expect(contextActions(state, { ...noCtx, drinkNearby: true })).toEqual([]);
  });

  it('counts only free ambient walkers in range; drinks only matter when hurt', () => {
    const { state } = world();
    const z = state.zombies.find((a) => a.state === 'ambient')!;
    for (const a of state.zombies) if (a !== z && a.state === 'ambient') a.pos = { x: 9999, z: 9999 };
    z.pos = { x: state.leader.pos.x + 3, z: state.leader.pos.z };
    z.heldBy = 0;
    z.dormant = false;
    expect(countRecruitable(state, 15)).toBe(1);
    z.heldBy = 7;
    expect(countRecruitable(state, 15)).toBe(0);
    state.pickups = [{ id: 1, kind: 'drink', shopId: 200, pos: { x: state.leader.pos.x + 2, z: state.leader.pos.z } }];
    state.horde.coreDamage = 0;
    expect(drinkNearby(state)).toBe(false);
    state.horde.coreDamage = 1.5;
    expect(drinkNearby(state)).toBe(true);
    state.leader.alive = false;
    expect(drinkNearby(state)).toBe(false);
  });
});

describe('feedback', () => {
  it('scales recruit popups by burst size', () => {
    expect(recruitPopup(2)).toBeNull();
    expect(recruitPopup(4)?.tier).toBe(1);
    expect(recruitPopup(8)?.tier).toBe(2);
    expect(recruitPopup(15)).toEqual({ text: '+15 HORDE SURGE!', tier: 3 });
  });

  it('finds the source of hits on the Alpha only', () => {
    const leader = { x: 0, z: 0 };
    const hit: GameEvent = { type: 'shot', guardId: 1, from: { x: 10, y: 1.5, z: 5 }, to: { x: 0.3, y: 1, z: 0.2 }, hit: true };
    expect(damageSourceFor(hit, leader)).toEqual({ x: 10, z: 5 });
    expect(damageSourceFor({ ...hit, hit: false } as GameEvent, leader)).toBeNull();
    expect(damageSourceFor({ ...hit, to: { x: 8, y: 1, z: 8 } } as GameEvent, leader)).toBeNull();
    expect(damageSourceFor({ type: 'vehicleHit', vehicleId: 1, pos: { x: 3, z: 0 }, target: 'zombie', speed: 9, killed: false }, leader)).toBeNull();
  });

  it('banners only for major events, with rotating quips', () => {
    expect(bannerForEvent({ type: 'strongholdCaptured', strongholdId: 'suburb_checkpoint', districtId: 'suburbs', unlock: 'rush', biomass: 50 } as GameEvent, 0)?.title)
      .toBe('OUTPOST OVERRUN!');
    expect(bannerForEvent({ type: 'districtStatus', districtId: 'suburbs', status: 'infected', prev: 'contested' } as GameEvent, 0)?.title)
      .toBe('DISTRICT CONQUERED!');
    expect(bannerForEvent({ type: 'districtStatus', districtId: 'suburbs', status: 'contested', prev: 'human' } as GameEvent, 0)).toBeNull();
    expect(bannerForEvent({ type: 'abilityUnlocked', abilityId: 'horde_frenzy', slot: null }, 0)?.icon).toBe('frenzy');
    expect(bannerForEvent({ type: 'rushStart' }, 0)).toBeNull();
    expect(pickQuip(['a', 'b'], 3)).toBe('b');
    expect(pickQuip(['a', 'b'], -1)).toBe('b');
  });

  it('picks the HUD emphasis from recent activity', () => {
    const { state } = world();
    expect(hudContext(state, 99, 99, 99)).toBe('explore');
    expect(hudContext(state, 99, 1, 99)).toBe('recruit');
    expect(hudContext(state, 1, 1, 99)).toBe('combat');
  });
});

describe('circular minimap math', () => {
  it('centers the player and clamps rim markers', () => {
    const bounds = { minX: -420, minZ: -500 };
    const proj = centeredProjection(bounds, { x: 30, z: -40 }, 90, 180);
    const out = { x: 0, z: 0 };
    worldToMap(proj, 30, -40, out);
    expect(out.x).toBeCloseTo(90);
    expect(out.z).toBeCloseTo(90);
    worldToMap(proj, 30, -40 - 90, out); // 90 m north = top edge
    expect(out.z).toBeCloseTo(0);
    worldToMap(proj, 30 + 400, -40, out);
    expect(clampToCircle(90, 90, 80, out)).toBe(true);
    expect(out.x).toBeCloseTo(170);
    expect(out.z).toBeCloseTo(90);
  });
});
