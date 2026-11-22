// [pure] HUD icon set (HUD-T001): cartoon SVG icons drawn in code (no assets, no DOM). Every icon shares the same
// 32x32 grid, deep-teal outline and the HUD palette so they read as one family at 16-40 px.
import type { AbilityId } from '../core/types';

const O = '#193F48'; // outline (deep teal)
const G = '#86D957'; // zombie green
const GD = '#5fae3f';
const T = '#45D6C5'; // turquoise
const Y = '#FFD166'; // sunny yellow
const C = '#FF8066'; // coral
const K = '#FFF4DC'; // cream
const P = '#FF9FB2'; // brain pink

const s = (w = 2.2): string => `stroke="${O}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/** Small zombie head used by several icons; (x, y) = top-left offset, k = scale. */
function head(x: number, y: number, k: number, fill = G): string {
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <path d="M7 14c0-6 4-10 9-10s9 4 9 10v5c0 5-4 9-9 9s-9-4-9-9z" fill="${fill}" ${s(2.2 / k)}/>
    <path d="M10.5 8.5l2 1.6M13 7l1.2 2.2" fill="none" ${s(1.5 / k)}/>
    <circle cx="12" cy="15.5" r="3.2" fill="${K}" ${s(1.6 / k)}/><circle cx="12.7" cy="15.9" r="1.35" fill="${O}"/>
    <circle cx="20.6" cy="16" r="2.2" fill="${Y}" ${s(1.6 / k)}/><circle cx="20.5" cy="16.3" r="0.95" fill="${O}"/>
    <path d="M11.2 22q4.8 3.4 9.6 0" fill="none" ${s(2 / k)}/>
    <path d="M14 23.2v1.5M17.6 23.4v1.4" fill="none" ${s(1.3 / k)}/>
  </g>`;
}

export const ICONS = {
  zombie: head(0, 0, 1),
  horde: `${head(-1, -2, 0.6, GD)}${head(13, -2, 0.6, GD)}${head(3.5, 6, 0.8)}`,
  heart: `<path d="M16 27.5S5 21.2 5 13.6A5.6 5.6 0 0 1 16 10.4a5.6 5.6 0 0 1 11 3.2c0 7.6-11 13.9-11 13.9z" fill="${G}" ${s()}/>
    <path d="M9 15.5h14M11.5 13.5v4M15 13.5v4M18.5 13.5v4" fill="none" ${s(1.5)}/>
    <path d="M9.4 11.6a3 3 0 0 1 3-1.6" fill="none" stroke="${K}" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>`,
  bolt: `<path d="M18.5 3 7 18h7.5l-2.5 11 12.5-16.5h-7.5z" fill="${T}" ${s()}/>
    <path d="M15.5 7.5 11 13.5" fill="none" stroke="${K}" stroke-width="1.6" stroke-linecap="round" opacity="0.75"/>`,
  brain: `<path d="M10 8.5a4.2 4.2 0 0 1 6-1.6 4.2 4.2 0 0 1 6 1.6 4.2 4.2 0 0 1 3.4 5.6 4.4 4.4 0 0 1-1.6 6.4 4.4 4.4 0 0 1-7.8 3.6 4.4 4.4 0 0 1-7.8-3.6 4.4 4.4 0 0 1-1.6-6.4A4.2 4.2 0 0 1 10 8.5z" fill="${P}" ${s()}/>
    <path d="M16 7v17.5M11 13q2.5 1 2 4M21 13q-2.5 1-2 4M9.5 19.5q2-.5 3 1.5M22.5 19.5q-2-.5-3 1.5" fill="none" ${s(1.5)}/>`,
  bite: `<path d="M3.5 16c3.2-7.5 21.8-7.5 25 0-3.2 7.5-21.8 7.5-25 0z" fill="${C}" ${s()}/>
    <path d="M7 16c3.2-3.6 14.8-3.6 18 0-3.2 3.6-14.8 3.6-18 0z" fill="${O}"/>
    <path d="M8 14.8l2 2.4 2-2.9 2 2.9 2-2.9 2 2.9 2-2.9 2 2.9 2-2.4z" fill="${K}"/>
    <path d="M9.5 18l1.8-1.6 1.8 1.9 1.8-1.9 1.8 1.9 1.8-1.9 1.8 1.9 1.8-1.6z" fill="${K}"/>`,
  claws: `<path d="M17 3.5 Q11 13 4.5 22 Q11 15.5 19 5.5z M23.5 5 Q17 15 10 25.5 Q17.5 18 25.5 7z M29 8.5 Q23 17 16.5 28 Q24 20.5 30.5 10.5z" fill="${K}" ${s(2)}/>
    <path d="M6 4l4 4M3 9l4 2" fill="none" stroke="${C}" stroke-width="2" stroke-linecap="round"/>`,
  rush: `<path d="M5 8l8 8-8 8M14 8l8 8-8 8" fill="none" stroke="${O}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5 8l8 8-8 8M14 8l8 8-8 8" fill="none" stroke="${T}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M25 11h3M26 16h3M25 21h3" fill="none" ${s(2)}/>`,
  frenzy: `<path d="M16 3l3 6.5 6.8-2.3-2.2 6.8L30 17l-6.4 3 2.2 6.8-6.8-2.3L16 31l-3-6.5-6.8 2.3 2.2-6.8L2 17l6.4-3-2.2-6.8 6.8 2.3z" fill="${C}" ${s(2)}/>
    <path d="M16 9.5l1.8 4 4.2-1.3-1.3 4.1 3.9 1.7-3.9 1.8 1.3 4.1-4.2-1.4-1.8 4-1.8-4-4.2 1.4 1.3-4.1-3.9-1.8 3.9-1.7-1.3-4.1 4.2 1.3z" fill="${Y}"/>`,
  brute: `<path d="M4 25c0-5.5 3.5-8.5 7-9l2.5-7c.8-2.4 4-2.6 5-.4l1.5 4.2c5.2 0 8 3.6 8 8.2V25z" fill="${G}" ${s()}/>
    <path d="M13.5 13.5q3 2.5 6.5 0M9 21q4-2 7 0" fill="none" ${s(1.6)}/>
    <path d="M4 25h24" fill="none" ${s(2.4)}/>`,
  megaphone: `<path d="M5 13h5l12-6v18l-12-6H5z" fill="${Y}" ${s()}/>
    <path d="M10 19l2 7h3l-1.5-6" fill="${K}" ${s(1.8)}/>
    <path d="M25.5 11q3 5 0 10M27.8 8.5q4.5 7.5 0 15" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round"/>`,
  recall: `<path d="M24 25v-8a7 7 0 0 0-7-7H8" fill="none" stroke="${O}" stroke-width="6" stroke-linecap="round"/>
    <path d="M24 25v-8a7 7 0 0 0-7-7H8" fill="none" stroke="${T}" stroke-width="3" stroke-linecap="round"/>
    <path d="M12 4.5 5.5 10l6.5 5.5z" fill="${T}" ${s(2)}/>`,
  move: `<path d="M16 29s-9-8.5-9-15a9 9 0 0 1 18 0c0 6.5-9 15-9 15z" fill="${T}" ${s()}/><circle cx="16" cy="13.5" r="3.6" fill="${K}" ${s(1.8)}/>`,
  target: `<circle cx="16" cy="16" r="10.5" fill="none" stroke="${O}" stroke-width="5"/>
    <circle cx="16" cy="16" r="10.5" fill="none" stroke="${C}" stroke-width="2.6"/>
    <circle cx="16" cy="16" r="3.6" fill="${C}" ${s(1.8)}/>
    <path d="M16 2v6M16 24v6M2 16h6M24 16h6" fill="none" ${s(2.4)}/>`,
  fort: `<path d="M6 28V13h4v-3h3v3h6v-3h3v3h4v15z" fill="${C}" ${s()}/>
    <path d="M13 28v-6a3 3 0 0 1 6 0v6" fill="${O}"/>
    <path d="M16 10V3" fill="none" ${s(2)}/><path d="M16 3.5h7l-2 2.2 2 2.2h-7z" fill="${Y}" ${s(1.6)}/>`,
  star: `<path d="M16 3.5l3.8 7.8 8.5 1.2-6.2 6 1.5 8.5L16 23l-7.6 4 1.5-8.5-6.2-6 8.5-1.2z" fill="${Y}" ${s()}/>
    <path d="M12.5 12.5l1.2-2.4" fill="none" stroke="${K}" stroke-width="1.6" stroke-linecap="round"/>`,
  pin: `<path d="M16 29s-9-8.5-9-15a9 9 0 0 1 18 0c0 6.5-9 15-9 15z" fill="${Y}" ${s()}/><circle cx="16" cy="13.5" r="3.6" fill="${O}"/>`,
  nest: `<path d="M4 18c2 7 22 7 24 0z" fill="#c89a5b" ${s()}/>
    <path d="M7 20.5l4-2M12 22l5-2.5M18 22.5l4-2.5" fill="none" ${s(1.4)}/>
    <ellipse cx="16" cy="13" rx="5.2" ry="6.5" fill="${G}" ${s()}/><path d="M13.5 11l1.5 1.5 1.5-1.5 1.5 1.5" fill="none" ${s(1.4)}/>`,
  drink: `<path d="M9 10h14l-2 18H11z" fill="${T}" ${s()}/>
    <path d="M8 10h16" fill="none" ${s(2.6)}/><path d="M17 10l3-7h4" fill="none" stroke="${C}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M11.5 16h9" fill="none" stroke="${K}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
  lock: `<path d="M10.5 14v-3.5a5.5 5.5 0 0 1 11 0V14" fill="none" stroke="${O}" stroke-width="5"/>
    <path d="M10.5 14v-3.5a5.5 5.5 0 0 1 11 0V14" fill="none" stroke="${K}" stroke-width="2"/>
    <rect x="7" y="14" width="18" height="14" rx="3.5" fill="${Y}" ${s()}/><path d="M16 19.5v3.5" fill="none" ${s(2.6)}/>`,
  eye: `<path d="M3 16s5-9 13-9 13 9 13 9-5 9-13 9S3 16 3 16z" fill="${K}" ${s()}/>
    <circle cx="16" cy="16" r="5" fill="${G}" ${s(1.8)}/><circle cx="16.5" cy="16.5" r="2" fill="${O}"/>`,
  grave: `<path d="M8 28V12a8 8 0 0 1 16 0v16z" fill="#9fb7b5" ${s()}/>
    <path d="M12.5 15h7M16 11v9" fill="none" ${s(2)}/><path d="M5 28h22" fill="none" ${s(2.4)}/>`,
  warning: `<path d="M16 4 29 27H3z" fill="${C}" ${s()}/><path d="M16 12v7" fill="none" stroke="${K}" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="23" r="1.8" fill="${K}"/>`,
  map: `<path d="M4 8l7-3 10 3 7-3v19l-7 3-10-3-7 3z" fill="${K}" ${s()}/>
    <path d="M11 5v19M21 8v19" fill="none" ${s(1.6)}/><path d="M14 13l4 3M18 13l-4 3" fill="none" stroke="${C}" stroke-width="2" stroke-linecap="round"/>`,
  check: `<circle cx="16" cy="16" r="12" fill="${G}" ${s()}/><path d="M10 16.5l4 4 8-9" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  gate: `<path d="M3 11h26v8H3z" fill="${Y}" ${s()}/><path d="M8 11l-4 8M15 11l-4 8M22 11l-4 8M29 11l-4 8" fill="none" ${s(2.2)}/>
    <path d="M7 19v8M25 19v8" fill="none" ${s(2.6)}/>`,
  human: `<circle cx="16" cy="10" r="5.5" fill="#f2c189" ${s()}/><path d="M6 28c0-6 4.5-10 10-10s10 4 10 10z" fill="${C}" ${s()}/>`,
  mouseL: `<rect x="8" y="3.5" width="16" height="25" rx="8" fill="${K}" ${s()}/><path d="M16 3.5v9M8 12.5h16" fill="none" ${s(1.8)}/>
    <path d="M10 6.5a6 6 0 0 1 6-3v9H8.6V11a6 6 0 0 1 1.4-4.5z" fill="${C}" ${s(1.8)}/>`,
  mouseR: `<rect x="8" y="3.5" width="16" height="25" rx="8" fill="${K}" ${s()}/><path d="M16 3.5v9M8 12.5h16" fill="none" ${s(1.8)}/>
    <path d="M22 6.5a6 6 0 0 0-6-3v9h7.4V11a6 6 0 0 0-1.4-4.5z" fill="${T}" ${s(1.8)}/>`,
  flame: `<path d="M16 3c1 5 8 7.5 8 15a8 8 0 0 1-16 0c0-4 2-6.5 4-8 0 3 1.5 4.5 3 5 0-5 1-9 1-12z" fill="${C}" ${s()}/>
    <path d="M16 18c2 2 3.5 3 3.5 5.2a3.5 3.5 0 0 1-7 0c0-1.8 1.5-3.2 3.5-5.2z" fill="${Y}"/>`,
  skullCrown: `<path d="M6 12l4 4 6-8 6 8 4-4-2 13H8z" fill="${Y}" ${s()}/><circle cx="16" cy="19" r="2" fill="${C}" ${s(1.4)}/>`,
  dizzy: `<path d="M16 6a10 10 0 1 1-9.5 7" fill="none" ${s(2.6)}/><path d="M16 11a5 5 0 1 1-4.7 3.3" fill="none" stroke="${Y}" stroke-width="2.6" stroke-linecap="round"/>`,
  pause: `<rect x="8" y="6" width="6" height="20" rx="2.5" fill="${K}" ${s()}/><rect x="18" y="6" width="6" height="20" rx="2.5" fill="${K}" ${s()}/>`,
  sound: `<path d="M5 12h5l7-6v20l-7-6H5z" fill="${K}" ${s()}/><path d="M21 11q3 5 0 10M24.5 8q5 8 0 16" fill="none" ${s(2)}/>`,
  camera: `<path d="M16 5a11 11 0 1 1-10.4 7.4" fill="none" stroke="${O}" stroke-width="5" stroke-linecap="round"/>
    <path d="M16 5a11 11 0 1 1-10.4 7.4" fill="none" stroke="${T}" stroke-width="2.4" stroke-linecap="round"/><path d="M3 6l3 7 6.5-3.5z" fill="${T}" ${s(1.8)}/>`,
  fullscreen: `<rect x="8.5" y="8.5" width="15" height="15" rx="2" fill="${T}" ${s(1.8)}/>
    <path d="M4 11V4h7M21 4h7v7M28 21v7h-7M11 28H4v-7" fill="none" stroke="${O}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M4 11V4h7M21 4h7v7M28 21v7h-7M11 28H4v-7" fill="none" stroke="${K}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
} as const;

export type IconName = keyof typeof ICONS;

export type IconSize = 's' | 'm' | 'l';

/** Inline SVG markup for an icon (decorative: aria-hidden). */
export function icon(name: IconName, size: IconSize = 'm', extraClass = ''): string {
  const cls = `hz-ico${size === 'm' ? '' : ` hz-ico-${size}`}${extraClass ? ` ${extraClass}` : ''}`;
  return `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

/** Icon for an ability id (every AbilityId maps to a distinct icon). */
export function abilityIcon(id: AbilityId | null): IconName {
  switch (id) {
    case 'bite': return 'bite';
    case 'alpha_claws': return 'claws';
    case 'rush': return 'rush';
    case 'horde_frenzy': return 'frenzy';
    case 'brute_evolution': return 'brute';
    case 'pounce': return 'rush';
    case 'infect': return 'zombie';
    default: return 'lock';
  }
}
