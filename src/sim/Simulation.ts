import { BALANCE } from '../config/balance';
import type { ISimulation, SimContext } from '../core/contracts';
import type { DistrictLayout, GameEvent, GameState, SimInput } from '../core/types';
import { updateLeader } from '../entities/ZombieLeader';
import { CollisionWorld, isCrawlable } from '../world/CollisionWorld';
import { NavigationGrid } from '../world/NavigationGrid';
import { buildLegacyDistrictLayout as buildDistrictLayout } from '../world/legacyDistrictLayout';
import { SpatialHash } from '../utils/spatialHash';
import { mulberry32 } from '../utils/rng';
import { applyHordeCommands, updateHorde } from '../systems/HordeSystem';
import { updateNavigation } from '../systems/NavigationSystem';
import { updateHumanAI } from '../systems/HumanAISystem';
import { updateCombat } from '../systems/CombatSystem';
import { updateConversion } from '../systems/ConversionSystem';
import { checkVictory } from '../systems/VictorySystem';
import { updateStructures } from '../systems/StructureSystem';
import { updateMomentum } from '../systems/MomentumSystem';
import { updatePopulation } from '../systems/PopulationSystem';
import { updateProgression } from '../systems/ProgressionSystem';
import { updateConquest } from '../systems/ConquestSystem';
import { updateHordeHealth } from '../systems/HordeHealthSystem';
import { updateRespawn } from '../systems/RespawnSystem';
import { updateAwareness } from '../systems/AwarenessSystem';
import { updateResistance } from '../systems/ResistanceSystem';
import { updateTraffic } from '../systems/TrafficSystem';
import { updateShops } from '../systems/ShopSystem';
import { updateCityDirector } from '../systems/CityActivityDirector';
import { updateWorldInteractions } from '../systems/WorldInteractionSystem';
import { updateRewards } from '../systems/RewardSystem';
import { updateCompanions } from '../systems/CompanionSystem';
import { updatePlayerVehicle } from '../systems/PlayerVehicleSystem';
import { updateHideouts } from '../systems/HideoutSystem';
import { updateNestTravel } from '../systems/NestTravelSystem';
import { applySave } from '../persistence/saveSchema';
import type { WorldSave } from '../core/types';
import { createInitialState } from './createInitialState';

function copyPrevious(e: GameState['leader'] | GameState['zombies'][number] | GameState['guards'][number]): void {
  e.prevPos.x = e.pos.x; e.prevPos.z = e.pos.z; e.prevFacing = e.facing;
}

function tickVisualTimers(e: GameState['leader'] | GameState['zombies'][number] | GameState['guards'][number], dt: number): void {
  e.hitFlash = Math.max(0, e.hitFlash - dt); e.animTime += dt;
}

export class Simulation implements ISimulation {
  ctx!: SimContext;
  private events: GameEvent[] = [];
  private seed: number;

  constructor(private readonly layout: DistrictLayout = buildDistrictLayout(), seed: number = BALANCE.sim.seed,
    save: WorldSave | null = null) {
    this.seed = seed; this.reset(seed, save);
  }

  get state(): GameState { return this.ctx.state; }

  reset(seed: number = this.seed, save: WorldSave | null = null): void {
    this.seed = seed; this.events = [];
    const collision = new CollisionWorld(this.layout.bounds, this.layout.colliders);
    // The constructor rebuilds once; fresh/reset simulations therefore have identical versions.
    const navGrid = new NavigationGrid(collision);
    const crawlNavGrid = new NavigationGrid(collision, undefined, undefined, isCrawlable);
    const rng = mulberry32(seed);
    const state = createInitialState(this.layout, collision, rng);
    this.ctx = {
      state, layout: this.layout, collision, navGrid, crawlNavGrid, rng, balance: BALANCE,
      zombieHash: new SpatialHash(2, this.layout.bounds),
      nav: { followField: null, attackField: null, effectiveTarget: null, squads: new Map() },
      emit: event => this.events.push(event), newId: () => state.nextEntityId++,
    };
    if (save) applySave(this.ctx, save);
  }

  drainEvents(): GameEvent[] { const events = this.events; this.events = []; return events; }

  step(dt: number, input: SimInput): void {
    const s = this.state;
    copyPrevious(s.leader);
    for (const z of s.zombies) copyPrevious(z);
    for (const g of s.guards) copyPrevious(g);
    const openWorld = this.layout.strongholds.length > 0;
    // Legacy district: victory/defeat freeze the sim. Open world: only 'playing' and 'respawning' exist and both simulate.
    if (s.phase !== 'playing' && !(openWorld && s.phase === 'respawning')) {
      // Freeze gameplay, including cooldowns and sim time. Only animation/corpse ages advance.
      s.leader.animTime += dt;
      for (const g of s.guards) g.animTime += dt;
      let write = 0;
      for (const z of s.zombies) {
        z.animTime += dt;
        if (z.state === 'dead') z.stateTime += dt;
        if (z.state !== 'dead' || z.stateTime < BALANCE.walker.corpseFadeTime) s.zombies[write++] = z;
      }
      s.zombies.length = write;
      return;
    }
    const stepEventStart = this.events.length;
    if (openWorld) updatePopulation(this.ctx, dt);
    applyHordeCommands(this.ctx, dt, input);
    updateProgression(this.ctx, dt, input);
    if (s.phase === 'playing' && !s.nestTravel) updateLeader(this.ctx, dt, input);
    // V priority: vehicle (mount/dismount) > shortcut > nest teleport map > nearest prop. No Alpha control mid-teleport.
    let interactFree = !(openWorld && updatePlayerVehicle(this.ctx, dt, input));
    updateNavigation(this.ctx, dt, input);
    updateHorde(this.ctx, dt, input);
    updateHumanAI(this.ctx, dt, input);
    updateCombat(this.ctx, dt, input);
    updateConversion(this.ctx, dt, input);
    updateStructures(this.ctx, dt);
    updateMomentum(this.ctx, dt);
    if (openWorld) { updateConquest(this.ctx, dt); updateHordeHealth(this.ctx, dt); updateRespawn(this.ctx, dt); }
    else { updateHordeHealth(this.ctx, dt); checkVictory(this.ctx); }
    // todos #10b/#12: citizen fight-back level, traffic (hits/rammers/bailing drivers), shop drinks. Open world only.
    if (openWorld) { updateResistance(this.ctx); updateTraffic(this.ctx, dt); updateShops(this.ctx); }
    // Living City & Expanded Rewards (docs/11_cityupgrade.md). Open world only.
    if (openWorld) {
      if (updateHideouts(this.ctx, input, interactFree)) interactFree = false;
      if (updateNestTravel(this.ctx, dt, input, interactFree)) interactFree = false;
      updateWorldInteractions(this.ctx, input, interactFree);
      updateCompanions(this.ctx, dt, input);
      updateCityDirector(this.ctx, dt, this.events.slice(stepEventStart));
      updateRewards(this.ctx, input, this.events.slice(stepEventStart));
    }
    // EW: zombie vision/senses (open world only; legacy has no fog). Runs while respawning too, so identified collapses to the engaged set.
    if (openWorld) updateAwareness(this.ctx, dt, this.events.slice(stepEventStart));
    tickVisualTimers(s.leader, dt);
    for (const z of s.zombies) tickVisualTimers(z, dt);
    for (const g of s.guards) tickVisualTimers(g, dt);
    s.gate.hitFlash = Math.max(0, s.gate.hitFlash - dt);
    s.capReachedFlash = Math.max(0, s.capReachedFlash - dt);
    s.time += dt;
  }
}
