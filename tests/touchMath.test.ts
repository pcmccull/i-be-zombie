import { describe, expect, it } from 'vitest';
import { clampKnob, createStickOutput, isTap, pinchZoomDelta, stickFromOffset, touchDistance } from '../src/core/touchMath';

const R = 56, DZ = 0.12, SPRINT = 0.85;

describe('touchMath stick (todos #7)', () => {
  it('screen up is forward, screen right is right', () => {
    const o = stickFromOffset(0, -R, R, DZ, SPRINT, createStickOutput());
    expect(o.moveForward).toBeCloseTo(1);
    expect(o.moveRight).toBeCloseTo(0);
    stickFromOffset(R, 0, R, DZ, SPRINT, o);
    expect(o.moveRight).toBeCloseTo(1);
    expect(o.moveForward).toBeCloseTo(0);
    stickFromOffset(0, R, R, DZ, SPRINT, o);
    expect(o.moveForward).toBeCloseTo(-1);
  });

  it('dead zone gives zero output and no sprint', () => {
    const o = stickFromOffset(R * DZ * 0.9, 0, R, DZ, SPRINT, createStickOutput());
    expect(o).toEqual({ moveForward: 0, moveRight: 0, sprint: false, mag: 0 });
  });

  it('is clamped to the unit circle beyond the radius', () => {
    const o = stickFromOffset(R * 3, -R * 3, R, DZ, SPRINT, createStickOutput());
    expect(Math.hypot(o.moveForward, o.moveRight)).toBeCloseTo(1);
    expect(o.mag).toBeCloseTo(1);
    expect(o.sprint).toBe(true);
  });

  it('sprints only at or past the threshold', () => {
    const o = createStickOutput();
    expect(stickFromOffset(0, -R * 0.8, R, DZ, SPRINT, o).sprint).toBe(false);
    expect(stickFromOffset(0, -R * 0.86, R, DZ, SPRINT, o).sprint).toBe(true);
  });

  it('magnitude ramps from 0 at the dead zone edge to 1 at the rim', () => {
    const o = createStickOutput();
    expect(stickFromOffset(0, -R * 0.56, R, DZ, SPRINT, o).mag).toBeCloseTo(0.5, 2);
  });

  it('degenerate input is zero', () => {
    const o = createStickOutput();
    expect(stickFromOffset(Number.NaN, 0, R, DZ, SPRINT, o).mag).toBe(0);
    expect(stickFromOffset(10, 10, 0, DZ, SPRINT, o).mag).toBe(0);
  });

  it('clampKnob keeps the knob inside the radius', () => {
    const k = clampKnob(300, 400, 50, { x: 0, y: 0 });
    expect(Math.hypot(k.x, k.y)).toBeCloseTo(50);
    expect(clampKnob(10, -5, 50, { x: 0, y: 0 })).toEqual({ x: 10, y: -5 });
  });
});

describe('touchMath tap & pinch', () => {
  it('tap needs little movement and a short press', () => {
    expect(isTap(3, 4, 120, 12, 280)).toBe(true);
    expect(isTap(10, 10, 120, 12, 280)).toBe(false);
    expect(isTap(0, 0, 400, 12, 280)).toBe(false);
  });

  it('pinch out zooms in (negative), pinch in zooms out (positive, like wheel down)', () => {
    expect(pinchZoomDelta(100, 150, 2.5)).toBeCloseTo(-125);
    expect(pinchZoomDelta(150, 100, 2.5)).toBeCloseTo(125);
    expect(pinchZoomDelta(0, 100, 2.5)).toBe(0);
  });

  it('touchDistance', () => {
    expect(touchDistance(0, 0, 3, 4)).toBe(5);
  });
});
