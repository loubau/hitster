import { useRef, useState, type CSSProperties } from 'react';
import { cardsFor } from '../data/cards';
import { newGame } from '../engine/game';
import type { GameState, Settings } from '../engine/types';
import { normaliseCode } from '../room/code';
import { lastRoom } from '../room/identity';
import { freeCode, roomsConfigured } from '../room/supabase';
import { Icon } from './Icon';
import { PLAYER_COLORS, Token, tilt } from './cards';
import { loadPrefs, savePrefs } from './prefs';
import { Rules, dealProblem } from './Rules';

/** Going into a room: one opened here (with its first rules), or one joined by its code. */
export interface RoomEntry {
  code: string;
  /** Null: rejoin as the player this browser already is there. */
  name: string | null;
  create?: { settings: Settings };
}

type Mode = 'table' | 'open' | 'join';

const MODES: { id: Mode; label: string }[] = [
  { id: 'table', label: 'Play on one phone' },
  { id: 'open', label: 'Open a room' },
  { id: 'join', label: 'Join a room' },
];

interface Props {
  canResume: boolean;
  onResume: () => void;
  onStart: (s: GameState) => void;
  onRoom: (entry: RoomEntry) => void;
}

export function Setup({ canResume, onResume, onStart, onRoom }: Props) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [mode, setMode] = useState<Mode>('table');
  const [draft, setDraft] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0);
  const [opening, setOpening] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const meInput = useRef<HTMLInputElement>(null);
  const { names, settings, me } = prefs;
  const deckSize = cardsFor(settings).length;
  const seated = names.length >= 2;
  const rejoin = roomsConfigured ? lastRoom() : null;

  const addName = () => {
    const name = draft.trim();
    if (!name) return;
    if (names.includes(name)) return setError(`${name} is already playing`);
    setPrefs((p) => ({ ...p, names: [...p.names, name].slice(0, 8) }));
    setDraft('');
    setError(null);
  };

  const start = () => {
    if (!seated) {
      // The hint under the button already says why; point at the name field.
      setNudge((n) => n + 1);
      nameInput.current?.focus();
      return;
    }
    const problem = dealProblem(settings, names.length);
    if (problem) return setError(problem);
    savePrefs(prefs);
    onStart(newGame(settings, names, cardsFor(settings), Date.now() % 2147483647));
  };

  const myName = me.trim();
  const needName = () => {
    setNudge((n) => n + 1);
    meInput.current?.focus();
  };

  const open = async () => {
    if (!myName) return needName();
    setOpening(true);
    savePrefs(prefs);
    onRoom({ code: await freeCode(), name: myName, create: { settings } });
  };

  const join = () => {
    const room = normaliseCode(code);
    if (!room) return setError('A room code is four letters');
    if (!myName) return needName();
    savePrefs(prefs);
    onRoom({ code: room, name: myName });
  };

  const meField = (
    <input
      ref={meInput}
      className="room-field"
      value={me}
      onChange={(e) => setPrefs((p) => ({ ...p, me: e.target.value }))}
      placeholder="Your name"
      maxLength={14}
      autoComplete="nickname"
      aria-label="Your name"
    />
  );

  return (
    <div className="table theme-regular setup">
      <header className="setup-head">
        <h1 className="wordmark">
          Hitster<span>at the table</span>
        </h1>
        <div className="setup-resume">
          {canResume && mode === 'table' && (
            <button type="button" className="ghost-btn" onClick={onResume}>
              Resume last game
            </button>
          )}
          {rejoin && (
            <button type="button" className="ghost-btn" onClick={() => onRoom({ code: rejoin, name: null })}>
              Back to room {rejoin}
            </button>
          )}
        </div>
      </header>

      <div className="modes" role="tablist" aria-label="How to play">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={`mode${mode === m.id ? ' is-on' : ''}`}
            onClick={() => {
              setMode(m.id);
              setError(null);
              setNudge(0);
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'table' && (
        <>
          <section className="setup-block">
            <h2>Who's playing</h2>
            <div className="plates">
              {names.map((n, i) => (
                <span key={n} className="plate" style={{ '--tilt': tilt(n, 4) } as CSSProperties}>
                  <Token name={n} color={PLAYER_COLORS[i % PLAYER_COLORS.length]} size={24} />
                  {n}
                  <button type="button" aria-label={`Remove ${n}`} onClick={() => setPrefs((p) => ({ ...p, names: p.names.filter((x) => x !== n) }))}>
                    <Icon name="cross" size={14} />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="add-player"
              onSubmit={(e) => {
                e.preventDefault();
                addName();
              }}
            >
              <input ref={nameInput} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a player" maxLength={14} aria-label="Player name" />
              <button type="submit" className="chip-btn">
                <Icon name="plus" size={16} /> Add
              </button>
            </form>
          </section>

          <Rules settings={settings} onChange={(s) => setPrefs((p) => ({ ...p, settings: s }))} />

          <footer className="setup-foot">
            {error && <p className="form-error">{error}</p>}
            <button type="button" key={nudge} className={`slab${seated ? '' : ' is-waiting'}${nudge ? ' is-nudged' : ''}`} onClick={start}>
              Deal the cards
            </button>
            <p className={`deck-note${seated ? '' : ' is-hint'}`}>
              {seated ? `${deckSize} cards in the deck` : names.length ? 'Add one more player to deal' : 'Add at least two players to deal'}
            </p>
          </footer>
        </>
      )}

      {mode !== 'table' && !roomsConfigured && (
        <section className="setup-block">
          <h2>Rooms aren't configured yet</h2>
          <p className="room-blurb">This copy of Hitster has no Supabase project behind it, so for now everyone plays on one phone.</p>
        </section>
      )}

      {mode === 'open' && roomsConfigured && (
        <form
          className="room-form"
          onSubmit={(e) => {
            e.preventDefault();
            void open();
          }}
        >
          <section className="setup-block">
            <h2>Open a room</h2>
            <p className="room-blurb">Everyone plays on their own phone. You set the rules and deal, and the music plays from yours.</p>
            {meField}
          </section>
          <footer className="setup-foot">
            {error && <p className="form-error">{error}</p>}
            <button type="submit" key={nudge} className={`slab${myName && !opening ? '' : ' is-waiting'}${nudge ? ' is-nudged' : ''}`} disabled={opening}>
              {opening ? 'Opening…' : 'Open the room'}
            </button>
            <p className={`deck-note${myName ? '' : ' is-hint'}`}>{myName ? 'You get a code to send the others' : 'Type your name to open a room'}</p>
          </footer>
        </form>
      )}

      {mode === 'join' && roomsConfigured && (
        <form
          className="room-form"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <section className="setup-block">
            <h2>Join a room</h2>
            <input
              className="room-field code-field"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
                setError(null);
              }}
              placeholder="CODE"
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Room code"
            />
            {meField}
          </section>
          <footer className="setup-foot">
            {error && <p className="form-error">{error}</p>}
            <button type="submit" key={nudge} className={`slab${code.length === 4 && myName ? '' : ' is-waiting'}${nudge ? ' is-nudged' : ''}`}>
              Join
            </button>
            <p className="deck-note">Ask whoever opened the room for the four letters</p>
          </footer>
        </form>
      )}
    </div>
  );
}
