// [pure] Car looks shared by VehicleRenderer (paint, wear, door) and the VFX rules (paint chips, bonnet smoke).
// Render-only: reads VehicleAgent fields, never writes them.
import { BALANCE } from '../config/balance';
import type { VehicleAgent } from '../core/types';

export const CAR_PAINT: readonly number[] = [0xff6f91, 0x35c6c6, 0xffd35c, 0xf8f4ec, 0x6f8cff, 0xff9a4d];
export const RAMMER_PAINT: readonly number[] = [0x2b2f36, 0x3b3f2c, 0x4a1f22];
/** Soot/grime the paint is pulled toward as the driver's grip wears down. */
export const SCORCH = 0x3a3632;
/** Stalled-car bonnet smoke and damaged-car steam colours. */
export const SMOKE_DARK = 0x4f4c48;
export const SMOKE_LIGHT = 0x9a968e;

/** City buses and delivery trucks/vans run fleet liveries; police cars are white (black panels are trim). */
export const BUS_PAINT: readonly number[] = [0xffc93c, 0x2ec4b6, 0xf25f5c, 0x3a86ff];
export const FLEET_PAINT: readonly number[] = [0xf8f4ec, 0xe94f37, 0x2e86ab, 0x7bc950, 0xf6ae2d];
export const POLICE_PAINT = 0xf4f6f8;

type CarLook = Pick<VehicleAgent, 'kind' | 'variant' | 'model'>;
type CarWear = Pick<VehicleAgent, 'hp' | 'mode' | 'modeTime'>;

export function vehiclePaint(v: CarLook): number {
  if (v.model === 'police') return POLICE_PAINT;
  const list = v.kind === 'rammer' ? RAMMER_PAINT : v.model === 'bus' ? BUS_PAINT
    : v.model === 'van' || v.model === 'boxTruck' ? FLEET_PAINT : CAR_PAINT;
  const i = Math.abs(Math.floor(Number.isFinite(v.variant) ? v.variant : 0)) % list.length;
  return list[i];
}

/** 0 = pristine, 1 = grip gone (stalled cars are fully worn). */
export function vehicleWear(v: CarWear, maxHp: number = BALANCE.traffic.carHp): number {
  if (v.mode === 'stalled') return 1;
  if (!(maxHp > 0) || !Number.isFinite(v.hp)) return 0;
  return Math.max(0, Math.min(1, 1 - v.hp / maxHp));
}

/** Seconds into the stall at which the car starts sinking away (VehicleRenderer). */
export function sinkStart(): number { return BALANCE.traffic.fadeTime - 1.2; }

/**
 * Bonnet smoke puffs per second: stalled cars smoke dark until they sink; live cars past half wear leak light steam
 * that thickens toward 0 grip. Pristine cars never smoke.
 */
export function vehicleSmokeRate(v: CarWear, maxHp: number = BALANCE.traffic.carHp): number {
  if (v.mode === 'stalled') return v.modeTime < sinkStart() ? 3.5 : 0;
  const wear = vehicleWear(v, maxHp);
  return wear <= 0.5 ? 0 : (wear - 0.5) * 2 * 2.5;
}

/** Driver door swing (radians, outward) for a stalled car: eases open over the first 0.35 s. */
export function doorOpenAngle(v: Pick<VehicleAgent, 'mode' | 'modeTime'>): number {
  if (v.mode !== 'stalled') return 0;
  const t = Math.max(0, Math.min(1, v.modeTime / 0.35));
  const ease = 1 - (1 - t) ** 3;
  return 1.15 * ease;
}
