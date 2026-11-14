// LocalStorage adapter for WorldSave. Never throws. OWNER: T006. T001 stub.
import { BALANCE } from '../config/balance';
import type { StorageLike } from '../core/contracts';
import type { WorldSave } from '../core/types';

export class SaveStore {
  constructor(private readonly storage: StorageLike | null, private readonly key: string = BALANCE.save.storageKey) {}
  load(): WorldSave | null { void this.storage; void this.key; return null; }
  save(_s: WorldSave): boolean { return false; }
  clear(): void { /* T006 */ }
}
