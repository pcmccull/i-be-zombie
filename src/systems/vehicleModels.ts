// [pure] Vehicle body types: footprint and handling per VehicleModel (BALANCE.vehicleModels), spawn pick.
import { BALANCE } from '../config/balance';
import type { Rng, VehicleAgent, VehicleModel } from '../core/types';

export const VEHICLE_MODELS = Object.keys(BALANCE.vehicleModels) as VehicleModel[];

export function modelSpec(model: VehicleModel | undefined): (typeof BALANCE.vehicleModels)[VehicleModel] {
  return BALANCE.vehicleModels[model ?? 'sedan'];
}

/** Half length / half width of a vehicle's footprint. */
export function halfLength(v: Pick<VehicleAgent, 'model'>): number { return modelSpec(v.model).length / 2; }
export function halfWidth(v: Pick<VehicleAgent, 'model'>): number { return modelSpec(v.model).width / 2; }

/** Weighted random body type; rammers only drive models that can ram. */
export function pickModel(rng: Rng, rammer: boolean): VehicleModel {
  let total = 0;
  for (const m of VEHICLE_MODELS) if (!rammer || BALANCE.vehicleModels[m].rammer) total += BALANCE.vehicleModels[m].weight;
  let r = rng.next() * total;
  for (const m of VEHICLE_MODELS) {
    if (rammer && !BALANCE.vehicleModels[m].rammer) continue;
    r -= BALANCE.vehicleModels[m].weight;
    if (r <= 0) return m;
  }
  return 'sedan';
}
