import { useEffect, useReducer } from 'react';
import { reduce, type Action } from './engine/game';
import type { GameState } from './engine/types';
import { Game } from './ui/Game';
import { Setup } from './ui/Setup';

const SAVE_KEY = 'hitster.game.v1';

type AppAction = Action | { type: 'load'; state: GameState | null };

function appReduce(s: GameState | null, a: AppAction): GameState | null {
  if (a.type === 'load') return a.state;
  return s ? reduce(s, a) : s;
}

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

export function App() {
  const [game, dispatch] = useReducer(appReduce, null);
  const saved = game ? null : loadSaved();

  useEffect(() => {
    try {
      if (game && game.phase !== 'over') localStorage.setItem(SAVE_KEY, JSON.stringify(game));
      else if (game) localStorage.removeItem(SAVE_KEY);
    } catch {
      // Storage can be unavailable (private mode); the game just won't survive a reload.
    }
  }, [game]);

  if (!game) {
    return (
      <Setup
        canResume={!!saved && saved.phase !== 'over'}
        onResume={() => dispatch({ type: 'load', state: saved })}
        onStart={(state) => dispatch({ type: 'load', state })}
      />
    );
  }
  return <Game state={game} dispatch={dispatch} onExit={() => dispatch({ type: 'load', state: null })} />;
}
