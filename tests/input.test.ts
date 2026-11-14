import { describe, expect, it } from 'vitest';
import {
  abilitySlotForKey,
  hordeCommandForRightClick,
  isSystemKey,
  keyActionFor,
  keyAllowedWhileModal,
  shouldReleaseLock,
  shouldRequestLock,
  zoomTarget,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../src/core/cameraMath';

describe('open-world key mapping', () => {
  it('maps Q E R F to ability slots 0-3 and nothing else', () => {
    expect(['KeyQ', 'KeyE', 'KeyR', 'KeyF'].map(abilitySlotForKey)).toEqual([0, 1, 2, 3]);
    for (const code of ['KeyW', 'Space', 'KeyG', 'KeyM', 'Escape']) expect(abilitySlotForKey(code)).toBeNull();
  });

  it('maps one-shot keys to actions (Space regroup, G follow, M map, Esc pause, N mute)', () => {
    expect(keyActionFor('Space')).toBe('regroup');
    expect(keyActionFor('KeyG')).toBe('follow');
    expect(keyActionFor('KeyM')).toBe('map');
    expect(keyActionFor('Escape')).toBe('pause');
    expect(keyActionFor('KeyN')).toBe('mute');
    expect(keyActionFor('Tab')).toBe('help');
    expect(keyActionFor('F3')).toBe('debug');
    expect(keyActionFor('KeyC')).toBe('recenter');
    // R is an ability slot now, never restart; E is no longer rally.
    expect(keyActionFor('KeyR')).toBeNull();
    expect(keyActionFor('KeyE')).toBeNull();
  });

  it('ignores game keys while a menu or map is open but keeps system keys', () => {
    for (const code of ['KeyQ', 'KeyE', 'KeyR', 'KeyF', 'Space', 'KeyG', 'KeyW', 'KeyC']) {
      expect(keyAllowedWhileModal(code, true)).toBe(false);
      expect(keyAllowedWhileModal(code, false)).toBe(true);
    }
    for (const code of ['Escape', 'KeyM', 'KeyN', 'F3', 'Tab']) {
      expect(isSystemKey(code)).toBe(true);
      expect(keyAllowedWhileModal(code, true)).toBe(true);
    }
  });
});

describe('right-click horde orders', () => {
  const guard = { kind: 'guard', id: 7 } as const;
  const ground = { x: 12, z: -3 };

  it('attacks a target, additive with Ctrl', () => {
    expect(hordeCommandForRightClick({ target: guard, ground, shift: false, ctrl: false }))
      .toEqual({ type: 'attack', target: guard, additive: false });
    expect(hordeCommandForRightClick({ target: guard, ground, shift: false, ctrl: true }))
      .toEqual({ type: 'attack', target: guard, additive: true });
  });

  it('moves to the ground point when nothing is targeted', () => {
    const cmd = hordeCommandForRightClick({ target: null, ground, shift: false, ctrl: false });
    expect(cmd).toEqual({ type: 'move', point: ground });
    expect(cmd && cmd.type === 'move' && cmd.point).not.toBe(ground); // copied, not aliased
  });

  it('Shift+RMB regroups regardless of what is under the pointer', () => {
    expect(hordeCommandForRightClick({ target: guard, ground, shift: true, ctrl: false })).toEqual({ type: 'regroup' });
    expect(hordeCommandForRightClick({ target: null, ground: null, shift: true, ctrl: false })).toEqual({ type: 'regroup' });
  });

  it('issues nothing when the ray misses the ground and hits no target', () => {
    expect(hordeCommandForRightClick({ target: null, ground: null, shift: false, ctrl: false })).toBeNull();
  });
});

describe('open-world pointer lock and zoom', () => {
  it('keeps the mouse captured through respawn, releases for menus/map/help', () => {
    expect(shouldRequestLock({ isLocked: false, phase: 'respawning', helpVisible: false })).toBe(true);
    expect(shouldRequestLock({ isLocked: false, phase: 'playing', helpVisible: false, modalOpen: true })).toBe(false);
    expect(shouldReleaseLock({ isLocked: true, phase: 'respawning', helpVisible: false })).toBe(false);
    expect(shouldReleaseLock({ isLocked: true, phase: 'playing', helpVisible: false, modalOpen: true })).toBe(true);
  });

  it('clamps wheel zoom to the open-world range and is multiplicative', () => {
    expect(zoomTarget(ZOOM_MAX, 1000)).toBe(ZOOM_MAX);
    expect(zoomTarget(ZOOM_MIN, -1000)).toBe(ZOOM_MIN);
    expect(zoomTarget(ZOOM_DEFAULT, 100)).toBeGreaterThan(ZOOM_DEFAULT);
    expect(zoomTarget(ZOOM_DEFAULT, 0)).toBeCloseTo(ZOOM_DEFAULT, 10);
    expect(zoomTarget(20, Number.NaN)).toBe(20);
    expect(ZOOM_MAX).toBeGreaterThanOrEqual(56); // frames a 40-zombie horde
  });
});
