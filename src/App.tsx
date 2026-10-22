import { Suspense, lazy, useEffect, useReducer, useState } from 'react';
import { reduce, type Action } from './engine/game';
import type { GameState, Settings } from './engine/types';
import { codeFromUrl, showRoomInUrl } from './room/code';
import { takeSeat, type Identity } from './room/identity';
import { roomsConfigured } from './room/supabase';
import { Game } from './ui/Game';
import { JoinRoom } from './ui/JoinRoom';
import { Setup, type RoomEntry } from './ui/Setup';

// Rooms pull in the Supabase client; a game on one phone never needs it.
const RoomScreen = lazy(() => import('./ui/RoomScreen'));

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

type Route =
  | { to: 'table' }
  /** A room link: rejoin if this browser is already in it, otherwise ask for a name. */
  | { to: 'join'; code: string; checking: boolean }
  | { to: 'room'; code: string; identity: Identity; release: () => void; create?: { settings: Settings } };

function firstRoute(): Route {
  const code = roomsConfigured ? codeFromUrl() : null;
  return code ? { to: 'join', code, checking: true } : { to: 'table' };
}

export function App() {
  const [game, dispatch] = useReducer(appReduce, null);
  const [route, setRoute] = useState(firstRoute);
  const saved = game ? null : loadSaved();

  useEffect(() => {
    try {
      if (game && game.phase !== 'over') localStorage.setItem(SAVE_KEY, JSON.stringify(game));
      else if (game) localStorage.removeItem(SAVE_KEY);
    } catch {
      // Storage can be unavailable (private mode); the game just won't survive a reload.
    }
  }, [game]);

  const enter = async ({ code, name, create }: RoomEntry) => {
    const seat = await takeSeat(code, name, !!create);
    setRoute(seat ? { to: 'room', code, ...seat, create } : { to: 'join', code, checking: false });
  };

  useEffect(() => {
    if (route.to === 'join' && route.checking) void enter({ code: route.code, name: null });
    // Only the link this page was opened with.
  }, []);

  useEffect(() => showRoomInUrl(route.to === 'table' ? null : route.code), [route]);

  const toTable = () => {
    if (route.to === 'room') route.release();
    setRoute({ to: 'table' });
  };

  if (route.to === 'join') {
    if (route.checking) return null;
    return <JoinRoom code={route.code} onJoin={(name) => void enter({ code: route.code, name })} onCancel={toTable} />;
  }
  if (route.to === 'room') {
    return (
      <Suspense fallback={null}>
        <RoomScreen key={route.code} code={route.code} identity={route.identity} create={route.create} onLeave={toTable} />
      </Suspense>
    );
  }
  if (!game) {
    return (
      <Setup
        canResume={!!saved && saved.phase !== 'over'}
        onResume={() => dispatch({ type: 'load', state: saved })}
        onStart={(state) => dispatch({ type: 'load', state })}
        onRoom={(entry) => void enter(entry)}
      />
    );
  }
  return <Game state={game} dispatch={dispatch} onExit={() => dispatch({ type: 'load', state: null })} />;
}
