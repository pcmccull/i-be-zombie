// Canvas2D drawing shared by the minimap and the world map. Fog (discovery) and territory (district status)
// are two independent layers: fog decides what terrain is visible, territory only tints what is visible.
import type { DistrictLayout, GameState, GroundKind, Vec2 } from '../core/types';
import {
  STRONGHOLD_COLORS,
  districtName,
  makeProjection,
  strongholdMapStatus,
  territoryStyle,
  worldToMap,
  isNestActiveFor,
  type MapProjection,
} from './uiHelpers';

const FOG_COLOR = '#0c0f13';
const GROUND_COLORS: Record<GroundKind, string> = {
  road: '#4a5260',
  sidewalk: '#7d7a70',
  park: '#4b6a45',
  plaza: '#8a8472',
  lot: '#555b66',
  compound: '#6a6759',
};
const BUILDING_COLOR = '#b4a583';

const tmp: Vec2 = { x: 0, z: 0 };
const tmp2: Vec2 = { x: 0, z: 0 };

export interface MapLayerOptions {
  /** Draw district borders + names (world map). */
  labels: boolean;
}

/**
 * Terrain (revealed cells only) + territory tint + district borders. Redraw only when
 * `staticLayerKey(state, layout)` changes.
 */
export function drawStaticLayer(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  layout: DistrictLayout,
  state: GameState,
  opts: MapLayerOptions,
): MapProjection {
  const proj = makeProjection(layout.bounds, w, h);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = FOG_COLOR;
  g.fillRect(proj.offX, proj.offY, proj.width, proj.height);

  const fog = state.discovery;
  const cs = fog.cellSize * proj.scale;
  const hasFog = fog.cols > 0 && fog.rows > 0 && fog.bits.length >= fog.cols * fog.rows;

  g.save();
  g.beginPath();
  if (hasFog) {
    for (let row = 0; row < fog.rows; row++) {
      for (let col = 0; col < fog.cols; col++) {
        if (fog.bits[row * fog.cols + col] !== 1) continue;
        g.rect(proj.offX + col * cs, proj.offY + row * cs, cs + 0.5, cs + 0.5);
      }
    }
  } else {
    g.rect(proj.offX, proj.offY, proj.width, proj.height);
  }
  g.clip();

  g.fillStyle = '#2b3038';
  g.fillRect(proj.offX, proj.offY, proj.width, proj.height);
  for (const p of layout.ground) {
    worldToMap(proj, p.rect.minX, p.rect.minZ, tmp);
    g.fillStyle = GROUND_COLORS[p.kind] ?? '#4a5260';
    g.fillRect(tmp.x, tmp.z, (p.rect.maxX - p.rect.minX) * proj.scale, (p.rect.maxZ - p.rect.minZ) * proj.scale);
  }
  g.fillStyle = BUILDING_COLOR;
  for (const b of layout.buildings) {
    worldToMap(proj, b.footprint.minX, b.footprint.minZ, tmp);
    g.fillRect(
      tmp.x,
      tmp.z,
      Math.max(1, (b.footprint.maxX - b.footprint.minX) * proj.scale),
      Math.max(1, (b.footprint.maxZ - b.footprint.minZ) * proj.scale),
    );
  }
  // Territory tint (status only; independent of what has been revealed).
  for (const d of layout.districts) {
    const style = territoryStyle(state.districts[d.id]?.status ?? 'unknown');
    if (!style.tint) continue;
    worldToMap(proj, d.rect.minX, d.rect.minZ, tmp);
    g.fillStyle = style.tint;
    g.fillRect(tmp.x, tmp.z, (d.rect.maxX - d.rect.minX) * proj.scale, (d.rect.maxZ - d.rect.minZ) * proj.scale);
  }
  g.restore();

  // District borders for discovered districts.
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(240, 242, 236, 0.28)';
  for (const d of layout.districts) {
    if (!state.districts[d.id]?.discovered) continue;
    worldToMap(proj, d.rect.minX, d.rect.minZ, tmp);
    g.strokeRect(tmp.x + 0.5, tmp.z + 0.5, (d.rect.maxX - d.rect.minX) * proj.scale - 1, (d.rect.maxZ - d.rect.minZ) * proj.scale - 1);
  }
  if (opts.labels) {
    g.font = '700 15px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const d of layout.districts) {
      const known = state.districts[d.id]?.discovered;
      worldToMap(proj, (d.rect.minX + d.rect.maxX) / 2, d.rect.minZ + 14, tmp);
      const text = known ? districtName(d.id).toUpperCase() : 'UNEXPLORED';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(8, 10, 13, 0.85)';
      g.strokeText(text, tmp.x, tmp.z);
      g.fillStyle = known ? '#f0f2ec' : '#6b7280';
      g.fillText(text, tmp.x, tmp.z);
    }
  }
  return proj;
}

function strongholdIcon(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, tier: number): void {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = '#0c0f13';
  g.stroke();
  if (tier > 0 && r >= 7) {
    g.fillStyle = '#0c0f13';
    for (let i = 0; i < tier; i++) g.fillRect(x - (tier * 3) / 2 + i * 3 + 0.5, y - 1, 2, 2);
  }
}

export interface DynamicLayerOptions {
  /** Icon scale: ~1 minimap, ~1.5 world map. */
  size: number;
  /** Draw text next to stronghold icons (world map). */
  annotate: boolean;
  waypoint: Vec2 | null;
}

export function drawDynamicLayer(
  g: CanvasRenderingContext2D,
  proj: MapProjection,
  layout: DistrictLayout,
  state: GameState,
  opts: DynamicLayerOptions,
): void {
  const s = opts.size;
  // Nests (only where the cell is revealed, or active).
  for (const n of layout.nests) {
    const active = isNestActiveFor(state, n);
    if (!active && !state.districts[n.districtId]?.discovered) continue;
    worldToMap(proj, n.pos.x, n.pos.z, tmp);
    g.beginPath();
    g.arc(tmp.x, tmp.z, 3.5 * s, 0, Math.PI * 2);
    g.fillStyle = active ? '#c8f0a0' : '#58604f';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = active ? '#4f6b3a' : '#2b3038';
    g.stroke();
    if (n.id === state.activeNestId) {
      g.beginPath();
      g.arc(tmp.x, tmp.z, 6 * s, 0, Math.PI * 2);
      g.lineWidth = 1;
      g.strokeStyle = '#9be35a';
      g.stroke();
    }
  }
  // Strongholds.
  for (const def of layout.strongholds) {
    const status = strongholdMapStatus(state, def);
    worldToMap(proj, def.center.x, def.center.z, tmp);
    strongholdIcon(g, tmp.x, tmp.z, 6 * s, STRONGHOLD_COLORS[status], status === 'unknown' ? 0 : def.defenseTier);
    if (opts.annotate) {
      const label = status === 'unknown' ? '???' : def.name;
      g.font = '700 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(8, 10, 13, 0.85)';
      g.strokeText(label, tmp.x, tmp.z + 8 * s);
      g.fillStyle = '#f0f2ec';
      g.fillText(label, tmp.x, tmp.z + 8 * s);
    }
  }
  // Followers (cheap dots).
  g.fillStyle = '#9be35a';
  const dot = Math.max(1.5, 1.2 * s);
  for (let i = 0; i < state.zombies.length; i++) {
    const z = state.zombies[i];
    if (z.state !== 'follower') continue;
    worldToMap(proj, z.pos.x, z.pos.z, tmp);
    g.fillRect(tmp.x - dot / 2, tmp.z - dot / 2, dot, dot);
  }
  // Waypoint.
  if (opts.waypoint) {
    worldToMap(proj, opts.waypoint.x, opts.waypoint.z, tmp2);
    g.lineWidth = 2;
    g.strokeStyle = '#ffd24a';
    g.beginPath();
    g.arc(tmp2.x, tmp2.z, 5 * s, 0, Math.PI * 2);
    g.moveTo(tmp2.x - 8 * s, tmp2.z);
    g.lineTo(tmp2.x + 8 * s, tmp2.z);
    g.moveTo(tmp2.x, tmp2.z - 8 * s);
    g.lineTo(tmp2.x, tmp2.z + 8 * s);
    g.stroke();
  }
  // Leader arrow (forward = (sin a, cos a) on x/z; map y axis = +z, so rotate an up-pointing arrow by PI - a).
  const l = state.leader;
  worldToMap(proj, l.pos.x, l.pos.z, tmp);
  g.save();
  g.translate(tmp.x, tmp.z);
  g.rotate(Math.PI - l.facing);
  g.beginPath();
  g.moveTo(0, -6.5 * s);
  g.lineTo(4.5 * s, 5 * s);
  g.lineTo(0, 2.5 * s);
  g.lineTo(-4.5 * s, 5 * s);
  g.closePath();
  g.fillStyle = l.alive ? '#f4f7f0' : '#8a3a30';
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = '#4f6b3a';
  g.stroke();
  g.restore();
}
