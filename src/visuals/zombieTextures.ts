/**
 * [3D] Procedural zombie texture atlas: ATLAS_GRID × ATLAS_GRID seamless 128 px tiles (skin, rotting skin,
 * Hawaiian shirts, office shirt, hi-vis vest, police uniform, denim, ...), drawn once on a canvas at boot, plus a
 * normal map derived from a parallel height canvas (fabric weave, wrinkles, wounds, veins).
 *
 * Tiles are authored light / neutral where the renderer tints them per zombie (skin tone, tee colour) and in full
 * colour where the pattern is the identity (Hawaiian prints, hi-vis, police navy). Every feature is drawn wrapped
 * (±tile offsets, clipped), so tiles repeat without seams — the shader wraps UVs inside each tile.
 */
import * as THREE from 'three';
import { mulberry32 } from '../utils/rng';
import { ATLAS_GRID, TILE } from './zombieProfiles';

export const TILE_PX = 128;

export interface ZombieAtlas {
  map: THREE.Texture;
  normalMap: THREE.Texture;
}

let cached: ZombieAtlas | null = null;

type Ctx = CanvasRenderingContext2D;

interface Painter {
  c: Ctx; // albedo
  h: Ctx; // height (grayscale, 128 = flat)
  r: () => number;
  S: number;
}

/** Run `fn` at the 9 wrap offsets so features crossing a tile edge reappear on the opposite edge. */
function wrapped(ctx: Ctx, S: number, fn: (ctx: Ctx) => void): void {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      ctx.save();
      ctx.translate(ox * S, oy * S);
      fn(ctx);
      ctx.restore();
    }
  }
}

function blob(ctx: Ctx, x: number, y: number, rad: number, color: string, alpha: number, r: () => number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(x + (r() - 0.5) * rad, y + (r() - 0.5) * rad, rad * (0.35 + 0.45 * r()), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function noise(p: Painter, count: number, size: number, dark: string, light: string, alpha: number): void {
  const { c, r, S } = p;
  for (let i = 0; i < count; i++) {
    c.globalAlpha = alpha * (0.4 + 0.6 * r());
    c.fillStyle = r() < 0.5 ? dark : light;
    c.fillRect(r() * S, r() * S, size, size);
  }
  c.globalAlpha = 1;
}

/** Fabric weave in the height map (and a faint albedo echo). */
function weave(p: Painter, step: number, diagonal: boolean, strength: number): void {
  const { h, S } = p;
  h.globalAlpha = strength;
  for (let i = -S; i < S * 2; i += step) {
    h.strokeStyle = (i / step) % 2 === 0 ? '#9a9a9a' : '#6a6a6a';
    h.lineWidth = step * 0.5;
    h.beginPath();
    if (diagonal) { h.moveTo(i, 0); h.lineTo(i + S, S); } else { h.moveTo(i, 0); h.lineTo(i, S); }
    h.stroke();
  }
  h.globalAlpha = 1;
}

function wrinkles(p: Painter, count: number): void {
  const { h, r, S } = p;
  h.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = r() * S;
    const y = r() * S;
    const len = 18 + r() * 40;
    const ang = (r() - 0.5) * 1.4 + (r() < 0.5 ? 0 : Math.PI / 2);
    wrapped(h, S, (ctx) => {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#d8d8d8';
      ctx.lineWidth = 3 + r() * 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(ang) * len * 0.5 + 6, y + Math.sin(ang) * len * 0.5, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#404040';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }
  h.globalAlpha = 1;
}

function grime(p: Painter, spots: number, color = '#3b2e22', alpha = 0.22): void {
  const { c, r, S } = p;
  for (let i = 0; i < spots; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 8 + r() * 22;
    wrapped(c, S, (ctx) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha * (0.5 + r() * 0.5);
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    });
  }
  c.globalAlpha = 1;
}

function bloodStain(p: Painter, count: number, alpha = 0.6): void {
  const { c, h, r, S } = p;
  for (let i = 0; i < count; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 6 + r() * 12;
    const seed = r();
    wrapped(c, S, (ctx) => {
      const rr = mulberry32(Math.floor(seed * 1e6));
      const rn = (): number => rr.next();
      blob(ctx, x, y, rad, '#5a1612', alpha, rn);
      blob(ctx, x, y, rad * 0.5, '#3a0c0a', alpha * 0.8, rn);
      // drips
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = '#4a120e';
      ctx.lineWidth = 2;
      for (let d = 0; d < 3; d++) {
        const dx = x + (rn() - 0.5) * rad;
        ctx.beginPath();
        ctx.moveTo(dx, y);
        ctx.lineTo(dx + (rn() - 0.5) * 2, y + rad * (0.8 + rn() * 1.6));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
    wrapped(h, S, (ctx) => { blob(ctx, x, y, rad * 0.8, '#707070', 0.4, r); });
  }
}

/** Jagged tears: a skin-coloured hole with a dark frayed outline (recessed in the height map). */
function tears(p: Painter, count: number, holeColor = '#9aa88c'): void {
  const { c, h, r, S } = p;
  for (let i = 0; i < count; i++) {
    const cx = r() * S;
    const cy = r() * S;
    const w = 8 + r() * 14;
    const hgt = 5 + r() * 9;
    const pts: [number, number][] = [];
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rad = 0.6 + r() * 0.5;
      pts.push([cx + Math.cos(a) * w * rad, cy + Math.sin(a) * hgt * rad]);
    }
    const path = (ctx: Ctx): void => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < n; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.closePath();
    };
    wrapped(c, S, (ctx) => {
      path(ctx);
      ctx.fillStyle = holeColor;
      ctx.fill();
      ctx.strokeStyle = '#1c1612';
      ctx.lineWidth = 2;
      ctx.stroke();
      // frayed threads
      ctx.strokeStyle = 'rgba(240,236,220,0.6)';
      ctx.lineWidth = 1;
      for (let k = 0; k < n; k += 2) {
        ctx.beginPath();
        ctx.moveTo(pts[k][0], pts[k][1]);
        ctx.lineTo(pts[k][0] + (r() - 0.5) * 6, pts[k][1] + (r() - 0.5) * 6);
        ctx.stroke();
      }
    });
    wrapped(h, S, (ctx) => { path(ctx); ctx.fillStyle = '#383838'; ctx.fill(); });
  }
}

function hemDirt(p: Painter): void {
  const { c, S } = p;
  const g = c.createLinearGradient(0, S * 0.6, 0, S);
  g.addColorStop(0, 'rgba(60,45,30,0)');
  g.addColorStop(1, 'rgba(60,45,30,0.35)');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
}

function fill(p: Painter, color: string): void {
  p.c.fillStyle = color;
  p.c.fillRect(0, 0, p.S, p.S);
  p.h.fillStyle = '#808080';
  p.h.fillRect(0, 0, p.S, p.S);
}

function hibiscus(ctx: Ctx, x: number, y: number, size: number, petal: string, center: string, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = petal;
  for (let k = 0; k < 5; k++) {
    ctx.rotate((Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.55, size * 0.38, size * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function leaf(ctx: Ctx, x: number, y: number, size: number, color: string, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.25, size, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(0, size);
  ctx.stroke();
  ctx.restore();
}

function paintSkin(p: Painter, rot: boolean, alpha: boolean): void {
  const { c, h, r, S } = p;
  fill(p, alpha ? '#cfd6c4' : '#dcdfd2');
  // mottling: purple undertones, sickly yellow, grey-green
  const mottles = rot ? 70 : 45;
  for (let i = 0; i < mottles; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 4 + r() * 14;
    const col = r() < 0.4 ? '#b9a9c8' : r() < 0.6 ? '#ece6b8' : r() < 0.8 ? '#a9b6a0' : '#c6cdbf';
    wrapped(c, S, (ctx) => { ctx.globalAlpha = 0.28; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); });
  }
  c.globalAlpha = 1;
  // veins
  const veins = rot ? 9 : 6;
  for (let i = 0; i < veins; i++) {
    let x = r() * S;
    let y = r() * S;
    const segs: [number, number][] = [[x, y]];
    let a = r() * Math.PI * 2;
    for (let k = 0; k < 7; k++) {
      a += (r() - 0.5) * 1.2;
      x += Math.cos(a) * 7;
      y += Math.sin(a) * 7;
      segs.push([x, y]);
    }
    const draw = (ctx: Ctx, col: string, w: number, al: number): void => {
      ctx.globalAlpha = al;
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(segs[0][0], segs[0][1]);
      for (const [sx, sy] of segs) ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    wrapped(c, S, (ctx) => draw(ctx, alpha ? '#4e6a3a' : '#6e5a7e', alpha ? 1.6 : 1.2, 0.45));
    wrapped(h, S, (ctx) => draw(ctx, '#a8a8a8', 2, 0.6));
  }
  // bruises
  const bruises = rot ? 6 : 2;
  for (let i = 0; i < bruises; i++) {
    const x = r() * S;
    const y = r() * S;
    wrapped(c, S, (ctx) => blob(ctx, x, y, 14 + r() * 10, '#7a5e8e', 0.22, r));
  }
  // wounds: dark recessed centre, raw rim
  const wounds = rot ? 5 : 2;
  for (let i = 0; i < wounds; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 4 + r() * (rot ? 8 : 5);
    wrapped(c, S, (ctx) => {
      blob(ctx, x, y, rad * 1.5, '#8a4a3e', 0.55, r);
      blob(ctx, x, y, rad, '#5c2222', 0.85, r);
      blob(ctx, x, y, rad * 0.5, '#2e0e0e', 0.9, r);
    });
    wrapped(h, S, (ctx) => { blob(ctx, x, y, rad, '#303030', 0.8, r); });
  }
  if (alpha) {
    // scars across the Alpha's hide
    for (let i = 0; i < 4; i++) {
      const x = r() * S;
      const y = r() * S;
      const a = r() * Math.PI;
      wrapped(c, S, (ctx) => {
        ctx.strokeStyle = 'rgba(70,40,40,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 26);
        ctx.stroke();
      });
    }
  }
  // pores / bumps
  for (let i = 0; i < 900; i++) {
    h.globalAlpha = 0.3;
    h.fillStyle = r() < 0.5 ? '#9a9a9a' : '#666666';
    h.fillRect(r() * S, r() * S, 2, 2);
  }
  h.globalAlpha = 1;
  noise(p, 600, 1, '#7a7a70', '#f0f0e6', 0.12);
}

function paintHawaiian(p: Painter, base: string, petals: string[], leafCol: string): void {
  const { c, r, S } = p;
  fill(p, base);
  for (let i = 0; i < 7; i++) {
    const x = r() * S;
    const y = r() * S;
    const sz = 9 + r() * 8;
    const rot = r() * 6;
    const lc = leafCol;
    wrapped(c, S, (ctx) => {
      leaf(ctx, x + sz, y, sz * 1.2, lc, rot);
      leaf(ctx, x - sz * 0.8, y + sz * 0.6, sz, lc, rot + 1.8);
    });
  }
  for (let i = 0; i < 9; i++) {
    const x = r() * S;
    const y = r() * S;
    const sz = 7 + r() * 7;
    const col = petals[i % petals.length];
    const rot = r() * 6;
    wrapped(c, S, (ctx) => hibiscus(ctx, x, y, sz, col, '#f6d24a', rot));
  }
  // sun-faded
  c.globalAlpha = 0.18;
  c.fillStyle = '#f4efe0';
  c.fillRect(0, 0, S, S);
  c.globalAlpha = 1;
  weave(p, 3, false, 0.4);
  wrinkles(p, 7);
  grime(p, 7);
  bloodStain(p, 2, 0.5);
  tears(p, 2);
  hemDirt(p);
}

function paintTile(id: number, p: Painter): void {
  const { c, r, S } = p;
  switch (id) {
    case TILE.skin: paintSkin(p, false, false); break;
    case TILE.skinRot: paintSkin(p, true, false); break;
    case TILE.alphaSkin: paintSkin(p, true, true); break;
    case TILE.hawaiianRed: paintHawaiian(p, '#c8463a', ['#fbeee0', '#ffd0d8', '#f6d24a'], '#2f7a4a'); break;
    case TILE.hawaiianTeal: paintHawaiian(p, '#2e8fa6', ['#fff2c8', '#ff8a6a', '#ffffff'], '#1f5e46'); break;
    case TILE.office: {
      fill(p, '#f2f0ea');
      c.strokeStyle = 'rgba(120,150,200,0.25)';
      c.lineWidth = 1;
      for (let x = 2; x < S; x += 6) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S); c.stroke(); }
      // placket + buttons down the middle (front centre of the torso maps to the tile centre)
      c.fillStyle = 'rgba(0,0,0,0.08)';
      c.fillRect(S / 2 - 5, 0, 10, S);
      c.fillStyle = '#c9c0ae';
      for (let y = 10; y < S; y += 26) { c.beginPath(); c.arc(S / 2, y, 2.4, 0, Math.PI * 2); c.fill(); }
      p.h.fillStyle = '#9a9a9a';
      p.h.fillRect(S / 2 - 5, 0, 10, S);
      weave(p, 2, false, 0.3);
      wrinkles(p, 10);
      grime(p, 9, '#5a4a32', 0.25);
      bloodStain(p, 3, 0.55);
      tears(p, 2);
      break;
    }
    case TILE.tee: {
      fill(p, '#e4e4e2');
      // faded sunset + palm print
      const g = c.createRadialGradient(S * 0.5, S * 0.45, 2, S * 0.5, S * 0.45, 26);
      g.addColorStop(0, 'rgba(255,150,80,0.45)');
      g.addColorStop(1, 'rgba(255,120,120,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, S, S);
      c.strokeStyle = 'rgba(40,40,50,0.28)';
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(S * 0.52, S * 0.62); c.quadraticCurveTo(S * 0.5, S * 0.5, S * 0.56, S * 0.36); c.stroke();
      c.fillStyle = 'rgba(40,40,50,0.28)';
      for (let k = 0; k < 5; k++) leaf(c, S * 0.56, S * 0.36, 9, 'rgba(40,40,50,0.28)', -1.2 + k * 0.6);
      weave(p, 2, false, 0.35);
      wrinkles(p, 8);
      grime(p, 10);
      bloodStain(p, 2, 0.5);
      tears(p, 3);
      hemDirt(p);
      break;
    }
    case TILE.tank: {
      fill(p, '#ececea');
      for (let x = 0; x < S; x += 4) {
        p.h.fillStyle = (x / 4) % 2 ? '#a0a0a0' : '#606060';
        p.h.fillRect(x, 0, 2, S);
        c.fillStyle = (x / 4) % 2 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
        c.fillRect(x, 0, 2, S);
      }
      grime(p, 9);
      bloodStain(p, 2, 0.5);
      tears(p, 2);
      break;
    }
    case TILE.hiVis: {
      fill(p, '#f07a1c');
      for (const yy of [0.32, 0.66]) {
        c.fillStyle = '#d4dade';
        c.fillRect(0, yy * S, S, 11);
        c.fillStyle = 'rgba(255,255,255,0.4)';
        c.fillRect(0, yy * S + 2, S, 2);
        p.h.fillStyle = '#a0a0a0';
        p.h.fillRect(0, yy * S, S, 11);
      }
      weave(p, 3, true, 0.35);
      wrinkles(p, 6);
      grime(p, 12, '#3a2c1c', 0.3);
      bloodStain(p, 1, 0.5);
      tears(p, 2, '#4a4a40');
      break;
    }
    case TILE.police: {
      fill(p, '#2a3a60');
      c.strokeStyle = '#1b2742';
      c.lineWidth = 2;
      c.strokeRect(S * 0.18, S * 0.22, 26, 20);
      c.strokeRect(S * 0.6, S * 0.22, 26, 20);
      c.fillStyle = '#1b2742';
      c.fillRect(S / 2 - 2, 0, 4, S);
      c.fillStyle = '#e2b33c';
      c.beginPath();
      c.moveTo(S * 0.27, S * 0.14); c.lineTo(S * 0.33, S * 0.17); c.lineTo(S * 0.31, S * 0.24); c.lineTo(S * 0.23, S * 0.24); c.lineTo(S * 0.21, S * 0.17);
      c.closePath(); c.fill();
      weave(p, 2, true, 0.35);
      wrinkles(p, 8);
      grime(p, 7, '#141414', 0.3);
      bloodStain(p, 2, 0.55);
      tears(p, 2);
      break;
    }
    case TILE.lifeguard: {
      fill(p, '#d8342c');
      c.globalAlpha = 0.8;
      c.fillStyle = '#f4f0e8';
      c.fillRect(S * 0.42, S * 0.28, S * 0.16, S * 0.44);
      c.fillRect(S * 0.28, S * 0.42, S * 0.44, S * 0.16);
      c.globalAlpha = 1;
      weave(p, 2, false, 0.3);
      wrinkles(p, 6);
      grime(p, 8);
      bloodStain(p, 1, 0.5);
      tears(p, 2);
      break;
    }
    case TILE.sport: {
      fill(p, '#f0f0f0');
      c.fillStyle = 'rgba(30,30,40,0.55)';
      c.fillRect(S * 0.06, 0, 6, S);
      c.fillRect(S * 0.88, 0, 6, S);
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.fillRect(S * 0.06 + 7, 0, 3, S);
      c.fillRect(S * 0.88 - 4, 0, 3, S);
      for (let i = 0; i < 400; i++) { p.h.fillStyle = r() < 0.5 ? '#909090' : '#707070'; p.h.fillRect(r() * S, r() * S, 2, 2); }
      wrinkles(p, 6);
      grime(p, 8);
      bloodStain(p, 2, 0.5);
      tears(p, 2);
      break;
    }
    case TILE.denim: {
      fill(p, '#3d5a88');
      c.strokeStyle = 'rgba(200,215,240,0.12)';
      c.lineWidth = 1;
      for (let i = -S; i < S * 2; i += 3) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + S, S); c.stroke(); }
      const g = c.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, 40);
      g.addColorStop(0, 'rgba(190,205,230,0.35)');
      g.addColorStop(1, 'rgba(190,205,230,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, S, S);
      weave(p, 3, true, 0.5);
      wrinkles(p, 9);
      grime(p, 8, '#2a2014', 0.3);
      bloodStain(p, 1, 0.45);
      tears(p, 2, '#a4ae94');
      hemDirt(p);
      break;
    }
    case TILE.khaki: {
      fill(p, '#d9ceb0');
      weave(p, 2, false, 0.45);
      noise(p, 700, 1, '#9a8e70', '#f0e8d0', 0.2);
      wrinkles(p, 10);
      grime(p, 10, '#4a3a22', 0.3);
      bloodStain(p, 1, 0.45);
      tears(p, 1);
      hemDirt(p);
      break;
    }
    case TILE.slacks: {
      fill(p, '#a2a2a6');
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(S / 2 - 1, 0, 2, S);
      p.h.fillStyle = '#b0b0b0';
      p.h.fillRect(S / 2 - 1, 0, 2, S);
      weave(p, 2, true, 0.3);
      wrinkles(p, 8);
      grime(p, 9, '#3a3024', 0.3);
      bloodStain(p, 1, 0.45);
      tears(p, 1);
      hemDirt(p);
      break;
    }
    case TILE.boardShorts: {
      fill(p, '#2fb5b0');
      const cols = ['#2fb5b0', '#f2c84b', '#f26b5b', '#f6f2e8', '#2f6fb5'];
      for (let k = 0; k < 8; k++) {
        const y0 = (k / 8) * S;
        c.fillStyle = cols[k % cols.length];
        c.beginPath();
        c.moveTo(0, y0);
        for (let x = 0; x <= S; x += 8) c.lineTo(x, y0 + Math.sin((x / S) * Math.PI * 4) * 3);
        c.lineTo(S, y0 + S / 8 + 2);
        for (let x = S; x >= 0; x -= 8) c.lineTo(x, y0 + S / 8 + Math.sin((x / S) * Math.PI * 4) * 3 + 2);
        c.closePath();
        c.fill();
      }
      c.globalAlpha = 0.15; c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S); c.globalAlpha = 1;
      wrinkles(p, 7);
      grime(p, 7);
      tears(p, 1);
      break;
    }
    case TILE.leather: {
      fill(p, '#5a4434');
      for (let i = 0; i < 30; i++) {
        const x = r() * S; const y = r() * S; const a = r() * Math.PI;
        c.strokeStyle = 'rgba(220,200,170,0.18)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10); c.stroke();
      }
      noise(p, 800, 1, '#2a1e16', '#8a7060', 0.25);
      grime(p, 6, '#1a120c', 0.3);
      break;
    }
    case TILE.hair: {
      fill(p, '#c4c4c4');
      for (let i = 0; i < 380; i++) {
        const x = r() * S; const y = r() * S; const len = 6 + r() * 12; const a = Math.PI / 2 + (r() - 0.5) * 0.7;
        const col = r() < 0.5 ? 'rgba(40,40,40,0.35)' : 'rgba(255,255,255,0.25)';
        wrapped(c, S, (ctx) => { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke(); });
        wrapped(p.h, S, (ctx) => { ctx.strokeStyle = r() < 0.5 ? '#b0b0b0' : '#505050'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke(); });
      }
      break;
    }
    case TILE.alphaJacket: {
      fill(p, '#6b1f2e');
      noise(p, 900, 1, '#3a0e16', '#8a3444', 0.3);
      for (let i = 0; i < 22; i++) {
        const x = r() * S; const y = r() * S; const a = r() * Math.PI;
        wrapped(c, S, (ctx) => { ctx.strokeStyle = 'rgba(200,120,120,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); ctx.stroke(); });
      }
      c.strokeStyle = 'rgba(20,6,8,0.6)';
      c.lineWidth = 2;
      c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(S * 0.3, 0); c.lineTo(S * 0.3, S); c.moveTo(S * 0.7, 0); c.lineTo(S * 0.7, S); c.stroke();
      c.setLineDash([]);
      wrinkles(p, 9);
      grime(p, 6, '#140808', 0.35);
      bloodStain(p, 2, 0.6);
      tears(p, 2, '#6f8f55');
      break;
    }
    case TILE.fatigues: {
      fill(p, '#5f6a3c');
      for (let i = 0; i < 16; i++) {
        const x = r() * S; const y = r() * S; const col = r() < 0.5 ? '#3e4a28' : '#7d7a4c';
        wrapped(c, S, (ctx) => blob(ctx, x, y, 12 + r() * 10, col, 0.8, r));
      }
      weave(p, 2, true, 0.35);
      wrinkles(p, 9);
      grime(p, 8);
      bloodStain(p, 2, 0.5);
      tears(p, 2);
      break;
    }
    default:
      fill(p, '#ffffff');
      break;
  }
}

/** Sobel height → tangent-space normal map (OpenGL convention), per tile with edge wrap. */
function heightToNormal(src: ImageData, out: ImageData, N: number, S: number, strength: number): void {
  const W = src.width;
  const d = src.data;
  const o = out.data;
  const hAt = (tx: number, ty: number, x: number, y: number): number => {
    const px = tx * S + ((x % S) + S) % S;
    const py = ty * S + ((y % S) + S) % S;
    return d[(py * W + px) * 4] / 255;
  };
  for (let ty = 0; ty < N; ty++) {
    for (let tx = 0; tx < N; tx++) {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const dx = (hAt(tx, ty, x + 1, y) - hAt(tx, ty, x - 1, y)) * strength;
          const dy = (hAt(tx, ty, x, y + 1) - hAt(tx, ty, x, y - 1)) * strength;
          // canvas y grows downward; texture v grows upward (flipY), so +dy in canvas = -slope in v
          let nx = -dx;
          let ny = dy;
          let nz = 1;
          const len = Math.hypot(nx, ny, nz);
          nx /= len; ny /= len; nz /= len;
          const i = ((ty * S + y) * W + tx * S + x) * 4;
          o[i] = (nx * 0.5 + 0.5) * 255;
          o[i + 1] = (ny * 0.5 + 0.5) * 255;
          o[i + 2] = (nz * 0.5 + 0.5) * 255;
          o[i + 3] = 255;
        }
      }
    }
  }
}

export function getZombieAtlas(): ZombieAtlas {
  if (cached) return cached;
  const N = ATLAS_GRID;
  const S = TILE_PX;
  const size = N * S;
  const albedo = document.createElement('canvas');
  albedo.width = albedo.height = size;
  const height = document.createElement('canvas');
  height.width = height.height = size;
  const c = albedo.getContext('2d') as Ctx;
  const h = height.getContext('2d') as Ctx;
  const rng = mulberry32(0x2b1e5);
  const r = (): number => rng.next();
  for (let id = 0; id < N * N; id++) {
    const tx = id % N;
    const ty = Math.floor(id / N);
    for (const ctx of [c, h]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx * S, ty * S, S, S);
      ctx.clip();
      ctx.translate(tx * S, ty * S);
    }
    paintTile(id, { c, h, r, S });
    c.restore();
    h.restore();
  }
  const hData = h.getImageData(0, 0, size, size);
  const nData = h.createImageData(size, size);
  heightToNormal(hData, nData, N, S, 2.2);
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = size;
  (normalCanvas.getContext('2d') as Ctx).putImageData(nData, 0, 0);

  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.name = 'ZombieAtlas';
  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 4;
  normalMap.name = 'ZombieAtlasNormal';
  cached = { map, normalMap };
  return cached;
}

export function disposeZombieAtlas(): void {
  if (!cached) return;
  cached.map.dispose();
  cached.normalMap.dispose();
  cached = null;
}
