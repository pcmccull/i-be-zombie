// [pure] Versioned save schema (docs/3_open_world.md §4H). OWNER: T006. T001 stub. No DOM, no clocks.
import type { SimContext } from '../core/contracts';
import type { GameState, WorldSave } from '../core/types';

export function createSave(_state: GameState, _seed: number, _savedAt = 0): WorldSave { throw new Error('T006: createSave not implemented'); }
export function applySave(_ctx: SimContext, _save: WorldSave): void { /* T006 */ }
export function parseSave(_raw: unknown): WorldSave | null { return null; }
export function encodeBits(_bits: Uint8Array): string { return ''; }
export function decodeBits(_s: string, length: number): Uint8Array { return new Uint8Array(length); }
