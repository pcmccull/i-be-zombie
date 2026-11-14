// [pure] Versioned save schema (docs/3_open_world.md §4H). OWNER: T006. No DOM, no clocks.
import { BALANCE } from '../config/balance';
import { ABILITIES, INNATE_ABILITIES } from '../content/abilities';
import { STRONGHOLDS } from '../content/strongholds';
import type { SimContext } from '../core/contracts';
import type {
  AbilityId,
  DistrictId,
  DistrictState,
  GameState,
  StrongholdId,
  StrongholdState,
  TerritoryStatus,
  Vec2,
  WorldSave,
} from '../core/types';
import { DISTRICT_IDS } from '../core/types';

export const SAVE_VERSION = BALANCE.save.version;

/**
 * Schema migration chain keyed by source version `v` (migrates `v` -> `v + 1`).
 * Empty at v1; adding v2 is a one-line addition `1: (old) => ({ ... })`.
 */
export const MIGRATIONS: Record<number, (old: unknown) => unknown> = {};

const STRONGHOLD_IDS: readonly StrongholdId[] = STRONGHOLDS.map(s => s.id);
const TERRITORY_STATUSES: readonly TerritoryStatus[] = ['unknown', 'human', 'contested', 'infected'];

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isAbilityId(v: unknown): v is AbilityId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ABILITIES, v);
}

function isTerritoryStatus(v: unknown): v is TerritoryStatus {
  return typeof v === 'string' && (TERRITORY_STATUSES as readonly string[]).includes(v);
}

function isStrongholdId(v: unknown): v is StrongholdId {
  return typeof v === 'string' && (STRONGHOLD_IDS as readonly string[]).includes(v);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function isValidBase64(s: string): boolean {
  if (s.length % 4 !== 0) return false;
  for (let i = 0; i < s.length; i += 4) {
    const c0 = s.charCodeAt(i);
    const c1 = s.charCodeAt(i + 1);
    const c2 = s.charCodeAt(i + 2);
    const c3 = s.charCodeAt(i + 3);
    if (c0 >= 128 || B64_LOOKUP[c0] < 0) return false;
    if (c1 >= 128 || B64_LOOKUP[c1] < 0) return false;
    const isLast = i + 4 === s.length;
    if (c2 === 61) {
      if (!isLast || c3 !== 61) return false;
    } else if (c2 >= 128 || B64_LOOKUP[c2] < 0) {
      return false;
    }
    if (c3 === 61) {
      if (!isLast) return false;
    } else if (c3 >= 128 || B64_LOOKUP[c3] < 0) {
      return false;
    }
  }
  return true;
}

export function encodeBits(bits: Uint8Array): string {
  const len = bits.length;
  if (len === 0) return '';
  let out = '';
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bits[i] << 16) | (bits[i + 1] << 8) | bits[i + 2];
    out +=
      B64_CHARS[(n >>> 18) & 63] +
      B64_CHARS[(n >>> 12) & 63] +
      B64_CHARS[(n >>> 6) & 63] +
      B64_CHARS[n & 63];
  }
  const rem = len - i;
  if (rem === 1) {
    const n = bits[i] << 16;
    out += B64_CHARS[(n >>> 18) & 63] + B64_CHARS[(n >>> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bits[i] << 16) | (bits[i + 1] << 8);
    out += B64_CHARS[(n >>> 18) & 63] + B64_CHARS[(n >>> 12) & 63] + B64_CHARS[(n >>> 6) & 63] + '=';
  }
  return out;
}

export function decodeBits(s: string, length: number): Uint8Array {
  const targetLen = Math.max(0, Math.floor(Number.isFinite(length) ? length : 0));
  const out = new Uint8Array(targetLen);
  if (typeof s !== 'string' || s.length === 0 || targetLen === 0 || !isValidBase64(s)) {
    return out;
  }
  let outIdx = 0;
  for (let i = 0; i < s.length && outIdx < targetLen; i += 4) {
    const v0 = B64_LOOKUP[s.charCodeAt(i)];
    const v1 = B64_LOOKUP[s.charCodeAt(i + 1)];
    const pad2 = s.charCodeAt(i + 2) === 61;
    const pad3 = s.charCodeAt(i + 3) === 61;
    const v2 = pad2 ? 0 : B64_LOOKUP[s.charCodeAt(i + 2)];
    const v3 = pad3 ? 0 : B64_LOOKUP[s.charCodeAt(i + 3)];
    const triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    out[outIdx++] = (triple >>> 16) & 0xff;
    if (!pad2 && outIdx < targetLen) out[outIdx++] = (triple >>> 8) & 0xff;
    if (!pad3 && outIdx < targetLen) out[outIdx++] = triple & 0xff;
  }
  return out;
}

function normalizeUnlocked(list: readonly AbilityId[]): AbilityId[] {
  const unlocked: AbilityId[] = [];
  for (const innate of INNATE_ABILITIES) {
    if (!unlocked.includes(innate)) unlocked.push(innate);
  }
  for (const id of list) {
    if (isAbilityId(id) && !unlocked.includes(id)) {
      unlocked.push(id);
    }
  }
  return unlocked;
}

function sanitizeEquipped(
  equipped: readonly (AbilityId | null)[],
  unlocked: readonly AbilityId[],
): (AbilityId | null)[] {
  const slots = BALANCE.progression.slots;
  const out: (AbilityId | null)[] = new Array<AbilityId | null>(slots).fill(null);
  const seen = new Set<AbilityId>();
  for (let i = 0; i < slots; i++) {
    const id = equipped[i] ?? null;
    if (
      id !== null &&
      isAbilityId(id) &&
      unlocked.includes(id) &&
      ABILITIES[id].slotBehavior === 'slot' &&
      !seen.has(id)
    ) {
      out[i] = id;
      seen.add(id);
    }
  }
  return out;
}

export function createSave(state: GameState, seed: number, savedAt = 0): WorldSave {
  const unlockedAbilities = normalizeUnlocked(state.progression.unlocked);
  const equippedAbilities = sanitizeEquipped(state.progression.equipped, unlockedAbilities);
  const acquiredUpgrades = unlockedAbilities.filter(id => !INNATE_ABILITIES.includes(id));

  const districts = {} as Record<DistrictId, DistrictState>;
  for (const id of DISTRICT_IDS) {
    const src = state.districts[id];
    districts[id] = {
      id,
      status: src && isTerritoryStatus(src.status) ? src.status : 'unknown',
      discovered: Boolean(src?.discovered),
      infection: clamp01(src?.infection ?? 0),
      humanStrength: clamp01(src?.humanStrength ?? 1),
      alertLevel: clamp01(src?.alertLevel ?? 0),
      strongholdCaptured: Boolean(src?.strongholdCaptured),
    };
  }

  type SavedStronghold = Pick<StrongholdState, 'id' | 'captured' | 'objectivesDone' | 'reinforcementsSpent'>;
  const strongholds = {} as Record<StrongholdId, SavedStronghold>;
  for (const id of STRONGHOLD_IDS) {
    strongholds[id] = {
      id,
      captured: false,
      objectivesDone: [],
      reinforcementsSpent: 0,
    };
  }
  for (const sh of state.strongholds) {
    if (!isStrongholdId(sh.id)) continue;
    const objectivesDone: string[] = [];
    for (const objId of sh.objectivesDone) {
      if (typeof objId === 'string' && !objectivesDone.includes(objId)) {
        objectivesDone.push(objId);
      }
    }
    strongholds[sh.id] = {
      id: sh.id,
      captured: Boolean(sh.captured),
      objectivesDone,
      reinforcementsSpent: Math.max(
        0,
        Math.floor(Number.isFinite(sh.reinforcementsSpent) ? sh.reinforcementsSpent : 0),
      ),
    };
  }

  const destroyedStructures: number[] = [];
  for (const s of state.structures) {
    if (s.destroyed && Number.isInteger(s.id) && s.id >= 1 && !destroyedStructures.includes(s.id)) {
      destroyedStructures.push(s.id);
    }
  }

  return {
    version: SAVE_VERSION,
    seed: Number.isFinite(seed) ? seed : BALANCE.sim.seed,
    savedAt: Number.isFinite(savedAt) ? savedAt : 0,
    player: {
      biomass: Math.max(0, Number.isFinite(state.progression.biomass) ? state.progression.biomass : 0),
      unlockedAbilities,
      equippedAbilities,
      selectedNestId: typeof state.activeNestId === 'string' ? state.activeNestId : '',
    },
    districts,
    strongholds,
    destroyedStructures,
    gateDestroyed: Boolean(state.gate.destroyed),
    discoveryBits: encodeBits(state.discovery.bits),
    acquiredUpgrades,
  };
}

export function parseSave(raw: unknown): WorldSave | null {
  try {
    if (!isRecord(raw)) return null;
    if (typeof raw.version !== 'number' || !Number.isInteger(raw.version)) return null;
    if (raw.version > SAVE_VERSION) return null;
    if (raw.version < 1 && !MIGRATIONS[raw.version]) return null;

    let data: unknown = raw;
    let ver = raw.version;
    while (ver < SAVE_VERSION) {
      const migrate = MIGRATIONS[ver];
      if (!migrate) return null;
      data = migrate(data);
      if (!isRecord(data) || typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version <= ver) {
        return null;
      }
      ver = data.version;
    }
    if (ver !== SAVE_VERSION || !isRecord(data)) return null;

    if (typeof data.seed !== 'number' || !Number.isFinite(data.seed)) return null;
    if (typeof data.savedAt !== 'number' || !Number.isFinite(data.savedAt)) return null;
    if (typeof data.gateDestroyed !== 'boolean') return null;
    if (typeof data.discoveryBits !== 'string' || !isValidBase64(data.discoveryBits)) return null;

    if (!Array.isArray(data.destroyedStructures)) return null;
    const destroyedStructures: number[] = [];
    for (const item of data.destroyedStructures) {
      if (typeof item !== 'number' || !Number.isInteger(item) || !Number.isFinite(item) || item < 1) {
        return null;
      }
      if (!destroyedStructures.includes(item)) destroyedStructures.push(item);
    }

    if (!Array.isArray(data.acquiredUpgrades)) return null;
    for (const item of data.acquiredUpgrades) {
      if (!isAbilityId(item)) return null;
    }

    if (!isRecord(data.player)) return null;
    const player = data.player;
    if (typeof player.biomass !== 'number' || !Number.isFinite(player.biomass) || player.biomass < 0) {
      return null;
    }
    if (typeof player.selectedNestId !== 'string') return null;

    if (!Array.isArray(player.unlockedAbilities)) return null;
    for (const id of player.unlockedAbilities) {
      if (!isAbilityId(id)) return null;
    }

    if (!Array.isArray(player.equippedAbilities) || player.equippedAbilities.length !== BALANCE.progression.slots) {
      return null;
    }
    for (const slot of player.equippedAbilities) {
      if (slot !== null && !isAbilityId(slot)) return null;
    }

    const unlockedAbilities = normalizeUnlocked([
      ...(player.unlockedAbilities as AbilityId[]),
      ...(data.acquiredUpgrades as AbilityId[]),
    ]);
    const equippedAbilities = sanitizeEquipped(
      player.equippedAbilities as (AbilityId | null)[],
      unlockedAbilities,
    );
    const acquiredUpgrades = unlockedAbilities.filter(id => !INNATE_ABILITIES.includes(id));

    if (!isRecord(data.districts)) return null;
    const districts = {} as Record<DistrictId, DistrictState>;
    for (const id of DISTRICT_IDS) {
      const d = data.districts[id];
      if (!isRecord(d)) return null;
      if (d.id !== id) return null;
      if (!isTerritoryStatus(d.status)) return null;
      if (typeof d.discovered !== 'boolean') return null;
      if (typeof d.infection !== 'number' || !Number.isFinite(d.infection)) return null;
      if (typeof d.humanStrength !== 'number' || !Number.isFinite(d.humanStrength)) return null;
      if (typeof d.alertLevel !== 'number' || !Number.isFinite(d.alertLevel)) return null;
      if (typeof d.strongholdCaptured !== 'boolean') return null;
      districts[id] = {
        id,
        status: d.status,
        discovered: d.discovered,
        infection: clamp01(d.infection),
        humanStrength: clamp01(d.humanStrength),
        alertLevel: clamp01(d.alertLevel),
        strongholdCaptured: d.strongholdCaptured,
      };
    }

    if (!isRecord(data.strongholds)) return null;
    type SavedStronghold = Pick<StrongholdState, 'id' | 'captured' | 'objectivesDone' | 'reinforcementsSpent'>;
    const strongholds = {} as Record<StrongholdId, SavedStronghold>;
    for (const id of STRONGHOLD_IDS) {
      strongholds[id] = {
        id,
        captured: false,
        objectivesDone: [],
        reinforcementsSpent: 0,
      };
    }
    for (const [key, val] of Object.entries(data.strongholds)) {
      if (!isRecord(val)) return null;
      if (typeof val.id !== 'string' || val.id !== key) return null;
      if (typeof val.captured !== 'boolean') return null;
      if (!Array.isArray(val.objectivesDone)) return null;
      const objectivesDone: string[] = [];
      for (const objId of val.objectivesDone) {
        if (typeof objId !== 'string') return null;
        if (!objectivesDone.includes(objId)) objectivesDone.push(objId);
      }
      if (
        typeof val.reinforcementsSpent !== 'number' ||
        !Number.isFinite(val.reinforcementsSpent) ||
        val.reinforcementsSpent < 0
      ) {
        return null;
      }
      if (isStrongholdId(key)) {
        strongholds[key] = {
          id: key,
          captured: val.captured,
          objectivesDone,
          reinforcementsSpent: Math.floor(val.reinforcementsSpent),
        };
      }
    }

    return {
      version: SAVE_VERSION,
      seed: data.seed,
      savedAt: data.savedAt,
      player: {
        biomass: Math.max(0, player.biomass),
        unlockedAbilities,
        equippedAbilities,
        selectedNestId: player.selectedNestId,
      },
      districts,
      strongholds,
      destroyedStructures,
      gateDestroyed: data.gateDestroyed,
      discoveryBits: data.discoveryBits,
      acquiredUpgrades,
    };
  } catch {
    return null;
  }
}

export function applySave(ctx: SimContext, save: WorldSave): void {
  const { state, layout, collision, navGrid, crawlNavGrid } = ctx;

  // 1. Restore progression (unlocked U innate; equipped keeps only unlocked, slot-behavior, non-duplicate)
  const rawUnlocked: AbilityId[] = [];
  if (Array.isArray(save.player?.unlockedAbilities)) {
    for (const id of save.player.unlockedAbilities) {
      if (isAbilityId(id)) rawUnlocked.push(id);
    }
  }
  if (Array.isArray(save.acquiredUpgrades)) {
    for (const id of save.acquiredUpgrades) {
      if (isAbilityId(id)) rawUnlocked.push(id);
    }
  }
  const unlocked = normalizeUnlocked(rawUnlocked);
  state.progression.biomass = Math.max(
    0,
    Number.isFinite(save.player?.biomass) ? save.player.biomass : 0,
  );
  state.progression.unlocked = unlocked;
  state.progression.equipped = sanitizeEquipped(
    Array.isArray(save.player?.equippedAbilities) ? save.player.equippedAbilities : [],
    unlocked,
  );

  // 2. Restore activeNestId (fall back to the start nest if unknown)
  const startNest = layout.nests.find(n => n.strongholdId === null) ?? layout.nests[0];
  const requestedNest = layout.nests.find(n => n.id === save.player?.selectedNestId);
  const activeNest = requestedNest ?? startNest;
  state.activeNestId = activeNest ? activeNest.id : '';

  // 3. Restore district states
  if (isRecord(save.districts)) {
    for (const id of DISTRICT_IDS) {
      const sd = save.districts[id];
      if (!isRecord(sd)) continue;
      state.districts[id] = {
        id,
        // 'contested' is transient (StrongholdState.contested is not saved); a loaded one could never revert.
        status: isTerritoryStatus(sd.status) ? (sd.status === 'contested' ? 'human' : sd.status) : state.districts[id].status,
        discovered: typeof sd.discovered === 'boolean' ? sd.discovered : state.districts[id].discovered,
        infection: clamp01(typeof sd.infection === 'number' ? sd.infection : state.districts[id].infection),
        humanStrength: clamp01(
          typeof sd.humanStrength === 'number' ? sd.humanStrength : state.districts[id].humanStrength,
        ),
        alertLevel: clamp01(typeof sd.alertLevel === 'number' ? sd.alertLevel : state.districts[id].alertLevel),
        strongholdCaptured:
          typeof sd.strongholdCaptured === 'boolean'
            ? sd.strongholdCaptured
            : state.districts[id].strongholdCaptured,
      };
    }
  }

  // 4. Restore strongholds by id (unknown ids ignored; objective ids filtered to the def's)
  const capturedStrongholds = new Set<StrongholdId>();
  const savedStrongholds = isRecord(save.strongholds)
    ? (save.strongholds as Record<string, WorldSave['strongholds'][StrongholdId] | undefined>)
    : {};
  for (const sh of state.strongholds) {
    const saved = savedStrongholds[sh.id];
    if (!saved || !isRecord(saved)) continue;
    const def = layout.strongholds.find(d => d.id === sh.id);
    const validObjIds = new Set(def ? def.objectives.map(o => o.id) : []);
    const objectivesDone: string[] = [];
    if (Array.isArray(saved.objectivesDone)) {
      for (const objId of saved.objectivesDone) {
        if (typeof objId === 'string' && validObjIds.has(objId) && !objectivesDone.includes(objId)) {
          objectivesDone.push(objId);
        }
      }
    }
    sh.captured = Boolean(saved.captured);
    sh.objectivesDone = objectivesDone;
    sh.reinforcementsSpent = Math.max(
      0,
      Math.floor(Number.isFinite(saved.reinforcementsSpent) ? saved.reinforcementsSpent : 0),
    );
    if (sh.captured) {
      sh.contested = false;
      sh.defenderStrength = 0;
      sh.holdProgress = 0;
      capturedStrongholds.add(sh.id);
    }
  }
  for (const [key, val] of Object.entries(savedStrongholds)) {
    if (val && isRecord(val) && val.captured && isStrongholdId(key)) {
      capturedStrongholds.add(key);
    }
  }

  // 4b. A captured stronghold always grants its unlock. Saves from before an unlock was attached to a stronghold
  // (e.g. Rush moving to suburb_checkpoint) get it here, auto-equipped into the first empty slot like a live capture.
  for (const id of capturedStrongholds) {
    const unlock = layout.strongholds.find(d => d.id === id)?.unlock ?? null;
    if (!unlock || state.progression.unlocked.includes(unlock)) continue;
    state.progression.unlocked.push(unlock);
    const empty = state.progression.equipped.indexOf(null);
    if (empty >= 0 && ABILITIES[unlock].slotBehavior === 'slot') state.progression.equipped[empty] = unlock;
  }

  // 5. Destroy structures and gate silently; rebuild nav grids once if anything changed
  const destroyedSet = new Set<number>(
    Array.isArray(save.destroyedStructures) ? save.destroyedStructures : [],
  );
  let navChanged = false;
  for (const s of state.structures) {
    if (!destroyedSet.has(s.id)) continue;
    const col = collision.colliders[s.colliderId];
    if (!s.destroyed || (col && col.enabled)) {
      navChanged = true;
    }
    s.hp = 0;
    s.destroyed = true;
    s.destroyedAt = 0;
    s.hitFlash = 0;
    collision.setEnabled(s.colliderId, false);
    for (const z of state.zombies) {
      if (z.heldBy === s.id) {
        z.heldBy = 0;
      }
    }
  }

  if (save.gateDestroyed) {
    const gateCol = collision.colliders[state.gate.colliderId];
    if (!state.gate.destroyed || (gateCol && gateCol.enabled)) {
      navChanged = true;
    }
    state.gate.hp = 0;
    state.gate.destroyed = true;
    state.gate.hitFlash = 0;
    collision.setEnabled(state.gate.colliderId, false);
  }

  if (navChanged) {
    navGrid.rebuild();
    crawlNavGrid.rebuild();
  }

  // 6. Remove humans defending captured strongholds
  if (capturedStrongholds.size > 0) {
    state.guards = state.guards.filter(
      g => g.strongholdId === null || !capturedStrongholds.has(g.strongholdId),
    );
  }

  // 7. Discovery bits + revealed recount
  const decoded = decodeBits(save.discoveryBits, state.discovery.bits.length);
  let revealed = 0;
  for (let i = 0; i < state.discovery.bits.length; i++) {
    const bit = decoded[i] ? 1 : 0;
    state.discovery.bits[i] = bit;
    revealed += bit;
  }
  state.discovery.revealed = revealed;

  // 8. Move leader and live followers to the active nest (deterministic walkable ring)
  const nestAnchor: Vec2 = activeNest ? activeNest.pos : layout.playerStart;
  const leaderPos = navGrid.nearestWalkable(nestAnchor);
  state.leader.pos.x = leaderPos.x;
  state.leader.pos.z = leaderPos.z;
  state.leader.prevPos.x = leaderPos.x;
  state.leader.prevPos.z = leaderPos.z;
  state.leader.vel.x = 0;
  state.leader.vel.z = 0;

  const liveFollowers = state.zombies.filter(z => z.state === 'follower' && z.hp > 0);
  const count = liveFollowers.length;
  for (let i = 0; i < count; i++) {
    const z = liveFollowers[i];
    const baseAngle = (2 * Math.PI * i) / Math.max(1, count);
    let placed: Vec2 | null = null;
    for (let rStep = 0; rStep < 6 && !placed; rStep++) {
      const r = 2.5 + rStep * 1.0;
      for (let aStep = 0; aStep < 8 && !placed; aStep++) {
        const a = baseAngle + (aStep * Math.PI) / 4;
        const cand = {
          x: leaderPos.x + Math.sin(a) * r,
          z: leaderPos.z + Math.cos(a) * r,
        };
        if (!collision.isBlocked(cand, z.radius) && navGrid.isWalkable(cand)) {
          placed = cand;
        }
      }
    }
    if (!placed) {
      placed = navGrid.nearestWalkable({
        x: leaderPos.x + Math.sin(baseAngle) * 2.5,
        z: leaderPos.z + Math.cos(baseAngle) * 2.5,
      });
    }
    z.pos.x = placed.x;
    z.pos.z = placed.z;
    z.prevPos.x = placed.x;
    z.prevPos.z = placed.z;
    z.vel.x = 0;
    z.vel.z = 0;
  }
  state.followerCount = count;
}
