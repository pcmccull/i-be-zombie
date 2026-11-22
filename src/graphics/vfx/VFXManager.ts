import * as THREE from 'three';
import type { DistrictLayout, GameEvent, GameState } from '../../core/types';
import { flashScale } from '../performance/GraphicsQuality';
import type { GraphicsSettings, QualityProfile } from '../performance/GraphicsQuality';
import { EmitterPool } from './EmitterPool';
import { createFootstepAccumulator, dustColor, EMITTERS, footstepColor, isUnlockNearby, mapEvents, MAX_CHARGE_EMITTERS,
  pickFootsteps, scaledCount, surfaceAt, withinVision } from './vfxRules';
import type { FootstepOptions, VfxName, VfxPayload } from './vfxRules';
import { BALANCE } from '../../config/balance';
import { SMOKE_DARK, SMOKE_LIGHT, vehicleSmokeRate } from '../../visuals/vehicleLook';
import { halfLength } from '../../systems/vehicleModels';
export type { VfxName, VfxSurface, VfxPayload } from './vfxRules';

/** Render-only adapter. Call update before rendering, even on a frame with dt=0. */
export class VFXManager {
  private readonly pool: EmitterPool;
  private profile: QualityProfile;
  private settings: GraphicsSettings;
  private layout?: DistrictLayout;
  private alpha = 1;
  private leaderX = 0;
  private leaderZ = 0;
  // The first update culls all origins before they can be submitted to the renderer.
  private hiddenBeyond = Infinity;
  private footsteps = createFootstepAccumulator();
  private readonly stepIds: number[] = [];
  private readonly footOptions: FootstepOptions = { dt: 0, time: 0, rate: 0, radius: 0,
    focusX: 0, focusZ: 0, leaderX: 0, leaderZ: 0, hiddenBeyond: 0 };
  private readonly payload: VfxPayload = { x: 0, z: 0 };
  private readonly resolvedPayload: VfxPayload = { x: 0, z: 0 };
  private chargeCredit = 0;
  private chargeCursor = 0;
  private chargeEmitters = 0;
  private lastBrainAuraCredit = 0;
  /** Per-car bonnet-smoke credit (puffs), keyed by vehicle id; at most ~24 live cars. */
  private readonly smokeCredit = new Map<number, number>();
  private seed = 0x12753ab9;
  private disposed = false;

  constructor(scene: THREE.Scene, profile: QualityProfile, settings: GraphicsSettings) {
    this.pool = new EmitterPool(scene);
    this.profile = { ...profile }; this.settings = { ...settings };
    this.setQuality(profile, settings);
  }
  setWorld(layout: DistrictLayout): void {
    this.reset(); this.layout = layout;
    // Warm the bucket grid at world setup rather than at the first combat impact.
    surfaceAt(layout, layout.playerStart.x, layout.playerStart.z);
  }
  setQuality(profile: QualityProfile, settings: GraphicsSettings): void {
    if (this.disposed) return;
    if (this.settings.reducedMotion !== settings.reducedMotion) this.reset();
    this.profile = { ...profile }; this.settings = { ...settings };
    this.pool.setCap(profile.maxParticles);
    this.pool.trimAmbient(this.ambientTarget(), this.leaderX, this.leaderZ, profile.footstepRadius);
    this.footsteps.credit = 0; this.chargeCredit = 0; this.lastBrainAuraCredit = 0;
  }
  private ambientTarget(): number { return Math.floor(this.profile.ambientMotes * (this.settings.reducedMotion ? 0.5 : 1)); }
  emit(name: VfxName, p: VfxPayload): void {
    if (this.disposed || !Number.isFinite(p.x) || !Number.isFinite(p.z) || (p.y !== undefined && !Number.isFinite(p.y))) return;
    if (name === 'horde.charge') {
      if (this.chargeEmitters >= MAX_CHARGE_EMITTERS) return;
      this.chargeEmitters++;
    }
    const surface = p.surface ?? (this.layout ? surfaceAt(this.layout, p.x, p.z) : 'grass');
    let color = p.color;
    if (name === 'zombie.footstep') { color = footstepColor(surface); if (color === undefined) return; }
    if ((name === 'vehicle.impact' || name === 'body.fall') && color === undefined) color = dustColor(surface);
    if (name === 'bullet.impact' && color === undefined) {
      color = surface === 'sand' ? 0xe8d6a8 : surface === 'grass' ? 0x7d9a6a : surface === 'wood' ? 0x9a7852 : 0xa9a294;
    }
    const payload = this.resolvedPayload;
    payload.x = p.x; payload.y = p.y; payload.z = p.z; payload.dirX = p.dirX; payload.dirZ = p.dirZ;
    payload.radius = p.radius; payload.intensity = p.intensity; payload.faction = p.faction;
    payload.color = color; payload.surface = surface;
    // Per-frame emitters whose rate is already quality-scaled spawn exactly one particle.
    const count = name === 'ambient.mote' || name === 'vehicle.smoke' || name === 'horde.lastBrainAura' ? 1 : scaledCount(EMITTERS[name].count * Math.min(2, Math.max(0, p.intensity ?? 1)), this.profile, this.settings.reducedMotion);
    this.pool.spawn(name, payload, count, this.settings.reducedMotion, flashScale(this.settings), this.leaderX, this.leaderZ, this.hiddenBeyond);
  }
  consume(events: readonly GameEvent[], state: GameState): void {
    if (this.disposed) return;
    this.followLeader(state, this.alpha);
    const mapped = mapEvents(events.filter(ev => isUnlockNearby(ev, state, this.layout)), state);
    for (const effect of mapped) this.emit(effect.name, effect.payload);
  }
  private followLeader(state: GameState, alpha: number): void {
    this.leaderX = state.leader.prevPos.x + (state.leader.pos.x - state.leader.prevPos.x) * alpha;
    this.leaderZ = state.leader.prevPos.z + (state.leader.pos.z - state.leader.prevPos.z) * alpha;
  }
  private random(): number {
    let n = this.seed; n ^= n << 13; n ^= n >>> 17; n ^= n << 5; this.seed = n;
    return (n >>> 0) / 4294967296;
  }
  update(dt: number, state: GameState, alpha: number, camera: THREE.Camera, focusX: number, focusZ: number, hiddenBeyond: number): void {
    if (this.disposed) return;
    this.alpha = Math.max(0, Math.min(1, alpha));
    this.followLeader(state, this.alpha); this.hiddenBeyond = Math.max(0, hiddenBeyond);
    const elapsed = Math.max(0, Math.min(0.1, dt));
    if (elapsed > 0) {
      const puffs = scaledCount(EMITTERS['zombie.footstep'].count, this.profile, this.settings.reducedMotion);
      const o = this.footOptions;
      o.dt = elapsed; o.time = state.time;
      o.rate = puffs ? this.profile.footstepsPerSecond * (this.settings.reducedMotion ? 0.5 : 1) / puffs : 0;
      o.radius = this.profile.footstepRadius; o.focusX = focusX; o.focusZ = focusZ;
      o.leaderX = this.leaderX; o.leaderZ = this.leaderZ; o.hiddenBeyond = this.hiddenBeyond; o.alpha = this.alpha;
      pickFootsteps(state.zombies, this.footsteps, o, this.stepIds);
      for (const id of this.stepIds) {
        for (const z of state.zombies) {
          if (z.id !== id) continue;
          const p = this.payload;
          p.x = z.prevPos.x + (z.pos.x - z.prevPos.x) * this.alpha;
          p.z = z.prevPos.z + (z.pos.z - z.prevPos.z) * this.alpha;
          p.y = 0.17; p.dirX = p.dirZ = undefined;
          this.emit('zombie.footstep', p);
          break;
        }
      }
      this.updateCharge(elapsed, state, focusX, focusZ);
      this.updateCarSmoke(elapsed, state, focusX, focusZ);
      this.updateLastBrainAura(elapsed, state);
      const target = this.ambientTarget();
      const live = this.pool.trimAmbient(target, focusX, focusZ, this.profile.footstepRadius);
      for (let i = live; i < target; i++) {
        const angle = this.random() * Math.PI * 2;
        const r = Math.sqrt(this.random()) * Math.min(this.profile.footstepRadius, this.hiddenBeyond) * 0.85;
        const p = this.payload;
        p.x = focusX + Math.sin(angle) * r; p.y = 0.6 + this.random() * 3.5; p.z = focusZ + Math.cos(angle) * r;
        p.dirX = p.dirZ = undefined;
        this.emit('ambient.mote', p);
      }
    }
    // Also remove old particles that crossed the visibility limit or were left behind by a teleport.
    this.pool.update(elapsed, camera, this.leaderX, this.leaderZ, this.hiddenBeyond);
    this.chargeEmitters = 0;
  }
  private updateCharge(dt: number, state: GameState, focusX: number, focusZ: number): void {
    if (state.progression.frenzyTimeLeft <= 0 && state.abilities.rushTimeLeft <= 0) { this.chargeCredit = 0; return; }
    this.chargeCredit = Math.min(MAX_CHARGE_EMITTERS, this.chargeCredit + dt * (this.settings.reducedMotion ? 36 : 72));
    let budget = Math.min(Math.floor(this.chargeCredit), MAX_CHARGE_EMITTERS - this.chargeEmitters);
    this.chargeCredit -= Math.floor(this.chargeCredit);
    const zombies = state.zombies, n = zombies.length;
    let scanned = 0;
    for (; scanned < n && budget > 0; scanned++) {
      const z = zombies[(this.chargeCursor + scanned) % n];
      if (z.state !== 'follower' || z.dormant || z.elevation > 0.15) continue;
      const dx = z.pos.x - z.prevPos.x, dz = z.pos.z - z.prevPos.z;
      if (dx * dx + dz * dz <= (0.6 / 60) ** 2) continue;
      const p = this.payload;
      p.x = z.prevPos.x + dx * this.alpha; p.z = z.prevPos.z + dz * this.alpha;
      if (!withinVision(p.x, p.z, focusX, focusZ, this.profile.footstepRadius)) continue;
      p.y = 0.2; p.dirX = dx; p.dirZ = dz;
      this.emit('horde.charge', p); budget--;
    }
    this.chargeCursor = n ? (this.chargeCursor + scanned) % n : 0;
  }
  /** Stalled cars smoke dark from the bonnet; clawed cars past half grip leak light steam. */
  private updateCarSmoke(dt: number, state: GameState, focusX: number, focusZ: number): void {
    const cars = state.vehicles;
    if (!cars || cars.length === 0) { this.smokeCredit.clear(); return; }
    if (this.smokeCredit.size > 64) this.smokeCredit.clear();
    const scale = this.profile.burstScale * (this.settings.reducedMotion ? 0.5 : 1);
    const radius = this.profile.footstepRadius * 1.5;
    for (const v of cars) {
      const nose = halfLength(v) - 0.7;
      const rate = vehicleSmokeRate(v) * scale;
      if (rate <= 0) { this.smokeCredit.delete(v.id); continue; }
      const x = v.prevPos.x + (v.pos.x - v.prevPos.x) * this.alpha, z = v.prevPos.z + (v.pos.z - v.prevPos.z) * this.alpha;
      if (!withinVision(x, z, focusX, focusZ, radius)) continue;
      // A random starting phase keeps a row of wrecks from puffing in lockstep.
      let credit = (this.smokeCredit.get(v.id) ?? this.random()) + rate * dt;
      const p = this.payload;
      for (; credit >= 1; credit--) {
        p.x = x + Math.sin(v.facing) * nose + (this.random() - 0.5) * 0.5;
        p.z = z + Math.cos(v.facing) * nose + (this.random() - 0.5) * 0.5;
        p.y = 1.0; p.dirX = p.dirZ = undefined; p.color = v.mode === 'stalled' ? SMOKE_DARK : SMOKE_LIGHT;
        this.emit('vehicle.smoke', p);
      }
      p.color = undefined;
      this.smokeCredit.set(v.id, credit);
    }
  }
  reset(): void {
    this.smokeCredit.clear();
    this.pool.reset(); this.footsteps.credit = 0; this.footsteps.cursor = 0;
    this.footsteps.ids.fill(-1); this.footsteps.times.fill(-Infinity); this.stepIds.length = 0;
    this.chargeCredit = 0; this.chargeCursor = 0; this.chargeEmitters = 0; this.lastBrainAuraCredit = 0; this.seed = 0x12753ab9;
  }

  private updateLastBrainAura(dt: number, state: GameState): void {
    if (!state.horde.lastBrain.active || !state.leader.alive || state.phase !== 'playing') {
      this.lastBrainAuraCredit = 0;
      return;
    }
    const rate = 24 * this.profile.burstScale * (this.settings.reducedMotion ? 0.5 : 1);
    this.lastBrainAuraCredit = Math.min(8, this.lastBrainAuraCredit + dt * rate);
    while (this.lastBrainAuraCredit >= 1) {
      this.lastBrainAuraCredit -= 1;
      const p = this.payload;
      p.x = this.leaderX;
      p.y = state.leader.elevation + 0.85;
      p.z = this.leaderZ;
      p.radius = 0.85;
      p.dirX = p.dirZ = undefined;
      p.color = undefined;
      this.emit('horde.lastBrainAura', p);
    }
  }
  dispose(): void { if (!this.disposed) { this.reset(); this.pool.dispose(); this.disposed = true; } }
  stats(): { live: number; capacity: number; drawCalls: number } { return this.pool.stats(); }
}
