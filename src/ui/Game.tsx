import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { usePlayback } from '../audio/usePlayback';
import { BUY_COST, SKIP_COST, activePlayer, challengers, takenSlots, type Action } from '../engine/game';
import { earnsChip } from '../engine/rules';
import type { GameState, Player } from '../engine/types';
import { CardBack, CardFace, PLAYER_COLORS, Token, cardColor } from './cards';
import { Fx, type FxEvent } from './fx/Fx';
import { Icon } from './Icon';
import { Seats } from './Seats';
import { Timeline, type Marker } from './Timeline';
import { Victory } from './Victory';

interface Props {
  state: GameState;
  dispatch: (a: Action) => void;
  onExit: () => void;
}

const buzz = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iOS); haptics are a nicety.
  }
};

function fmt(sec: number) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Game({ state, dispatch, onExit }: Props) {
  const active = activePlayer(state);
  const card = state.current;
  const set = card?.set ?? state.settings.sets[0];
  const colors = useMemo(
    () => Object.fromEntries(state.players.map((p, i) => [p.id, PLAYER_COLORS[i % PLAYER_COLORS.length]])),
    [state.players],
  );
  const byId = (id: string) => state.players.find((p) => p.id === id) as Player;
  const playback = usePlayback(card, state.draw);

  const [fx, setFx] = useState<FxEvent | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [nudge, setNudge] = useState(0);
  const [freshId, setFreshId] = useState<string | undefined>();

  const say = (text: string) => setToast({ id: Date.now(), text });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // The big moment: fire the themed effect as soon as the card is turned over.
  useEffect(() => {
    if (state.phase !== 'reveal' || !state.outcome || !card) return;
    const o = state.outcome;
    const kind = o.placedCorrectly ? 'hit' : o.stealerId ? 'steal' : 'miss';
    buzz(kind === 'hit' ? [20, 40, 20] : kind === 'steal' ? [60, 30, 60] : 120);
    setFx({ id: state.draw, kind, set: card.set, who: kind === 'steal' ? byId(o.stealerId!).name : active.name, loot: cardColor(card) });
    // Fires once per revealed card.
  }, [state.phase, state.draw]);

  const picking = state.picking;
  const picker = picking ? byId(picking.playerId) : null;
  const canChallenge = challengers(state);

  const markers: Marker[] = state.challenges.map((c) => {
    const result = state.outcome?.challenges.find((r) => r.playerId === c.playerId);
    return { slot: c.slot, name: byId(c.playerId).name, color: colors[c.playerId], correct: result?.correct };
  });
  if (state.phase === 'challenge' && state.slot !== null && picking) {
    markers.unshift({ slot: state.slot, name: active.name, color: colors[active.id] });
  }

  const next = () => {
    if (earnsChip(state.named)) say(`+1 chip for ${active.name}`);
    const o = state.outcome;
    if (o && card) setFreshId(card.id);
    setFx(null);
    dispatch({ type: 'next' });
  };

  const lockIn = () => {
    if (state.slot === null) {
      setNudge((n) => n + 1);
      say('Tap a slot in the timeline first');
      return;
    }
    buzz(25);
    dispatch({ type: 'lockIn' });
  };

  const lockChallenge = () => {
    if (!picking || picking.slot === null) {
      setNudge((n) => n + 1);
      say(`${picker?.name}: tap a different slot`);
      return;
    }
    buzz(25);
    dispatch({ type: 'lockChallenge' });
  };

  const peekPlayer = peek ? byId(peek) : null;
  const revealed = state.phase === 'reveal' || state.phase === 'over';
  const timelineOwner = peekPlayer ?? active;

  return (
    <div
      className={`table game theme-${set}${fx?.kind === 'miss' ? ' is-shaking' : ''}`}
      style={{ '--active': colors[active.id], '--picker': picker ? colors[picker.id] : undefined } as CSSProperties}
    >
      <header className="table-top">
        <Seats
          players={state.players}
          colors={colors}
          activeId={active.id}
          highlightId={picker?.id}
          target={state.settings.target}
          onPeek={(id) => setPeek(id === active.id ? null : id)}
        />
        <button type="button" className="menu-btn" aria-label="End game" onClick={() => confirm('End this game?') && onExit()}>
          <Icon name="menu" />
        </button>
      </header>

      <section className="deck-zone">
        <div className={`deck${revealed ? ' is-revealed' : ''}`}>
          <div className="deck-stack" />
          {card && (
            <div className={`flip${revealed ? ' is-flipped' : ''}`} key={state.draw}>
              <div className="flip-back">
                <CardBack set={card.set} spinning={playback.playing} />
              </div>
              <div className="flip-face">
                <CardFace card={card} />
              </div>
            </div>
          )}
          <div className="yt-host" ref={playback.host} aria-hidden="true" />
        </div>

        {revealed && card ? (
          <aside className="liner" key={`liner-${state.draw}`}>
            {card.trivia && <p>{card.trivia}</p>}
            {card.accept && (
              <p className="liner-accept">
                <b>Counts as naming it:</b> {card.accept}
              </p>
            )}
            <dl>
              {card.facts.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        ) : (
          <div className="controls">
            <div className="turn-label" style={{ color: colors[active.id] }}>
              {active.name}
            </div>
            <div className="turn-hint">
              {state.phase === 'place'
                ? state.slot === null
                  ? 'Listen, then tap a slot'
                  : 'Happy? Lock it in'
                : picker
                  ? `${picker.name} is challenging`
                  : 'Anyone want to challenge?'}
            </div>
            <div className="transport">
              <button type="button" className="btn-play" onClick={playback.toggle} aria-label={playback.playing ? 'Pause' : 'Play'}>
                <Icon name={playback.playing ? 'pause' : 'play'} size={30} />
              </button>
              <button type="button" className="btn-round" onClick={playback.restart} aria-label="Restart song">
                <Icon name="restart" size={18} />
              </button>
              <button type="button" className="btn-round" onClick={() => playback.seekBy(15)} aria-label="Forward 15 seconds">
                +15
              </button>
            </div>
            <div className="progress" title={playback.label}>
              <i style={{ width: `${(playback.position / playback.duration) * 100}%` }} />
            </div>
            <div className="progress-meta">
              <span>{fmt(playback.position)}</span>
              <span>{playback.label}</span>
            </div>
          </div>
        )}
      </section>

      <section className="timeline-zone">
        {peekPlayer ? (
          <div className="zone-banner">
            <span>
              <Token name={peekPlayer.name} color={colors[peekPlayer.id]} size={22} /> {peekPlayer.name}'s timeline
            </span>
            <button type="button" onClick={() => setPeek(null)}>
              Back to {active.name}
            </button>
          </div>
        ) : picker ? (
          <div className="zone-banner is-picker">
            <span>
              <Token name={picker.name} color={colors[picker.id]} size={22} /> {picker.name}: tap where it really goes
            </span>
          </div>
        ) : null}
        <div className="timeline-scroll">
          <Timeline
            cards={timelineOwner.timeline}
            mystery={peekPlayer ? null : card}
            selectable={!peekPlayer && (state.phase === 'place' || !!picking)}
            selected={peekPlayer ? null : picking ? picking.slot : state.phase === 'reveal' ? null : state.slot}
            selectedBy={
              picking ? { name: picker!.name, color: colors[picker!.id] } : { name: active.name, color: colors[active.id] }
            }
            blocked={picking ? takenSlots(state) : []}
            markers={peekPlayer ? [] : markers}
            reveal={
              !peekPlayer && state.phase === 'reveal' && state.outcome && state.slot !== null
                ? { slot: state.slot, correct: state.outcome.placedCorrectly, fits: state.outcome.correctSlots }
                : null
            }
            freshId={freshId}
            onSelect={(slot) => {
              buzz(8);
              dispatch({ type: 'selectSlot', slot });
            }}
          />
        </div>
      </section>

      <footer className="actions" data-phase={state.phase}>
        {state.phase === 'place' && (
          <>
            <div className="side-actions">
              <button
                type="button"
                className="chip-btn"
                onClick={() => (active.chips >= SKIP_COST ? dispatch({ type: 'skip' }) : say('Skipping costs 1 chip'))}
              >
                <Icon name="skip" size={16} /> Skip <i className="coin" />
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => (active.chips >= BUY_COST ? dispatch({ type: 'buyCard' }) : say('Buying a card costs 3 chips'))}
              >
                Buy card <i className="coin" />
                <i className="coin" />
                <i className="coin" />
              </button>
            </div>
            <button
              type="button"
              key={nudge}
              className={`slab${state.slot === null ? ' is-waiting' : ''}${nudge ? ' is-nudged' : ''}`}
              onClick={lockIn}
            >
              Lock in
            </button>
          </>
        )}

        {state.phase === 'challenge' && !picking && (
          <>
            {canChallenge.length > 0 ? (
              <button
                type="button"
                className="challenge"
                onClick={() => {
                  buzz([40, 30, 40]);
                  if (canChallenge.length === 1) dispatch({ type: 'startChallenge', playerId: canChallenge[0].id });
                  else setAsking(true);
                }}
              >
                Challenge!
              </button>
            ) : (
              <p className="no-challenge">Nobody has a chip left to challenge</p>
            )}
            <button
              type="button"
              className={canChallenge.length > 0 ? 'reveal-side' : 'slab'}
              onClick={() => dispatch({ type: 'reveal' })}
            >
              {canChallenge.length > 0 ? (
                <>
                  <span>Reveal</span>
                  <small>{state.challenges.length ? `${state.challenges.length} in` : 'no one?'}</small>
                </>
              ) : (
                'Reveal'
              )}
            </button>
          </>
        )}

        {state.phase === 'challenge' && picking && picker && (
          <>
            <button type="button" className="ghost-btn" onClick={() => dispatch({ type: 'cancelChallenge' })}>
              Cancel
            </button>
            <button
              type="button"
              key={nudge}
              className={`slab slab-picker${picking.slot === null ? ' is-waiting' : ''}${nudge ? ' is-nudged' : ''}`}
              onClick={lockChallenge}
            >
              Lock in · {picker.name}
            </button>
          </>
        )}

        {state.phase === 'reveal' && card && (
          <div className="named">
            <p className="named-q">Did {active.name} name it out loud?</p>
            <div className="named-row">
              {(
                [
                  ['primary', card.primaryLabel],
                  ['secondary', card.secondaryLabel],
                  ...(state.settings.variant === 'expert' ? [['year', 'Exact year']] : []),
                ] as [keyof GameState['named'], string][]
              ).map(([field, label]) => (
                <button
                  key={field}
                  type="button"
                  className={`toggle${state.named[field] ? ' is-on' : ''}`}
                  onClick={() => dispatch({ type: 'toggleNamed', field })}
                  aria-pressed={state.named[field]}
                >
                  <Icon name={state.named[field] ? 'check' : 'plus'} size={16} /> {label}
                </button>
              ))}
            </div>
            <div className="named-foot">
              <span className="named-note">
                {earnsChip(state.named) ? (
                  <>
                    <i className="coin" /> +1 chip
                  </>
                ) : (
                  'Both = 1 chip'
                )}
              </span>
              <button type="button" className="slab slab-next" onClick={next}>
                Next: {state.players[(state.turn + 1) % state.players.length].name}
              </button>
            </div>
          </div>
        )}
      </footer>

      {asking && (
        <div className="sheet-backdrop" onClick={() => setAsking(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Who called it first?</h2>
            <div className="sheet-players">
              {canChallenge.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="sheet-player"
                  onClick={() => {
                    setAsking(false);
                    dispatch({ type: 'startChallenge', playerId: p.id });
                  }}
                >
                  <Token name={p.name} color={colors[p.id]} size={56} />
                  <span>{p.name}</span>
                  <small>
                    {p.chips} chip{p.chips === 1 ? '' : 's'}
                  </small>
                </button>
              ))}
            </div>
            <button type="button" className="ghost-btn" onClick={() => setAsking(false)}>
              Never mind
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
      {fx && <Fx event={fx} onDone={() => setFx(null)} />}
      {state.phase === 'over' && state.winnerId && (
        <Victory winner={byId(state.winnerId)} color={colors[state.winnerId]} set={set} onExit={onExit} />
      )}
    </div>
  );
}
