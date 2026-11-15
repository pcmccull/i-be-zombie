import { Game } from './core/Game';

const game = new Game(document.getElementById('app')!, document.getElementById('hud')!);
game.start();

// Dev-only handle for profiling from the console (e.g. game.hordeStats).
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;

if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
