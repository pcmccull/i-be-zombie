// [pure] Top-level game flow (docs/4_intro_scene.md §5). One central gate for every gameplay input source.

/** Client flow state. Distinct from the simulation's `GameState` data model (src/core/types.ts). */
export type GameFlowState = 'LOADING' | 'INTRO_CINEMATIC' | 'PLAYING' | 'PAUSED';

/** Keyboard/mouse/touch gameplay input, horde commands, abilities and manual camera control. */
export function gameplayInputEnabled(flow: GameFlowState): boolean {
  return flow === 'PLAYING';
}

/**
 * Hard input lock for the start screen + opening cinematic: every gameplay input source is dropped (not
 * buffered). PAUSED is not locked here — the pause menu is a modal that still needs Esc / its own buttons.
 */
export function cinematicInputLock(flow: GameFlowState): boolean {
  return flow === 'LOADING' || flow === 'INTRO_CINEMATIC';
}

/** Gameplay HUD (meters, minimap, touch overlay) is shown only once the player has control (or paused over it). */
export function gameplayHudVisible(flow: GameFlowState): boolean {
  return flow === 'PLAYING' || flow === 'PAUSED';
}

/** The opening cinematic plays only for a new game (no save) or an explicit replay — never on district entry. */
export function shouldPlayIntro(opts: { hasSave: boolean; replay?: boolean }): boolean {
  return opts.replay === true || !opts.hasSave;
}

const ALLOWED: Record<GameFlowState, readonly GameFlowState[]> = {
  LOADING: ['INTRO_CINEMATIC', 'PLAYING'],
  INTRO_CINEMATIC: ['PLAYING', 'LOADING'],
  PLAYING: ['PAUSED', 'LOADING', 'INTRO_CINEMATIC'],
  PAUSED: ['PLAYING', 'LOADING', 'INTRO_CINEMATIC'],
};

/** Returns `to` when the transition is legal, otherwise `from` (illegal transitions are ignored, never thrown). */
export function transitionFlow(from: GameFlowState, to: GameFlowState): GameFlowState {
  return from === to || ALLOWED[from].includes(to) ? to : from;
}
