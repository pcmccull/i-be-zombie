import { describe, expect, it } from 'vitest';
import {
  applyOrbitDelta,
  clampCameraPitch,
  computeOrbitDelta,
  isInitialLockJump,
  MAX_CAMERA_PITCH,
  MIN_CAMERA_PITCH,
  MOUSE_LOOK_SENSITIVITY,
  POINTER_LOCK_SPIKE_PX,
  shouldReleaseLock,
  shouldRequestLock,
} from '../src/core/cameraMath';

describe('pointer lock orbit math', () => {
  it('maps movementX/movementY with drag-matching sign conventions and sensitivity scaling', () => {
    const out = { yawDelta: 0, pitchDelta: 0 };
    const res = computeOrbitDelta(100, -40, MOUSE_LOOK_SENSITIVITY, out);
    expect(res).toBe(out);
    // Moving right (+dx) decreases yaw; moving up (-dy) decreases pitch.
    expect(out.yawDelta).toBeCloseTo(-100 * MOUSE_LOOK_SENSITIVITY);
    expect(out.pitchDelta).toBeCloseTo(-40 * MOUSE_LOOK_SENSITIVITY);

    // Moving left (-dx) increases yaw; moving down (+dy) increases pitch.
    computeOrbitDelta(-50, 80, 0.01, out);
    expect(out.yawDelta).toBeCloseTo(0.5);
    expect(out.pitchDelta).toBeCloseTo(0.8);
  });

  it('guards against non-finite movement or sensitivity inputs', () => {
    expect(computeOrbitDelta(Number.NaN, 10)).toEqual({ yawDelta: 0, pitchDelta: 0 });
    expect(computeOrbitDelta(10, Number.POSITIVE_INFINITY)).toEqual({ yawDelta: 0, pitchDelta: 0 });
    expect(computeOrbitDelta(10, 10, Number.NaN)).toEqual({ yawDelta: 0, pitchDelta: 0 });
  });

  it('applies yaw/pitch deltas and clamps pitch to [MIN_CAMERA_PITCH, MAX_CAMERA_PITCH]', () => {
    const out = { yaw: 0, pitch: 0 };
    const startPitch = (45 * Math.PI) / 180;

    applyOrbitDelta(0.5, startPitch, 20, 10, 0.005, out);
    expect(out.yaw).toBeCloseTo(0.5 - 20 * 0.005);
    expect(out.pitch).toBeCloseTo(startPitch + 10 * 0.005);

    // Large downward drag/move clamps at MAX_CAMERA_PITCH (78 deg).
    applyOrbitDelta(0, startPitch, 0, 5000, MOUSE_LOOK_SENSITIVITY, out);
    expect(out.pitch).toBeCloseTo(MAX_CAMERA_PITCH);

    // Large upward drag/move clamps at MIN_CAMERA_PITCH (20 deg).
    applyOrbitDelta(0, startPitch, 0, -5000, MOUSE_LOOK_SENSITIVITY, out);
    expect(out.pitch).toBeCloseTo(MIN_CAMERA_PITCH);

    expect(clampCameraPitch(0)).toBeCloseTo(MIN_CAMERA_PITCH);
    expect(clampCameraPitch(Math.PI)).toBeCloseTo(MAX_CAMERA_PITCH);
  });
});

describe('pointer lock state decisions', () => {
  it('requests lock only on left click while unlocked during active play with help closed', () => {
    expect(
      shouldRequestLock({
        isLocked: false,
        phase: 'playing',
        helpVisible: false,
        button: 0,
        supported: true,
      }),
    ).toBe(true);

    // Already locked -> do not request again
    expect(
      shouldRequestLock({
        isLocked: true,
        phase: 'playing',
        helpVisible: false,
        button: 0,
      }),
    ).toBe(false);

    // Help panel open -> never lock
    expect(
      shouldRequestLock({
        isLocked: false,
        phase: 'playing',
        helpVisible: true,
        button: 0,
      }),
    ).toBe(false);

    // Victory or defeat overlay open -> never lock
    expect(
      shouldRequestLock({
        isLocked: false,
        phase: 'victory',
        helpVisible: false,
        button: 0,
      }),
    ).toBe(false);
    expect(
      shouldRequestLock({
        isLocked: false,
        phase: 'defeat',
        helpVisible: false,
        button: 0,
      }),
    ).toBe(false);

    // Right click or middle click -> never lock
    expect(
      shouldRequestLock({
        isLocked: false,
        phase: 'playing',
        helpVisible: false,
        button: 2,
      }),
    ).toBe(false);

    // Unsupported API -> never lock
    expect(
      shouldRequestLock({
        isLocked: false,
        phase: 'playing',
        helpVisible: false,
        button: 0,
        supported: false,
      }),
    ).toBe(false);
  });

  it('releases active lock when help opens or game transitions to victory/defeat', () => {
    expect(shouldReleaseLock({ isLocked: true, phase: 'playing', helpVisible: false })).toBe(false);
    expect(shouldReleaseLock({ isLocked: true, phase: 'playing', helpVisible: true })).toBe(true);
    expect(shouldReleaseLock({ isLocked: true, phase: 'victory', helpVisible: false })).toBe(true);
    expect(shouldReleaseLock({ isLocked: true, phase: 'defeat', helpVisible: false })).toBe(true);
    expect(shouldReleaseLock({ isLocked: false, phase: 'victory', helpVisible: true })).toBe(false);
  });

  it('ignores large initial movement jumps only on the first move after locking', () => {
    expect(POINTER_LOCK_SPIKE_PX).toBe(300);
    expect(isInitialLockJump(301, 0, true)).toBe(true);
    expect(isInitialLockJump(0, -301, true)).toBe(true);
    expect(isInitialLockJump(300, -300, true)).toBe(false);
    expect(isInitialLockJump(12, -8, true)).toBe(false);
    // Subsequent moves are not filtered even if fast
    expect(isInitialLockJump(450, 450, false)).toBe(false);
  });
});
