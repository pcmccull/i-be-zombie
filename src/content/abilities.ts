// [pure] Data-driven ability registry (docs/3_open_world.md §4E). Orchestrator-owned content.
import { BALANCE } from '../config/balance';
import type { AbilityDef, AbilityId } from '../core/types';

export const ABILITIES: Readonly<Record<AbilityId, AbilityDef>> = {
  bite: {
    id: 'bite', name: 'Bite', type: 'alpha', source: null, slotBehavior: 'innate', activatable: false,
    cooldown: 0, biomassCost: 0, duration: 0, description: 'LMB: quick bite. Always available.',
  },
  infect: {
    id: 'infect', name: 'Infect', type: 'passive', source: null, slotBehavior: 'innate', activatable: false,
    cooldown: 0, biomassCost: 0, duration: 0, description: 'Humans you kill yourself always rise as followers.',
  },
  rush: {
    id: 'rush', name: 'Rush', type: 'horde', source: null, slotBehavior: 'slot', activatable: true,
    cooldown: BALANCE.rush.cooldown, biomassCost: 0, duration: BALANCE.rush.duration,
    description: 'Short burst: the whole horde runs 45% faster and attacks 25% faster for 4 s - fast enough to run down fleeing civilians.',
  },
  alpha_claws: {
    id: 'alpha_claws', name: 'Alpha Claws', type: 'alpha', source: 'police_station', slotBehavior: 'slot', activatable: false,
    cooldown: 0, biomassCost: 0, duration: 0,
    description: 'While equipped, LMB becomes a three-hit claw combo; the finisher staggers humans.',
  },
  horde_frenzy: {
    id: 'horde_frenzy', name: 'Horde Frenzy', type: 'horde', source: 'mall_security', slotBehavior: 'slot', activatable: true,
    cooldown: BALANCE.frenzy.cooldown, biomassCost: 0, duration: BALANCE.frenzy.duration,
    description: 'Nearby followers move 40% faster and attack 50% faster for 8 s.',
  },
  pounce: {
    id: 'pounce', name: 'Pounce', type: 'alpha', source: null, slotBehavior: 'slot', activatable: true,
    cooldown: 8, biomassCost: 0, duration: 0, description: 'Leap onto a target. (Not available in this build.)',
  },
  brute_evolution: {
    id: 'brute_evolution', name: 'Brute Evolution', type: 'horde', source: 'industrial_yard', slotBehavior: 'slot', activatable: true,
    cooldown: BALANCE.brute.cooldown, biomassCost: BALANCE.brute.costPerBrute, duration: 0,
    description: 'Spend biomass to mutate the nearest followers into durable siege Brutes.',
  },
};

export const INNATE_ABILITIES: readonly AbilityId[] = ['bite', 'infect'];
/** Slot abilities every open-world game starts with (unlocked, equipped from slot Q onward). */
export const STARTER_ABILITIES: readonly AbilityId[] = ['rush'];
export const SLOT_KEYS: readonly string[] = ['Q', 'E', 'R', 'F'];
