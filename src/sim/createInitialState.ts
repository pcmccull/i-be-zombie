import { BALANCE } from '../config/balance';
import type { ICollisionWorld } from '../core/contracts';
import type { AbilityId, DistrictId, DistrictLayout, DistrictState, DiscoveryState, GameState, PlayerRewardState, Rng, StrongholdState, VisionState, WorldInteractable, ZombieAgent } from '../core/types';
import { DISTRICT_IDS } from '../core/types';
import { INNATE_ABILITIES } from '../content/abilities';
import { createLeader } from '../entities/ZombieLeader';
import { createZombie } from '../entities/Zombie';
import { createGuard } from '../entities/HumanGuard';
import { createGate, createStructures } from '../entities/Structure';

export function createInitialState(layout: DistrictLayout, collision: ICollisionWorld, rng: Rng): GameState {
  let id = 1;
  const leader = createLeader(id++, layout);
  const zombies: ZombieAgent[] = [];
  for (let zone = 0; zone < layout.spawnZones.length; zone++) {
    const { rect, count, heldBy } = layout.spawnZones[zone];
    for (let i = 0; i < count; i++) {
      const p = { x: 0, z: 0 };
      let tries = 0;
      do {
        p.x = rect.minX + rng.next() * (rect.maxX - rect.minX);
        p.z = rect.minZ + rng.next() * (rect.maxZ - rect.minZ);
        if (++tries > 10000) throw new Error('Spawn zone has no sampled walkable point');
      } while (collision.isBlocked(p, 0.45));
      zombies.push(createZombie(id++, p, { state: 'ambient', variant: i % 6, spawnZone: zone, isConverted: false, heldBy, rng }));
    }
  }
  const area = layout.startFollowerArea;
  const startFollowers = startFollowerCount(layout);
  for (let i = 0; i < startFollowers; i++) {
    const p = { x: 0, z: 0 };
    let tries = 0;
    do {
      p.x = area.minX + rng.next() * (area.maxX - area.minX);
      p.z = area.minZ + rng.next() * (area.maxZ - area.minZ);
      if (++tries > 10000) throw new Error('Start follower area has no distinct sampled walkable point');
    } while (collision.isBlocked(p, BALANCE.world.navAgentRadius) ||
      Math.hypot(p.x - leader.pos.x, p.z - leader.pos.z) < leader.radius + BALANCE.walker.radius ||
      zombies.some(z => z.state === 'follower' && Math.hypot(p.x - z.pos.x, p.z - z.pos.z) < 2 * BALANCE.walker.radius));
    zombies.push(createZombie(id++, p, { state: 'follower', variant: i % 6, spawnZone: -1, isConverted: false, rng }));
  }
  const guards = layout.guards.map(spawn => {
    const guard = createGuard(id++, spawn, collision);
    if (spawn.tower) guard.elevation = layout.checkpoint.towers.find(t => t.id === spawn.tower)?.platformHeight ?? 4;
    return guard;
  });
  const state: GameState = {
    time: 0, phase: 'playing', nextEntityId: id, leader, zombies, guards, gate: createGate(collision),
    structures: createStructures(layout, collision), momentum: { value: 0, idleTime: 0, tier: 'dormant', gainFlash: 0 },
    horde: {
      strength: BALANCE.hordeHealth.alphaCore, maxStrength: BALANCE.hordeHealth.alphaCore, followerStrength: 0, coreDamage: 0,
      activeFollowers: 0, graceLeft: 0, lastBrain: { active: false, timeLeft: 0 },
      alphaDamageTaken: 0, sharedDamageDealt: 0, strengthGained: 0, strengthLost: 0,
    },
    order: { type: 'follow' }, squads: [], abilities: { rallyCooldown: 0, rushCooldown: 0, rushTimeLeft: 0 },
    pendingConversions: [], stats: { recruited: 0, conversions: 0, losses: 0, guardsKilled: 0, cascadeRecruits: 0, structuresDestroyed: 0 },
    followerCount: startFollowers, capReachedFlash: 0, atCapacity: false,
    districts: createDistrictStates(), strongholds: createStrongholdStates(layout),
    progression: {
      biomass: BALANCE.progression.startBiomass, unlocked: [...INNATE_ABILITIES],
      equipped: new Array<AbilityId | null>(BALANCE.progression.slots).fill(null), cooldowns: {}, frenzyTimeLeft: 0, slotsOwned: 0, visionTier: 1, speedLevel: 0, attackLevel: 0,
    },
    discovery: createDiscovery(layout),
    activeNestId: layout.nests.find(n => n.strongholdId === null)?.id ?? '',
    claimedNests: BALANCE.openWorld.startNestClaimed ? layout.nests.filter(n => n.claim).map(n => n.id) : [], deaths: 0,
    nestTravel: null,
    vision: createVisionState(),
    vehicles: [], pickups: [], resistance: { level: 0 },
    rewards: createInitialRewardState(),
    cityEvents: [],
    interactables: createInteractables(layout),
    playerVehicle: null,
    companions: [],
  };
  // NOTE: no t=0 fog reveal here: tests/discovery + persistence assume a blank fog before the first step. The first
  // updateConquest step (revealTimer starts at 0) reveals around the start, so the start district reads human at t=dt.
  return state;
}

/** Followers at t=0: none in the open world (the first nest unlocks the horde), horde.startFollowers in the legacy district. */
export function startFollowerCount(layout: DistrictLayout): number {
  return layout.strongholds.length > 0 ? BALANCE.openWorld.startFollowers : BALANCE.horde.startFollowers;
}

/** EW: transient vision state (AwarenessSystem fills it on its first update). */
export function createVisionState(): VisionState {
  return { tier: 1, identified: [], seen: [], cues: [], nextCueId: 1, revision: 0 };
}

export function createInitialRewardState(): PlayerRewardState {
  return {
    brains: 0,
    unlockedRewardIds: [],
    equippedCosmeticIdsBySlot: { hat: null, glasses: null, back: null, hand: null },
    unlockedCompanionIds: [],
    activeCompanionIds: [],
    achievementProgress: {},
    discoveredSecretIds: [],
    unlockedHideoutIds: [],
    unlockedVehicleIds: [],
    activeVehicleId: null,
  };
}

/**
 * World props the Alpha can mess with (docs/11_cityupgrade.md §2.6). Parked cars, warning signs (sirens) and road
 * barriers come from layout props; trash cans (one beside each bench) and fire hydrants (every 6th streetlight, on the
 * kerb side) are generated here deterministically and drawn by visuals/InteractableProps. Ids are stable per layout.
 */
function createInteractables(layout: DistrictLayout): WorldInteractable[] {
  if (layout.strongholds.length === 0) return [];
  const out: WorldInteractable[] = [];
  let nextId = 1;
  const push = (kind: WorldInteractable['kind'], x: number, z: number) => {
    out.push({
      id: nextId++,
      kind,
      pos: { x, z },
      radius: BALANCE.city.interactRange,
      cooldown: BALANCE.city.interactableTriggerCooldown,
      lastTriggeredAt: -Infinity,
      triggerCount: 0,
    });
  };
  let lights = 0;
  for (const prop of layout.props) {
    let kind: WorldInteractable['kind'] | null = null;
    if (prop.kind === 'trashCan') kind = 'trashCan';
    else if (prop.kind === 'hydrant') kind = 'fireHydrant';
    else if (prop.kind === 'car') kind = 'carAlarm';
    else if (prop.kind === 'barrier') kind = 'constructionBarrier';
    else if (prop.kind === 'warningSign') kind = 'sirenPost';
    if (kind) push(kind, prop.pos.x, prop.pos.z);
    if (prop.kind === 'bench') {
      // Bench seat runs along its rotation's right axis: the can stands at one end.
      push('trashCan', prop.pos.x + Math.cos(prop.rotation) * 1.5, prop.pos.z - Math.sin(prop.rotation) * 1.5);
    } else if (prop.kind === 'streetlight' && lights++ % 6 === 3) {
      push('fireHydrant', prop.pos.x + Math.sin(prop.rotation) * 1.1, prop.pos.z + Math.cos(prop.rotation) * 1.1);
    }
  }
  return out;
}

export function createDistrictStates(): Record<DistrictId, DistrictState> {
  const out = {} as Record<DistrictId, DistrictState>;
  for (const id of DISTRICT_IDS) {
    out[id] = {
      id,
      status: 'unknown',
      discovered: false,
      infection: 0,
      humanStrength: 1,
      alertLevel: 0,
      strongholdCaptured: false,
      alert: 'normal',
      control: 'humanControlled',
      heat: 0,
      discoveredPOIs: [],
      completedUniqueEvents: [],
      unlockedShortcuts: [],
    };
  }
  return out;
}

export function createStrongholdStates(layout: DistrictLayout): StrongholdState[] {
  return layout.strongholds.map(def => ({
    id: def.id, captured: false, contested: false, defenderStrength: 1, objectivesDone: [], holdProgress: 0,
    reinforcementsSpent: 0, lastReinforcementAt: -Infinity,
  }));
}

export function createDiscovery(layout: DistrictLayout): DiscoveryState {
  const cellSize = BALANCE.discovery.cellSize, b = layout.bounds;
  const cols = Math.ceil((b.maxX - b.minX) / cellSize), rows = Math.ceil((b.maxZ - b.minZ) / cellSize);
  return { cellSize, cols, rows, bits: new Uint8Array(cols * rows), revealed: 0 };
}
