import { useRef, useState } from 'react';
import { loadPrefs, savePrefs } from './prefs';
import { RoomCode } from './RoomCode';

/** Where a shared room link lands when this browser isn't in that room yet: just a name. */
export function JoinRoom({ code, onJoin, onCancel }: { code: string; onJoin: (name: string) => void; onCancel: () => void }) {
  const [prefs] = useState(loadPrefs);
  const [name, setName] = useState(prefs.me);
  const [nudge, setNudge] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  return (
    <form
      className="table theme-regular setup join-room"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed) {
          setNudge((n) => n + 1);
          input.current?.focus();
          return;
        }
        savePrefs({ ...prefs, me: trimmed });
        onJoin(trimmed);
      }}
    >
      <header className="setup-head">
        <h1 className="wordmark">
          Hitster<span>join the room</span>
        </h1>
      </header>
      <section className="setup-block">
        <h2>Room</h2>
        <RoomCode code={code} />
        <input
          ref={input}
          className="room-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={14}
          autoComplete="nickname"
          autoFocus
          aria-label="Your name"
        />
      </section>
      <footer className="setup-foot">
        <button type="submit" key={nudge} className={`slab${trimmed ? '' : ' is-waiting'}${nudge ? ' is-nudged' : ''}`}>
          Join
        </button>
        <button type="button" className="ghost-btn" onClick={onCancel}>
          Play on one phone instead
        </button>
      </footer>
    </form>
  );
}
