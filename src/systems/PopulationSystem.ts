// [pure] Radius activation and bounded, district-budget population replenishment.
import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { DistrictDef, DistrictId, Vec2 } from '../core/types';
import { createGuard } from '../entities/HumanGuard';
import { createZombie } from '../entities/Zombie';
import { getDistrictAt } from '../world/worldQueries';

interface DistrictPopulation {
  civilians: number;
  ambient: number;
  civilianWait: number;
  ambientWait: number;
}
interface PopulationMemory {
  refreshIn: number;
  districts: Map<DistrictId, DistrictPopulation>;
  pending: Set<number>;
}
const memories = new WeakMap<SimContext, PopulationMemory>();

function activeOrigin(ctx: SimContext): Vec2 {
  if (ctx.state.leader.alive && ctx.state.leader.hp > 0) return ctx.state.leader.pos;
  const nests = ctx.layout.nests;
  const active = (id: string): boolean => ctx.state.strongholds.some(s => s.id === id && s.captured);
  return nests.find(n => n.id === ctx.state.activeNestId && (n.strongholdId === null || active(n.strongholdId)))?.pos ??
    nests.find(n => n.strongholdId === null)?.pos ?? ctx.layout.playerStart;
}

function refresh(ctx: SimContext, m: PopulationMemory, origin: Vec2): void {
  const radius2 = BALANCE.population.activeRadius ** 2;
  for (const g of ctx.state.guards) {
    g.dormant = (g.pos.x - origin.x) ** 2 + (g.pos.z - origin.z) ** 2 > radius2;
  }
  for (const z of ctx.state.zombies) {
    z.dormant = z.state === 'ambient' && (z.pos.x - origin.x) ** 2 + (z.pos.z - origin.z) ** 2 > radius2;
  }
  m.pending.clear();
  for (const pending of ctx.state.pendingConversions) m.pending.add(pending.guardId);
  let write = 0;
  for (const g of ctx.state.guards) {
    if (g.state === 'DEAD' && g.deathTime !== null && ctx.state.time - g.deathTime > 30 && !m.pending.has(g.id)) continue;
    ctx.state.guards[write++] = g;
  }
  ctx.state.guards.length = write;
}

/** Pick only authored walkable, screened points. A failed attempt never spends an id. */
function spawnPoint(ctx: SimContext, district: DistrictDef, origin: Vec2, radius: number): Vec2 | undefined {
  const points = district.spawnPoints;
  if (!points.length) return undefined;
  const start = Math.floor(ctx.rng.next() * points.length);
  for (let i = 0; i < points.length; i++) {
    const p = points[(start + i) % points.length];
    if (getDistrictAt(ctx.layout, p) !== district.id ||
        (p.x - origin.x) ** 2 + (p.z - origin.z) ** 2 < BALANCE.population.minRespawnDistance ** 2 ||
        ctx.collision.isBlocked(p, radius)) continue;
    if (ctx.state.leader.alive && ctx.state.leader.hp > 0 &&
        !ctx.collision.segmentBlocked(ctx.state.leader.pos, p, {
          mode: 'sight', fromHeight: BALANCE.guard.eyeHeight, toHeight: BALANCE.targetHeights.guardTorso,
        })) continue;
    return p;
  }
  return undefined;
}

export function updatePopulation(ctx: SimContext, dt: number): void {
  const state = ctx.state;
  if (state.phase !== 'playing' && state.phase !== 'respawning') return;
  let m = memories.get(ctx);
  if (!m) {
    m = { refreshIn: 0, districts: new Map(), pending: new Set() };
    memories.set(ctx, m);
  }
  const origin = activeOrigin(ctx);
  m.refreshIn -= dt;
  if (m.refreshIn <= 1e-9) {
    refresh(ctx, m, origin);
    const period = 1 / BALANCE.population.dormantRefreshHz;
    m.refreshIn = period + (m.refreshIn % period);
  }
  // A recruit/conversion must wake immediately, even between the radius refreshes.
  for (const z of state.zombies) if (z.state === 'follower' || z.state === 'rising') z.dormant = false;

  for (const district of ctx.layout.districts) {
    let counts = m.districts.get(district.id);
    if (!counts) {
      counts = { civilians: 0, ambient: 0, civilianWait: 0, ambientWait: 0 };
      m.districts.set(district.id, counts);
    }
    counts.civilians = counts.ambient = 0;
  }
  let humans = 0, ambient = 0;
  for (const g of state.guards) {
    if (g.hp <= 0 || g.state === 'DEAD') continue;
    humans++;
    if (g.role === 'civilian') m.districts.get(getDistrictAt(ctx.layout, g.pos))!.civilians++;
  }
  for (const z of state.zombies) {
    if (z.state !== 'ambient' || z.hp <= 0) continue;
    ambient++;
    if (z.heldBy === 0) m.districts.get(getDistrictAt(ctx.layout, z.pos))!.ambient++;
  }
  for (const district of ctx.layout.districts) {
    const counts = m.districts.get(district.id)!;
    const territory = state.districts[district.id];
    const infected = territory.status === 'infected';
    const captured = territory.strongholdCaptured || state.strongholds.some(s => s.id === district.strongholdId && s.captured);
    const civilianBudget = infected ? 0 : Math.floor(district.civilianBudget * (captured ? BALANCE.conquest.capturedPatrolFactor : 1));
    const ambientBudget = infected ? 0 : district.ambientBudget;
    counts.civilianWait = counts.civilians < civilianBudget ? counts.civilianWait + dt : 0;
    counts.ambientWait = counts.ambient < ambientBudget ? counts.ambientWait + dt : 0;
    if (counts.civilianWait + 1e-9 >= BALANCE.population.civilianRespawnDelay &&
        humans < BALANCE.population.maxHumans && state.guards.length < BALANCE.population.maxHumans) {
      const p = spawnPoint(ctx, district, origin, BALANCE.civilian.radius);
      if (p) {
        const g = createGuard(ctx.newId(), { role: 'civilian', post: 'street', pos: p, facing: ctx.rng.next() * Math.PI * 2,
          tower: null, homeArea: district.rect, waypoints: [p, ...district.spawnPoints.filter(point => point !== p)] }, ctx.collision);
        g.dormant = (p.x - origin.x) ** 2 + (p.z - origin.z) ** 2 > BALANCE.population.activeRadius ** 2;
        state.guards.push(g); humans++; counts.civilianWait = 0;
      }
    }
    if (counts.ambientWait + 1e-9 >= BALANCE.population.civilianRespawnDelay && ambient < BALANCE.population.maxAmbient) {
      const p = spawnPoint(ctx, district, origin, BALANCE.walker.radius);
      if (p) {
        const zone = ctx.layout.spawnZones.findIndex(zone => !zone.heldBy && p.x >= zone.rect.minX && p.x <= zone.rect.maxX &&
          p.z >= zone.rect.minZ && p.z <= zone.rect.maxZ);
        const z = createZombie(ctx.newId(), p, { state: 'ambient', spawnZone: zone,
          variant: Math.floor(ctx.rng.next() * 6), isConverted: false, rng: ctx.rng });
        z.dormant = (p.x - origin.x) ** 2 + (p.z - origin.z) ** 2 > BALANCE.population.activeRadius ** 2;
        state.zombies.push(z); ambient++; counts.ambientWait = 0;
      }
    }
  }
}
