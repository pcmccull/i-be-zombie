import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { GameEvent, GameState, VehicleAgent } from '../src/core/types';
import { clawPoint, dustColor, EMITTERS, mapEvents, VfxTile } from '../src/graphics/vfx/vfxRules';
import type { VfxSurface } from '../src/graphics/vfx/vfxRules';
import { CAR_PAINT, doorOpenAngle, RAMMER_PAINT, sinkStart, vehiclePaint, vehicleSmokeRate, vehicleWear } from '../src/visuals/vehicleLook';

const car = (over: Partial<VehicleAgent> = {}): VehicleAgent => ({
  id: 9, kind: 'civilian', mode: 'cruise', pos: { x: 10, z: 0 }, prevPos: { x: 10, z: 0 }, facing: 0, prevFacing: 0,
  speed: 8, lane: 0, modeTime: 0, passes: 0, variant: 2, hitFlash: 0, stuckTime: 0, hp: BALANCE.traffic.carHp, bogTime: 0,
  ...over,
} as VehicleAgent);
const stateWith = (v: VehicleAgent): GameState => ({
  leader: { pos: { x: 0, z: 0 }, prevPos: { x: 0, z: 0 } }, guards: [], vehicles: [v],
} as unknown as GameState);

describe('car looks (vehicleLook)', () => {
  it('paints civilians and rammers from their own palettes, deterministically, for any variant', () => {
    expect(vehiclePaint(car({ variant: 2 }))).toBe(CAR_PAINT[2]);
    expect(vehiclePaint(car({ variant: 8 }))).toBe(CAR_PAINT[2]);
    expect(vehiclePaint(car({ kind: 'rammer', variant: 1 } as Partial<VehicleAgent>))).toBe(RAMMER_PAINT[1]);
    expect(CAR_PAINT).toContain(vehiclePaint(car({ variant: -3 })));
    expect(CAR_PAINT).toContain(vehiclePaint(car({ variant: NaN })));
  });
  it('wear tracks the lost grip, clamps, and is total once stalled', () => {
    const max = BALANCE.traffic.carHp;
    expect(vehicleWear(car())).toBe(0);
    expect(vehicleWear(car({ hp: max / 2 }))).toBeCloseTo(0.5);
    expect(vehicleWear(car({ hp: -5 }))).toBe(1);
    expect(vehicleWear(car({ hp: max * 2 }))).toBe(0);
    expect(vehicleWear(car({ mode: 'stalled', hp: max }))).toBe(1);
    expect(vehicleWear(car({ hp: 10 }), 0)).toBe(0);
  });
  it('only worn or stalled cars smoke; wrecks stop once they sink', () => {
    const max = BALANCE.traffic.carHp;
    expect(vehicleSmokeRate(car())).toBe(0);
    expect(vehicleSmokeRate(car({ hp: max * 0.6 }))).toBe(0);
    const light = vehicleSmokeRate(car({ hp: max * 0.3 })), heavy = vehicleSmokeRate(car({ hp: max * 0.05 }));
    expect(light).toBeGreaterThan(0);
    expect(heavy).toBeGreaterThan(light);
    expect(vehicleSmokeRate(car({ mode: 'stalled', modeTime: 1 }))).toBeGreaterThan(heavy);
    expect(vehicleSmokeRate(car({ mode: 'stalled', modeTime: sinkStart() + 0.1 }))).toBe(0);
  });
  it('the driver door is shut on live cars and eases open (monotonic) on a stall', () => {
    expect(doorOpenAngle(car())).toBe(0);
    let last = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const a = doorOpenAngle(car({ mode: 'stalled', modeTime: t }));
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
    expect(last).toBeCloseTo(1.15);
  });
});

describe('car VFX rules', () => {
  it('a claw lands on the panel facing the attacker, just outside the footprint, pointing back at it', () => {
    const v = car({ facing: 0 });
    // Attacker 3 m to the car's left (+X when facing +Z).
    const p = clawPoint(v, { x: 13, z: 0.5 });
    expect(p.x).toBeGreaterThan(10.95);
    expect(p.x).toBeLessThan(11.2);
    expect(p.z).toBeCloseTo(0.5);
    expect(p.dirX).toBeCloseTo(1);
    // Rotated car (facing +X): its left is -Z.
    const r = clawPoint(car({ facing: Math.PI / 2 }), { x: 10, z: -3 });
    expect(r.z).toBeLessThan(-0.95);
    expect(r.z).toBeGreaterThan(-1.2);
  });
  it('falls back to the roof when the attacker is unknown or inside the footprint', () => {
    expect(clawPoint(car(), undefined).y).toBeCloseTo(1.55);
    const inside = clawPoint(car(), { x: 10.2, z: 0.3 });
    expect(inside).toMatchObject({ x: 10, z: 0, y: 1.55 });
  });
  it('a claw on a live car becomes one paint-chip spark burst (not a generic hit), drawn from the melee', () => {
    const v = car({ variant: 4 });
    const events: GameEvent[] = [
      { type: 'damage', target: { kind: 'vehicle', id: 9 }, amount: 8, pos: { ...v.pos } },
      { type: 'melee', attacker: 'zombie', attackerId: 3, target: { kind: 'vehicle', id: 9 }, pos: { x: 13, z: 0 } },
    ];
    const out = mapEvents(events, stateWith(v));
    expect(out.map(e => e.name)).toEqual(['vehicle.claw']);
    expect(out[0].payload.color).toBe(CAR_PAINT[4]);
    expect(out[0].payload.x).toBeGreaterThan(10.9);
  });
  it('the Alpha claws harder; claws on an old wreck or a missing car spark nothing', () => {
    const alpha: GameEvent = { type: 'melee', attacker: 'leader', attackerId: 1, target: { kind: 'vehicle', id: 9 }, pos: { x: 13, z: 0 } };
    expect(mapEvents([alpha], stateWith(car()))[0].payload.intensity).toBeGreaterThan(1);
    // The killing claw stalls the car in the same step: it still sparks.
    expect(mapEvents([alpha], stateWith(car({ mode: 'stalled', modeTime: 0 })))).toHaveLength(1);
    expect(mapEvents([alpha], stateWith(car({ mode: 'stalled', modeTime: 2 })))).toEqual([]);
    expect(mapEvents([alpha], stateWith(car({ id: 4 })))).toEqual([]);
  });
  it('car impacts scale with speed and follow the car heading', () => {
    const v = car({ facing: Math.PI / 2 });
    const hit = (speed: number, killed: boolean): GameEvent => ({ type: 'vehicleHit', vehicleId: 9, pos: { x: 12, z: 0 }, target: 'zombie', speed, killed });
    const slow = mapEvents([hit(3, false)], stateWith(v))[0].payload, fast = mapEvents([hit(14, false)], stateWith(v))[0].payload;
    expect(fast.intensity!).toBeGreaterThan(slow.intensity!);
    expect(fast.intensity!).toBeLessThanOrEqual(2);
    expect(slow.intensity!).toBeGreaterThanOrEqual(0.6);
    expect(fast.dirX).toBeCloseTo(1);
    expect(mapEvents([hit(14, true)], stateWith(v))[0].payload.intensity!).toBeGreaterThan(fast.intensity!);
  });
  it('a pulled driver: glass at the driver window, dust where they land, stars above their head', () => {
    const v = car({ facing: 0 });
    const out = mapEvents([{ type: 'driverBailed', vehicleId: 9, guardId: 7, pos: { x: 12, z: 0 }, pulled: true }], stateWith(v));
    const glass = out.find(e => e.name === 'vehicle.glass')!.payload;
    expect(glass.x).toBeCloseTo(11); // left side of a +Z-facing car
    const stars = out.find(e => e.name === 'human.dazed')!.payload;
    expect(stars.y!).toBeGreaterThan(1.7);
    expect(stars.x).toBe(12);
  });
  it('new emitters keep the shape language: stars spiral, glass bounces, smoke rises, sparks pop', () => {
    expect(EMITTERS['human.dazed'].motion).toBe('spiral');
    expect(EMITTERS['human.dazed'].tiles).toEqual([VfxTile.Star]);
    expect(EMITTERS['vehicle.glass'].bounce).toBeGreaterThan(0);
    expect(EMITTERS['vehicle.smoke'].gravity).toBeLessThan(0);
    expect(EMITTERS['vehicle.claw'].flash).toBe(true);
    expect(EMITTERS['vehicle.claw'].tiles).toContain(VfxTile.Shard);
    for (const name of ['vehicle.claw', 'vehicle.impact', 'vehicle.glass', 'vehicle.smoke', 'human.dazed', 'body.fall'] as const) {
      const c = EMITTERS[name];
      expect(c.lifetime[0]).toBeLessThanOrEqual(c.lifetime[1]);
      expect(c.lifetime[1]).toBeLessThanOrEqual(3);
      expect(c.count).toBeGreaterThan(0);
    }
  });
  it('every surface has a dust colour', () => {
    const surfaces: VfxSurface[] = ['asphalt', 'sidewalk', 'grass', 'sand', 'concrete', 'wood', 'metal', 'cloth'];
    for (const s of surfaces) expect(Number.isInteger(dustColor(s))).toBe(true);
    expect(dustColor('sand')).not.toBe(dustColor('asphalt'));
  });
});
