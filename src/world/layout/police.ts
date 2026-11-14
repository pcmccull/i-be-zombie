import type { Rng } from '../../core/types';
import { building, district, enclosure, human, prop, rect, streetPopulation, stronghold, vehicle, type WorldDraft } from './common';

export function buildPolice(w: WorldDraft, rng: Rng): void {
  district(w, 'police', rect(-200, -160, 0, 0), 10, 18, [
    { rect: rect(-177, -83, -163, -77), count: 5 }, { rect: rect(-103, -142, -97, -125), count: 5 },
    { rect: rect(-43, -83, -25, -77), count: 4 }, { rect: rect(-103, -45, -97, -25), count: 4 },
  ]);
  const station = enclosure(w, 5, 'stationDoor', 'station', rect(-78, -65, -25, -18), 'south', [-47, -39], 2.4, true);
  building(w, rect(-73, -60, -54, -39), 'civic', 13, rng);
  stronghold(w, 'police_station', rect(-78, -65, -25, -18), { x: -34, z: -14 },
    [{ x: -100, z: -110 }, { x: -100, z: -140 }],
    [{ structureId: station.id }, { point: { x: -41, z: -40 }, radius: 6, holdTime: 6, minZombies: 6, requires: ['breach'] }]);
  for (const [x, z, dx, dz] of [
    [-47, -22, 0, 0], [-39, -22, 0, 0], [-47, -32, 12, 0], [-34, -54, 0, 9],
    [-69, -30, 12, 0], [-49, -57, 8, 0], [-31, -30, 0, 4], [-60, -34, 9, 0],
  ]) {
    const waypoints = dx === 0 && dz === 0 ? [{ x, z }] : [
      { x, z }, { x: x + dx, z: z + dz },
      { x: x + dx + (dx === 0 ? 3 : 0), z: z + dz + (dz === 0 ? 3 : 0) },
      { x: x + (dx === 0 ? 3 : 0), z: z + (dz === 0 ? 3 : 0) },
    ];
    human(w, 'police', 'stronghold', { x, z }, waypoints, { strongholdId: 'police_station' });
  }
  for (const [x, z, width, depth, style] of [
    [-192, -150, 32, 25, 'office'], [-148, -149, 30, 26, 'civic'], [-85, -149, 24, 28, 'office'],
    [-48, -146, 30, 24, 'office'], [-190, -61, 30, 29, 'civic'], [-146, -61, 29, 28, 'office'],
    [-191, -113, 31, 18, 'garage'], [-147, -112, 29, 17, 'office'], [-79, -111, 27, 16, 'office'],
  ] as const) building(w, rect(x, z, x + width, z + depth), style, 8 + rng.next() * 9, rng);
  w.ground.push({ kind: 'plaza', rect: rect(-192, -30, -114, -14) }, { kind: 'lot', rect: rect(-84, -120, -17, -91) });
  for (const x of [-78, -66, -39, -25]) vehicle(w, 'car', x, -117, Math.PI / 2, rng);
  for (const x of [-185, -169, -150, -128]) prop(w, 'tree', x, -23);
  prop(w, 'sign', -43, -15); prop(w, 'floodlight', -49, -19); prop(w, 'floodlight', -37, -19);
  streetPopulation(w, 10, rect(-189, -84, -19, -76), true);
}
