import type { CheckpointLayout, Rng } from '../../core/types';
import { building, district, human, prop, rect, solid, streetPopulation, stronghold, vehicle, type WorldDraft } from './common';

export function buildIndustrial(w: WorldDraft, rng: Rng): CheckpointLayout {
  district(w, 'industrial', rect(0, -160, 200, 0), 8, 22, [
    { rect: rect(25, -83, 43, -77), count: 6 }, { rect: rect(97, -141, 103, -124), count: 6 },
    { rect: rect(158, -83, 176, -77), count: 5 }, { rect: rect(97, -46, 103, -26), count: 5 },
  ]);
  // Legacy 42 x 32 m checkpoint, translated (+80,-60) into the NE block.
  const bounds = rect(142, -144, 184, -112), gate = rect(159.5, -113, 166.5, -112);
  solid(w, rect(142, -144, 184, -143), 'cp-wall-n');
  solid(w, rect(142, -144, 143, -112), 'cp-wall-w');
  solid(w, rect(183, -144, 184, -112), 'cp-wall-e');
  solid(w, rect(142, -113, 159.5, -112), 'cp-wall-sw');
  solid(w, rect(166.5, -113, 184, -112), 'cp-wall-se');
  solid(w, gate, 'gate', 'gate', 3);
  const towers: CheckpointLayout['towers'] = [
    { id: 'W', rect: rect(144, -117, 147, -114), platformHeight: 4 },
    { id: 'E', rect: rect(179, -117, 182, -114), platformHeight: 4 },
  ];
  towers.forEach(t => solid(w, t.rect, `tower${t.id}`, 'tower', 6, false));
  building(w, rect(146, -140, 156, -133), 'garage', 2.8, rng);
  building(w, rect(170, -140, 180, -133), 'garage', 2.8, rng);
  vehicle(w, 'barrier', 146, -105, 0, rng); vehicle(w, 'barrier', 180, -105, 0, rng);
  const checkpoint: CheckpointLayout = {
    bounds, gate: { rect: gate, facing: 0, tag: 'gate' }, towers, stagingArea: rect(143, -109, 182, -92),
    gateApproachOutside: Array.from({ length: 7 }, (_, i) => ({ x: 160 + i, z: -110 })),
    gateApproachInside: Array.from({ length: 7 }, (_, i) => ({ x: 160 + i, z: -115 })),
  };
  w.ground.push({ kind: 'compound', rect: bounds }, { kind: 'lot', rect: checkpoint.stagingArea });
  stronghold(w, 'industrial_yard', bounds, { x: 137, z: -104 },
    [{ x: 100, z: -110 }, { x: 100, z: -140 }],
    [{}, { point: { x: 163, z: -125 }, radius: 7, holdTime: 6, minZombies: 8, requires: ['break_gate'] }]);
  // Platform edge positions clear the 3 x 3 m support footprints at ground level.
  for (const [tower, x] of [['W', 147.6], ['E', 178.4]] as const) {
    human(w, 'soldier', 'stronghold', { x, z: -115.5 }, [{ x, z: -115.5 }], { tower, strongholdId: 'industrial_yard' });
  }
  for (const [x, z, dx] of [[151, -127, 5], [174, -127, 4], [163, -138, 0],
    [153, -119, 4], [163, -105, 0], [174, -99, 4]]) {
    human(w, 'soldier', 'stronghold', { x, z }, [{ x, z }, { x: x + dx, z }], { strongholdId: 'industrial_yard' });
  }
  for (const [x, z, width, depth] of [[18, -150, 31, 28], [59, -150, 28, 27], [18, -114, 29, 18],
    [59, -114, 28, 18], [19, -63, 30, 35], [60, -62, 28, 33], [120, -63, 30, 34], [164, -63, 29, 35]]) {
    building(w, rect(x, z, x + width, z + depth), 'warehouse', 9 + rng.next() * 5, rng);
  }
  w.ground.push({ kind: 'lot', rect: rect(115, -151, 137, -94) });
  for (const z of [-143, -122]) vehicle(w, 'truck', 126, z, 0, rng);
  for (const x of [26, 67, 132, 178]) {
    vehicle(w, 'dumpster', x, -21, 0, rng); vehicle(w, 'barrier', x + 7, -19, 0, rng);
    prop(w, 'fence', x + 2, -16, Math.PI / 2);
  }
  prop(w, 'floodlight', 157, -111); prop(w, 'floodlight', 169, -111);
  prop(w, 'warningSign', 155, -94); prop(w, 'warningSign', 171, -94);
  streetPopulation(w, 8, rect(18, -84, 189, -76), true);
  return checkpoint;
}
