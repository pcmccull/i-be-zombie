import type { Rng } from '../../core/types';
import { building, district, enclosure, human, prop, rect, streetPopulation, stronghold, vehicle, type WorldDraft } from './common';

export function buildSuburbs(w: WorldDraft, rng: Rng): void {
  district(w, 'suburbs', rect(-200, 0, 0, 160), 16, 30, [
    { rect: rect(-145, 124, -136, 132), count: 8 }, { rect: rect(-137, 137, -122, 145), count: 8 },
    { rect: rect(-103, 25, -97, 40), count: 7 }, { rect: rect(-60, 77, -43, 83), count: 7 },
  ]);
  w.ground.push({ kind: 'park', rect: rect(-170, 109, -113, 154) },
    { kind: 'plaza', rect: rect(-163, 108, -143, 122) });
  for (const [x, z, width, depth] of [
    [-194, 18, 17, 20], [-163, 18, 18, 20], [-137, 18, 20, 20],
    [-192, 46, 18, 19], [-162, 46, 18, 19], [-135, 47, 19, 18],
    [-145, 90, 21, 15], [-194, 134, 18, 18], [-83, 20, 18, 18],
    [-53, 22, 18, 19], [-82, 48, 18, 18], [-51, 48, 18, 18],
    [-54, 96, 18, 18], [-84, 133, 18, 20], [-53, 134, 18, 19],
  ]) {
    building(w, rect(x, z, x + width, z + depth), rng.next() < 0.25 ? 'garage' : 'house', 4 + rng.next() * 3, rng);
    w.ground.push({ kind: 'park', rect: rect(x - 2, z - 2, x + width + 2, z + depth + 2) });
    prop(w, 'fence', x + width / 2, z - 2, Math.PI / 2);
    prop(w, 'tree', x - 2, z + depth + 1, 0, Math.floor(rng.next() * 3));
  }
  const bus = enclosure(w, 1, 'busDoor', 'bus', rect(-141, 114, -127, 119), 'south', [-135, -131], 3.2, false);
  const alley = enclosure(w, 2, 'alleyGate', 'alley', rect(-186, 89, -176, 111), 'south', [-184, -178], 3, false);
  const pen = enclosure(w, 4, 'penGate', 'barricade', rect(-80, 95, -68, 105), 'west', [98, 102], 2.2, true);
  for (const [def, count] of [[bus, 10], [alley, 15], [pen, 20]] as const) {
    const b = def.enclosure;
    w.spawnZones.push({ name: `${def.landmark}-held`, heldBy: def.id, count,
      rect: rect(b.minX + 0.7, b.minZ + 0.7, b.maxX - 0.7, b.maxZ - 0.7) });
  }
  stronghold(w, 'suburb_checkpoint', rect(-89, 92, -65, 111), { x: -84, z: 117 },
    [{ x: -100, z: 25 }, { x: -100, z: 50 }], [{ structureId: pen.id }, {}]);
  for (const pos of [{ x: -86, z: 96 }, { x: -85, z: 107 }, { x: -72, z: 109 }]) {
    human(w, 'police', 'stronghold', pos, [pos, { x: pos.x + 2, z: pos.z }], { strongholdId: 'suburb_checkpoint' });
  }
  vehicle(w, 'barrier', -87, 100, Math.PI / 2, rng);
  vehicle(w, 'car', -64, 120, Math.PI / 2, rng);
  for (const [x, z] of [[-167, 116], [-166, 139], [-148, 150], [-118, 150], [-115, 121]]) prop(w, 'tree', x, z);
  prop(w, 'bench', -162, 128); prop(w, 'bench', -145, 149);
  streetPopulation(w, 4, rect(-163, 128, -119, 138));
  streetPopulation(w, 12, rect(-188, 76, -20, 84));
}
