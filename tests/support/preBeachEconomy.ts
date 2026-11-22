// Test fixture: the open-world horde economy from before the beach start (5 start followers, base cap 40, no
// first-nest grant, the start nest already claimed/active). System tests written against that economy call this at the top of the file, before any
// Simulation is built; the real economy (alone on the beach, first nest unlocks 10) is covered in tests/beachStart.test.ts.
import { afterAll } from 'vitest';
import { BALANCE } from '../../src/config/balance';

type Economy = { maxFollowers: number; startFollowers: number; firstNestHorde: number; startNestClaimed: boolean };

export function usePreBeachEconomy(): void {
  const ow = BALANCE.openWorld as unknown as Economy;
  const saved: Economy = {
    maxFollowers: ow.maxFollowers, startFollowers: ow.startFollowers, firstNestHorde: ow.firstNestHorde, startNestClaimed: ow.startNestClaimed,
  };
  ow.maxFollowers = 40; ow.startFollowers = 5; ow.firstNestHorde = 0; ow.startNestClaimed = true;
  afterAll(() => { Object.assign(ow, saved); });
}
