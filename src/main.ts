import { Game } from './core/Game';

const game = new Game(document.getElementById('app')!, document.getElementById('hud')!);
game.start();

if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
