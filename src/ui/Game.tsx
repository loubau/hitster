import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { usePlayback } from '../audio/usePlayback';
import { BUY_COST, SKIP_COST, activePlayer, buyAllowed, challengers, skipAllowed, takenSlots, type Action } from '../engine/game';
import { earnsChip } from '../engine/rules';
import type { Card, GameState, Player } from '../engine/types';
import { submitFeedback } from '../feedback';
import type { RoomClient, RoomView } from '../room/client';
import { useRoomPlayback } from '../room/useRoomPlayback';
import { CardBack, CardFace, PLAYER_COLORS, Token, cardColor } from './cards';
import { FeedbackSheet } from './FeedbackSheet';
import { Fx, type FxEvent } from './fx/Fx';
import { Icon } from './Icon';
import { Menu, type MenuItem } from './Menu';
import { inviteTo } from './RoomCode';
import { Seats } from './Seats';
import { Timeline, type Marker } from './Timeline';
import { Victory } from './Victory';

/** This device's seat in a room game: its own actions, its own sound. */
export interface RoomSeat {
  client: RoomClient;
  view: RoomView;
  muted: boolean;
  onMute: (muted: boolean) => void;
}

interface Props {
  state: GameState;
  dispatch: (a: Action) => void;
  onExit: () => void;
  /** Left out at the table: one phone does everything. */
  room?: RoomSeat;
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

export function Game({ state, dispatch, onExit, room }: Props) {
  const active = activePlayer(state);
  const meId = room?.view.me.id;
  const isHost = !!room?.view.isHost;
  /** At the table anyone may do anything; in a room, what this player may do now. */
  const may = (a: Action) => !room || room.client.may(a);
  const isMe = (id: string) => !!room && id === meId;
  const card = state.current;
  const set = card?.set ?? state.settings.sets[0];
  const colors = useMemo(
    () => Object.fromEntries(state.players.map((p, i) => [p.id, PLAYER_COLORS[i % PLAYER_COLORS.length]])),
    [state.players],
  );
  const byId = (id: string) => state.players.find((p) => p.id === id) as Player;
  // In a room only the host starts the music; everyone else follows it, muted or not.
  const playback = usePlayback(card, state.draw, { autoplay: !room || isHost, muted: room?.muted ?? false });
  const transport = useRoomPlayback(room?.client ?? null, isHost, playback, card?.id, state.draw);

  const [fx, setFx] = useState<FxEvent | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [nudge, setNudge] = useState(0);
  const [freshId, setFreshId] = useState<string | undefined>();
  const [noting, setNoting] = useState(false);
  /** The last few revealed cards, newest first, so players can still leave a note on them. */
  const [recent, setRecent] = useState<{ card: Card; videoId?: string }[]>([]);

  const say = (text: string) => setToast({ id: Date.now(), text });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // Room: anyone's Next moves the table on, so every device files away the card that just left.
  const before = useRef({ state, videoId: playback.videoId });
  useEffect(() => {
    const prev = before.current;
    before.current = { state, videoId: playback.videoId };
    const left = prev.state.current;
    if (!room || prev.state.draw === state.draw || prev.state.phase !== 'reveal' || !left) return;
    const was = activePlayer(prev.state);
    if (earnsChip(prev.state.named)) say(isMe(was.id) ? '+1 chip for you' : `+1 chip for ${was.name}`);
    setFreshId(left.id);
    setRecent((r) => [{ card: left, videoId: prev.videoId }, ...r.filter((x) => x.card.id !== left.id)].slice(0, 3));
    setFx(null);
  }, [state, playback.videoId]);

  // Failover: the earliest player still here takes over the room (and the music).
  const wasHost = useRef(isHost);
  useEffect(() => {
    if (isHost && !wasHost.current) say("You're the host now");
    wasHost.current = isHost;
  }, [isHost]);

  /** A challenge waits on the host, so the button shows it was heard. */
  const [calling, setCalling] = useState(false);
  useEffect(() => setCalling(false), [state.phase, state.picking?.playerId, state.draw]);
  useEffect(() => {
    if (!calling) return;
    const t = setTimeout(() => setCalling(false), 4000);
    return () => clearTimeout(t);
  }, [calling]);

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
    if (room) return dispatch({ type: 'next' });
    if (earnsChip(state.named)) say(`+1 chip for ${active.name}`);
    const o = state.outcome;
    if (o && card) setFreshId(card.id);
    if (card) setRecent((r) => [{ card, videoId: playback.videoId }, ...r.filter((x) => x.card.id !== card.id)].slice(0, 3));
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
  const skipOn = skipAllowed(state.settings);
  const buyOn = buyAllowed(state.settings);
  const mine = isMe(active.id);
  const nextUp = state.players[(state.turn + 1) % state.players.length];
  const hostName = room?.view.room?.members.find((m) => m.id === room.view.room?.hostId)?.name ?? 'the host';
  const invite = room ? inviteTo(room.view.code, say) : null;
  const away = room ? new Set(state.players.filter((p) => !room.view.online.has(p.id)).map((p) => p.id)) : undefined;

  const menu: MenuItem[] =
    room && invite
      ? [
          { id: 'copy', label: 'Copy room link', onSelect: invite.copy },
          ...(invite.share ? [{ id: 'share', label: 'Share invite', onSelect: invite.share }] : []),
          ...(isHost ? [{ id: 'lobby', label: 'Back to the lobby', confirm: 'Sure? End this game', onSelect: () => room.client.endGame() }] : []),
          { id: 'feedback', label: 'Feedback', onSelect: () => setNoting(true) },
          { id: 'exit', label: 'Leave room', confirm: 'Sure? Leave room', onSelect: onExit },
        ]
      : [
          { id: 'feedback', label: 'Feedback', onSelect: () => setNoting(true) },
          { id: 'exit', label: 'Exit game', confirm: 'Sure? End game', onSelect: onExit },
        ];

  // In a room nobody should have to wonder whose turn it is.
  const turnLabel = !room ? active.name : mine ? 'Your turn' : state.phase === 'place' ? `${active.name} is placing` : `${active.name}'s turn`;
  const turnHint =
    state.phase === 'place'
      ? !may({ type: 'lockIn' })
        ? 'Listen along'
        : state.slot === null
          ? 'Listen, then tap a slot'
          : 'Happy? Lock it in'
      : picker
        ? isMe(picker.id)
          ? 'Your challenge'
          : `${picker.name} is challenging`
        : 'Anyone want to challenge?';

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
          meId={meId}
          away={away}
          onPeek={(id) => setPeek(id === active.id ? null : id)}
        />
        {room && (
          <button
            type="button"
            className={`mute-btn${room.muted ? ' is-muted' : ''}`}
            aria-pressed={!room.muted}
            aria-label="Sound on this phone"
            onClick={() => room.onMute(!room.muted)}
          >
            <Icon name={room.muted ? 'muted' : 'sound'} />
          </button>
        )}
        <Menu items={menu} />
      </header>
      {room && (room.view.link !== 'live' || room.view.hostAway) && (
        <div className="room-banner" role="status">
          {room.view.link !== 'live' ? 'Reconnecting…' : `Waiting for ${hostName}…`}
        </div>
      )}

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
            <div className={room ? 'turn-label is-room' : 'turn-label'} style={{ color: colors[active.id] }}>
              {turnLabel}
            </div>
            <div className="turn-hint">{turnHint}</div>
            <div className="transport">
              <button
                type="button"
                className="btn-play"
                onClick={transport.toggle}
                disabled={!transport.canControl}
                aria-label={playback.playing ? 'Pause' : 'Play'}
              >
                <Icon name={playback.playing ? 'pause' : 'play'} size={30} />
              </button>
              <button type="button" className="btn-round" onClick={transport.restart} disabled={!transport.canControl} aria-label="Restart song">
                <Icon name="restart" size={18} />
              </button>
              <button
                type="button"
                className="btn-round"
                onClick={() => transport.seekBy(15)}
                disabled={!transport.canControl}
                aria-label="Forward 15 seconds"
              >
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
              <Token name={picker.name} color={colors[picker.id]} size={22} />{' '}
              {isMe(picker.id)
                ? 'You: tap where it really goes'
                : may({ type: 'lockChallenge' })
                  ? `${picker.name}: tap where it really goes`
                  : `${picker.name} is picking a slot`}
            </span>
          </div>
        ) : null}
        <div className="timeline-scroll">
          <Timeline
            cards={timelineOwner.timeline}
            mystery={peekPlayer ? null : card}
            selectable={!peekPlayer && (state.phase === 'place' || !!picking) && may({ type: 'selectSlot', slot: 0 })}
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
        {state.phase === 'place' && !may({ type: 'lockIn' }) && <p className="no-challenge">Waiting for {active.name} to lock in</p>}

        {state.phase === 'place' && may({ type: 'lockIn' }) && (
          <>
            {(skipOn || buyOn) && (
              <div className="side-actions">
                {skipOn && (
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => (active.chips >= SKIP_COST ? dispatch({ type: 'skip' }) : say('Skipping costs 1 chip'))}
                  >
                    <Icon name="skip" size={16} /> Skip <i className="coin" />
                  </button>
                )}
                {buyOn && (
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => (active.chips >= BUY_COST ? dispatch({ type: 'buyCard' }) : say('Buying a card costs 3 chips'))}
                  >
                    Buy card <i className="coin" />
                    <i className="coin" />
                    <i className="coin" />
                  </button>
                )}
              </div>
            )}
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

        {room && state.phase === 'challenge' && !picking && (
          <>
            {canChallenge.some((p) => p.id === meId) ? (
              <button
                type="button"
                className="challenge"
                disabled={calling}
                onClick={() => {
                  buzz([40, 30, 40]);
                  setCalling(true);
                  dispatch({ type: 'startChallenge', playerId: meId! });
                }}
              >
                {calling ? 'Calling it…' : 'Challenge!'}
              </button>
            ) : (
              <p className="no-challenge">
                {mine
                  ? canChallenge.length > 0
                    ? 'Anyone think you got it wrong?'
                    : 'Nobody has a chip left to challenge'
                  : state.challenges.some((c) => c.playerId === meId)
                    ? 'Your challenge is in'
                    : 'No chip left to challenge with'}
              </p>
            )}
            {may({ type: 'reveal' }) && (
              <button type="button" className={canChallenge.length > 0 ? 'reveal-side' : 'slab'} onClick={() => dispatch({ type: 'reveal' })}>
                {canChallenge.length > 0 ? (
                  <>
                    <span>Reveal</span>
                    <small>{state.challenges.length ? `${state.challenges.length} in` : 'no one?'}</small>
                  </>
                ) : (
                  'Reveal'
                )}
              </button>
            )}
          </>
        )}

        {!room && state.phase === 'challenge' && !picking && (
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

        {state.phase === 'challenge' && picking && picker && !may({ type: 'lockChallenge' }) && (
          <>
            {may({ type: 'cancelChallenge' }) && (
              <button type="button" className="ghost-btn" onClick={() => dispatch({ type: 'cancelChallenge' })}>
                Cancel
              </button>
            )}
            <p className="no-challenge">{picker.name} is picking a slot</p>
          </>
        )}

        {state.phase === 'challenge' && picking && picker && may({ type: 'lockChallenge' }) && (
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
            <p className="named-q">Did {mine ? 'you' : active.name} name it out loud?</p>
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
                  disabled={!may({ type: 'toggleNamed', field })}
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
              {may({ type: 'next' }) ? (
                <button type="button" className="slab slab-next" onClick={next}>
                  Next: {isMe(nextUp.id) ? 'you' : nextUp.name}
                </button>
              ) : (
                <span className="named-wait">Waiting for {active.name}</span>
              )}
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

      {noting && (
        <FeedbackSheet
          choices={[
            ...(card ? [{ card, videoId: playback.videoId, revealed }] : []),
            ...recent.filter((r) => r.card.id !== card?.id).map((r) => ({ ...r, revealed: true })),
          ]}
          onClose={() => setNoting(false)}
          onSend={(f) => {
            setNoting(false);
            say('Thanks, noted');
            void submitFeedback({ ...f, mode: room ? 'room' : 'table', roomCode: room?.view.code ?? null });
            if (f.videoId && f.reasons.includes('bad-youtube')) playback.reportVideo(f.videoId, f.cardId);
          }}
        />
      )}

      {toast && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
      {fx && <Fx event={fx} onDone={() => setFx(null)} />}
      {state.phase === 'over' && state.winnerId && (
        <Victory
          winner={byId(state.winnerId)}
          color={colors[state.winnerId]}
          set={set}
          {...(!room
            ? { onExit }
            : isHost
              ? { onExit: () => room.client.endGame(), note: 'Everyone goes back to the lobby' }
              : { onExit, label: 'Leave room', note: `${hostName} can deal a new game` })}
        />
      )}
    </div>
  );
}
