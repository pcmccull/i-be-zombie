// LocalStorage adapter for WorldSave. Never throws. OWNER: T006.
import { BALANCE } from '../config/balance';
import type { StorageLike } from '../core/contracts';
import type { WorldSave } from '../core/types';
import { parseSave } from './saveSchema';

export class SaveStore {
  constructor(
    private readonly storage: StorageLike | null,
    private readonly key: string = BALANCE.save.storageKey,
  ) {}

  load(): WorldSave | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      if (typeof raw !== 'string' || raw.length === 0) return null;
      const parsed: unknown = JSON.parse(raw);
      return parseSave(parsed);
    } catch {
      return null;
    }
  }

  save(s: WorldSave): boolean {
    if (!this.storage) return false;
    try {
      const validated = parseSave(s);
      if (!validated) return false;
      const serialized = JSON.stringify(validated);
      this.storage.setItem(this.key, serialized);
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.key);
    } catch {
      // Ignore storage errors (SecurityError, disabled storage, etc.).
    }
  }
}
