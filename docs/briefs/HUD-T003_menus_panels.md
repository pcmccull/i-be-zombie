# HUD-T003 — Menus, panels, cinematic & touch restyle

Read first: `AGENTS.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md`, `docs/9_hud_redesign.md`,
`src/ui/hudTheme.css` (tokens + `.ibz-panel` / `.ibz-btn` / `.hz-key` / `.hz-ico` / keyframes), `src/ui/hudIcons.ts`.

## Goal
Make every menu / modal / side panel / touch control look like the same polished, playful tropical-zombie game as
the new gameplay HUD (built in parallel by the orchestrator in HUD.ts / hud.css). Visual only: no behavior changes.

## Locked files (edit ONLY these)
- `src/ui/hudPanels.css` — help panel (Tab), `.ibz-overlay` / `.ibz-modal*` (intro card, respawn, victory/defeat),
  `.ibz-intro-keys`, `.ibz-begin-prompt`, `.ibz-stats-grid` / `.ibz-stat-*`, `.ibz-restart-*`, `.ibz-respawn-count`,
  pause menu (`.ibz-pause*`), world map (`.ibz-worldmap*`, `.ibz-legend*`, `.ibz-sw*`, `.ibz-sh-*`),
  nest panel (`.ibz-nest-*`). Remove the old `.ibz-btn` block here (now in hudTheme.css) unless you need a variant
  (`.ibz-btn-danger` → coral, `.ibz-btn-small`).
- `src/ui/PauseMenu.ts`, `src/ui/WorldMap.ts`, `src/ui/NestPanel.ts` — markup only (add `icon(...)` from
  `./hudIcons`, headings, `.hz-key` key caps, section structure). Keep every callback, getter, data flow, element the
  code queries and every public method identical.
- `src/ui/CinematicOverlay.ts`, `src/ui/intro.css` — skip button, subtitles, start prompt, objective card in the new
  style. **Keep** `.ibz-hud.is-cinematic > * { visibility: hidden !important; }` semantics (the orchestrator may add
  an opacity fade in hud.css; do not fight it).
- `src/ui/TouchControls.ts`, `src/ui/touch.css` — stick, buttons, slot buttons: rounded cartoon buttons, icons from
  `abilityIcon()` for slot buttons, attack = `bite`, regroup = `megaphone`, follow = `recall`, map = `map`,
  pause = `pause`, recenter = `camera`. Touch targets ≥ 48 px. HUD panel positions on touch are NOT yours
  (hud.css `body.ibz-touch-active …`).

Do NOT edit HUD.ts, hud.css, hudOpenWorld.css, hudTheme.css, hudIcons.ts, Minimap.ts, mapRender.ts, Game.ts.
Do not rename any class that HUD.ts markup uses (`ibz-help-panel`, `ibz-help-title`, `ibz-help-table`, `ibz-overlay`,
`ibz-modal`, `is-defeat`, `ibz-modal-title`, `ibz-modal-pitch`, `ibz-intro-keys`, `ibz-begin-prompt`, `ibz-respawn`,
`ibz-respawn-count`, `ibz-stats-grid`, `ibz-stat-cell`, `ibz-stat-label`, `ibz-stat-val`, `ibz-restart-btn`,
`ibz-restart-hint`, `is-visible`).

## Style rules
- Use tokens only (`var(--hz-*)`), sizes in `calc(N * var(--hz-u))`. Palette green/teal/yellow/coral/cream/deep;
  no harsh black, no blood red, no neon. Menus/modals use `--hz-panel-solid` (more opaque than gameplay panels),
  radius `--hz-r-l`, the shared `--hz-hi, --hz-lip, --hz-drop` shadows. Titles `--hz-font-display`, cream with
  `--hz-text-shadow`, accent words green/yellow. Modal backdrop: soft deep-teal tint + blur, not black.
- Modal entrance: `hz-slide-down`/scale-in 200-350 ms, `--hz-ease-pop`. Buttons: 80-150 ms press feedback (base
  `.ibz-btn` already does it). Hover/focus-visible states on every clickable thing. No infinite flashing except a
  slow `hz-soft-pulse` on the begin prompt.
- Respawn modal is friendly ("THE ALPHA FALLS" stays; coral accent), victory green, defeat coral.
- Nest panel: a tidy card (title with `nest` icon, slot buttons showing ability icons, eyesight section with `eye`).
- World map: frame, legend swatches and side list restyled; the canvas drawing itself (mapRender.ts) is not yours.
- Must work 1280×720 → 4K and on phones (touch layout); no horizontal overflow; reduced motion is handled globally.

## Done when
`npx tsc --noEmit` and `npm test` pass; report `.agent-context/reports/HUD-T003-agy-worker.md` per AGENTS.md
(list classes added/renamed; any markup change in the .ts files).
