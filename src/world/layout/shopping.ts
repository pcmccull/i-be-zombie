import type { Rng } from '../../core/types';
import { building, district, enclosure, human, prop, rect, streetPopulation, stronghold, vehicle, type WorldDraft } from './common';

export function buildShopping(w: WorldDraft, rng: Rng): void {
  district(w, 'shopping', rect(0, 0, 200, 160), 22, 26, [
    { rect: rect(25, 77, 43, 83), count: 7 }, { rect: rect(97, 30, 103, 48), count: 7 },
    { rect: rect(157, 77, 177, 83), count: 6 }, { rect: rect(97, 126, 103, 144), count: 6 },
  ]);
  building(w, rect(120, 95, 190, 135), 'mall', 10, rng);
  const security = enclosure(w, 6, 'securityShutter', 'mall', rect(134, 135, 178, 155), 'west', [141, 149], 2.4, true);
  stronghold(w, 'mall_security', rect(134, 135, 178, 155), { x: 124, z: 146 },
    [{ x: 100, z: 110 }, { x: 100, z: 130 }],
    [{ structureId: security.id }, { point: { x: 155, z: 145 }, radius: 5, holdTime: 5, minZombies: 5, requires: ['disable_security'] }]);
  for (const [x, z] of [[138, 140], [138, 151], [151, 140], [170, 141], [166, 150]]) {
    human(w, 'police', 'stronghold', { x, z }, [{ x, z }, { x: x + 3, z }], { strongholdId: 'mall_security' });
  }
  const store = enclosure(w, 3, 'storeDoor', 'store', rect(21, 21, 37, 35), 'south', [25, 31], 5, true);
  for (const [x, z] of [[24, 25], [33, 25], [24, 31], [33, 31]]) {
    human(w, 'civilian', 'store', { x, z }, [{ x, z }], { homeArea: store.enclosure, shelter: store.id });
  }
  for (const [x, z, width, depth] of [[46, 20, 20, 17], [72, 20, 16, 18], [20, 49, 28, 17],
    [62, 48, 26, 18], [21, 101, 25, 18], [59, 103, 28, 17], [23, 137, 24, 17], [60, 135, 26, 19]]) {
    building(w, rect(x, z, x + width, z + depth), 'storefront', 6 + rng.next() * 4, rng);
  }
  w.ground.push({ kind: 'lot', rect: rect(115, 16, 194, 68) });
  for (const x of [124, 138, 152, 166, 180]) for (const z of [25, 54]) {
    vehicle(w, 'car', x, z, 0, rng);
    w.markings.push({ kind: 'parkingBay', rect: rect(x - 2.2, z - 3, x + 2.2, z + 3), rotation: 0 });
  }
  for (const x of [119, 144, 169, 193]) prop(w, 'streetlight', x, 65);
  prop(w, 'sign', 118, 93); prop(w, 'dumpster', 187, 144);
  streetPopulation(w, 18, rect(18, 76, 189, 84), true);
}
