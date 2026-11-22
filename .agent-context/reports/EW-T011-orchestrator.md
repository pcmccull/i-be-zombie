# EW-T011 — Browser playtest (orchestrator)

- **Task ID & Agent:** EW-T011 · Claude orchestrator (built-in browser, dev server :5173)
- **Status:** COMPLETED

## Completed Work
What the playtest checked (via the `window.game` dev handle: teleport the leader, set camera yaw/zoom, read state):

- **Perimeter tour**
  - East edge: seawall + water, with vehicle-blockade gaps.
  - NE corner: shipping containers + urban fence + broken bridge spans.
  - NW corner: military perimeter with watchtowers.
  - SW corner: mangrove barrier + beach.
  - Zoomed out (64 m) at the edges: no void and no skirt; backdrop planes fill the view.
  - One frame mid-teleport showed a flat cyan patch. It didn't come back once the chunks had streamed, so treated as a transient frame.
- **Eyesight tiers 1→4** at `nest_start`:
  - Buttons update: Predator 20 → Hunter 60 → Apex 120 BIO.
  - The "Eyes adjust — …" toast shows, the haze clears further out, and the identified count grows 4 → 8.
  - After a hot reload (save/load), the tier came back as 4.
- **Human gating:** at tier 1, the drawn humans were exactly the identified ones (all within 18 m); civilians at 41 m and more were hidden.
- **Cue arcs:** at tier 1, about 25 m from the suburb police checkpoint, cues fire (`vision.cues` 2) and up to 6 pooled arcs show, then fade out. The pooled arcs rotate by direction; low-intensity cues are faint.
- **Frame time:** pane at DPR 1, so vision quality is low.

  | Tier | fps | p50 | p95 |
  |---|---|---|---|
  | 1 | 50 | 20.1 ms | 25 ms |
  | 4 | 49.7 | 20 ms | 20.7 ms |

  Tier makes no measurable difference. A teleport costs one hitch of about 120 ms while chunks stream; normal walking has none.
- **Mobile 375×812:** touch mode is detected and vision quality is low. Joystick and buttons are fine; the eyesight panel fits.
- No console errors.

### Fixes made (orchestrator)
1. `src/ui/hudOpenWorld.css`: the district banner was always shown as an empty box in the open world. `.is-open-world .ibz-ow-only {display:block}` outranked `.ibz-district-banner {display:none}`. I added `.is-open-world .ibz-district-banner` to the hide rule. Verified: hidden at rest, shown for about 3.8 s on entering a district.
2. `src/ui/NestPanel.ts`: the panel disappeared at Apex (MAX) when there was no loadout to manage. The Eyesight section now stays once tier > 1 and shows MAX.
3. `src/ui/HUD.ts` (EW tip block only, additive):
   - The two eyesight tips fired on the same frame; they no longer do (`else if`).
   - The "affordable" tip is skipped while the nest panel is open.
   - Both texts are shorter so they fit on phones.

## Remaining Work / follow-ups (not EW-owned)
- On mobile, every HUD toast still slides under the HORDE panel at the top. The toast position lives in `hud.css` / `touch.css`, which the other session owns, so I didn't touch it.
- The nest panel can draw over the "Your conquest continues" resume card (pre-existing for the loadout panel too).

## Public Interfaces/Exports Added
None.

## Verification Run
- `npx tsc --noEmit` → 0 errors.
- `npx vitest run` → 55 files, 592/592 pass.
- `npm run build` → OK.
- Browser console: no errors.

## Memory Notes
- Open-world-only HUD elements that need their own hidden state must restate it under `.is-open-world`. The `.ibz-ow-only` display:block rule outranks a bare class rule.
- Playtest teleport needs `pos` + `prevPos` for the leader and the followers. Camera: set `cameraRig.yaw/viewYaw`; zoom range is 8..64.
