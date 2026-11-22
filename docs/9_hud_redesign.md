# 9 — HUD redesign (tropical zombie action HUD)

Source: user request 2026-11-16 (condensed here; the full request lives in the session transcript).

## Goal
Replace the debug-panel style HUD with a cohesive, polished, *playful* third-person action HUD: colorful, tropical,
zombie-themed (not horror). World stays the focus; information sits on the edges, the center stays clear.

## Palette (tokens in `src/ui/hudTheme.css`)
| Token | Hex | Use |
|---|---|---|
| `--hz-green` | `#86D957` | health, horde, positive |
| `--hz-teal` | `#45D6C5` | abilities, energy, navigation |
| `--hz-yellow` | `#FFD166` | objectives, rewards, prompts |
| `--hz-coral` | `#FF8066` | warnings, combat |
| `--hz-cream` | `#FFF4DC` | text, bright surfaces |
| `--hz-deep` | `#193F48` | translucent backing, outlines |

Soft translucent rounded panels, slight cartoon depth (bottom "lip" shadow + top highlight), controlled glow.
No blood red, harsh black, neon or sci-fi chrome.

## Layout
- **Top-left** character card: Alpha portrait, health (smooth, damage-lag ghost bar, soft low-HP warning), stamina
  (energy), biomass ("brains"), status chips (Rush, Frenzy, Exhausted, Stunned, eyesight tier).
- **Top-center** objective: compact title/sub/progress `n / m`; expands briefly on change and while Tab is held open;
  celebratory completion; structure/gate HP bar and toasts below; district-entered banner.
- **Top-right** circular, player-centered minimap (north-up) with district name, compass, fog respected, followers,
  known strongholds, nests, waypoint, objective marker clamped to the rim. Never reveals undiscovered things.
- **Bottom-left** horde card: zombie icon, big `count / cap`, state chips (Following / Attacking / Moving / Split /
  Rush / Frenzy / Brutes), recall hint, cap notice, outbreak meter; `+N` floater + icon bounce on recruit, soft
  response on losses.
- **Bottom-center** ability bar: primary attack (LMB bite / claw combo), Rally (Space), Recall (G), mutation slots
  Q E R F with icons, radial cooldowns, ready shimmer, active, empty, no-biomass and denied states.
- **Bottom-right** contextual actions only when relevant (RMB attack hovered target, Space rally N walkers,
  G recall, nest loadout, drinks) — no permanent instruction strip.

## Feedback
Recruit popups scaled by burst size (aggregated, single element), biomass floaters, directional damage indicator +
soft coral edge flash, small hit confirmation, target label, major banners (HORDE GROWING!, OUTPOST OVERRUN!,
DISTRICT CONQUERED!, NEW ABILITY UNLOCKED!) with sparing humor. Never block input.

## Behavior
Context emphasis (combat → health/abilities; exploring → map/objective). HUD hidden during the intro cinematic and
fades in when control starts; no gameplay HUD over modals. Reduced motion (GraphicsQuality + `prefers-reduced-motion`).
Responsive: `--hz-u` unit scales 1080p → 1440p → 4K; priority hiding on small viewports; safe-area insets; touch
layout kept. DOM/CSS only, no new dependencies, DOM writes only on change, all listeners/timers cleaned up.
No new mechanics; Ctrl is not used for any new shortcut.

Timings: button 80–150 ms, small update 150–250 ms, panel 200–350 ms, objective 300–500 ms, major reward 600–1000 ms.
