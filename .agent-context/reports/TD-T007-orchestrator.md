# TD-T007 — orchestrator (browser playtest, built-in browser, vite on :5181)
**Status:** COMPLETED
**Completed Work:**
- Desktop: fresh start shows no slots and touch overlay off. 6 capReached events → 1 toast (dedupe). unlock rush → slotsOwned 1, Q; unlock frenzy → not equipped, toast "buy or free a slot at a nest". buySlot at start nest spent exactly 40 (owned 2); nest panel button click → Game pendingBuySlot → spent 70 (owned 3), toast "Ability slot R unlocked", HUD shows Q E R. No console errors.
- Mobile emulation 375x812 (coarse pointer): overlay enabled at boot, body.ibz-touch-active, DPR 1.0, owned slots as touch buttons. Synthetic touch pointers: tap begins game; stick up 1.5 s → leader moved 10.5 m with sprint, stops on release; tap on open ground → move order; pinch out → targetZoom 12 → 8; ATTACK → windup; RALLY → rally cooldown.
- Fix (owner = orchestrator, src/ui/touch.css): phone layout — desktop HUD overlapped the touch controls. Under body.ibz-touch-active: hide keyboard hints/capture hint/intro key list; order pill above the stick; ≤760 px: stats/tracker/horde counter scaled 0.68, minimap hidden (MAP button), pause/map/cam row moved under the horde counter, nest panel a short scrollable card without descriptions.
- docs/todos.md items 7–9 ticked with player-facing notes.
**Remaining Work:** none. Not verified on a real phone (emulation only; emulator clicks are mouse events, gestures were synthesized PointerEvents).
**Observation (pre-existing, not a regression):** a tap/RMB whose ray first hits the Alpha or followers issues no order (InputController's "solid hit before ground" rule) — taps just below screen centre do nothing.
**Verification Run:** browser checks above; test save cleared from the pane's localStorage afterwards.
**Memory Notes:** Built-in browser mobile preset emulates `(pointer: coarse)` but sends mouse events; test touch with `new PointerEvent(..., {pointerType:'touch'})` dispatched on the canvas / window. Intro overlay blocks sim stepping (time stays 0) until a real gesture; queued inputs apply on the first step.
