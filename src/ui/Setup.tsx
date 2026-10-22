import { useRef, useState, type CSSProperties } from 'react';
import { SET_INFO, cardsFor, countBySet } from '../data/cards';
import { newGame } from '../engine/game';
import type { GameState, SetId, Settings, Variant } from '../engine/types';
import { Icon } from './Icon';
import { PLAYER_COLORS, Token, tilt } from './cards';

const PREFS_KEY = 'hitster.prefs.v1';

interface Prefs {
  names: string[];
  settings: Settings;
}

const DEFAULTS: Prefs = {
  names: [],
  settings: { sets: ['regular'], target: 10, startChips: 2, maxChips: 5, variant: 'original', includeDutch: true },
};

/** Names the setup used to prefill while testing; saved as-is they are not a real table. */
const TEST_NAMES = ['Sanne', 'Joost', 'Lou'];

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULTS;
    const prefs = { ...DEFAULTS, ...(JSON.parse(raw) as Prefs) };
    const leftover = prefs.names.length === TEST_NAMES.length && TEST_NAMES.every((n) => prefs.names.includes(n));
    return leftover ? { ...prefs, names: [] } : prefs;
  } catch {
    return DEFAULTS;
  }
}

const VARIANTS: { id: Variant; name: string; blurb: string }[] = [
  { id: 'original', name: 'Original', blurb: 'Place it right, keep it' },
  { id: 'pro', name: 'Pro', blurb: 'Also name it to keep it' },
  { id: 'expert', name: 'Expert', blurb: 'Name it and the exact year' },
];

const SET_SAMPLE: Record<SetId, { year: string; top: string; bottom: string }> = {
  regular: { year: '1975', top: 'Pop', bottom: '1950s to now' },
  jazz: { year: '1959', top: 'Jazz', bottom: 'ODJB to Thundercat' },
  classical: { year: '1808', top: 'Classical', bottom: 'Palestrina to Guðnadóttir' },
};

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`Fewer: ${label}`} onClick={() => onChange(Math.max(min, value - 1))}>
          <Icon name="minus" size={16} />
        </button>
        <b>{value}</b>
        <button type="button" aria-label={`More: ${label}`} onClick={() => onChange(Math.min(max, value + 1))}>
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  );
}

export function Setup({ canResume, onResume, onStart }: { canResume: boolean; onResume: () => void; onStart: (s: GameState) => void }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const counts = countBySet();
  const { names, settings } = prefs;
  const deckSize = cardsFor(settings).length;
  const seated = names.length >= 2;

  const update = (patch: Partial<Settings>) => setPrefs((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  const addName = () => {
    const name = draft.trim();
    if (!name) return;
    if (names.includes(name)) return setError(`${name} is already playing`);
    setPrefs((p) => ({ ...p, names: [...p.names, name].slice(0, 8) }));
    setDraft('');
    setError(null);
  };
  const toggleSet = (id: SetId) =>
    update({ sets: settings.sets.includes(id) ? settings.sets.filter((s) => s !== id) : [...settings.sets, id] });

  const start = () => {
    if (!seated) {
      // The hint under the button already says why; point at the name field.
      setNudge((n) => n + 1);
      nameInput.current?.focus();
      return;
    }
    if (settings.sets.length === 0) return setError('Pick at least one set of cards');
    if (deckSize < names.length + 10) return setError('Not enough cards in these sets yet');
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Preferences are a convenience only.
    }
    onStart(newGame(settings, names, cardsFor(settings), Date.now() % 2147483647));
  };

  return (
    <div className="table theme-regular setup">
      <header className="setup-head">
        <h1 className="wordmark">
          Hitster<span>at the table</span>
        </h1>
        {canResume && (
          <button type="button" className="ghost-btn" onClick={onResume}>
            Resume last game
          </button>
        )}
      </header>

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

      <section className="setup-block">
        <h2>Which cards</h2>
        <div className="set-picker">
          {(Object.keys(SET_INFO) as SetId[]).map((id) => {
            const on = settings.sets.includes(id);
            const s = SET_SAMPLE[id];
            return (
              <button key={id} type="button" className={`set-card${on ? ' is-on' : ''}`} onClick={() => toggleSet(id)} aria-pressed={on}>
                <div className={`face card-${id} sample-${id}`}>
                                    {id === 'jazz' ? (
                    <div className="face-band">
                      <span>{s.top}</span>
                    </div>
                  ) : (
                    <div className="face-top">{s.top}</div>
                  )}
                  <div className="face-year">{s.year}</div>
                  <div className="face-bottom">
                    <span className="face-title">{s.bottom}</span>
                  </div>
                </div>
                <span className="set-count">
                  {on && <Icon name="check" size={14} />} {counts[id]} cards
                </span>
              </button>
            );
          })}
        </div>
        {settings.sets.includes('regular') && (
          <label className="switch">
            <input type="checkbox" checked={settings.includeDutch} onChange={(e) => update({ includeDutch: e.target.checked })} />
            <span>Include Dutch and Flemish hits</span>
          </label>
        )}
      </section>

      <section className="setup-block">
        <h2>House rules</h2>
        <div className="variants">
          {VARIANTS.map((v) => (
            <button key={v.id} type="button" className={`variant${settings.variant === v.id ? ' is-on' : ''}`} onClick={() => update({ variant: v.id })}>
              <b>{v.name}</b>
              <small>{v.blurb}</small>
            </button>
          ))}
        </div>
        <Stepper label="Cards to win" value={settings.target} min={5} max={20} onChange={(target) => update({ target })} />
        <Stepper label="Starting chips" value={settings.startChips} min={0} max={settings.maxChips} onChange={(startChips) => update({ startChips })} />
        <Stepper label="Most chips you can hold" value={settings.maxChips} min={1} max={10} onChange={(maxChips) => update({ maxChips, startChips: Math.min(settings.startChips, maxChips) })} />
      </section>

      <footer className="setup-foot">
        {error && <p className="form-error">{error}</p>}
        <button type="button" key={nudge} className={`slab${seated ? '' : ' is-waiting'}${nudge ? ' is-nudged' : ''}`} onClick={start}>
          Deal the cards
        </button>
        <p className={`deck-note${seated ? '' : ' is-hint'}`}>
          {seated ? `${deckSize} cards in the deck` : names.length ? 'Add one more player to deal' : 'Add at least two players to deal'}
        </p>
      </footer>
    </div>
  );
}
