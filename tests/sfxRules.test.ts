import { describe, expect, it } from 'vitest';
import {
  CriticalGroanGate, GroanScheduler, HeartbeatScheduler, RECOVERY_SFX_ID, RecruitCueGate,
  SCREAM_IDS, SFX, SFX_IDS, SFX_TUNING, ScreamGate, SfxLimiter, distanceGain, pick, shotSfxFor,
} from '../src/audio/sfxRules';

describe('sfxRules (docs/7_soundeffects.md)', () => {
  it('maps weapons to clips: police pistol, tower sniper, ground soldier machine gun', () => {
    expect(shotSfxFor('police', false)).toBe('police_pistol');
    expect(shotSfxFor('police', true)).toBe('police_pistol');
    expect(shotSfxFor('soldier', true)).toBe('police_sniper');
    expect(shotSfxFor('soldier', false)).toBe('police_machinegun');
    expect(shotSfxFor('civilian', false)).toBe('police_pistol'); // todos #12 armed citizens
  });

  it('every listed clip has a spec and a file name in assets/soundeffects', () => {
    expect(SFX_IDS.length).toBe(27);
    for (const id of SFX_IDS) expect(SFX[id].gain).toBeGreaterThan(0);
    // groans stay quiet in the background
    expect(SFX.zombie_groan1.gain).toBeLessThan(0.3);
  });

  it('pick stays in range for r in [0,1]', () => {
    expect(pick(SCREAM_IDS, 0)).toBe('human_scream1');
    expect(pick(SCREAM_IDS, 0.999)).toBe('human_scream4');
    expect(pick(SCREAM_IDS, 1)).toBe('human_scream4');
  });

  it('distanceGain falls off from 1 to 0', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(SFX_TUNING.nearDist)).toBe(1);
    expect(distanceGain(SFX_TUNING.farDist)).toBe(0);
    const mid = distanceGain((SFX_TUNING.nearDist + SFX_TUNING.farDist) / 2);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it('SfxLimiter enforces min interval and max voices', () => {
    const lim = new SfxLimiter();
    const iv = SFX.police_pistol.minInterval;
    expect(lim.tryStart('police_pistol', 0, 1)).toBe(true);
    expect(lim.tryStart('police_pistol', iv / 2, 1)).toBe(false);
    let t = 0;
    let started = 1;
    for (let i = 0; i < 10; i++) { t += iv; if (lim.tryStart('police_pistol', t, 1)) started++; }
    // all started within 1 s, so never more than maxVoices overlapping
    expect(started).toBe(SFX.police_pistol.maxVoices);
    // once voices end, it plays again
    expect(lim.tryStart('police_pistol', 5, 1)).toBe(true);
  });

  it('GroanScheduler fires at random intervals inside the configured range', () => {
    const g = new GroanScheduler();
    const fires: number[] = [];
    for (let t = 0; t < 120; t += 0.1) if (g.update(t, () => 0.5)) fires.push(t);
    expect(fires.length).toBeGreaterThan(5);
    for (let i = 1; i < fires.length; i++) {
      const gap = fires[i] - fires[i - 1];
      expect(gap).toBeGreaterThanOrEqual(SFX_TUNING.groanIntervalMin - 0.11);
      expect(gap).toBeLessThanOrEqual(SFX_TUNING.groanIntervalMax + 0.11);
    }
  });

  it('ScreamGate: once per flight per human, globally spaced', () => {
    const gate = new ScreamGate();
    const r = () => 0;
    const frame = (t: number, flee: Record<number, boolean>) => {
      gate.begin();
      const out: number[] = [];
      for (const id of Object.keys(flee).map(Number)) if (gate.observe(id, flee[id], t, r)) out.push(id);
      gate.end();
      return out;
    };
    // a crowd of 5 starts fleeing together: only one scream
    expect(frame(0, { 1: true, 2: true, 3: true, 4: true, 5: true })).toHaveLength(1);
    // same humans keep fleeing past the gap: no repeats
    expect(frame(SFX_TUNING.screamGapMax + 1, { 1: true, 2: true, 3: true, 4: true, 5: true })).toHaveLength(0);
    // a new human fleeing after the gap screams
    expect(frame(SFX_TUNING.screamGapMax + 2, { 1: true, 6: true })).toEqual([6]);
    // but another new one right after is blocked by the gap
    expect(frame(SFX_TUNING.screamGapMax + 2.5, { 7: true })).toEqual([]);
    // human 1 stops, then flees again later: re-armed
    frame(30, { 1: false });
    expect(frame(40, { 1: true })).toEqual([1]);
  });

  it('HeartbeatScheduler tightens cadence as timeLeft falls and resets cleanly', () => {
    const hb = new HeartbeatScheduler();
    // First beat fires immediately on entry
    expect(hb.update(10, 6, 6)).toBe(true);
    // At full duration, next beat waits heartbeatIntervalMax
    expect(hb.update(10 + SFX_TUNING.heartbeatIntervalMax * 0.5, 6, 6)).toBe(false);
    expect(hb.update(10 + SFX_TUNING.heartbeatIntervalMax + 0.01, 6, 6)).toBe(true);

    // Near 0 timeLeft, cadence tightens toward heartbeatIntervalMin
    hb.reset();
    expect(hb.update(20, 0.1, 6)).toBe(true);
    const fastNext = 20 + SFX_TUNING.heartbeatIntervalMin + 0.02;
    expect(hb.update(fastNext, 0.1, 6)).toBe(true);

    // Reset allows immediate beat on next Last Brain entry
    hb.reset();
    expect(hb.update(20.05, 6, 6)).toBe(true);
  });

  it('CriticalGroanGate enforces at least 20 s cooldown and resets', () => {
    expect(SFX_TUNING.criticalGroanCooldown).toBeGreaterThanOrEqual(20);
    const gate = new CriticalGroanGate();
    expect(gate.tryGroan(1)).toBe(true);
    expect(gate.tryGroan(1 + SFX_TUNING.criticalGroanCooldown - 0.1)).toBe(false);
    expect(gate.tryGroan(1 + SFX_TUNING.criticalGroanCooldown)).toBe(true);
    gate.reset();
    expect(gate.tryGroan(2)).toBe(true);
  });

  it('RecruitCueGate throttles soft recruit cues and recovery cue id is valid', () => {
    expect(SFX_TUNING.recruitStrengthCooldown).toBeGreaterThanOrEqual(0.6);
    expect(SFX[RECOVERY_SFX_ID].gain).toBeGreaterThan(0);
    const gate = new RecruitCueGate();
    expect(gate.tryPlay(5)).toBe(true);
    expect(gate.tryPlay(5 + SFX_TUNING.recruitStrengthCooldown - 0.05)).toBe(false);
    expect(gate.tryPlay(5 + SFX_TUNING.recruitStrengthCooldown)).toBe(true);
    gate.reset();
    expect(gate.tryPlay(5.1)).toBe(true);
  });
});
